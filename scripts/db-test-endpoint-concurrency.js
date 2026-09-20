import { randomUUID } from 'node:crypto';
import { access } from 'node:fs/promises';
import path from 'node:path';

import bcrypt from 'bcrypt';
import dotenv from 'dotenv';
import mysql from 'mysql2/promise';
import request from 'supertest';

import { getCostaRicaBusinessDate } from '../src/shared/utils/costa-rica-time.js';
import { createPublicId } from '../src/shared/utils/public-id.js';

const TEST_DATABASE = 'saas_jps_test';
const ORIGIN = 'http://127.0.0.1:3000';
const DEFAULT_BURST = 12;

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

function authorized(api, token, method, url) {
  return api[method](url).set('Authorization', `Bearer ${token}`);
}

function assertIdempotentBurst(responses, label) {
  const created = responses.filter((response) => response.status === 201);
  const replays = responses.filter(
    (response) => response.status === 200 && response.body?.data?.replay === true,
  );
  assert(created.length === 1, `${label}: se esperó una única respuesta HTTP 201.`);
  assert(
    replays.length === responses.length - 1,
    `${label}: las solicitudes duplicadas no regresaron como replay HTTP 200.`,
  );
  const snapshots = new Set(responses.map((response) => JSON.stringify(response.body?.data)));
  assert(snapshots.size === 2, `${label}: las respuestas no conservaron un snapshot estable.`);
  return created[0].body.data;
}

async function createFixture(pool, suffix, password) {
  const passwordHash = await bcrypt.hash(password, 4);
  const [[plan]] = await pool.execute(
    "SELECT id FROM subscription_plans WHERE code = 'MONTHLY_BASE' LIMIT 1",
  );
  assert(plan, 'Falta el plan MONTHLY_BASE requerido por el fixture.');

  const [tenant] = await pool.execute(
    "INSERT INTO tenants (public_id, display_name, status) VALUES (?, ?, 'ACTIVE')",
    [createPublicId(), `Concurrencia endpoints ${suffix}`],
  );
  const email = `endpoint-concurrency-${suffix}@example.test`;
  const [user] = await pool.execute(
    `INSERT INTO users (public_id, email_normalized, password_hash, status)
     VALUES (?, ?, ?, 'ACTIVE')`,
    [createPublicId(), email, passwordHash],
  );
  const [membership] = await pool.execute(
    `INSERT INTO tenant_memberships (tenant_id, user_id, role, status)
     VALUES (?, ?, 'OWNER', 'ACTIVE')`,
    [tenant.insertId, user.insertId],
  );
  await pool.execute(
    `INSERT INTO subscriptions (tenant_id, plan_id, status, access_ends_at)
     VALUES (?, ?, 'ACTIVE', DATE_ADD(UTC_TIMESTAMP(6), INTERVAL 30 DAY))`,
    [tenant.insertId, plan.id],
  );

  const [[catalog]] = await pool.execute(`SELECT
      l.id AS lotteryId, lm.id AS modalityId, ds.id AS scheduleId
    FROM lotteries l
    JOIN lottery_modalities lm ON lm.lottery_id = l.id
    JOIN draw_schedules ds ON ds.lottery_modality_id = lm.id
    WHERE l.code = 'TICA'
    ORDER BY ds.id
    LIMIT 1`);
  assert(catalog, 'Falta el catálogo TICA requerido por el fixture.');
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
      (tenant_id, general_number_limit, updated_by_user_id) VALUES (?, 10.00, ?)`,
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
      'NORMAL', 'Normal', '13:00:00', 80.00, 10.00)`,
  [drawPublicId, tenant.insertId, catalog.scheduleId, businessDate]);
  await pool.query(
    `INSERT INTO draw_number_positions
      (draw_id, number_value, base_limit_amount, effective_limit_amount) VALUES ?`,
    [Array.from({ length: 100 }, (_, number) => [draw.insertId, number, '10.00', '10.00'])],
  );

  return {
    tenantId: String(tenant.insertId),
    userId: String(user.insertId),
    membershipId: String(membership.insertId),
    drawId: String(draw.insertId),
    drawPublicId,
    businessDate,
    email,
  };
}

