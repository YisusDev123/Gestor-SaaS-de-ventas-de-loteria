import { AppError } from '../error/app-error.js';

function configurationConflict() {
  return new AppError('La configuración cambió en otra sesión. Recargue e intente nuevamente.', {
    statusCode: 409,
    code: 'CONFIGURATION_VERSION_CONFLICT',
  });
}

function resourceNotFound(resource) {
  return new AppError(`${resource} no existe o no está disponible.`, {
    statusCode: 404,
    code: 'CATALOG_RESOURCE_NOT_FOUND',
  });
}

async function rollbackOrUnknown(connection, error, commitStarted) {
  if (commitStarted) {
    connection.destroy?.();
    throw new AppError('No fue posible confirmar el resultado de la operación.', {
      statusCode: 503,
      code: 'COMMIT_OUTCOME_UNKNOWN',
    });
  }
  try {
    await connection.rollback();
  } catch {
    connection.destroy?.();
  }
  throw error;
}

async function validarActor(connection, tenantId, userId) {
  const [rows] = await connection.execute(
    `SELECT tm.id
     FROM tenant_memberships tm
     JOIN tenants t ON t.id = tm.tenant_id
     JOIN users u ON u.id = tm.user_id
     WHERE tm.tenant_id = ? AND tm.user_id = ?
       AND tm.status = 'ACTIVE' AND tm.role IN ('OWNER', 'MANAGER')
       AND t.status = 'ACTIVE' AND u.status = 'ACTIVE'
     LIMIT 1 FOR UPDATE`,
    [tenantId, userId],
  );
  if (!rows[0]) {
    throw new AppError('No tiene permisos para modificar esta configuración.', {
      statusCode: 403,
      code: 'INSUFFICIENT_ROLE',
    });
  }
}

async function auditar(connection, {
  tenantId, userId, eventType, entityType, entityId, correlationId, metadata,
}) {
  await connection.execute(
    `INSERT INTO audit_events
      (tenant_id, actor_scope, actor_id, event_type, entity_type, entity_id,
       correlation_id, metadata)
     VALUES (?, 'USER', ?, ?, ?, ?, ?, ?)`,
    [tenantId, userId, eventType, entityType, entityId, correlationId, JSON.stringify(metadata)],
  );
}

async function transaccion(pool, operation) {
  const connection = await pool.getConnection();
  let commitStarted = false;
  try {
    await connection.beginTransaction();
    const result = await operation(connection);
    commitStarted = true;
    await connection.commit();
    return result;
  } catch (error) {
    return rollbackOrUnknown(connection, error, commitStarted);
  } finally {
    connection.release?.();
  }
}

function requireVersion(row, expectedVersion) {
  const currentVersion = row ? Number(row.configVersion) : 0;
  if (currentVersion !== expectedVersion) throw configurationConflict();
  return currentVersion + 1;
}

