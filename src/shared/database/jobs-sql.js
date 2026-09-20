import { AppError } from '../error/app-error.js';

async function resolveTransactionError(connection, error, commitStarted) {
  if (commitStarted) {
    connection.destroy?.();
    throw new AppError('No fue posible confirmar el resultado del job.', {
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

async function inTransaction(pool, operation) {
  const connection = await pool.getConnection();
  let commitStarted = false;
  try {
    await connection.beginTransaction();
    const result = await operation(connection);
    commitStarted = true;
    await connection.commit();
    return result;
  } catch (error) {
    return resolveTransactionError(connection, error, commitStarted);
  } finally {
    connection.release?.();
  }
}

function isDuplicateKey(error, keyName) {
  return error?.code === 'ER_DUP_ENTRY' && String(error.message).includes(keyName);
}

export function iniciarBaseDeDatosJobs(pool) {
  return {
    async conAdvisoryLock(lockName, operation) {
      const connection = await pool.getConnection();
      let acquired = false;
      try {
        const [rows] = await connection.execute('SELECT GET_LOCK(?, 0) AS acquired', [lockName]);
        acquired = Number(rows[0]?.acquired) === 1;
        if (!acquired) return { acquired: false };
        return { acquired: true, result: await operation() };
      } finally {
        if (acquired) {
          try {
            await connection.execute('SELECT RELEASE_LOCK(?) AS released', [lockName]);
          } catch {
            connection.destroy?.();
          }
        }
        connection.release?.();
      }
    },

    async recuperarEjecucionesAbandonadas() {
      const [items] = await pool.execute(
        `UPDATE job_run_items jri
         JOIN job_runs jr ON jr.id = jri.job_run_id
         SET jri.status = 'FAILED', jri.error_code = 'WORKER_INTERRUPTED',
             jri.processed_at = UTC_TIMESTAMP(6)
         WHERE jr.status = 'RUNNING' AND jr.started_at < DATE_SUB(UTC_TIMESTAMP(6), INTERVAL 5 MINUTE)
           AND jri.status = 'PENDING'`,
      );
      const [runs] = await pool.execute(
        `UPDATE job_runs
         SET status = 'FAILED', finished_at = UTC_TIMESTAMP(6), error_code = 'WORKER_INTERRUPTED'
         WHERE status = 'RUNNING' AND started_at < DATE_SUB(UTC_TIMESTAMP(6), INTERVAL 5 MINUTE)`,
      );
      return { runs: Number(runs.affectedRows), items: Number(items.affectedRows) };
    },

    async iniciarEjecucion(jobName, runKey) {
      const [result] = await pool.execute(
        `INSERT INTO job_runs (job_name, run_key, status)
         VALUES (?, ?, 'RUNNING')`,
        [jobName, runKey],
      );
      return String(result.insertId);
    },

    async finalizarEjecucion(jobRunId, status, summary, errorCode = null) {
      await pool.execute(
        `UPDATE job_runs
         SET status = ?, summary = ?, error_code = ?, finished_at = UTC_TIMESTAMP(6)
         WHERE id = ? AND status = 'RUNNING'`,
        [status, JSON.stringify(summary), errorCode, jobRunId],
      );
    },

    async listarTenantsElegibles(afterTenantId, limit, businessDate, onlyTenantId = null) {
      const parameters = [afterTenantId];
      let tenantFilter = '';
      if (onlyTenantId !== null) {
        tenantFilter = 'AND t.id = ?';
        parameters.push(onlyTenantId);
      }
      parameters.push(businessDate);
      parameters.push(limit);
      const [rows] = await pool.execute(
        `SELECT t.id AS tenantId
         FROM tenants t
         JOIN subscriptions s ON s.tenant_id = t.id
         WHERE t.id > ? ${tenantFilter}
           AND DATE(DATE_SUB(t.created_at, INTERVAL 6 HOUR)) <= ?
           AND t.status = 'ACTIVE'
           AND s.status IN ('TRIAL', 'ACTIVE')
           AND s.access_ends_at > UTC_TIMESTAMP(6)
         ORDER BY t.id
         LIMIT ?`,
        parameters,
      );
      return rows;
    },

    async obtenerConfiguracionGeneracion(tenantId, isoWeekday) {
      const [limitRows] = await pool.execute(
        `SELECT general_number_limit AS generalNumberLimit,
                config_version AS limitConfigVersion
         FROM tenant_limit_settings WHERE tenant_id = ? LIMIT 1`,
        [tenantId],
      );
      const [rows] = await pool.execute(
        `SELECT ds.id AS scheduleId, ds.code AS scheduleCode,
                TIME_FORMAT(ds.local_time, '%H:%i:%s') AS localTimeValue,
                l.code AS lotteryCode, l.name AS lotteryName,
                lm.code AS modalityCode, lm.name AS modalityName,
                tm.multiplier, ts.close_minutes_before AS closeMinutesBefore,
                tl.config_version AS lotteryConfigVersion,
                tm.config_version AS modalityConfigVersion,
                ts.config_version AS scheduleConfigVersion
         FROM tenant_lotteries tl
         JOIN lotteries l ON l.id = tl.lottery_id AND l.is_active = TRUE
         JOIN lottery_modalities lm ON lm.lottery_id = l.id AND lm.is_active = TRUE
         JOIN tenant_modalities tm
           ON tm.lottery_modality_id = lm.id AND tm.tenant_id = tl.tenant_id
          AND tm.is_enabled = TRUE
         JOIN draw_schedules ds ON ds.lottery_modality_id = lm.id AND ds.is_active = TRUE
         JOIN draw_schedule_weekdays dsw
           ON dsw.draw_schedule_id = ds.id AND dsw.iso_weekday = ?
         JOIN tenant_schedules ts
           ON ts.draw_schedule_id = ds.id AND ts.tenant_id = tl.tenant_id
          AND ts.is_enabled = TRUE
         WHERE tl.tenant_id = ? AND tl.is_enabled = TRUE
         ORDER BY ds.id`,
        [isoWeekday, tenantId],
      );
      const [[counts]] = await pool.execute(
        `SELECT
           (SELECT COUNT(*) FROM tenant_lotteries
             WHERE tenant_id = ? AND is_enabled = TRUE) AS enabledLotteries,
           (SELECT COUNT(*) FROM tenant_modalities
             WHERE tenant_id = ? AND is_enabled = TRUE) AS enabledModalities,
           (SELECT COUNT(*) FROM tenant_schedules
             WHERE tenant_id = ? AND is_enabled = TRUE) AS enabledSchedules`,
        [tenantId, tenantId, tenantId],
      );
      return {
        generalLimit: limitRows[0] || null,
        schedules: rows,
        counts: {
          enabledLotteries: Number(counts.enabledLotteries),
          enabledModalities: Number(counts.enabledModalities),
          enabledSchedules: Number(counts.enabledSchedules),
        },
      };
    },

    async iniciarItem(jobRunId, tenantId, itemKey) {
      const [result] = await pool.execute(
        `INSERT INTO job_run_items
          (job_run_id, tenant_id, item_key, status, attempt_count)
         VALUES (?, ?, ?, 'PENDING', 1)`,
        [jobRunId, tenantId, itemKey],
      );
      return String(result.insertId);
    },

    async finalizarItem(itemId, status, errorCode = null) {
      await pool.execute(
        `UPDATE job_run_items
         SET status = ?, error_code = ?, processed_at = UTC_TIMESTAMP(6)
         WHERE id = ? AND status = 'PENDING'`,
        [status, errorCode, itemId],
      );
    },

    async crearSorteoTransaccional(jobRunId, input) {
      return inTransaction(pool, async (connection) => {
        const drawStatus = input.multiplier === null ? 'PENDING' : 'OPEN';
        const [existingRows] = await connection.execute(
          `SELECT id, public_id AS publicId, status
           FROM draws
           WHERE tenant_id = ? AND draw_schedule_id = ? AND business_date = ?
           LIMIT 1 FOR UPDATE`,
          [input.tenantId, input.scheduleId, input.businessDate],
        );
        if (existingRows[0]) return { exists: true, draw: existingRows[0] };

        const [configurationRows] = await connection.execute(
          `SELECT ds.id AS scheduleId,
                  tl.config_version AS lotteryConfigVersion,
                  tm.config_version AS modalityConfigVersion,
                  ts.config_version AS scheduleConfigVersion,
                  tls.config_version AS limitConfigVersion
           FROM tenants t
           JOIN subscriptions s ON s.tenant_id = t.id
           JOIN tenant_lotteries tl ON tl.tenant_id = t.id AND tl.is_enabled = TRUE
           JOIN lotteries l ON l.id = tl.lottery_id AND l.is_active = TRUE
           JOIN lottery_modalities lm ON lm.lottery_id = l.id AND lm.is_active = TRUE
           JOIN tenant_modalities tm
             ON tm.tenant_id = t.id AND tm.lottery_modality_id = lm.id AND tm.is_enabled = TRUE
           JOIN draw_schedules ds ON ds.lottery_modality_id = lm.id AND ds.is_active = TRUE
           JOIN draw_schedule_weekdays dsw
             ON dsw.draw_schedule_id = ds.id AND dsw.iso_weekday = ?
           JOIN tenant_schedules ts
             ON ts.tenant_id = t.id AND ts.draw_schedule_id = ds.id AND ts.is_enabled = TRUE
           JOIN tenant_limit_settings tls ON tls.tenant_id = t.id
           WHERE t.id = ? AND ds.id = ? AND t.status = 'ACTIVE'
             AND s.status IN ('TRIAL', 'ACTIVE') AND s.access_ends_at > UTC_TIMESTAMP(6)
             AND DATE(DATE_SUB(t.created_at, INTERVAL 6 HOUR)) <= ?
           LIMIT 1 FOR UPDATE`,
          [input.isoWeekday, input.tenantId, input.scheduleId, input.businessDate],
        );
        const current = configurationRows[0];
        if (!current) return { skipped: true, code: 'CONFIGURATION_NO_LONGER_ELIGIBLE' };
        const stale = ['lotteryConfigVersion', 'modalityConfigVersion',
          'scheduleConfigVersion', 'limitConfigVersion']
          .some((key) => Number(current[key]) !== Number(input[key]));
        if (stale) return { skipped: true, code: 'CONFIGURATION_CHANGED' };

        let drawResult;
        try {
          [drawResult] = await connection.execute(
            `INSERT INTO draws
              (public_id, tenant_id, draw_schedule_id, business_date,
               scheduled_at_utc, closes_at_utc, status,
               lottery_code_snapshot, lottery_name_snapshot,
               modality_code_snapshot, modality_name_snapshot, local_time_snapshot,
               close_minutes_before_snapshot, multiplier_snapshot, general_limit_snapshot)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              input.publicId, input.tenantId, input.scheduleId, input.businessDate,
              input.scheduledAtUtc, input.closesAtUtc, drawStatus,
              input.lotteryCode, input.lotteryName, input.modalityCode, input.modalityName,
              input.localTime, input.closeMinutesBefore, input.multiplier, input.generalNumberLimit,
            ],
          );
        } catch (error) {
          if (isDuplicateKey(error, 'uq_draws_tenant_schedule_date')) {
            return { exists: true };
          }
          if (isDuplicateKey(error, 'uq_draws_public_id')) {
            return { retryPublicId: true };
          }
          throw error;
        }
        const drawId = String(drawResult.insertId);
        const positions = Array.from({ length: 100 }, (_, numberValue) => [
          drawId, numberValue, input.generalNumberLimit, input.generalNumberLimit,
        ]);
        await connection.query(
          `INSERT INTO draw_number_positions
            (draw_id, number_value, base_limit_amount, effective_limit_amount)
           VALUES ?`,
          [positions],
        );
        await connection.execute(
          `INSERT INTO audit_events
            (tenant_id, actor_scope, actor_id, event_type, entity_type, entity_id, metadata)
           VALUES (?, 'JOB', ?, 'DRAW_CREATED', 'DRAW', ?, ?)`,
          [input.tenantId, jobRunId, drawId, JSON.stringify({
            businessDate: input.businessDate,
            lotteryCode: input.lotteryCode,
            modalityCode: input.modalityCode,
            scheduleCode: input.scheduleCode,
          })],
        );
        return { created: true, drawId, publicId: input.publicId };
      });
    },

    async cerrarSorteosVencidosTransaccional(jobRunId, batchSize) {
      return inTransaction(pool, async (connection) => {
        const [rows] = await connection.execute(
          `SELECT id, tenant_id AS tenantId
           FROM draws
           WHERE status = 'OPEN' AND closes_at_utc <= UTC_TIMESTAMP(6)
           ORDER BY closes_at_utc, id
           LIMIT ? FOR UPDATE SKIP LOCKED`,
          [batchSize],
        );
        for (const row of rows) {
          const [result] = await connection.execute(
            `UPDATE draws
             SET status = 'CLOSED', closed_at = UTC_TIMESTAMP(6)
             WHERE id = ? AND tenant_id = ? AND status = 'OPEN'
               AND closes_at_utc <= UTC_TIMESTAMP(6)`,
            [row.id, row.tenantId],
          );
          if (result.affectedRows === 1) {
            await connection.execute(
              `INSERT INTO audit_events
                (tenant_id, actor_scope, actor_id, event_type, entity_type, entity_id)
               VALUES (?, 'JOB', ?, 'DRAW_CLOSED', 'DRAW', ?)`,
              [row.tenantId, jobRunId, row.id],
            );
          }
        }
        return rows.length;
      });
    },
  };
}