async function cleanup(pool, fixture) {
  if (!fixture?.tenantId) return;
  await pool.execute('DELETE FROM audit_events WHERE tenant_id = ?', [fixture.tenantId]);
  await pool.execute('DELETE FROM tenant_daily_summaries WHERE tenant_id = ?', [fixture.tenantId]);
  await pool.execute('DELETE FROM cash_movements WHERE tenant_id = ?', [fixture.tenantId]);
  await pool.execute('DELETE FROM ticket_replacements WHERE tenant_id = ?', [fixture.tenantId]);
  await pool.execute('DELETE FROM ticket_cancellations WHERE tenant_id = ?', [fixture.tenantId]);
  await pool.execute('DELETE FROM prize_payments WHERE tenant_id = ?', [fixture.tenantId]);
  await pool.execute('DELETE FROM ticket_prize_evaluations WHERE tenant_id = ?', [fixture.tenantId]);
  await pool.execute('UPDATE draws SET current_result_version_id = NULL WHERE tenant_id = ?', [fixture.tenantId]);
  await pool.execute('DELETE FROM draw_result_versions WHERE tenant_id = ?', [fixture.tenantId]);
  await pool.execute('DELETE FROM ticket_items WHERE tenant_id = ?', [fixture.tenantId]);
  await pool.execute('DELETE FROM tickets WHERE tenant_id = ?', [fixture.tenantId]);
  await pool.execute(
    'DELETE FROM draw_number_positions WHERE draw_id IN (SELECT id FROM draws WHERE tenant_id = ?)',
    [fixture.tenantId],
  );
  await pool.execute('DELETE FROM draws WHERE tenant_id = ?', [fixture.tenantId]);
  await pool.execute('DELETE FROM cash_accounts WHERE tenant_id = ?', [fixture.tenantId]);
  await pool.execute('DELETE FROM operation_requests WHERE tenant_id = ?', [fixture.tenantId]);
  await pool.execute('DELETE FROM user_sessions WHERE user_id = ?', [fixture.userId]);
  await pool.execute('DELETE FROM subscriptions WHERE tenant_id = ?', [fixture.tenantId]);
  await pool.execute('DELETE FROM tenant_limit_settings WHERE tenant_id = ?', [fixture.tenantId]);
  await pool.execute('DELETE FROM tenant_schedules WHERE tenant_id = ?', [fixture.tenantId]);
  await pool.execute('DELETE FROM tenant_modalities WHERE tenant_id = ?', [fixture.tenantId]);
  await pool.execute('DELETE FROM tenant_lotteries WHERE tenant_id = ?', [fixture.tenantId]);
  await pool.execute('DELETE FROM tenant_memberships WHERE tenant_id = ?', [fixture.tenantId]);
  await pool.execute('DELETE FROM users WHERE id = ?', [fixture.userId]);
  await pool.execute('DELETE FROM tenants WHERE id = ?', [fixture.tenantId]);
}

