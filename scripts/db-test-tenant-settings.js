import { access } from 'node:fs/promises';
import path from 'node:path';

import dotenv from 'dotenv';
import mysql from 'mysql2/promise';

import * as service from '../src/modules/tenant-settings/tenant-settings-services.js';
import { iniciarBaseDeDatosTenantSettings } from '../src/shared/database/tenant-settings-sql.js';
import { createPublicId } from '../src/shared/utils/public-id.js';

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

async function createTenantFixture(pool, suffix) {
  const [tenantResult] = await pool.execute(
    `INSERT INTO tenants (public_id, display_name, status)
     VALUES (?, ?, 'ACTIVE')`,
    [createPublicId(), `Puesto Config ${suffix}`],
  );
  const tenantId = String(tenantResult.insertId);
  const [userResult] = await pool.execute(
    `INSERT INTO users (public_id, email_normalized, password_hash, status)
     VALUES (?, ?, ?, 'ACTIVE')`,
    [createPublicId(), `config-${suffix}@example.test`, 'integration-not-a-login-password'],
  );
  const userId = String(userResult.insertId);
  await pool.execute(
    `INSERT INTO tenant_memberships (tenant_id, user_id, role, status)
     VALUES (?, ?, 'OWNER', 'ACTIVE')`,
    [tenantId, userId],
  );
  return { tenantId, userId };
}

async function cleanupTenant(pool, fixture) {
  if (!fixture?.tenantId) return;
  await pool.execute('DELETE FROM audit_events WHERE tenant_id = ?', [fixture.tenantId]);
  await pool.execute('DELETE FROM tenant_daily_lottery_availability WHERE tenant_id = ?', [fixture.tenantId]);
  await pool.execute('DELETE FROM tenant_schedules WHERE tenant_id = ?', [fixture.tenantId]);
  await pool.execute('DELETE FROM tenant_modalities WHERE tenant_id = ?', [fixture.tenantId]);
  await pool.execute('DELETE FROM tenant_lotteries WHERE tenant_id = ?', [fixture.tenantId]);
  await pool.execute('DELETE FROM tenant_limit_settings WHERE tenant_id = ?', [fixture.tenantId]);
  await pool.execute('DELETE FROM tenant_business_settings WHERE tenant_id = ?', [fixture.tenantId]);
  await pool.execute('DELETE FROM tenant_memberships WHERE tenant_id = ?', [fixture.tenantId]);
  await pool.execute('DELETE FROM users WHERE id = ?', [fixture.userId]);
  await pool.execute('DELETE FROM tenants WHERE id = ?', [fixture.tenantId]);
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
    connectionLimit: 3,
    timezone: '+00:00',
    dateStrings: true,
    supportBigNumbers: true,
    bigNumberStrings: true,
    decimalNumbers: false,
  });
  const database = iniciarBaseDeDatosTenantSettings(pool);
  let first;
  let second;
  try {
    const suffix = `${Date.now()}`;
    first = await createTenantFixture(pool, `${suffix}-1`);
    second = await createTenantFixture(pool, `${suffix}-2`);

    const initial = await service.obtenerConfiguracion(database, first.tenantId);
    assert(initial.lotteries.length === 3, 'El catálogo inicial no contiene tres loterías.');
    assert(initial.lotteries.every((lottery) => lottery.configVersion === 0), 'Un tenant nuevo heredó configuración ajena.');

    await service.actualizarNegocio(database, first.tenantId, first.userId, {
      displayName: 'Puesto Configurado',
      receiptFields: { informationalText: 'Gracias por su compra' },
      expectedVersion: 0,
    }, `settings-business-${suffix}`);
    await service.actualizarLoteria(database, first.tenantId, first.userId, 'TICA', {
      isEnabled: true, expectedVersion: 0,
    }, `settings-lottery-${suffix}`);
    await service.actualizarModalidad(
      database, first.tenantId, first.userId,
      { lotteryCode: 'TICA', modalityCode: 'NORMAL' },
      { isEnabled: true, multiplier: '80.5', confirmed: true, expectedVersion: 0 },
      `settings-modality-${suffix}`,
    );
    await service.actualizarHorario(
      database, first.tenantId, first.userId,
      { lotteryCode: 'TICA', modalityCode: 'NORMAL', scheduleCode: '1300' },
      { isEnabled: true, closeMinutesBefore: 12, expectedVersion: 0 },
      `settings-schedule-${suffix}`,
    );
    await service.actualizarLimiteGeneral(database, first.tenantId, first.userId, {
      generalNumberLimit: '10000', applyToOpenDraws: false, expectedVersion: 0,
    }, `settings-limit-${suffix}`);
    await service.actualizarDisponibilidadDiaria(
      database, first.tenantId, first.userId, 'TICA',
      { businessDate: '2026-09-08', isEnabledForSales: false, reason: 'Pausa operativa', expectedVersion: 0 },
      `settings-daily-${suffix}`,
    );

    let staleRejected = false;
    try {
      await service.actualizarLoteria(database, first.tenantId, first.userId, 'TICA', {
        isEnabled: false, expectedVersion: 0,
      }, `settings-stale-${suffix}`);
    } catch (error) {
      staleRejected = error?.code === 'CONFIGURATION_VERSION_CONFLICT';
    }
    assert(staleRejected, 'Una versión obsoleta no produjo conflicto visible.');

    const configured = await service.obtenerConfiguracion(database, first.tenantId);
    const tica = configured.lotteries.find((lottery) => lottery.code === 'TICA');
    const normal = tica.modalities.find((modality) => modality.code === 'NORMAL');
    const schedule = normal.schedules.find((item) => item.code === '1300');
    assert(configured.business.displayName === 'Puesto Configurado', 'No se actualizó el nombre del puesto.');
    assert(configured.generalLimit.amount === '10000.00', 'El límite perdió precisión decimal.');
    assert(tica.enabled && normal.multiplier === '80.50', 'La configuración de modalidad no coincide.');
    assert(schedule.closeMinutesBefore === 12, 'El cierre por horario no coincide.');

    const daily = await service.obtenerDisponibilidadDiaria(database, first.tenantId, '2026-09-08');
    assert(daily.lotteries.find((lottery) => lottery.code === 'TICA').enabledForSales === false, 'La pausa diaria no se conservó.');
    const isolated = await service.obtenerConfiguracion(database, second.tenantId);
    assert(isolated.business.displayName !== 'Puesto Configurado', 'El segundo tenant leyó el nombre del primero.');
    assert(isolated.generalLimit.amount === null, 'El segundo tenant heredó el límite del primero.');

    const [[audit]] = await pool.execute(
      'SELECT COUNT(*) AS total FROM audit_events WHERE tenant_id = ?', [first.tenantId],
    );
    assert(Number(audit.total) === 6, 'No se auditó cada cambio de configuración.');
    console.log('Integración de configuración aprobada: catálogo, concurrencia, auditoría y aislamiento tenant.');
  } finally {
    await cleanupTenant(pool, first);
    await cleanupTenant(pool, second);
    await pool.end();
  }
}

main().catch((error) => {
  console.error(`Integración de configuración fallida: ${error.message}`);
  process.exitCode = 1;
});
