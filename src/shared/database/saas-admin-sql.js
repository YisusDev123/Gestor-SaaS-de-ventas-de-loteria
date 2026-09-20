import { AppError } from '../error/app-error.js';

function errorAdminNoDisponible() {
  return new AppError('La cuenta administrativa no está disponible.', {
    statusCode: 403,
    code: 'ADMIN_ACCOUNT_UNAVAILABLE',
  });
}

function normalizarErrorPersistencia(error) {
  if (error?.code !== 'ER_DUP_ENTRY') return error;
  if (String(error.message).includes('uq_users_email_normalized')) {
    return new AppError('El correo ya está registrado.', {
      statusCode: 409,
      code: 'EMAIL_ALREADY_REGISTERED',
    });
  }
  return new AppError('No fue posible crear el registro porque ya existe.', {
    statusCode: 409,
    code: 'RESOURCE_ALREADY_EXISTS',
  });
}

async function resolverErrorTransaccion(connection, error, commitStarted) {
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
  throw normalizarErrorPersistencia(error);
}

async function bloquearAdminActivo(connection, adminId) {
  const [rows] = await connection.execute(
    `SELECT id AS adminId, email_normalized AS email, password_hash AS passwordHash, status
     FROM saas_admins WHERE id = ? LIMIT 1 FOR UPDATE`,
    [adminId],
  );
  const admin = rows[0];
  if (!admin || admin.status !== 'ACTIVE') throw errorAdminNoDisponible();
  return admin;
}

async function insertarAuditoria(connection, {
  adminId, tenantId = null, eventType, entityType, entityId, correlationId, reason = null,
  metadata = null,
}) {
  await connection.execute(
    `INSERT INTO audit_events
      (tenant_id, actor_scope, actor_id, event_type, entity_type, entity_id,
       correlation_id, reason, metadata)
     VALUES (?, 'ADMIN', ?, ?, ?, ?, ?, ?, ?)`,
    [
      tenantId,
      adminId,
      eventType,
      entityType,
      entityId,
      correlationId,
      reason,
      metadata ? JSON.stringify(metadata) : null,
    ],
  );
}