async function main() {
  requireGuard();
  const credentials = path.resolve(required('SAAS_TEST_CREDENTIALS_FILE'));
  await access(credentials);
  dotenv.config({ path: credentials, override: true, quiet: true });
  process.env.NODE_ENV = 'test';
  process.env.MYSQL_DB = TEST_DATABASE;
  process.env.PROCESS_ROLE = 'api';
  process.env.CORS_ALLOWED_ORIGINS = ORIGIN;
  process.env.JWT_SECRET = 'endpoint-concurrency-test-jwt-secret-32-bytes';
  process.env.OBSERVABILITY_TOKEN = 'endpoint-concurrency-observability-32-bytes';

  const burst = Number(process.env.ENDPOINT_CONCURRENCY || DEFAULT_BURST);
  assert(
    Number.isInteger(burst) && burst >= 4 && burst <= 40,
    'ENDPOINT_CONCURRENCY debe ser un entero entre 4 y 40.',
  );

  const fixturePool = mysql.createPool({
    host: required('MYSQL_HOST'),
    port: Number(process.env.MYSQL_PORT || 3306),
    user: required('MYSQL_USER'),
    password: required('MYSQL_PASSWORD'),
    database: TEST_DATABASE,
    connectionLimit: 8,
    timezone: '+00:00',
    dateStrings: true,
    supportBigNumbers: true,
    bigNumberStrings: true,
    decimalNumbers: false,
  });
  const [{ createApp }, { database }] = await Promise.all([
    import('../app.js'),
    import('../src/config/pool.js'),
  ]);
  const api = request(createApp());
  const password = 'clave-endpoint-concurrencia';
  let fixture;

  try {
    fixture = await createFixture(fixturePool, String(Date.now()), password);
    const login = await api.post('/auth/login').set('Origin', ORIGIN).send({
      email: fixture.email,
      password,
    });
    assert(login.status === 200, `Login HTTP falló con estado ${login.status}.`);
    const token = login.body?.data?.accessToken;
    assert(token, 'Login HTTP no devolvió accessToken.');

    const initializeInput = { requestId: randomUUID(), amount: '100.00' };
    const initializeResponses = await Promise.all(Array.from({ length: 4 }, () => (
      authorized(api, token, 'post', '/cash/initialize').send(initializeInput)
    )));
    assertIdempotentBurst(initializeResponses, 'Doble clic de inicialización de caja');

    const repeatedSaleInput = {
      requestId: randomUUID(),
      drawPublicId: fixture.drawPublicId,
      items: [{ number: '00', amount: '2.00' }],
    };
    const repeatedSaleResponses = await Promise.all(Array.from({ length: burst }, () => (
      authorized(api, token, 'post', '/sales/tickets').send(repeatedSaleInput)
    )));
    const repeatedSale = assertIdempotentBurst(
      repeatedSaleResponses,
      'Ráfaga de doble clic al emitir ticket',
    );

    const lastSlotResponses = await Promise.all([
      authorized(api, token, 'post', '/sales/tickets').send({
        requestId: randomUUID(),
        drawPublicId: fixture.drawPublicId,
        items: [{ number: '01', amount: '10.00' }],
      }),
      authorized(api, token, 'post', '/sales/tickets').send({
        requestId: randomUUID(),
        drawPublicId: fixture.drawPublicId,
        items: [{ number: '01', amount: '10.00' }],
      }),
    ]);
    assert(
      lastSlotResponses.filter((response) => response.status === 201).length === 1,
      'La competencia por el último cupo no aceptó exactamente una venta.',
    );
    assert(
      lastSlotResponses.some(
        (response) => response.status === 409
          && response.body?.error?.code === 'NUMBER_LIMIT_EXCEEDED',
      ),
      'La venta que perdió el último cupo no recibió NUMBER_LIMIT_EXCEEDED.',
    );

    const loadInputs = Array.from({ length: burst }, (_, index) => ({
      requestId: randomUUID(),
      drawPublicId: fixture.drawPublicId,
      items: [{ number: String(index + 10).padStart(2, '0'), amount: '1.00' }],
    }));
    const loadResponses = await Promise.all(loadInputs.map((input) => (
      authorized(api, token, 'post', '/sales/tickets').send(input)
    )));
    assert(
      loadResponses.every((response) => response.status === 201),
      'La ráfaga de ventas independientes produjo un rechazo inesperado.',
    );

    const cancelInput = { requestId: randomUUID(), reason: 'Doble clic de cancelación' };
    const cancelResponses = await Promise.all(Array.from({ length: 4 }, () => (
      authorized(
        api,
        token,
        'post',
        `/sales/tickets/${repeatedSale.ticket.ticketCode}/cancel`,
      ).send(cancelInput)
    )));
    assertIdempotentBurst(cancelResponses, 'Doble clic de cancelación');

    const expectedTotal = `${burst + 10}.00`;
    const expectedValidTickets = burst + 1;
    const [[totals]] = await fixturePool.execute(`SELECT
      (SELECT COUNT(*) FROM tickets WHERE tenant_id = ? AND status = 'VALID') AS validTickets,
      (SELECT COUNT(*) FROM tickets WHERE tenant_id = ? AND status = 'CANCELLED') AS cancelledTickets,
      (SELECT total_sold_amount FROM draws WHERE id = ?) AS drawTotal,
      (SELECT current_balance FROM cash_accounts WHERE tenant_id = ?) AS cashBalance,
      (SELECT COALESCE(SUM(sold_amount), 0) FROM draw_number_positions WHERE draw_id = ?) AS listTotal,
      (SELECT COUNT(*) FROM cash_movements WHERE tenant_id = ? AND movement_type = 'CANCELLATION') AS cancellations`,
    [
      fixture.tenantId,
      fixture.tenantId,
      fixture.drawId,
      fixture.tenantId,
      fixture.drawId,
      fixture.tenantId,
    ]);
    assert(Number(totals.validTickets) === expectedValidTickets, 'El total final de tickets válidos no coincide.');
    assert(Number(totals.cancelledTickets) === 1, 'El doble clic creó más de una cancelación lógica.');
    assert(Number(totals.cancellations) === 1, 'El doble clic duplicó el reverso en caja.');
    assert(totals.drawTotal === expectedTotal, 'El total del sorteo no concilia después de la concurrencia.');
    assert(totals.listTotal === expectedTotal, 'La Lista no concilia después de la concurrencia.');
    assert(
      totals.cashBalance === `${burst + 110}.00`,
      'La caja no concilia después de ventas y cancelación concurrentes.',
    );

    console.log(JSON.stringify({
      status: 'approved',
      transport: 'HTTP/Supertest',
      duplicateClickBurst: burst,
      scenarios: {
        cashInitializationReplay: 'approved',
        ticketCreationReplay: 'approved',
        lastAvailableAmountRace: 'approved',
        independentSalesBurst: 'approved',
        ticketCancellationReplay: 'approved',
      },
      reconciliation: {
        validTickets: expectedValidTickets,
        cancelledTickets: 1,
        drawTotal: expectedTotal,
        listTotal: expectedTotal,
        cashBalance: `${burst + 110}.00`,
      },
    }));
  } finally {
    await cleanup(fixturePool, fixture);
    await database.close();
    await fixturePool.end();
  }
}

main().catch((error) => {
  console.error(`Concurrencia HTTP fallida: ${error.message}`);
  process.exitCode = 1;
});
