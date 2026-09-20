import { access } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

import bcrypt from 'bcrypt';
import dotenv from 'dotenv';
import mysql from 'mysql2/promise';

import { loadConfig } from '../src/config/environment.js';
import * as servicioAuth from '../src/modules/auth/auth-services.js';
import { createAuthTokenManager, hashRefreshToken } from '../src/modules/auth/auth-token.js';
import * as servicioAdmin from '../src/modules/saas-admin/saas-admin-services.js';
import {
  createSaasAdminTokenManager,
  hashAdminRefreshToken,
} from '../src/modules/saas-admin/saas-admin-token.js';
import { iniciarBaseDeDatosAuth } from '../src/shared/database/auth-sql.js';
import { iniciarBaseDeDatosSaasAdmin } from '../src/shared/database/saas-admin-sql.js';

const TEST_DATABASE = 'saas_jps_test';

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Falta la variable requerida ${name}.`);
  return value;
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function requireGuard() {
  if (process.env.NODE_ENV !== 'test' || process.env.ALLOW_DB_INTEGRATION !== 'true') {
    throw new Error('Se requieren NODE_ENV=test y ALLOW_DB_INTEGRATION=true.');
  }
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
  const baseAdmin = iniciarBaseDeDatosSaasAdmin(pool);
  const baseAuth = iniciarBaseDeDatosAuth(pool);
  const adminTokens = createSaasAdminTokenManager(runtimeConfig);
  const userTokens = createAuthTokenManager(runtimeConfig);
  const fixture = {
    adminId: null,
    tenantId: null,
    userId: null,
    adminEmail: `admin-${Date.now()}@example.test`,
    ownerEmail: `owner-${Date.now()}@example.test`,
    adminPassword: 'clave-admin-integracion',
  };
  const proveedorDeshabilitado = {
    async enviarTokenRestablecimiento() { return { skipped: true }; },
  };

  try {
    const [adminResult] = await pool.execute(
      `INSERT INTO saas_admins (email_normalized, password_hash, status)
       VALUES (?, ?, 'ACTIVE')`,
      [fixture.adminEmail, await bcrypt.hash(fixture.adminPassword, 4)],
    );
    fixture.adminId = String(adminResult.insertId);

    const loginAdmin = await servicioAdmin.login(
      baseAdmin, adminTokens, fixture.adminEmail, fixture.adminPassword,
    );
    const [adminSessionRows] = await pool.execute(
      `SELECT id, refresh_token_hash AS tokenHash
       FROM admin_sessions WHERE admin_id = ?`,
      [fixture.adminId],
    );
    assert(adminSessionRows.length === 1, 'No se creó exactamente una sesión administrativa.');
    assert(
      Buffer.compare(
        adminSessionRows[0].tokenHash,
        hashAdminRefreshToken(loginAdmin.refreshToken),
      ) === 0,
      'La sesión administrativa no guardó el hash esperado.',
    );

    const creado = await servicioAdmin.crearTenant(
      baseAdmin,
      userTokens,
      proveedorDeshabilitado,
      fixture.adminId,
      {
        displayName: 'Puesto Integración Admin',
        ownerEmail: fixture.ownerEmail,
        planCode: 'MONTHLY_BASE',
      },
      `admin-create-${Date.now()}`,
    );
    assert(creado.accessSetup.delivery === 'MANUAL', 'No se entregó el setup manual esperado.');
    const [tenantRows] = await pool.execute(
      `SELECT t.id AS tenantId, u.id AS userId, s.status,
              TIMESTAMPDIFF(DAY, s.trial_started_at, s.trial_ends_at) AS trialDays
       FROM tenants t
       JOIN tenant_memberships tm ON tm.tenant_id = t.id AND tm.role = 'OWNER'
       JOIN users u ON u.id = tm.user_id
       JOIN subscriptions s ON s.tenant_id = t.id
       WHERE t.public_id = ? AND u.public_id = ?`,
      [creado.tenant.id, creado.owner.id],
    );
    assert(tenantRows.length === 1, 'El alta no creó todo el agregado tenant.');
    fixture.tenantId = String(tenantRows[0].tenantId);
    fixture.userId = String(tenantRows[0].userId);
    assert(tenantRows[0].status === 'TRIAL', 'La suscripción inicial no quedó en prueba.');
    assert(Number(tenantRows[0].trialDays) === 3, 'La prueba inicial no dura tres días.');
    const [[initialSettings]] = await pool.execute(
      `SELECT
         (SELECT COUNT(*) FROM tenant_lotteries WHERE tenant_id = ?) AS lotteries,
         (SELECT COUNT(*) FROM lotteries WHERE is_active = TRUE) AS catalogLotteries,
         (SELECT COUNT(*) FROM tenant_modalities WHERE tenant_id = ?) AS modalities,
         (SELECT COUNT(*) FROM tenant_modalities
           WHERE tenant_id = ? AND multiplier IS NULL AND is_enabled = TRUE) AS pendingModalities,
         (SELECT COUNT(*) FROM tenant_schedules WHERE tenant_id = ?) AS schedules,
         (SELECT COUNT(*) FROM draw_schedules WHERE is_active = TRUE) AS catalogSchedules,
         (SELECT MIN(close_minutes_before) FROM tenant_schedules WHERE tenant_id = ?) AS minClose,
         (SELECT MAX(close_minutes_before) FROM tenant_schedules WHERE tenant_id = ?) AS maxClose,
         (SELECT general_number_limit FROM tenant_limit_settings WHERE tenant_id = ?) AS generalLimit`,
      [fixture.tenantId, fixture.tenantId, fixture.tenantId, fixture.tenantId,
        fixture.tenantId, fixture.tenantId, fixture.tenantId],
    );
    assert(
      Number(initialSettings.lotteries) === Number(initialSettings.catalogLotteries),
      'El alta no habilitó todas las loterías activas.',
    );
    assert(
      Number(initialSettings.modalities) === Number(initialSettings.pendingModalities),
      'Las modalidades iniciales no quedaron habilitadas y pendientes de multiplicador.',
    );
    assert(
      Number(initialSettings.schedules) === Number(initialSettings.catalogSchedules),
      'El alta no habilitó todos los horarios activos.',
    );
    assert(
      Number(initialSettings.minClose) === 10 && Number(initialSettings.maxClose) === 10,
      'El cierre inicial no quedó en 10 minutos.',
    );
    assert(
      initialSettings.generalLimit === '10000.00',
      'El límite general inicial no quedó en 10000.00.',
    );

    const firstPassword = 'clave-inicial-vendedor';
    await servicioAuth.confirmarRestablecimiento(
      baseAuth, creado.accessSetup.token, firstPassword,
    );
    const sellerLogin = await servicioAuth.login(
      baseAuth, userTokens, fixture.ownerEmail, firstPassword,
    );

    await servicioAdmin.cambiarEstadoTenant(
      baseAdmin,
      fixture.adminId,
      creado.tenant.id,
      { status: 'SUSPENDED', reason: 'Prueba de integración' },
      `admin-suspend-${Date.now()}`,
    );
    const [activeSellerSessions] = await pool.execute(
      `SELECT id FROM user_sessions
       WHERE user_id = ? AND revoked_at IS NULL`,
      [fixture.userId],
    );
    assert(activeSellerSessions.length === 0, 'Suspender el tenant no revocó sus sesiones.');
    const refreshAfterSuspension = await baseAuth.refrescarSesionTransaccional(
      hashRefreshToken(sellerLogin.refreshToken),
      {},
    );
    assert(
      refreshAfterSuspension.invalid || refreshAfterSuspension.reused,
      'Una sesión suspendida no quedó inutilizable.',
    );

    await servicioAdmin.cambiarEstadoTenant(
      baseAdmin,
      fixture.adminId,
      creado.tenant.id,
      { status: 'ACTIVE' },
      `admin-reactivate-${Date.now()}`,
    );
    await pool.execute(
      `UPDATE subscriptions
       SET status = 'EXPIRED', access_ends_at = DATE_SUB(UTC_TIMESTAMP(6), INTERVAL 1 SECOND)
       WHERE tenant_id = ?`,
      [fixture.tenantId],
    );
    const expiredLogin = await servicioAuth.login(
      baseAuth, userTokens, fixture.ownerEmail, firstPassword,
    );
    assert(
      expiredLogin.contenido.subscription.renewalRequired,
      'El tenant vencido no recibió el contrato de renovación.',
    );

    const paymentInput = {
      requestId: randomUUID(),
      amount: '5000.00',
      startsAt: new Date(),
      accessEndsAt: new Date(Date.now() + 30 * 86_400_000),
      paidAt: new Date(),
      note: 'Pago de integración',
    };
    const payment = await servicioAdmin.confirmarPagoSuscripcion(
      baseAdmin,
      fixture.adminId,
      creado.tenant.id,
      paymentInput,
      `admin-payment-${Date.now()}`,
    );
    assert(!payment.replay, 'El primer pago fue tratado como reintento.');
    const paymentReplay = await servicioAdmin.confirmarPagoSuscripcion(
      baseAdmin,
      fixture.adminId,
      creado.tenant.id,
      paymentInput,
      `admin-payment-retry-${Date.now()}`,
    );
    assert(paymentReplay.replay, 'El mismo requestId no devolvió la respuesta persistida.');
    const [[paymentCounts]] = await pool.execute(
      `SELECT
         (SELECT COUNT(*) FROM subscription_payments sp
          JOIN subscription_periods sper ON sper.id = sp.subscription_period_id
          JOIN subscriptions s ON s.id = sper.subscription_id
          WHERE s.tenant_id = ?) AS payments,
         (SELECT COUNT(*) FROM cash_movements WHERE tenant_id = ?) AS cashMovements`,
      [fixture.tenantId, fixture.tenantId],
    );
    assert(Number(paymentCounts.payments) === 1, 'El reintento duplicó el pago SaaS.');
    assert(Number(paymentCounts.cashMovements) === 0, 'El pago SaaS modificó la caja del vendedor.');

    const reset = await servicioAdmin.restablecerAccesoTenant(
      baseAdmin,
      userTokens,
      proveedorDeshabilitado,
      fixture.adminId,
      creado.tenant.id,
      `admin-reset-${Date.now()}`,
    );
    const nextPassword = 'clave-restablecida-vendedor';
    await servicioAuth.confirmarRestablecimiento(baseAuth, reset.accessSetup.token, nextPassword);
    const nextLogin = await servicioAuth.login(
      baseAuth, userTokens, fixture.ownerEmail, nextPassword,
    );
    await servicioAuth.logout(baseAuth, nextLogin.refreshToken);

    const [auditRows] = await pool.execute(
      `SELECT event_type AS eventType
       FROM audit_events WHERE tenant_id = ? ORDER BY id`,
      [fixture.tenantId],
    );
    const eventTypes = auditRows.map((row) => row.eventType);
    assert(eventTypes.includes('TENANT_CREATED'), 'Falta auditoría de alta del tenant.');
    assert(eventTypes.includes('TENANT_STATUS_CHANGED'), 'Falta auditoría de cambio de estado.');
    assert(
      eventTypes.includes('TENANT_ACCESS_RESET_REQUESTED'),
      'Falta auditoría de restablecimiento de acceso.',
    );

    await servicioAdmin.logout(baseAdmin, loginAdmin.refreshToken);
    console.log('Integración SaaS admin aprobada: alta, aislamiento, renovación, pago idempotente y auditoría.');
  } finally {
    if (fixture.tenantId) {
      await pool.execute('DELETE FROM audit_events WHERE tenant_id = ?', [fixture.tenantId]);
      await pool.execute(
        `DELETE FROM subscription_payments
         WHERE subscription_period_id IN (
           SELECT sper.id FROM subscription_periods sper
           JOIN subscriptions s ON s.id = sper.subscription_id
           WHERE s.tenant_id = ?
         )`,
        [fixture.tenantId],
      );
      await pool.execute('DELETE FROM operation_requests WHERE tenant_id = ?', [fixture.tenantId]);
    }
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
      await pool.execute('DELETE FROM tenant_schedules WHERE tenant_id = ?', [fixture.tenantId]);
      await pool.execute('DELETE FROM tenant_modalities WHERE tenant_id = ?', [fixture.tenantId]);
      await pool.execute('DELETE FROM tenant_lotteries WHERE tenant_id = ?', [fixture.tenantId]);
      await pool.execute('DELETE FROM tenant_limit_settings WHERE tenant_id = ?', [fixture.tenantId]);
      await pool.execute(
        `DELETE FROM subscription_periods
         WHERE subscription_id IN (SELECT id FROM subscriptions WHERE tenant_id = ?)`,
        [fixture.tenantId],
      );
      await pool.execute('DELETE FROM subscriptions WHERE tenant_id = ?', [fixture.tenantId]);
      await pool.execute('DELETE FROM tenant_memberships WHERE tenant_id = ?', [fixture.tenantId]);
    }
    if (fixture.userId) await pool.execute('DELETE FROM users WHERE id = ?', [fixture.userId]);
    if (fixture.tenantId) await pool.execute('DELETE FROM tenants WHERE id = ?', [fixture.tenantId]);
    if (fixture.adminId) {
      await pool.execute(
        'UPDATE admin_sessions SET replaced_by_session_id = NULL WHERE admin_id = ?',
        [fixture.adminId],
      );
      await pool.execute('DELETE FROM admin_sessions WHERE admin_id = ?', [fixture.adminId]);
      await pool.execute('DELETE FROM saas_admins WHERE id = ?', [fixture.adminId]);
    }
    await pool.end();
  }
}

main().catch((error) => {
  console.error(`Integración SaaS admin fallida: ${error.message}`);
  process.exitCode = 1;
});
