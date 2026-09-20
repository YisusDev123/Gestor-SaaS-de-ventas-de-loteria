import { randomBytes } from 'node:crypto';
import { access } from 'node:fs/promises';
import path from 'node:path';

import bcrypt from 'bcrypt';
import dotenv from 'dotenv';
import mysql from 'mysql2/promise';

import { loadConfig } from '../src/config/environment.js';
import * as servicioAuth from '../src/modules/auth/auth-services.js';
import {
  createAuthTokenManager,
  hashPasswordResetToken,
  hashRefreshToken,
} from '../src/modules/auth/auth-token.js';
import { iniciarBaseDeDatosAuth } from '../src/shared/database/auth-sql.js';

const TEST_DATABASE = 'saas_jps_test';

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Falta la variable requerida ${name}.`);
  return value;
}

function requireGuard() {
  if (process.env.NODE_ENV !== 'test' || process.env.ALLOW_DB_INTEGRATION !== 'true') {
    throw new Error('Se requieren NODE_ENV=test y ALLOW_DB_INTEGRATION=true.');
  }
}

function publicId(prefix) {
  return `${prefix}${randomBytes(16).toString('hex').toUpperCase()}`.slice(0, 26);
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function main() {
  requireGuard();
  const credentialsFile = path.resolve(required('SAAS_TEST_CREDENTIALS_FILE'));
  await access(credentialsFile);
  dotenv.config({ path: credentialsFile, override: true, quiet: true });

  const pool = mysql.createPool({
    host: required('MYSQL_HOST'),
    port: Number(process.env.MYSQL_PORT || 3306),
    user: required('MYSQL_USER'),
    password: required('MYSQL_PASSWORD'),
    database: TEST_DATABASE,
    connectionLimit: 4,
    timezone: '+00:00',
    dateStrings: true,
    supportBigNumbers: true,
    bigNumberStrings: true,
    decimalNumbers: false,
  });
  const runtimeConfig = loadConfig({ NODE_ENV: 'test', MYSQL_DB: TEST_DATABASE });
  const baseDeDatosAuth = iniciarBaseDeDatosAuth(pool);
  const tokenManager = createAuthTokenManager(runtimeConfig);
  const fixture = {
    email: `auth-${Date.now()}@example.test`,
    password: 'clave-integracion-segura',
    userId: null,
    tenantId: null,
    membershipId: null,
    otherUserId: null,
    otherTenantId: null,
    otherMembershipId: null,
  };

  try {
    const passwordHash = await bcrypt.hash(fixture.password, 4);
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      const [[plan]] = await connection.query(
        'SELECT id FROM subscription_plans WHERE code = ? LIMIT 1', ['MONTHLY_BASE'],
      );
      assert(plan, 'Falta el plan MONTHLY_BASE requerido por el fixture.');
      const [tenantResult] = await connection.execute(
        `INSERT INTO tenants (public_id, display_name, status)
         VALUES (?, 'Puesto Integración', 'ACTIVE')`,
        [publicId('T')],
      );
      fixture.tenantId = String(tenantResult.insertId);
      const [userResult] = await connection.execute(
        `INSERT INTO users (public_id, email_normalized, password_hash, status)
         VALUES (?, ?, ?, 'ACTIVE')`,
        [publicId('U'), fixture.email, passwordHash],
      );
      fixture.userId = String(userResult.insertId);
      const [membershipResult] = await connection.execute(
        `INSERT INTO tenant_memberships (tenant_id, user_id, role, status)
         VALUES (?, ?, 'OWNER', 'ACTIVE')`,
        [fixture.tenantId, fixture.userId],
      );
      fixture.membershipId = String(membershipResult.insertId);
      await connection.execute(
        `INSERT INTO subscriptions (tenant_id, plan_id, status, access_ends_at)
         VALUES (?, ?, 'ACTIVE', DATE_ADD(UTC_TIMESTAMP(6), INTERVAL 30 DAY))`,
        [fixture.tenantId, plan.id],
      );

      const [otherTenantResult] = await connection.execute(
        `INSERT INTO tenants (public_id, display_name, status)
         VALUES (?, 'Puesto Aislado', 'ACTIVE')`,
        [publicId('T')],
      );
      fixture.otherTenantId = String(otherTenantResult.insertId);
      const [otherUserResult] = await connection.execute(
        `INSERT INTO users (public_id, email_normalized, password_hash, status)
         VALUES (?, ?, ?, 'ACTIVE')`,
        [publicId('U'), `other-${fixture.email}`, passwordHash],
      );
      fixture.otherUserId = String(otherUserResult.insertId);
      const [otherMembershipResult] = await connection.execute(
        `INSERT INTO tenant_memberships (tenant_id, user_id, role, status)
         VALUES (?, ?, 'OWNER', 'ACTIVE')`,
        [fixture.otherTenantId, fixture.otherUserId],
      );
      fixture.otherMembershipId = String(otherMembershipResult.insertId);
      await connection.execute(
        `INSERT INTO subscriptions (tenant_id, plan_id, status, access_ends_at)
         VALUES (?, ?, 'ACTIVE', DATE_ADD(UTC_TIMESTAMP(6), INTERVAL 30 DAY))`,
        [fixture.otherTenantId, plan.id],
      );
      await connection.commit();
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }

    const login = await servicioAuth.login(
      baseDeDatosAuth, tokenManager, fixture.email, fixture.password,
    );
    assert(login.contenido.tenant.name === 'Puesto Integración', 'Login no devolvió el tenant correcto.');
    const [storedLogin] = await pool.execute(
      'SELECT id, refresh_token_hash AS tokenHash FROM user_sessions WHERE user_id = ?',
      [fixture.userId],
    );
    assert(storedLogin.length === 1, 'Login no creó exactamente una sesión.');
    assert(
      Buffer.compare(storedLogin[0].tokenHash, hashRefreshToken(login.refreshToken)) === 0,
      'MySQL no almacenó el hash esperado del refresh.',
    );

    const ownMembership = await baseDeDatosAuth.obtenerMembershipActual(
      fixture.userId, fixture.tenantId, fixture.membershipId,
    );
    assert(ownMembership, 'No se resolvió la membership propia del tenant autenticado.');
    const crossedTenant = await baseDeDatosAuth.obtenerMembershipActual(
      fixture.userId, fixture.otherTenantId, fixture.membershipId,
    );
    assert(!crossedTenant, 'Una membership propia aceptó el ID de otro tenant.');
    const crossedMembership = await baseDeDatosAuth.obtenerMembershipActual(
      fixture.userId, fixture.tenantId, fixture.otherMembershipId,
    );
    assert(!crossedMembership, 'Se resolvió una membership perteneciente a otro tenant.');
    const crossedSession = await baseDeDatosAuth.buscarSesionActiva(
      storedLogin[0].id,
      fixture.userId,
      fixture.otherTenantId,
      fixture.membershipId,
    );
    assert(!crossedSession, 'Una sesión autenticada aceptó el ID de otro tenant.');

    const refreshed = await servicioAuth.refrescarToken(
      baseDeDatosAuth, tokenManager, login.refreshToken,
    );
    const [rotated] = await pool.execute(
      `SELECT revoked_at AS revokedAt, replaced_by_session_id AS replacedBy
       FROM user_sessions WHERE id = ?`,
      [storedLogin[0].id],
    );
    assert(rotated[0].revokedAt && rotated[0].replacedBy, 'La rotación no revocó ni enlazó la sesión anterior.');

    let reuseRejected = false;
    try {
      await servicioAuth.refrescarToken(baseDeDatosAuth, tokenManager, login.refreshToken);
    } catch (error) {
      reuseRejected = error?.code === 'REFRESH_TOKEN_REUSED';
    }
    assert(reuseRejected, 'La reutilización del refresh anterior no fue rechazada.');
    const [[activeAfterReuse]] = await pool.execute(
      'SELECT COUNT(*) AS total FROM user_sessions WHERE user_id = ? AND revoked_at IS NULL',
      [fixture.userId],
    );
    assert(Number(activeAfterReuse.total) === 0, 'La reutilización no revocó la familia completa.');

    const relogin = await servicioAuth.login(
      baseDeDatosAuth, tokenManager, fixture.email, fixture.password,
    );
    await servicioAuth.logout(baseDeDatosAuth, relogin.refreshToken);
    const [[activeAfterLogout]] = await pool.execute(
      'SELECT COUNT(*) AS total FROM user_sessions WHERE user_id = ? AND revoked_at IS NULL',
      [fixture.userId],
    );
    assert(Number(activeAfterLogout.total) === 0, 'Logout dejó una sesión activa.');
    assert(refreshed.refreshToken !== login.refreshToken, 'La rotación reutilizó el mismo secreto.');

    await servicioAuth.login(baseDeDatosAuth, tokenManager, fixture.email, fixture.password);
    let tokenEntregado = null;
    const proveedorRecuperacion = {
      async enviarTokenRestablecimiento(payload) {
        tokenEntregado = payload.token;
        return { skipped: false };
      },
    };
    await servicioAuth.solicitarRestablecimiento(
      baseDeDatosAuth,
      tokenManager,
      proveedorRecuperacion,
      fixture.email,
    );
    assert(tokenEntregado, 'La interfaz de recuperación no recibió el token.');
    const [resetRows] = await pool.execute(
      `SELECT token_hash AS tokenHash
       FROM password_reset_tokens
       WHERE actor_scope = 'USER' AND actor_id = ?
       ORDER BY id DESC LIMIT 1`,
      [fixture.userId],
    );
    assert(resetRows.length === 1, 'No se persistió el token de recuperación.');
    assert(
      Buffer.compare(resetRows[0].tokenHash, hashPasswordResetToken(tokenEntregado)) === 0,
      'MySQL no almacenó el hash esperado del token de recuperación.',
    );

    const nuevaPassword = 'clave-integracion-actualizada';
    await servicioAuth.confirmarRestablecimiento(
      baseDeDatosAuth, tokenEntregado, nuevaPassword,
    );
    const [[activeAfterReset]] = await pool.execute(
      'SELECT COUNT(*) AS total FROM user_sessions WHERE user_id = ? AND revoked_at IS NULL',
      [fixture.userId],
    );
    assert(Number(activeAfterReset.total) === 0, 'El restablecimiento dejó sesiones activas.');
    let passwordAnteriorRechazada = false;
    try {
      await servicioAuth.login(baseDeDatosAuth, tokenManager, fixture.email, fixture.password);
    } catch (error) {
      passwordAnteriorRechazada = error?.code === 'INVALID_CREDENTIALS';
    }
    assert(passwordAnteriorRechazada, 'La contraseña anterior continuó siendo válida.');
    const loginActualizado = await servicioAuth.login(
      baseDeDatosAuth, tokenManager, fixture.email, nuevaPassword,
    );
    await servicioAuth.logout(baseDeDatosAuth, loginActualizado.refreshToken);

    console.log('Integración auth aprobada: sesiones, recuperación y aislamiento entre dos tenants.');
  } finally {
    if (fixture.userId) {
      await pool.execute(
        'UPDATE user_sessions SET replaced_by_session_id = NULL WHERE user_id = ?', [fixture.userId],
      );
      await pool.execute('DELETE FROM user_sessions WHERE user_id = ?', [fixture.userId]);
      await pool.execute(
        `DELETE FROM password_reset_tokens
         WHERE actor_scope = 'USER' AND actor_id = ?`,
        [fixture.userId],
      );
    }
    if (fixture.tenantId) {
      await pool.execute('DELETE FROM subscriptions WHERE tenant_id = ?', [fixture.tenantId]);
      await pool.execute('DELETE FROM tenant_memberships WHERE tenant_id = ?', [fixture.tenantId]);
    }
    if (fixture.otherTenantId) {
      await pool.execute('DELETE FROM subscriptions WHERE tenant_id = ?', [fixture.otherTenantId]);
      await pool.execute(
        'DELETE FROM tenant_memberships WHERE tenant_id = ?', [fixture.otherTenantId],
      );
    }
    if (fixture.userId) await pool.execute('DELETE FROM users WHERE id = ?', [fixture.userId]);
    if (fixture.otherUserId) {
      await pool.execute('DELETE FROM users WHERE id = ?', [fixture.otherUserId]);
    }
    if (fixture.tenantId) await pool.execute('DELETE FROM tenants WHERE id = ?', [fixture.tenantId]);
    if (fixture.otherTenantId) {
      await pool.execute('DELETE FROM tenants WHERE id = ?', [fixture.otherTenantId]);
    }
    await pool.end();
  }
}

main().catch((error) => {
  console.error(`Integración auth fallida: ${error.message}`);
  process.exitCode = 1;
});
