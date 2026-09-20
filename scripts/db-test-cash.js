import { access } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';

import dotenv from 'dotenv';
import mysql from 'mysql2/promise';

import * as service from '../src/modules/cash/cash-services.js';
import { iniciarBaseDeDatosCash } from '../src/shared/database/cash-sql.js';
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
    [createPublicId(), `Puesto Caja ${suffix}`],
  );
  const tenantId = String(tenantResult.insertId);
  const [userResult] = await pool.execute(
    `INSERT INTO users (public_id, email_normalized, password_hash, status)
     VALUES (?, ?, ?, 'ACTIVE')`,
    [createPublicId(), `cash-${suffix}@example.test`, 'integration-not-a-login-password'],
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
  await pool.execute('DELETE FROM tenant_daily_summaries WHERE tenant_id = ?', [fixture.tenantId]);
  await pool.execute('DELETE FROM audit_events WHERE tenant_id = ?', [fixture.tenantId]);
  await pool.execute('DELETE FROM cash_movements WHERE tenant_id = ?', [fixture.tenantId]);
  await pool.execute('DELETE FROM cash_accounts WHERE tenant_id = ?', [fixture.tenantId]);
  await pool.execute('DELETE FROM operation_requests WHERE tenant_id = ?', [fixture.tenantId]);
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
    connectionLimit: 4,
    timezone: '+00:00',
    dateStrings: true,
    supportBigNumbers: true,
    bigNumberStrings: true,
    decimalNumbers: false,
  });
  const database = iniciarBaseDeDatosCash(pool);
  let first;
  let second;
  try {
    const suffix = String(Date.now());
    first = await createTenantFixture(pool, `${suffix}-1`);
    second = await createTenantFixture(pool, `${suffix}-2`);
    const now = new Date('2026-09-08T12:00:00.000Z');

    const initialInput = {
      requestId: randomUUID(), amount: '0.00',
    };
    const initialized = await service.inicializarCaja(
      database, first.tenantId, first.userId, initialInput, `cash-init-${suffix}`, now,
    );
    assert(initialized.cash.balance === '0.00', 'La caja no admitió saldo inicial cero.');
    const replay = await service.inicializarCaja(
      database, first.tenantId, first.userId, initialInput, `cash-init-replay-${suffix}`, now,
    );
    assert(replay.replay === true, 'La inicialización idempotente creó una operación nueva.');
    let reusedKeyRejected = false;
    try {
      await service.inicializarCaja(
        database, first.tenantId, first.userId,
        { ...initialInput, amount: '1.00' }, `cash-init-reused-${suffix}`, now,
      );
    } catch (error) {
      reusedKeyRejected = error?.code === 'IDEMPOTENCY_KEY_REUSED';
    }
    assert(reusedKeyRejected, 'Un requestId reutilizado aceptó un payload diferente.');

    await service.registrarMovimiento(database, first.tenantId, first.userId, {
      requestId: randomUUID(), movementType: 'ENTRY', amount: '125.50',
      reason: 'Fondo operativo',
    }, `cash-entry-${suffix}`, now);
    const expenseInput = {
      requestId: randomUUID(), movementType: 'EXPENSE', amount: '25.25',
      reason: 'Compra de insumos',
    };
    const expense = await service.registrarMovimiento(
      database, first.tenantId, first.userId, expenseInput, `cash-expense-${suffix}`, now,
    );
    assert(expense.cash.balance === '100.25', 'El saldo continuo perdió precisión DECIMAL.');
    const expenseReplay = await service.registrarMovimiento(
      database, first.tenantId, first.userId, expenseInput, `cash-expense-replay-${suffix}`, now,
    );
    assert(expenseReplay.replay === true, 'El gasto idempotente se aplicó dos veces.');

    let overdraftRejected = false;
    try {
      await service.registrarMovimiento(database, first.tenantId, first.userId, {
        requestId: randomUUID(), movementType: 'WITHDRAWAL', amount: '1000.00',
        reason: 'Retiro inválido',
      }, `cash-overdraft-${suffix}`, now);
    } catch (error) {
      overdraftRejected = error?.code === 'INSUFFICIENT_CASH_BALANCE';
    }
    assert(overdraftRejected, 'La caja permitió un saldo negativo.');

    const concurrentWithdrawals = await Promise.allSettled([
      service.registrarMovimiento(database, first.tenantId, first.userId, {
        requestId: randomUUID(), movementType: 'WITHDRAWAL', amount: '75.00',
        reason: 'Retiro concurrente A',
      }, `cash-concurrent-a-${suffix}`, now),
      service.registrarMovimiento(database, first.tenantId, first.userId, {
        requestId: randomUUID(), movementType: 'WITHDRAWAL', amount: '75.00',
        reason: 'Retiro concurrente B',
      }, `cash-concurrent-b-${suffix}`, now),
    ]);
    const fulfilled = concurrentWithdrawals.filter((result) => result.status === 'fulfilled');
    const rejected = concurrentWithdrawals.filter((result) => result.status === 'rejected');
    assert(fulfilled.length === 1, 'Los débitos concurrentes no se serializaron.');
    assert(
      rejected.length === 1 && rejected[0].reason?.code === 'INSUFFICIENT_CASH_BALANCE',
      'La carrera de débitos no rechazó exactamente el movimiento sin fondos.',
    );

    const state = await service.obtenerCaja(database, first.tenantId);
    assert(state.reconciliation.isBalanced, 'El saldo cacheado no concilia con el ledger.');
    assert(state.balance === '25.25', 'El saldo final no coincide con los movimientos concurrentes.');
    const isolated = await service.obtenerCaja(database, second.tenantId);
    assert(!isolated.initialized && isolated.balance === '0.00', 'Otro tenant heredó caja ajena.');

    const firstPendingCutoff = await database.obtenerSiguienteFechaCorte('2026-09-09');
    assert(firstPendingCutoff === '2026-09-08', 'No se detectó el primer corte pendiente.');
    await database.cerrarResumenDiario('2026-09-08');
    await database.cerrarResumenDiario('2026-09-08');
    const [[daily]] = await pool.execute(
      `SELECT manual_credits_amount AS credits, manual_debits_amount AS debits,
              closing_balance AS closingBalance, status, calculation_version AS version
       FROM tenant_daily_summaries
       WHERE tenant_id = ? AND business_date = '2026-09-08'`,
      [first.tenantId],
    );
    assert(daily.credits === '125.50' && daily.debits === '100.25', 'El corte diario no separó entradas y salidas.');
    assert(daily.closingBalance === '25.25' && daily.status === 'CLOSED', 'El cierre diario no conservó el saldo continuo.');
    assert(Number(daily.version) === 1, 'Repetir un corte idéntico incrementó su versión.');
    await database.cerrarResumenDiario('2026-09-09');
    const [[nextDaily]] = await pool.execute(
      `SELECT opening_balance AS openingBalance, closing_balance AS closingBalance
       FROM tenant_daily_summaries
       WHERE tenant_id = ? AND business_date = '2026-09-09'`,
      [first.tenantId],
    );
    assert(
      nextDaily.openingBalance === '25.25' && nextDaily.closingBalance === '25.25',
      'El saldo final no continuó como apertura del día siguiente.',
    );
    const pendingAfterRecovery = await database.obtenerSiguienteFechaCorte('2026-09-09');
    assert(pendingAfterRecovery === null, 'La recuperación dejó cortes pendientes.');

    const [[counts]] = await pool.execute(
      `SELECT
         (SELECT COUNT(*) FROM cash_movements WHERE tenant_id = ?) AS movements,
         (SELECT COUNT(*) FROM audit_events WHERE tenant_id = ?
           AND event_type IN ('CASH_INITIALIZED', 'CASH_MOVEMENT_CREATED')) AS audits`,
      [first.tenantId, first.tenantId],
    );
    assert(Number(counts.movements) === 4, 'Los replays o la concurrencia duplicaron movimientos de caja.');
    assert(Number(counts.audits) === 4, 'Los movimientos no quedaron auditados exactamente una vez.');
    console.log('Integración de caja aprobada: continuidad, idempotencia, concurrencia, corte y aislamiento.');
  } finally {
    await cleanupTenant(pool, first);
    await cleanupTenant(pool, second);
    await pool.end();
  }
}

main().catch((error) => {
  console.error(`Integración de caja fallida: ${error.message}`);
  process.exitCode = 1;
});