export function iniciarBaseDeDatosSaasAdmin(pool) {
  return {
    async listarTenants(filters, cursor, limit) {
      const conditions = [];
      const parameters = [];
      if (filters.status) { conditions.push('t.status = ?'); parameters.push(filters.status); }
      if (filters.subscriptionStatus) { conditions.push('s.status = ?'); parameters.push(filters.subscriptionStatus); }
      if (filters.search) {
        conditions.push('(t.public_id = ? OR u.email_normalized = ? OR t.display_name LIKE ?)');
        parameters.push(filters.search.toUpperCase(), filters.search.toLowerCase(), `${filters.search}%`);
      }
      if (cursor) { conditions.push('t.id < ?'); parameters.push(cursor.id); }
      parameters.push(limit);
      const [rows] = await pool.execute(
        `SELECT CAST(t.id AS CHAR) AS cursorId, t.public_id AS id,
                t.display_name AS displayName, t.status, t.created_at AS createdAt,
                s.status AS subscriptionStatus, s.access_ends_at AS accessEndsAt,
                s.suspension_reason_public AS suspensionReason,
                sp.code AS planCode, sp.name AS planName,
                u.email_normalized AS ownerEmail, u.status AS ownerStatus
         FROM tenants t
         JOIN subscriptions s ON s.tenant_id = t.id
         JOIN subscription_plans sp ON sp.id = s.plan_id
         LEFT JOIN tenant_memberships tm ON tm.id = (
           SELECT MIN(owner_tm.id) FROM tenant_memberships owner_tm
           WHERE owner_tm.tenant_id = t.id AND owner_tm.role = 'OWNER'
         )
         LEFT JOIN users u ON u.id = tm.user_id
         ${conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''}
         ORDER BY t.id DESC LIMIT ?`,
        parameters,
      );
      return rows;
    },

    async obtenerTenant(tenantPublicId) {
      const [rows] = await pool.execute(
        `SELECT t.id AS internalTenantId, t.public_id AS id,
                t.display_name AS displayName, t.status, t.timezone,
                t.currency_code AS currencyCode, t.created_at AS createdAt,
                s.status AS subscriptionStatus, s.trial_started_at AS trialStartedAt,
                s.trial_ends_at AS trialEndsAt, s.access_ends_at AS accessEndsAt,
                s.suspension_reason_public AS suspensionReason,
                sp.code AS planCode, sp.name AS planName,
                sp.current_price AS currentPlanPrice, sp.currency_code AS planCurrencyCode,
                u.public_id AS ownerId, u.email_normalized AS ownerEmail,
                u.status AS ownerStatus, tm.status AS membershipStatus
         FROM tenants t
         JOIN subscriptions s ON s.tenant_id = t.id
         JOIN subscription_plans sp ON sp.id = s.plan_id
         LEFT JOIN tenant_memberships tm ON tm.id = (
           SELECT MIN(owner_tm.id) FROM tenant_memberships owner_tm
           WHERE owner_tm.tenant_id = t.id AND owner_tm.role = 'OWNER'
         )
         LEFT JOIN users u ON u.id = tm.user_id
         WHERE t.public_id = ? LIMIT 1`,
        [tenantPublicId],
      );
      const row = rows[0];
      if (!row) return null;
      const [periods] = await pool.execute(
        `SELECT spd.period_type AS type, spd.starts_at AS startsAt,
                spd.ends_at AS endsAt, spd.agreed_price AS agreedPrice,
                spd.currency_code AS currencyCode, spd.status,
                spp.amount AS paidAmount, spp.paid_at AS paidAt, spp.note
         FROM subscription_periods spd
         LEFT JOIN subscription_payments spp ON spp.subscription_period_id = spd.id
         JOIN subscriptions s ON s.id = spd.subscription_id
         WHERE s.tenant_id = ? ORDER BY spd.id DESC LIMIT 12`,
        [row.internalTenantId],
      );
      return {
        id: row.id,
        displayName: row.displayName,
        status: row.status,
        timezone: row.timezone,
        currencyCode: row.currencyCode,
        createdAt: row.createdAt,
        owner: row.ownerId ? {
          id: row.ownerId, email: row.ownerEmail,
          status: row.ownerStatus, membershipStatus: row.membershipStatus,
        } : null,
        subscription: {
          status: row.subscriptionStatus,
          trialStartedAt: row.trialStartedAt,
          trialEndsAt: row.trialEndsAt,
          accessEndsAt: row.accessEndsAt,
          suspensionReason: row.suspensionReason,
          plan: {
            code: row.planCode, name: row.planName,
            currentPrice: row.currentPlanPrice, currencyCode: row.planCurrencyCode,
          },
          periods,
        },
      };
    },

    async listarPlanes() {
      const [rows] = await pool.execute(
        `SELECT code, name, current_price AS currentPrice,
                currency_code AS currencyCode, trial_days AS trialDays,
                is_active AS isActive, updated_at AS updatedAt
         FROM subscription_plans ORDER BY id`,
      );
      return rows.map((row) => ({ ...row, trialDays: Number(row.trialDays), isActive: Boolean(row.isActive) }));
    },

    async listarAuditoria(filters, cursor, limit) {
      const conditions = [];
      const parameters = [];
      if (filters.tenantId) { conditions.push('t.public_id = ?'); parameters.push(filters.tenantId); }
      if (filters.actorScope) { conditions.push('a.actor_scope = ?'); parameters.push(filters.actorScope); }
      if (filters.eventType) { conditions.push('a.event_type = ?'); parameters.push(filters.eventType); }
      if (cursor) { conditions.push('a.id < ?'); parameters.push(cursor.id); }
      parameters.push(limit);
      const [rows] = await pool.execute(
        `SELECT CAST(a.id AS CHAR) AS cursorId, a.event_type AS eventType,
                a.actor_scope AS actorScope, a.entity_type AS entityType,
                a.correlation_id AS correlationId, a.reason, a.metadata,
                a.created_at AS createdAt, t.public_id AS tenantId,
                t.display_name AS tenantName
         FROM audit_events a
         LEFT JOIN tenants t ON t.id = a.tenant_id
         ${conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''}
         ORDER BY a.id DESC LIMIT ?`,
        parameters,
      );
      return rows.map((row) => ({
        ...row,
        metadata: typeof row.metadata === 'string' ? JSON.parse(row.metadata) : (row.metadata || {}),
      }));
    },

    async buscarAdminPorEmail(email) {
      const [rows] = await pool.execute(
        `SELECT id AS adminId, email_normalized AS email,
                password_hash AS passwordHash, status
         FROM saas_admins WHERE email_normalized = ? LIMIT 1`,
        [email],
      );
      return rows[0] || null;
    },

    async registrarLoginAdminTransaccional(adminId, expectedPasswordHash, sessionData) {
      const connection = await pool.getConnection();
      let commitStarted = false;
      try {
        await connection.beginTransaction();
        const admin = await bloquearAdminActivo(connection, adminId);
        if (admin.passwordHash !== expectedPasswordHash) {
          throw new AppError('Correo o contraseña incorrectos.', {
            statusCode: 401,
            code: 'INVALID_ADMIN_CREDENTIALS',
          });
        }
        const [result] = await connection.execute(
          `INSERT INTO admin_sessions
            (admin_id, refresh_token_hash, family_id, expires_at,
             created_ip_hash, user_agent_summary)
           VALUES (?, ?, ?, ?, ?, ?)`,
          [
            admin.adminId,
            sessionData.tokenHash,
            sessionData.familyId,
            sessionData.expiresAt,
            sessionData.ipHash,
            sessionData.userAgent,
          ],
        );
        await connection.execute(
          'UPDATE saas_admins SET last_login_at = UTC_TIMESTAMP(6) WHERE id = ?',
          [admin.adminId],
        );
        commitStarted = true;
        await connection.commit();
        return { admin, sessionId: String(result.insertId) };
      } catch (error) {
        return resolverErrorTransaccion(connection, error, commitStarted);
      } finally {
        connection.release?.();
      }
    },

    async refrescarAdminSesionTransaccional(tokenHash, nextSessionData) {
      const connection = await pool.getConnection();
      let commitStarted = false;
      try {
        await connection.beginTransaction();
        const [rows] = await connection.execute(
          `SELECT ads.id AS sessionId, ads.admin_id AS adminId,
                  ads.family_id AS familyId, ads.revoked_at AS revokedAt,
                  (ads.expires_at <= UTC_TIMESTAMP(6)) AS isExpired,
                  sa.email_normalized AS email, sa.status
           FROM admin_sessions ads
           JOIN saas_admins sa ON sa.id = ads.admin_id
           WHERE ads.refresh_token_hash = ? LIMIT 1 FOR UPDATE`,
          [tokenHash],
        );
        const session = rows[0];
        if (!session) {
          await connection.rollback();
          return { invalid: true };
        }
        if (session.revokedAt) {
          await connection.execute(
            `UPDATE admin_sessions SET revoked_at = COALESCE(revoked_at, UTC_TIMESTAMP(6))
             WHERE family_id = ?`,
            [session.familyId],
          );
          commitStarted = true;
          await connection.commit();
          return { reused: true };
        }
        if (Number(session.isExpired) === 1 || session.status !== 'ACTIVE') {
          await connection.execute(
            `UPDATE admin_sessions SET revoked_at = COALESCE(revoked_at, UTC_TIMESTAMP(6))
             WHERE family_id = ?`,
            [session.familyId],
          );
          commitStarted = true;
          await connection.commit();
          return { invalid: true };
        }
        const [newResult] = await connection.execute(
          `INSERT INTO admin_sessions
            (admin_id, refresh_token_hash, family_id, expires_at,
             created_ip_hash, user_agent_summary)
           VALUES (?, ?, ?, ?, ?, ?)`,
          [
            session.adminId,
            nextSessionData.tokenHash,
            session.familyId,
            nextSessionData.expiresAt,
            nextSessionData.ipHash,
            nextSessionData.userAgent,
          ],
        );
        const newSessionId = String(newResult.insertId);
        const [replaceResult] = await connection.execute(
          `UPDATE admin_sessions
           SET revoked_at = UTC_TIMESTAMP(6), replaced_by_session_id = ?
           WHERE id = ? AND revoked_at IS NULL`,
          [newSessionId, session.sessionId],
        );
        if (replaceResult.affectedRows !== 1) {
          throw new AppError('La sesión administrativa ya no está disponible.', {
            statusCode: 401,
            code: 'INVALID_ADMIN_REFRESH_TOKEN',
          });
        }
        commitStarted = true;
        await connection.commit();
        return {
          admin: { adminId: session.adminId, email: session.email },
          sessionId: newSessionId,
        };
      } catch (error) {
        return resolverErrorTransaccion(connection, error, commitStarted);
      } finally {
        connection.release?.();
      }
    },

    async cerrarAdminSesionTransaccional(tokenHash) {
      const connection = await pool.getConnection();
      let commitStarted = false;
      try {
        await connection.beginTransaction();
        const [rows] = await connection.execute(
          `SELECT id FROM admin_sessions
           WHERE refresh_token_hash = ? LIMIT 1 FOR UPDATE`,
          [tokenHash],
        );
        if (rows[0]) {
          await connection.execute(
            `UPDATE admin_sessions
             SET revoked_at = COALESCE(revoked_at, UTC_TIMESTAMP(6)) WHERE id = ?`,
            [rows[0].id],
          );
        }
        commitStarted = true;
        await connection.commit();
      } catch (error) {
        return resolverErrorTransaccion(connection, error, commitStarted);
      } finally {
        connection.release?.();
      }
    },

    async buscarSesionAdminActiva(sessionId, adminId) {
      const [rows] = await pool.execute(
        `SELECT ads.id, ads.admin_id AS adminId, sa.email_normalized AS email
         FROM admin_sessions ads
         JOIN saas_admins sa ON sa.id = ads.admin_id
         WHERE ads.id = ? AND ads.admin_id = ?
           AND ads.revoked_at IS NULL AND ads.expires_at > UTC_TIMESTAMP(6)
           AND sa.status = 'ACTIVE'
         LIMIT 1`,
        [sessionId, adminId],
      );
      return rows[0] || null;
    },

    async crearTenantTransaccional(adminId, data) {
      const connection = await pool.getConnection();
      let commitStarted = false;
      try {
        await connection.beginTransaction();
        await bloquearAdminActivo(connection, adminId);
        const [planRows] = await connection.execute(
          `SELECT id, code, trial_days AS trialDays
           FROM subscription_plans
           WHERE code = ? AND is_active = TRUE LIMIT 1 FOR UPDATE`,
          [data.planCode],
        );
        const plan = planRows[0];
        if (!plan) {
          throw new AppError('El plan solicitado no está disponible.', {
            statusCode: 400,
            code: 'SUBSCRIPTION_PLAN_UNAVAILABLE',
          });
        }
        const [periodRows] = await connection.execute(
          `SELECT UTC_TIMESTAMP(6) AS startsAt,
                  DATE_ADD(UTC_TIMESTAMP(6), INTERVAL ? DAY) AS endsAt`,
          [plan.trialDays],
        );
        const period = periodRows[0];
        const [tenantResult] = await connection.execute(
          `INSERT INTO tenants (public_id, display_name, status)
           VALUES (?, ?, 'ACTIVE')`,
          [data.tenantPublicId, data.displayName],
        );
        const tenantId = String(tenantResult.insertId);
        const [userResult] = await connection.execute(
          `INSERT INTO users (public_id, email_normalized, password_hash, status)
           VALUES (?, ?, ?, 'ACTIVE')`,
          [data.userPublicId, data.ownerEmail, data.unusablePasswordHash],
        );
        const userId = String(userResult.insertId);
        await connection.execute(
          `INSERT INTO tenant_memberships (tenant_id, user_id, role, status)
           VALUES (?, ?, 'OWNER', 'ACTIVE')`,
          [tenantId, userId],
        );
        await connection.execute(
          `INSERT INTO tenant_lotteries (tenant_id, lottery_id, is_enabled)
           SELECT ?, l.id, TRUE
           FROM lotteries l
           WHERE l.is_active = TRUE`,
          [tenantId],
        );
        await connection.execute(
          `INSERT INTO tenant_modalities
            (tenant_id, lottery_modality_id, is_enabled, multiplier, updated_by_user_id)
           SELECT ?, lm.id, TRUE, NULL, ?
           FROM lottery_modalities lm
           JOIN lotteries l ON l.id = lm.lottery_id AND l.is_active = TRUE
           WHERE lm.is_active = TRUE`,
          [tenantId, userId],
        );
        await connection.execute(
          `INSERT INTO tenant_schedules
            (tenant_id, draw_schedule_id, is_enabled, close_minutes_before, updated_by_user_id)
           SELECT ?, ds.id, TRUE, ds.default_close_minutes_before, ?
           FROM draw_schedules ds
           JOIN lottery_modalities lm ON lm.id = ds.lottery_modality_id
             AND lm.is_active = TRUE
           JOIN lotteries l ON l.id = lm.lottery_id AND l.is_active = TRUE
           WHERE ds.is_active = TRUE`,
          [tenantId, userId],
        );
        await connection.execute(
          `INSERT INTO tenant_limit_settings
            (tenant_id, general_number_limit, updated_by_user_id)
           VALUES (?, '10000.00', ?)`,
          [tenantId, userId],
        );
        const [subscriptionResult] = await connection.execute(
          `INSERT INTO subscriptions
            (tenant_id, plan_id, status, trial_started_at, trial_ends_at, access_ends_at)
           VALUES (?, ?, 'TRIAL', ?, ?, ?)`,
          [tenantId, plan.id, period.startsAt, period.endsAt, period.endsAt],
        );
        const subscriptionId = String(subscriptionResult.insertId);
        await connection.execute(
          `INSERT INTO subscription_periods
            (subscription_id, period_type, starts_at, ends_at, agreed_price,
             currency_code, status, created_by_admin_id)
           VALUES (?, 'TRIAL', ?, ?, '0.00', 'CRC', 'CONFIRMED', ?)`,
          [subscriptionId, period.startsAt, period.endsAt, adminId],
        );
        const [resetResult] = await connection.execute(
          `INSERT INTO password_reset_tokens
            (actor_scope, actor_id, token_hash, purpose, expires_at)
           VALUES ('USER', ?, ?, 'PASSWORD_RESET', ?)`,
          [userId, data.resetTokenHash, data.resetExpiresAt],
        );
        await insertarAuditoria(connection, {
          adminId,
          tenantId,
          eventType: 'TENANT_CREATED',
          entityType: 'TENANT',
          entityId: tenantId,
          correlationId: data.correlationId,
          metadata: {
            tenantPublicId: data.tenantPublicId,
            userPublicId: data.userPublicId,
            planCode: plan.code,
            trialDays: Number(plan.trialDays),
          },
        });
        commitStarted = true;
        await connection.commit();
        return {
          tenantId,
          userId,
          resetTokenId: String(resetResult.insertId),
          trialEndsAt: period.endsAt,
          planCode: plan.code,
        };
      } catch (error) {
        return resolverErrorTransaccion(connection, error, commitStarted);
      } finally {
        connection.release?.();
      }
    },

    async cambiarEstadoTenantTransaccional(adminId, tenantPublicId, nextStatus, reason, correlationId) {
      const connection = await pool.getConnection();
      let commitStarted = false;
      try {
        await connection.beginTransaction();
        await bloquearAdminActivo(connection, adminId);
        const [rows] = await connection.execute(
          `SELECT t.id AS tenantId, t.status AS tenantStatus
           FROM tenants t WHERE t.public_id = ? LIMIT 1 FOR UPDATE`,
          [tenantPublicId],
        );
        const tenant = rows[0];
        if (!tenant) {
          throw new AppError('El tenant solicitado no existe.', {
            statusCode: 404,
            code: 'TENANT_NOT_FOUND',
          });
        }
        if (tenant.tenantStatus === 'CLOSED' && nextStatus !== 'CLOSED') {
          throw new AppError('Un tenant cerrado no puede reactivarse.', {
            statusCode: 409,
            code: 'TENANT_CLOSED',
          });
        }
        await connection.execute(
          'UPDATE tenants SET status = ? WHERE id = ?',
          [nextStatus, tenant.tenantId],
        );
        await connection.execute(
          `UPDATE subscriptions
           SET status = CASE
             WHEN ? = 'ACTIVE' THEN CASE
               WHEN trial_ends_at IS NOT NULL AND trial_ends_at > UTC_TIMESTAMP(6) THEN 'TRIAL'
               WHEN access_ends_at > UTC_TIMESTAMP(6) THEN 'ACTIVE'
               ELSE 'EXPIRED'
             END
             ELSE ?
           END,
           suspension_reason_public = CASE WHEN ? = 'ACTIVE' THEN NULL ELSE ? END
           WHERE tenant_id = ?`,
          [nextStatus, nextStatus, nextStatus, reason, tenant.tenantId],
        );
        if (nextStatus !== 'ACTIVE') {
          await connection.execute(
            `UPDATE user_sessions
             SET revoked_at = COALESCE(revoked_at, UTC_TIMESTAMP(6))
             WHERE tenant_id = ? AND revoked_at IS NULL`,
            [tenant.tenantId],
          );
        }
        await insertarAuditoria(connection, {
          adminId,
          tenantId: tenant.tenantId,
          eventType: 'TENANT_STATUS_CHANGED',
          entityType: 'TENANT',
          entityId: tenant.tenantId,
          correlationId,
          reason,
          metadata: { previousStatus: tenant.tenantStatus, nextStatus },
        });
        commitStarted = true;
        await connection.commit();
        return {
          tenantId: String(tenant.tenantId),
          previousStatus: tenant.tenantStatus,
          status: nextStatus,
        };
      } catch (error) {
        return resolverErrorTransaccion(connection, error, commitStarted);
      } finally {
        connection.release?.();
      }
    },

    async crearRestablecimientoTenantTransaccional(
      adminId,
      tenantPublicId,
      tokenHash,
      expiresAt,
      correlationId,
    ) {
      const connection = await pool.getConnection();
      let commitStarted = false;
      try {
        await connection.beginTransaction();
        await bloquearAdminActivo(connection, adminId);
        const [rows] = await connection.execute(
          `SELECT t.id AS tenantId, u.id AS userId, u.email_normalized AS email
           FROM tenants t
           JOIN tenant_memberships tm ON tm.tenant_id = t.id
             AND tm.role = 'OWNER' AND tm.status = 'ACTIVE'
           JOIN users u ON u.id = tm.user_id AND u.status = 'ACTIVE'
           WHERE t.public_id = ? AND t.status <> 'CLOSED'
           ORDER BY tm.id LIMIT 1 FOR UPDATE`,
          [tenantPublicId],
        );
        const owner = rows[0];
        if (!owner) {
          throw new AppError('No existe una cuenta activa para este tenant.', {
            statusCode: 404,
            code: 'TENANT_OWNER_NOT_FOUND',
          });
        }
        await connection.execute(
          `UPDATE password_reset_tokens
           SET consumed_at = COALESCE(consumed_at, UTC_TIMESTAMP(6))
           WHERE actor_scope = 'USER' AND actor_id = ?
             AND purpose = 'PASSWORD_RESET' AND consumed_at IS NULL`,
          [owner.userId],
        );
        const [resetResult] = await connection.execute(
          `INSERT INTO password_reset_tokens
            (actor_scope, actor_id, token_hash, purpose, expires_at)
           VALUES ('USER', ?, ?, 'PASSWORD_RESET', ?)`,
          [owner.userId, tokenHash, expiresAt],
        );
        await connection.execute(
          `UPDATE user_sessions
           SET revoked_at = COALESCE(revoked_at, UTC_TIMESTAMP(6))
           WHERE user_id = ? AND revoked_at IS NULL`,
          [owner.userId],
        );
        await insertarAuditoria(connection, {
          adminId,
          tenantId: owner.tenantId,
          eventType: 'TENANT_ACCESS_RESET_REQUESTED',
          entityType: 'USER',
          entityId: owner.userId,
          correlationId,
        });
        commitStarted = true;
        await connection.commit();
        return {
          tenantId: String(owner.tenantId),
          userId: String(owner.userId),
          email: owner.email,
          resetTokenId: String(resetResult.insertId),
        };
      } catch (error) {
        return resolverErrorTransaccion(connection, error, commitStarted);
      } finally {
        connection.release?.();
      }
    },

    async actualizarPrecioPlanTransaccional(adminId, planCode, currentPrice, correlationId) {
      const connection = await pool.getConnection();
      let commitStarted = false;
      try {
        await connection.beginTransaction();
        await bloquearAdminActivo(connection, adminId);
        const [rows] = await connection.execute(
          `SELECT id, current_price AS currentPrice
           FROM subscription_plans WHERE code = ? LIMIT 1 FOR UPDATE`,
          [planCode],
        );
        const plan = rows[0];
        if (!plan) {
          throw new AppError('El plan solicitado no existe.', {
            statusCode: 404,
            code: 'SUBSCRIPTION_PLAN_NOT_FOUND',
          });
        }
        await connection.execute(
          'UPDATE subscription_plans SET current_price = ? WHERE id = ?',
          [currentPrice, plan.id],
        );
        await insertarAuditoria(connection, {
          adminId,
          eventType: 'SUBSCRIPTION_PLAN_PRICE_CHANGED',
          entityType: 'SUBSCRIPTION_PLAN',
          entityId: plan.id,
          correlationId,
          metadata: { previousPrice: plan.currentPrice, currentPrice, currencyCode: 'CRC' },
        });
        commitStarted = true;
        await connection.commit();
        return { planCode, previousPrice: plan.currentPrice, currentPrice, currencyCode: 'CRC' };
      } catch (error) {
        return resolverErrorTransaccion(connection, error, commitStarted);
      } finally {
        connection.release?.();
      }
    },

    async confirmarPagoSuscripcionTransaccional(adminId, tenantPublicId, data) {
      const connection = await pool.getConnection();
      let commitStarted = false;
      try {
        await connection.beginTransaction();
        await bloquearAdminActivo(connection, adminId);
        const [requestRows] = await connection.execute(
          `SELECT id, tenant_id AS tenantId, payload_fingerprint AS payloadFingerprint,
                  status, response_snapshot AS response
           FROM operation_requests
           WHERE actor_scope = 'ADMIN' AND actor_id = ?
             AND operation_type = 'CONFIRM_SUBSCRIPTION_PAYMENT' AND request_id = ?
           LIMIT 1 FOR UPDATE`,
          [adminId, data.requestId],
        );
        const existingRequest = requestRows[0];
        if (existingRequest) {
          if (!Buffer.isBuffer(existingRequest.payloadFingerprint)
            || Buffer.compare(existingRequest.payloadFingerprint, data.payloadFingerprint) !== 0) {
            throw new AppError('El requestId ya fue utilizado con datos diferentes.', {
              statusCode: 409,
              code: 'IDEMPOTENCY_KEY_REUSED',
            });
          }
          if (existingRequest.status === 'COMPLETED' && existingRequest.response) {
            await connection.rollback();
            const contenido = typeof existingRequest.response === 'string'
              ? JSON.parse(existingRequest.response)
              : existingRequest.response;
            return {
              contenido,
              replay: true,
              tenantId: existingRequest.tenantId == null
                ? null
                : String(existingRequest.tenantId),
            };
          }
          throw new AppError('La confirmación anterior todavía requiere conciliación.', {
            statusCode: 409,
            code: 'OPERATION_IN_PROGRESS',
          });
        }

        const [tenantRows] = await connection.execute(
          `SELECT t.id AS tenantId, t.status AS tenantStatus,
                  s.id AS subscriptionId, sp.id AS planId, sp.code AS planCode
           FROM tenants t
           JOIN subscriptions s ON s.tenant_id = t.id
           JOIN subscription_plans sp ON sp.id = s.plan_id
           WHERE t.public_id = ? LIMIT 1 FOR UPDATE`,
          [tenantPublicId],
        );
        const tenant = tenantRows[0];
        if (!tenant) {
          throw new AppError('El tenant solicitado no existe.', {
            statusCode: 404,
            code: 'TENANT_NOT_FOUND',
          });
        }
        if (tenant.tenantStatus === 'CLOSED') {
          throw new AppError('No se puede renovar un tenant cerrado.', {
            statusCode: 409,
            code: 'TENANT_CLOSED',
          });
        }
        const [operationResult] = await connection.execute(
          `INSERT INTO operation_requests
            (tenant_id, actor_scope, actor_id, operation_type, request_id,
             payload_fingerprint, status)
           VALUES (?, 'ADMIN', ?, 'CONFIRM_SUBSCRIPTION_PAYMENT', ?, ?, 'PROCESSING')`,
          [tenant.tenantId, adminId, data.requestId, data.payloadFingerprint],
        );
        const [periodResult] = await connection.execute(
          `INSERT INTO subscription_periods
            (subscription_id, period_type, starts_at, ends_at, agreed_price,
             currency_code, status, created_by_admin_id)
           VALUES (?, 'PAID', ?, ?, ?, 'CRC', 'CONFIRMED', ?)`,
          [
            tenant.subscriptionId,
            data.startsAt,
            data.accessEndsAt,
            data.amount,
            adminId,
          ],
        );
        const [paymentResult] = await connection.execute(
          `INSERT INTO subscription_payments
            (subscription_period_id, amount, currency_code, paid_at,
             confirmed_by_admin_id, note)
           VALUES (?, ?, 'CRC', ?, ?, ?)`,
          [periodResult.insertId, data.amount, data.paidAt, adminId, data.note],
        );
        await connection.execute(
          `UPDATE subscriptions
           SET status = 'ACTIVE', access_ends_at = ?, suspension_reason_public = NULL
           WHERE id = ?`,
          [data.accessEndsAt, tenant.subscriptionId],
        );
        await connection.execute(
          `UPDATE tenants SET status = 'ACTIVE'
           WHERE id = ? AND status <> 'CLOSED'`,
          [tenant.tenantId],
        );
        const contenido = {
          tenant: { id: tenantPublicId, status: 'ACTIVE' },
          subscription: {
            status: 'ACTIVE',
            planCode: tenant.planCode,
            startsAt: data.startsAt.toISOString(),
            accessEndsAt: data.accessEndsAt.toISOString(),
            agreedPrice: data.amount,
            currencyCode: 'CRC',
          },
          payment: { paidAt: data.paidAt.toISOString(), requestId: data.requestId },
        };
        await insertarAuditoria(connection, {
          adminId,
          tenantId: tenant.tenantId,
          eventType: 'SUBSCRIPTION_PAYMENT_CONFIRMED',
          entityType: 'SUBSCRIPTION_PAYMENT',
          entityId: paymentResult.insertId,
          correlationId: data.correlationId,
          metadata: {
            planCode: tenant.planCode,
            amount: data.amount,
            currencyCode: 'CRC',
            accessEndsAt: contenido.subscription.accessEndsAt,
          },
        });
        await connection.execute(
          `UPDATE operation_requests
           SET status = 'COMPLETED', resource_type = 'SUBSCRIPTION_PAYMENT',
               resource_id = ?, http_status = 201, response_snapshot = ?,
               completed_at = UTC_TIMESTAMP(6)
           WHERE id = ?`,
          [paymentResult.insertId, JSON.stringify(contenido), operationResult.insertId],
        );
        commitStarted = true;
        await connection.commit();
        return { contenido, replay: false, tenantId: String(tenant.tenantId) };
      } catch (error) {
        return resolverErrorTransaccion(connection, error, commitStarted);
      } finally {
        connection.release?.();
      }
    },
  };
}
