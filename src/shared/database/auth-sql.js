import { AppError } from '../error/app-error.js';

const CONTEXT_COLUMNS = `
  u.id AS userId, u.public_id AS userPublicId, u.email_normalized AS email,
  u.password_hash AS passwordHash, u.status AS userStatus,
  tm.id AS membershipId, tm.role, tm.status AS membershipStatus,
  t.id AS tenantId, t.public_id AS tenantPublicId, t.display_name AS tenantName,
  t.status AS tenantStatus, t.timezone, t.currency_code AS currencyCode,
  s.status AS subscriptionStatus, s.access_ends_at AS accessEndsAt,
  (s.status IN ('TRIAL', 'ACTIVE') AND s.access_ends_at > UTC_TIMESTAMP(6)) AS hasAccess`;

function errorCredenciales() {
  return new AppError('Correo o contraseña incorrectos.', {
    statusCode: 401,
    code: 'INVALID_CREDENTIALS',
  });
}

function validarContextoParaSesion(contexto) {
  if (!contexto || contexto.userStatus !== 'ACTIVE'
    || contexto.membershipStatus !== 'ACTIVE' || contexto.tenantStatus !== 'ACTIVE') {
    throw new AppError('La cuenta no está disponible.', {
      statusCode: 403,
      code: 'ACCOUNT_UNAVAILABLE',
    });
  }
}

async function buscarContextoMembership(connection, membershipId, bloquear = false) {
  const [rows] = await connection.execute(
    `SELECT ${CONTEXT_COLUMNS}
     FROM tenant_memberships tm
     JOIN users u ON u.id = tm.user_id
     JOIN tenants t ON t.id = tm.tenant_id
     LEFT JOIN subscriptions s ON s.tenant_id = t.id
     WHERE tm.id = ?
     LIMIT 1${bloquear ? ' FOR UPDATE' : ''}`,
    [membershipId],
  );
  return rows[0] || null;
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
  throw error;
}