export function iniciarBaseDeDatosTenantSettings(pool) {
  return {
    async obtenerCatalogoConfigurado(tenantId) {
      const [rows] = await pool.execute(
        `SELECT l.id AS lotteryId, l.code AS lotteryCode, l.name AS lotteryName,
                l.is_active AS lotteryCatalogActive, l.sort_order AS lotterySortOrder,
                COALESCE(tl.is_enabled, FALSE) AS lotteryEnabled,
                COALESCE(tl.config_version, 0) AS lotteryConfigVersion,
                lm.id AS modalityId, lm.code AS modalityCode, lm.name AS modalityName,
                lm.is_active AS modalityCatalogActive, lm.sort_order AS modalitySortOrder,
                COALESCE(tm.is_enabled, FALSE) AS modalityEnabled,
                tm.multiplier, COALESCE(tm.config_version, 0) AS modalityConfigVersion,
                ds.id AS scheduleId, ds.code AS scheduleCode,
                TIME_FORMAT(ds.local_time, '%H:%i') AS localTimeValue,
                ds.default_close_minutes_before AS defaultCloseMinutesBefore,
                ds.is_active AS scheduleCatalogActive,
                COALESCE(ts.is_enabled, FALSE) AS scheduleEnabled,
                COALESCE(ts.close_minutes_before, ds.default_close_minutes_before) AS closeMinutesBefore,
                COALESCE(ts.config_version, 0) AS scheduleConfigVersion,
                (SELECT GROUP_CONCAT(dsw.iso_weekday ORDER BY dsw.iso_weekday)
                   FROM draw_schedule_weekdays dsw
                  WHERE dsw.draw_schedule_id = ds.id) AS weekdays
         FROM lotteries l
         LEFT JOIN tenant_lotteries tl ON tl.lottery_id = l.id AND tl.tenant_id = ?
         LEFT JOIN lottery_modalities lm ON lm.lottery_id = l.id
         LEFT JOIN tenant_modalities tm ON tm.lottery_modality_id = lm.id AND tm.tenant_id = ?
         LEFT JOIN draw_schedules ds ON ds.lottery_modality_id = lm.id
         LEFT JOIN tenant_schedules ts ON ts.draw_schedule_id = ds.id AND ts.tenant_id = ?
         ORDER BY l.sort_order, l.code, lm.sort_order, lm.code, ds.local_time, ds.code`,
        [tenantId, tenantId, tenantId],
      );
      const [businessRows] = await pool.execute(
        `SELECT t.display_name AS displayName, t.timezone, t.currency_code AS currencyCode,
                COALESCE(tbs.receipt_fields, JSON_OBJECT()) AS receiptFields,
                COALESCE(tbs.config_version, 0) AS businessConfigVersion,
                tls.general_number_limit AS generalNumberLimit,
                COALESCE(tls.config_version, 0) AS limitConfigVersion
         FROM tenants t
         LEFT JOIN tenant_business_settings tbs ON tbs.tenant_id = t.id
         LEFT JOIN tenant_limit_settings tls ON tls.tenant_id = t.id
         WHERE t.id = ? LIMIT 1`,
        [tenantId],
      );
      return { rows, business: businessRows[0] || null };
    },

    async obtenerDisponibilidadDiaria(tenantId, businessDate) {
      const [rows] = await pool.execute(
        `SELECT l.code AS lotteryCode, l.name AS lotteryName,
                tl.is_enabled AS permanentlyEnabled,
                COALESCE(tdla.is_enabled_for_sales, tl.is_enabled) AS enabledForSales,
                COALESCE(tdla.config_version, 0) AS configVersion,
                tdla.reason, tdla.changed_at AS changedAt
         FROM lotteries l
         JOIN tenant_lotteries tl ON tl.lottery_id = l.id AND tl.tenant_id = ?
         LEFT JOIN tenant_daily_lottery_availability tdla
           ON tdla.lottery_id = l.id AND tdla.tenant_id = tl.tenant_id
          AND tdla.business_date = ?
         WHERE l.is_active = TRUE
         ORDER BY l.sort_order, l.code`,
        [tenantId, businessDate],
      );
      return rows;
    },

    async actualizarNegocioTransaccional(tenantId, userId, input, correlationId) {
      return transaccion(pool, async (connection) => {
        await validarActor(connection, tenantId, userId);
        const [tenantRows] = await connection.execute(
          'SELECT display_name AS displayName FROM tenants WHERE id = ? LIMIT 1 FOR UPDATE',
          [tenantId],
        );
        const tenant = tenantRows[0];
        if (!tenant) throw resourceNotFound('El tenant');
        const [settingRows] = await connection.execute(
          `SELECT receipt_fields AS receiptFields, config_version AS configVersion
           FROM tenant_business_settings WHERE tenant_id = ? FOR UPDATE`,
          [tenantId],
        );
        const current = settingRows[0] || null;
        const configVersion = requireVersion(current, input.expectedVersion);
        await connection.execute('UPDATE tenants SET display_name = ? WHERE id = ?', [input.displayName, tenantId]);
        if (input.expectedVersion === 0) {
          await connection.execute(
            `INSERT INTO tenant_business_settings
              (tenant_id, receipt_fields, config_version, updated_by_user_id)
             VALUES (?, ?, 1, ?)`,
            [tenantId, JSON.stringify(input.receiptFields), userId],
          );
        } else {
          await connection.execute(
            `UPDATE tenant_business_settings
             SET receipt_fields = ?, config_version = ?, updated_by_user_id = ?
             WHERE tenant_id = ?`,
            [JSON.stringify(input.receiptFields), configVersion, userId, tenantId],
          );
        }
        await auditar(connection, {
          tenantId, userId, eventType: 'TENANT_BUSINESS_SETTINGS_UPDATED',
          entityType: 'TENANT', entityId: tenantId, correlationId,
          metadata: {
            previous: { displayName: tenant.displayName, receiptFields: current?.receiptFields || {} },
            next: { displayName: input.displayName, receiptFields: input.receiptFields },
            configVersion,
          },
        });
        return { displayName: input.displayName, receiptFields: input.receiptFields, configVersion };
      });
    },

    async actualizarLoteriaTransaccional(tenantId, userId, lotteryCode, input, correlationId) {
      return transaccion(pool, async (connection) => {
        await validarActor(connection, tenantId, userId);
        const [catalogRows] = await connection.execute(
          'SELECT id, code, name FROM lotteries WHERE code = ? AND is_active = TRUE LIMIT 1 FOR UPDATE',
          [lotteryCode],
        );
        const lottery = catalogRows[0];
        if (!lottery) throw resourceNotFound('La lotería');
        const [rows] = await connection.execute(
          `SELECT is_enabled AS isEnabled, config_version AS configVersion
           FROM tenant_lotteries WHERE tenant_id = ? AND lottery_id = ? FOR UPDATE`,
          [tenantId, lottery.id],
        );
        const current = rows[0] || null;
        const configVersion = requireVersion(current, input.expectedVersion);
        if (!current) {
          await connection.execute(
            `INSERT INTO tenant_lotteries (tenant_id, lottery_id, is_enabled, config_version)
             VALUES (?, ?, ?, 1)`,
            [tenantId, lottery.id, input.isEnabled],
          );
        } else {
          await connection.execute(
            `UPDATE tenant_lotteries SET is_enabled = ?, config_version = ?
             WHERE tenant_id = ? AND lottery_id = ?`,
            [input.isEnabled, configVersion, tenantId, lottery.id],
          );
        }
        await auditar(connection, {
          tenantId, userId, eventType: 'TENANT_LOTTERY_UPDATED', entityType: 'LOTTERY',
          entityId: lottery.id, correlationId,
          metadata: { lotteryCode, previous: current, next: { isEnabled: input.isEnabled }, configVersion },
        });
        return { lotteryCode, isEnabled: input.isEnabled, configVersion };
      });
    },

    async actualizarModalidadTransaccional(tenantId, userId, codes, input, correlationId) {
      return transaccion(pool, async (connection) => {
        await validarActor(connection, tenantId, userId);
        const [catalogRows] = await connection.execute(
          `SELECT lm.id, lm.code, lm.name
           FROM lottery_modalities lm JOIN lotteries l ON l.id = lm.lottery_id
           WHERE l.code = ? AND lm.code = ? AND l.is_active = TRUE AND lm.is_active = TRUE
           LIMIT 1 FOR UPDATE`,
          [codes.lotteryCode, codes.modalityCode],
        );
        const modality = catalogRows[0];
        if (!modality) throw resourceNotFound('La modalidad');
        const [rows] = await connection.execute(
          `SELECT is_enabled AS isEnabled, multiplier, config_version AS configVersion
           FROM tenant_modalities WHERE tenant_id = ? AND lottery_modality_id = ? FOR UPDATE`,
          [tenantId, modality.id],
        );
        const current = rows[0] || null;
        const configVersion = requireVersion(current, input.expectedVersion);
        if (!current) {
          await connection.execute(
            `INSERT INTO tenant_modalities
              (tenant_id, lottery_modality_id, is_enabled, multiplier, config_version, updated_by_user_id)
             VALUES (?, ?, ?, ?, 1, ?)`,
            [tenantId, modality.id, input.isEnabled, input.multiplier, userId],
          );
        } else {
          await connection.execute(
            `UPDATE tenant_modalities
             SET is_enabled = ?, multiplier = ?, config_version = ?, updated_by_user_id = ?
             WHERE tenant_id = ? AND lottery_modality_id = ?`,
            [input.isEnabled, input.multiplier, configVersion, userId, tenantId, modality.id],
          );
        }
        let openedPendingDraws = 0;
        if (input.isEnabled) {
          const [drawResult] = await connection.execute(
            `UPDATE draws d
             JOIN draw_schedules ds ON ds.id = d.draw_schedule_id
             SET d.multiplier_snapshot = ?, d.status = 'OPEN'
             WHERE d.tenant_id = ? AND ds.lottery_modality_id = ?
               AND d.status = 'PENDING' AND d.multiplier_snapshot IS NULL
               AND d.closes_at_utc > UTC_TIMESTAMP(6)`,
            [input.multiplier, tenantId, modality.id],
          );
          openedPendingDraws = Number(drawResult.affectedRows);
        }
        await auditar(connection, {
          tenantId, userId, eventType: 'TENANT_MODALITY_UPDATED', entityType: 'LOTTERY_MODALITY',
          entityId: modality.id, correlationId,
          metadata: { ...codes, previous: current, next: { isEnabled: input.isEnabled, multiplier: input.multiplier }, configVersion, openedPendingDraws },
        });
        return {
          ...codes,
          isEnabled: input.isEnabled,
          multiplier: input.multiplier,
          configVersion,
          openedPendingDraws,
        };
      });
    },

    async actualizarHorarioTransaccional(tenantId, userId, codes, input, correlationId) {
      return transaccion(pool, async (connection) => {
        await validarActor(connection, tenantId, userId);
        const [catalogRows] = await connection.execute(
          `SELECT ds.id, ds.code
           FROM draw_schedules ds
           JOIN lottery_modalities lm ON lm.id = ds.lottery_modality_id
           JOIN lotteries l ON l.id = lm.lottery_id
           WHERE l.code = ? AND lm.code = ? AND ds.code = ?
             AND l.is_active = TRUE AND lm.is_active = TRUE AND ds.is_active = TRUE
           LIMIT 1 FOR UPDATE`,
          [codes.lotteryCode, codes.modalityCode, codes.scheduleCode],
        );
        const schedule = catalogRows[0];
        if (!schedule) throw resourceNotFound('El horario');
        const [rows] = await connection.execute(
          `SELECT is_enabled AS isEnabled, close_minutes_before AS closeMinutesBefore,
                  config_version AS configVersion
           FROM tenant_schedules WHERE tenant_id = ? AND draw_schedule_id = ? FOR UPDATE`,
          [tenantId, schedule.id],
        );
        const current = rows[0] || null;
        const configVersion = requireVersion(current, input.expectedVersion);
        if (!current) {
          await connection.execute(
            `INSERT INTO tenant_schedules
              (tenant_id, draw_schedule_id, is_enabled, close_minutes_before,
               config_version, updated_by_user_id)
             VALUES (?, ?, ?, ?, 1, ?)`,
            [tenantId, schedule.id, input.isEnabled, input.closeMinutesBefore, userId],
          );
        } else {
          await connection.execute(
            `UPDATE tenant_schedules
             SET is_enabled = ?, close_minutes_before = ?, config_version = ?, updated_by_user_id = ?
             WHERE tenant_id = ? AND draw_schedule_id = ?`,
            [input.isEnabled, input.closeMinutesBefore, configVersion, userId, tenantId, schedule.id],
          );
        }
        await auditar(connection, {
          tenantId, userId, eventType: 'TENANT_SCHEDULE_UPDATED', entityType: 'DRAW_SCHEDULE',
          entityId: schedule.id, correlationId,
          metadata: { ...codes, previous: current, next: { isEnabled: input.isEnabled, closeMinutesBefore: input.closeMinutesBefore }, configVersion },
        });
        return { ...codes, isEnabled: input.isEnabled, closeMinutesBefore: input.closeMinutesBefore, configVersion };
      });
    },

    async actualizarLimiteGeneralTransaccional(tenantId, userId, input, correlationId) {
      return transaccion(pool, async (connection) => {
        await validarActor(connection, tenantId, userId);
        const [rows] = await connection.execute(
          `SELECT general_number_limit AS generalNumberLimit, config_version AS configVersion
           FROM tenant_limit_settings WHERE tenant_id = ? FOR UPDATE`,
          [tenantId],
        );
        const current = rows[0] || null;
        const configVersion = requireVersion(current, input.expectedVersion);
        if (!current) {
          await connection.execute(
            `INSERT INTO tenant_limit_settings
              (tenant_id, general_number_limit, config_version, updated_by_user_id)
             VALUES (?, ?, 1, ?)`,
            [tenantId, input.generalNumberLimit, userId],
          );
        } else {
          await connection.execute(
            `UPDATE tenant_limit_settings
             SET general_number_limit = ?, config_version = ?, updated_by_user_id = ?
             WHERE tenant_id = ?`,
            [input.generalNumberLimit, configVersion, userId, tenantId],
          );
        }
        let affectedOpenDraws = 0;
        if (input.applyToOpenDraws) {
          const [drawResult] = await connection.execute(
            `UPDATE draws SET general_limit_snapshot = ?
             WHERE tenant_id = ? AND status IN ('PENDING', 'OPEN')
               AND closes_at_utc > UTC_TIMESTAMP(6)`,
            [input.generalNumberLimit, tenantId],
          );
          affectedOpenDraws = Number(drawResult.affectedRows);
          await connection.execute(
            `UPDATE draw_number_positions dnp
             JOIN draws d ON d.id = dnp.draw_id
             SET dnp.base_limit_amount = ?,
                 dnp.effective_limit_amount = GREATEST(?, dnp.sold_amount),
                 dnp.limit_adjustment_amount = GREATEST(?, dnp.sold_amount) - ?
             WHERE d.tenant_id = ? AND d.status IN ('PENDING', 'OPEN')
               AND d.closes_at_utc > UTC_TIMESTAMP(6)`,
            [input.generalNumberLimit, input.generalNumberLimit,
              input.generalNumberLimit, input.generalNumberLimit, tenantId],
          );
        }
        await auditar(connection, {
          tenantId, userId, eventType: 'TENANT_GENERAL_LIMIT_UPDATED', entityType: 'TENANT_LIMIT_SETTINGS',
          entityId: tenantId, correlationId,
          metadata: { previous: current, next: { generalNumberLimit: input.generalNumberLimit }, configVersion, applyToOpenDraws: input.applyToOpenDraws, affectedOpenDraws },
        });
        return { generalNumberLimit: input.generalNumberLimit, configVersion, affectedOpenDraws };
      });
    },

    async actualizarDisponibilidadDiariaTransaccional(tenantId, userId, lotteryCode, input, correlationId) {
      return transaccion(pool, async (connection) => {
        await validarActor(connection, tenantId, userId);
        const [catalogRows] = await connection.execute(
          `SELECT l.id
           FROM lotteries l
           JOIN tenant_lotteries tl ON tl.lottery_id = l.id AND tl.tenant_id = ?
           WHERE l.code = ? AND l.is_active = TRUE LIMIT 1 FOR UPDATE`,
          [tenantId, lotteryCode],
        );
        const lottery = catalogRows[0];
        if (!lottery) throw resourceNotFound('La lotería configurada');
        const [rows] = await connection.execute(
          `SELECT is_enabled_for_sales AS isEnabledForSales, reason,
                  config_version AS configVersion
           FROM tenant_daily_lottery_availability
           WHERE tenant_id = ? AND lottery_id = ? AND business_date = ? FOR UPDATE`,
          [tenantId, lottery.id, input.businessDate],
        );
        const current = rows[0] || null;
        const configVersion = requireVersion(current, input.expectedVersion);
        if (!current) {
          await connection.execute(
            `INSERT INTO tenant_daily_lottery_availability
              (tenant_id, lottery_id, business_date, is_enabled_for_sales,
               config_version, changed_by_user_id, reason)
             VALUES (?, ?, ?, ?, 1, ?, ?)`,
            [tenantId, lottery.id, input.businessDate, input.isEnabledForSales, userId, input.reason],
          );
        } else {
          await connection.execute(
            `UPDATE tenant_daily_lottery_availability
             SET is_enabled_for_sales = ?, config_version = ?, changed_by_user_id = ?,
                 changed_at = UTC_TIMESTAMP(6), reason = ?
             WHERE tenant_id = ? AND lottery_id = ? AND business_date = ?`,
            [input.isEnabledForSales, configVersion, userId, input.reason,
              tenantId, lottery.id, input.businessDate],
          );
        }
        await auditar(connection, {
          tenantId, userId, eventType: 'TENANT_DAILY_LOTTERY_AVAILABILITY_UPDATED',
          entityType: 'LOTTERY', entityId: lottery.id, correlationId,
          metadata: { lotteryCode, businessDate: input.businessDate, previous: current, next: { isEnabledForSales: input.isEnabledForSales, reason: input.reason }, configVersion },
        });
        return { lotteryCode, businessDate: input.businessDate, isEnabledForSales: input.isEnabledForSales, reason: input.reason, configVersion };
      });
    },
  };
}
