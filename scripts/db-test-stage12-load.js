import { randomUUID } from 'node:crypto';
import { access } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import path from 'node:path';

import dotenv from 'dotenv';
import mysql from 'mysql2/promise';

import * as cashService from '../src/modules/cash/cash-services.js';
import * as salesService from '../src/modules/sales/sales-services.js';
import { iniciarBaseDeDatosCash } from '../src/shared/database/cash-sql.js';
import { iniciarBaseDeDatosSales } from '../src/shared/database/sales-sql.js';
import { getCostaRicaBusinessDate } from '../src/shared/utils/costa-rica-time.js';
import { createPublicId } from '../src/shared/utils/public-id.js';

const TEST_DATABASE = 'saas_jps_test';
const DEFAULT_CONCURRENCY = 40;

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Falta ${name}.`);
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

function percentile(values, ratio) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil(sorted.length * ratio) - 1)];
}

async function createFixture(pool, suffix, withDraw = true) {
  const [tenant] = await pool.execute(
    "INSERT INTO tenants (public_id, display_name, status) VALUES (?, ?, 'ACTIVE')",
    [createPublicId(), `Carga Etapa 12 ${suffix}`],
  );
  const [user] = await pool.execute(
    "INSERT INTO users (public_id, email_normalized, password_hash, status) VALUES (?, ?, 'x', 'ACTIVE')",
    [createPublicId(), `stage12-load-${suffix}@example.test`],
  );
  await pool.execute(
    "INSERT INTO tenant_memberships (tenant_id, user_id, role, status) VALUES (?, ?, 'OWNER', 'ACTIVE')",
    [tenant.insertId, user.insertId],
  );
  const fixture = { tenantId: String(tenant.insertId), userId: String(user.insertId) };
  if (!withDraw) return fixture;

  const [[catalog]] = await pool.execute(`SELECT l.id AS lotteryId, lm.id AS modalityId,
      ds.id AS scheduleId
    FROM lotteries l
    JOIN lottery_modalities lm ON lm.lottery_id = l.id
    JOIN draw_schedules ds ON ds.lottery_modality_id = lm.id
    WHERE l.code = 'TICA' ORDER BY ds.id LIMIT 1`);
  await pool.execute(
    'INSERT INTO tenant_lotteries (tenant_id, lottery_id, is_enabled) VALUES (?, ?, TRUE)',
    [tenant.insertId, catalog.lotteryId],
  );
  await pool.execute(
    `INSERT INTO tenant_modalities
      (tenant_id, lottery_modality_id, is_enabled, multiplier, updated_by_user_id)
     VALUES (?, ?, TRUE, 80.00, ?)`,
    [tenant.insertId, catalog.modalityId, user.insertId],
  );
  await pool.execute(
    `INSERT INTO tenant_schedules
      (tenant_id, draw_schedule_id, is_enabled, close_minutes_before, updated_by_user_id)
     VALUES (?, ?, TRUE, 10, ?)`,
    [tenant.insertId, catalog.scheduleId, user.insertId],
  );
  await pool.execute(
    `INSERT INTO tenant_limit_settings
      (tenant_id, general_number_limit, updated_by_user_id) VALUES (?, 10000.00, ?)`,
    [tenant.insertId, user.insertId],
  );
  const drawPublicId = createPublicId();
  const businessDate = getCostaRicaBusinessDate();
  const [draw] = await pool.execute(`INSERT INTO draws
    (public_id, tenant_id, draw_schedule_id, business_date, scheduled_at_utc, closes_at_utc,
     status, lottery_code_snapshot, lottery_name_snapshot, modality_code_snapshot,
     modality_name_snapshot, local_time_snapshot, multiplier_snapshot, general_limit_snapshot)
    VALUES (?, ?, ?, ?, DATE_ADD(UTC_TIMESTAMP(6), INTERVAL 2 DAY),
      DATE_ADD(UTC_TIMESTAMP(6), INTERVAL 1 DAY), 'OPEN', 'TICA', 'Tica',
      'NORMAL', 'Normal', '13:00:00', 80.00, 10000.00)`,
  [drawPublicId, tenant.insertId, catalog.scheduleId, businessDate]);
  const positions = Array.from(
    { length: 100 }, (_, number) => [draw.insertId, number, '10000.00', '10000.00'],
  );
  await pool.query(
    `INSERT INTO draw_number_positions
      (draw_id, number_value, base_limit_amount, effective_limit_amount) VALUES ?`,
    [positions],
  );
  return {
    ...fixture,
    drawId: String(draw.insertId),
    drawPublicId,
    businessDate,
  };
}

async function cleanup(pool, fixture) {
  if (!fixture?.tenantId) return;
  await pool.execute('DELETE FROM audit_events WHERE tenant_id = ?', [fixture.tenantId]);
  await pool.execute('DELETE FROM cash_movements WHERE tenant_id = ?', [fixture.tenantId]);
  await pool.execute('DELETE FROM ticket_items WHERE tenant_id = ?', [fixture.tenantId]);
  await pool.execute('DELETE FROM tickets WHERE tenant_id = ?', [fixture.tenantId]);
  await pool.execute('DELETE FROM draw_number_positions WHERE draw_id IN (SELECT id FROM draws WHERE tenant_id = ?)', [fixture.tenantId]);
  await pool.execute('DELETE FROM draws WHERE tenant_id = ?', [fixture.tenantId]);
  await pool.execute('DELETE FROM cash_accounts WHERE tenant_id = ?', [fixture.tenantId]);
  await pool.execute('DELETE FROM operation_requests WHERE tenant_id = ?', [fixture.tenantId]);
  await pool.execute('DELETE FROM tenant_limit_settings WHERE tenant_id = ?', [fixture.tenantId]);
  await pool.execute('DELETE FROM tenant_schedules WHERE tenant_id = ?', [fixture.tenantId]);
  await pool.execute('DELETE FROM tenant_modalities WHERE tenant_id = ?', [fixture.tenantId]);
  await pool.execute('DELETE FROM tenant_lotteries WHERE tenant_id = ?', [fixture.tenantId]);
  await pool.execute('DELETE FROM tenant_memberships WHERE tenant_id = ?', [fixture.tenantId]);
  await pool.execute('DELETE FROM users WHERE id = ?', [fixture.userId]);
  await pool.execute('DELETE FROM tenants WHERE id = ?', [fixture.tenantId]);
}

async function timed(operation, samples) {
  const started = performance.now();
  const result = await operation();
  samples.push(performance.now() - started);
  return result;
}

async function main() {
  requireGuard();
  const credentials = path.resolve(required('SAAS_TEST_CREDENTIALS_FILE'));
  await access(credentials);
  dotenv.config({ path: credentials, override: true, quiet: true });
  const concurrency = Number(process.env.STAGE12_LOAD_CONCURRENCY || DEFAULT_CONCURRENCY);
  assert(Number.isInteger(concurrency) && concurrency >= 10 && concurrency <= 100,
    'STAGE12_LOAD_CONCURRENCY debe ser un entero entre 10 y 100.');
  const pool = mysql.createPool({
    host: required('MYSQL_HOST'),
    port: Number(process.env.MYSQL_PORT || 3306),
    user: required('MYSQL_USER'),
    password: required('MYSQL_PASSWORD'),
    database: TEST_DATABASE,
    connectionLimit: 12,
    queueLimit: 200,
    timezone: '+00:00',
    dateStrings: true,
    supportBigNumbers: true,
    bigNumberStrings: true,
    decimalNumbers: false,
  });
  const salesDb = iniciarBaseDeDatosSales(pool);
  const cashDb = iniciarBaseDeDatosCash(pool);
  const cursorSecret = 'stage12-load-cursor-secret-at-least-32-bytes';
  let primary;
  let foreign;
  try {
    const suffix = String(Date.now());
    primary = await createFixture(pool, `${suffix}-primary`);
    foreign = await createFixture(pool, `${suffix}-foreign`, false);
    await cashService.inicializarCaja(cashDb, primary.tenantId, primary.userId, {
      requestId: randomUUID(), amount: '0.00',
    }, 'stage12-load-cash');

    const intents = Array.from({ length: concurrency }, (_, index) => ({
      requestId: randomUUID(),
      drawPublicId: primary.drawPublicId,
      items: [{ number: String(index).padStart(2, '0'), amount: '1.00' }],
    }));
    const writeTimes = [];
    const readTimes = [];
    const started = performance.now();
    const writes = intents.map((input) => timed(
      () => salesService.crearTicket(
        salesDb, primary.tenantId, primary.userId, input, `stage12-write-${input.requestId}`,
      ), writeTimes,
    ));
    const reads = intents.map((_, index) => timed(
      () => salesService.obtenerLista(salesDb, cursorSecret, primary.tenantId, {
        businessDate: primary.businessDate, limit: 25,
      }), readTimes,
    ).then((result) => {
      assert(result.items.length === 1, `La lectura concurrente ${index} no devolvió el sorteo.`);
    }));
    const created = await Promise.all(writes);
    await Promise.all(reads);
    const elapsedMs = performance.now() - started;

    assert(created.every((result) => result.replay === false), 'Una venta inicial se trató como replay.');
    const replays = await Promise.all(intents.slice(0, 5).map((input) => (
      salesService.crearTicket(
        salesDb, primary.tenantId, primary.userId, input, `stage12-replay-${input.requestId}`,
      )
    )));
    assert(replays.every((result) => result.replay === true), 'Un reintento duplicó una intención.');

    const [[totals]] = await pool.execute(`SELECT
      (SELECT COUNT(*) FROM tickets WHERE tenant_id = ? AND status = 'VALID') AS tickets,
      (SELECT total_sold_amount FROM draws WHERE id = ?) AS drawTotal,
      (SELECT current_balance FROM cash_accounts WHERE tenant_id = ?) AS cashBalance,
      (SELECT COALESCE(SUM(sold_amount), 0) FROM draw_number_positions WHERE draw_id = ?) AS listTotal`,
    [primary.tenantId, primary.drawId, primary.tenantId, primary.drawId]);
    const expectedTotal = `${concurrency}.00`;
    assert(Number(totals.tickets) === concurrency, 'El número final de tickets no coincide.');
    assert(totals.drawTotal === expectedTotal, 'El total del sorteo no coincide con las ventas.');
    assert(totals.cashBalance === expectedTotal, 'La caja no coincide con las ventas.');
    assert(totals.listTotal === expectedTotal, 'La Lista no coincide con las ventas.');

    let isolated = false;
    try {
      await salesService.obtenerTicket(
        salesDb, foreign.tenantId, created[0].ticket.ticketCode,
      );
    } catch (error) {
      isolated = error.code === 'TICKET_NOT_FOUND';
    }
    assert(isolated, 'Un tenant ajeno pudo consultar un ticket por abuso de ID.');

    const writeP95 = percentile(writeTimes, 0.95);
    const readP95 = percentile(readTimes, 0.95);
    assert(writeP95 < 5000, `p95 de venta fuera del presupuesto: ${writeP95.toFixed(1)} ms.`);
    assert(readP95 < 3000, `p95 de Lista fuera del presupuesto: ${readP95.toFixed(1)} ms.`);
    assert(elapsedMs < 15000, `La carga completa excedió 15 s: ${elapsedMs.toFixed(1)} ms.`);
    console.log(JSON.stringify({
      status: 'approved', concurrency, writes: concurrency, reads: concurrency,
      replays: replays.length,
      writeP95Ms: Number(writeP95.toFixed(1)),
      readP95Ms: Number(readP95.toFixed(1)),
      elapsedMs: Number(elapsedMs.toFixed(1)),
      reconciliation: { tickets: concurrency, drawTotal: expectedTotal, cashBalance: expectedTotal, listTotal: expectedTotal },
      isolation: 'approved',
    }));
  } finally {
    await cleanup(pool, primary);
    await cleanup(pool, foreign);
    await pool.end();
  }
}

main().catch((error) => {
  console.error(`Carga Etapa 12 fallida: ${error.message}`);
  process.exitCode = 1;
});