export function iniciarBaseDeDatosAuth(pool) {
  return {
    async buscarContextosPorEmail(email) {
      const [rows] = await pool.execute(
        `SELECT ${CONTEXT_COLUMNS}
         FROM users u
         JOIN tenant_memberships tm ON tm.user_id = u.id
         JOIN tenants t ON t.id = tm.tenant_id
         LEFT JOIN subscriptions s ON s.tenant_id = t.id
         WHERE u.email_normalized = ?
         ORDER BY tm.id
         LIMIT 2`,
        [email],
      );
      return rows;
    },

    async buscarUsuarioRecuperacionPorEmail(email) {
      const [rows] = await pool.execute(
        `SELECT id AS userId, email_normalized AS email
         FROM users
         WHERE email_normalized = ? AND status = 'ACTIVE'
         LIMIT 1`,
        [email],
      );
      return rows[0] || null;
    },

    async crearTokenRestablecimientoTransaccional(userId, tokenHash, expiresAt) {
      const connection = await pool.getConnection();
      let commitStarted = false;
      try {
        await connection.beginTransaction();
        const [userRows] = await connection.execute(
          `SELECT id FROM users
           WHERE id = ? AND status = 'ACTIVE'
           LIMIT 1 FOR UPDATE`,
          [userId],
        );
        if (!userRows[0]) {
          await connection.rollback();
          return null;
        }
        await connection.execute(
          `UPDATE password_reset_tokens
           SET consumed_at = COALESCE(consumed_at, UTC_TIMESTAMP(6))
           WHERE actor_scope = 'USER' AND actor_id = ?
             AND purpose = 'PASSWORD_RESET' AND consumed_at IS NULL`,
          [userId],
        );
        const [result] = await connection.execute(
          `INSERT INTO password_reset_tokens
            (actor_scope, actor_id, token_hash, purpose, expires_at)
           VALUES ('USER', ?, ?, 'PASSWORD_RESET', ?)`,
          [userId, tokenHash, expiresAt],
        );
        commitStarted = true;
        await connection.commit();
        return String(result.insertId);
      } catch (error) {
        return resolverErrorTransaccion(connection, error, commitStarted);
      } finally {
        connection.release?.();
      }
    },

    async restablecerPasswordTransaccional(tokenHash, passwordHash) {
      const connection = await pool.getConnection();
      let commitStarted = false;
      try {
        await connection.beginTransaction();
        const [candidateRows] = await connection.execute(
          `SELECT actor_id AS userId
           FROM password_reset_tokens
           WHERE token_hash = ? AND actor_scope = 'USER' AND purpose = 'PASSWORD_RESET'
           LIMIT 1`,
          [tokenHash],
        );
        const candidate = candidateRows[0];
        if (!candidate) {
          await connection.rollback();
          return false;
        }
        const [userRows] = await connection.execute(
          `SELECT id FROM users
           WHERE id = ? AND status = 'ACTIVE'
           LIMIT 1 FOR UPDATE`,
          [candidate.userId],
        );
        if (!userRows[0]) {
          await connection.rollback();
          return false;
        }
        const [tokenRows] = await connection.execute(
          `SELECT id
           FROM password_reset_tokens
           WHERE token_hash = ? AND actor_scope = 'USER' AND actor_id = ?
             AND purpose = 'PASSWORD_RESET' AND consumed_at IS NULL
             AND expires_at > UTC_TIMESTAMP(6)
           LIMIT 1 FOR UPDATE`,
          [tokenHash, candidate.userId],
        );
        if (!tokenRows[0]) {
          await connection.rollback();
          return false;
        }
        await connection.execute(
          `UPDATE users
           SET password_hash = ?, password_changed_at = UTC_TIMESTAMP(6)
           WHERE id = ?`,
          [passwordHash, candidate.userId],
        );
        await connection.execute(
          `UPDATE password_reset_tokens
           SET consumed_at = COALESCE(consumed_at, UTC_TIMESTAMP(6))
           WHERE actor_scope = 'USER' AND actor_id = ?
             AND purpose = 'PASSWORD_RESET' AND consumed_at IS NULL`,
          [candidate.userId],
        );
        await connection.execute(
          `UPDATE user_sessions
           SET revoked_at = COALESCE(revoked_at, UTC_TIMESTAMP(6))
           WHERE user_id = ? AND revoked_at IS NULL`,
          [candidate.userId],
        );
        commitStarted = true;
        await connection.commit();
        return true;
      } catch (error) {
        return resolverErrorTransaccion(connection, error, commitStarted);
      } finally {
        connection.release?.();
      }
    },

    async registrarLoginTransaccional(membershipId, expectedPasswordHash, sessionData) {
      const connection = await pool.getConnection();
      let commitStarted = false;
      try {
        await connection.beginTransaction();
        const contexto = await buscarContextoMembership(connection, membershipId, true);
        if (!contexto || contexto.passwordHash !== expectedPasswordHash) {
          throw errorCredenciales();
        }
        validarContextoParaSesion(contexto);

        const [sessionResult] = await connection.execute(
          `INSERT INTO user_sessions
            (user_id, tenant_id, membership_id, refresh_token_hash, family_id, expires_at,
             created_ip_hash, user_agent_summary)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            contexto.userId,
            contexto.tenantId,
            contexto.membershipId,
            sessionData.tokenHash,
            sessionData.familyId,
            sessionData.expiresAt,
            sessionData.ipHash,
            sessionData.userAgent,
          ],
        );
        await connection.execute(
          'UPDATE users SET last_login_at = UTC_TIMESTAMP(6) WHERE id = ?',
          [contexto.userId],
        );

        commitStarted = true;
        await connection.commit();
        return { contexto, sessionId: String(sessionResult.insertId) };
      } catch (error) {
        return resolverErrorTransaccion(connection, error, commitStarted);
      } finally {
        connection.release?.();
      }
    },

    async refrescarSesionTransaccional(tokenHash, nextSessionData) {
      const connection = await pool.getConnection();
      let commitStarted = false;
      try {
        await connection.beginTransaction();
        const [sessionRows] = await connection.execute(
          `SELECT id AS sessionId, user_id AS userId, tenant_id AS tenantId,
                  membership_id AS membershipId, family_id AS familyId,
                  revoked_at AS revokedAt,
                  (expires_at <= UTC_TIMESTAMP(6)) AS isExpired
           FROM user_sessions
           WHERE refresh_token_hash = ?
           LIMIT 1 FOR UPDATE`,
          [tokenHash],
        );
        const session = sessionRows[0];

        if (!session) {
          await connection.rollback();
          return { invalid: true };
        }
        if (session.revokedAt) {
          await connection.execute(
            `UPDATE user_sessions
             SET revoked_at = COALESCE(revoked_at, UTC_TIMESTAMP(6))
             WHERE family_id = ?`,
            [session.familyId],
          );
          commitStarted = true;
          await connection.commit();
          return { reused: true };
        }
        if (Number(session.isExpired) === 1) {
          await connection.execute(
            'UPDATE user_sessions SET revoked_at = UTC_TIMESTAMP(6) WHERE id = ?',
            [session.sessionId],
          );
          commitStarted = true;
          await connection.commit();
          return { invalid: true };
        }

        const contexto = await buscarContextoMembership(connection, session.membershipId, true);
        if (!contexto || String(contexto.userId) !== String(session.userId)
          || String(contexto.tenantId) !== String(session.tenantId)) {
          await connection.execute(
            `UPDATE user_sessions
             SET revoked_at = COALESCE(revoked_at, UTC_TIMESTAMP(6))
             WHERE family_id = ?`,
            [session.familyId],
          );
          commitStarted = true;
          await connection.commit();
          return { invalid: true };
        }
        validarContextoParaSesion(contexto);

        const [newSessionResult] = await connection.execute(
          `INSERT INTO user_sessions
            (user_id, tenant_id, membership_id, refresh_token_hash, family_id, expires_at,
             created_ip_hash, user_agent_summary)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            session.userId,
            session.tenantId,
            session.membershipId,
            nextSessionData.tokenHash,
            session.familyId,
            nextSessionData.expiresAt,
            nextSessionData.ipHash,
            nextSessionData.userAgent,
          ],
        );
        const newSessionId = String(newSessionResult.insertId);
        const [replaceResult] = await connection.execute(
          `UPDATE user_sessions
           SET revoked_at = UTC_TIMESTAMP(6), replaced_by_session_id = ?
           WHERE id = ? AND revoked_at IS NULL`,
          [newSessionId, session.sessionId],
        );
        if (replaceResult.affectedRows !== 1) {
          throw new AppError('La sesión de renovación ya no está disponible.', {
            statusCode: 401,
            code: 'INVALID_REFRESH_TOKEN',
          });
        }

        commitStarted = true;
        await connection.commit();
        return { contexto, sessionId: newSessionId };
      } catch (error) {
        return resolverErrorTransaccion(connection, error, commitStarted);
      } finally {
        connection.release?.();
      }
    },

    async cerrarSesionTransaccional(tokenHash) {
      const connection = await pool.getConnection();
      let commitStarted = false;
      try {
        await connection.beginTransaction();
        const [rows] = await connection.execute(
          `SELECT id FROM user_sessions
           WHERE refresh_token_hash = ?
           LIMIT 1 FOR UPDATE`,
          [tokenHash],
        );
        if (rows[0]) {
          await connection.execute(
            `UPDATE user_sessions
             SET revoked_at = COALESCE(revoked_at, UTC_TIMESTAMP(6))
             WHERE id = ?`,
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

    async obtenerMembershipActual(userId, tenantId, membershipId) {
      const contexto = await buscarContextoMembership(pool, membershipId);
      if (!contexto || String(contexto.userId) !== String(userId)
        || String(contexto.tenantId) !== String(tenantId)) return null;
      return contexto;
    },

    async buscarSesionActiva(sessionId, userId, tenantId, membershipId) {
      const [rows] = await pool.execute(
        `SELECT us.id, us.user_id AS userId, us.tenant_id AS tenantId,
                us.membership_id AS membershipId
         FROM user_sessions us
         JOIN users u ON u.id = us.user_id
         WHERE us.id = ? AND us.user_id = ? AND us.tenant_id = ? AND us.membership_id = ?
           AND us.revoked_at IS NULL AND us.expires_at > UTC_TIMESTAMP(6)
           AND u.status = 'ACTIVE'
         LIMIT 1`,
        [sessionId, userId, tenantId, membershipId],
      );
      return rows[0] || null;
    },
  };
}
