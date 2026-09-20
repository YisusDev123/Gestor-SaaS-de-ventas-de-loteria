import { access } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';

import dotenv from 'dotenv';
import mysql from 'mysql2/promise';

import * as cashService from '../src/modules/cash/cash-services.js';
import * as salesService from '../src/modules/sales/sales-services.js';
import { renderReceiptPdf } from '../src/modules/sales/sales-receipt-pdf.js';
import { iniciarBaseDeDatosCash } from '../src/shared/database/cash-sql.js';
import { iniciarBaseDeDatosSales } from '../src/shared/database/sales-sql.js';
import { getCostaRicaBusinessDate } from '../src/shared/utils/costa-rica-time.js';
import { createPublicId } from '../src/shared/utils/public-id.js';

const TEST_DATABASE = 'saas_jps_test';
function required(name) { const value = process.env[name]?.trim(); if (!value) throw new Error(`Falta ${name}.`); return value; }
function assert(condition, message) { if (!condition) throw new Error(message); }
function guard() { if (process.env.NODE_ENV !== 'test' || process.env.ALLOW_DB_INTEGRATION !== 'true') throw new Error('Integración no autorizada.'); }

async function fixture(pool, suffix, withDraw = true) {
  const [tenant] = await pool.execute("INSERT INTO tenants (public_id, display_name, status) VALUES (?, ?, 'ACTIVE')", [createPublicId(), `Ventas ${suffix}`]);
  const [user] = await pool.execute("INSERT INTO users (public_id, email_normalized, password_hash, status) VALUES (?, ?, 'x', 'ACTIVE')", [createPublicId(), `sales-${suffix}@example.test`]);
  await pool.execute("INSERT INTO tenant_memberships (tenant_id, user_id, role, status) VALUES (?, ?, 'OWNER', 'ACTIVE')", [tenant.insertId, user.insertId]);
  if (!withDraw) return { tenantId: String(tenant.insertId), userId: String(user.insertId) };
  const [[catalog]] = await pool.execute(`SELECT l.id AS lotteryId, lm.id AS modalityId, ds.id AS scheduleId
    FROM lotteries l JOIN lottery_modalities lm ON lm.lottery_id=l.id
    JOIN draw_schedules ds ON ds.lottery_modality_id=lm.id
    WHERE l.code='TICA' ORDER BY ds.id LIMIT 1`);
  await pool.execute('INSERT INTO tenant_lotteries (tenant_id, lottery_id, is_enabled) VALUES (?, ?, TRUE)', [tenant.insertId, catalog.lotteryId]);
  await pool.execute('INSERT INTO tenant_modalities (tenant_id, lottery_modality_id, is_enabled, multiplier, updated_by_user_id) VALUES (?, ?, TRUE, 80.00, ?)', [tenant.insertId, catalog.modalityId, user.insertId]);
  await pool.execute('INSERT INTO tenant_schedules (tenant_id, draw_schedule_id, is_enabled, close_minutes_before, updated_by_user_id) VALUES (?, ?, TRUE, 10, ?)', [tenant.insertId, catalog.scheduleId, user.insertId]);
  await pool.execute('INSERT INTO tenant_limit_settings (tenant_id, general_number_limit, updated_by_user_id) VALUES (?, 100.00, ?)', [tenant.insertId, user.insertId]);
  const drawPublicId = createPublicId();
  const businessDate = getCostaRicaBusinessDate();
  const [draw] = await pool.execute(`INSERT INTO draws
    (public_id, tenant_id, draw_schedule_id, business_date, scheduled_at_utc, closes_at_utc,
     status, lottery_code_snapshot, lottery_name_snapshot, modality_code_snapshot,
     modality_name_snapshot, local_time_snapshot, multiplier_snapshot, general_limit_snapshot)
    VALUES (?, ?, ?, ?, DATE_ADD(UTC_TIMESTAMP(6), INTERVAL 2 DAY),
      DATE_ADD(UTC_TIMESTAMP(6), INTERVAL 1 DAY), 'OPEN', 'TICA', 'Tica',
      'NORMAL', 'Normal', '13:00:00', 80.00, 100.00)`,
  [drawPublicId, tenant.insertId, catalog.scheduleId, businessDate]);
  const positions = Array.from({ length: 100 }, (_, number) => [draw.insertId, number, '100.00', '100.00']);
  await pool.query('INSERT INTO draw_number_positions (draw_id, number_value, base_limit_amount, effective_limit_amount) VALUES ?', [positions]);
  return { tenantId: String(tenant.insertId), userId: String(user.insertId), drawId: String(draw.insertId), drawPublicId, businessDate };
}

async function cleanup(pool, item) {
  if (!item) return;
  await pool.execute('DELETE FROM audit_events WHERE tenant_id=?', [item.tenantId]);
  await pool.execute('DELETE FROM cash_movements WHERE tenant_id=?', [item.tenantId]);
  await pool.execute('DELETE FROM ticket_replacements WHERE tenant_id=?', [item.tenantId]);
  await pool.execute('DELETE FROM ticket_cancellations WHERE tenant_id=?', [item.tenantId]);
  await pool.execute('DELETE FROM ticket_items WHERE tenant_id=?', [item.tenantId]);
  await pool.execute('DELETE FROM tickets WHERE tenant_id=?', [item.tenantId]);
  if (item.drawId) await pool.execute('DELETE FROM draw_number_positions WHERE draw_id=?', [item.drawId]);
  await pool.execute('DELETE FROM draws WHERE tenant_id=?', [item.tenantId]);
  await pool.execute('DELETE FROM cash_accounts WHERE tenant_id=?', [item.tenantId]);
  await pool.execute('DELETE FROM operation_requests WHERE tenant_id=?', [item.tenantId]);
  await pool.execute('DELETE FROM tenant_limit_settings WHERE tenant_id=?', [item.tenantId]);
  await pool.execute('DELETE FROM tenant_schedules WHERE tenant_id=?', [item.tenantId]);
  await pool.execute('DELETE FROM tenant_modalities WHERE tenant_id=?', [item.tenantId]);
  await pool.execute('DELETE FROM tenant_lotteries WHERE tenant_id=?', [item.tenantId]);
  await pool.execute('DELETE FROM tenant_memberships WHERE tenant_id=?', [item.tenantId]);
  await pool.execute('DELETE FROM users WHERE id=?', [item.userId]);
  await pool.execute('DELETE FROM tenants WHERE id=?', [item.tenantId]);
}

async function main() {
  guard();
  const credentials = path.resolve(required('SAAS_TEST_CREDENTIALS_FILE')); await access(credentials);
  dotenv.config({ path: credentials, override: true, quiet: true });
  const pool = mysql.createPool({ host: required('MYSQL_HOST'), port: Number(process.env.MYSQL_PORT || 3306), user: required('MYSQL_USER'), password: required('MYSQL_PASSWORD'), database: TEST_DATABASE, connectionLimit: 6, timezone: '+00:00', dateStrings: true, supportBigNumbers: true, bigNumberStrings: true, decimalNumbers: false });
  const salesDb = iniciarBaseDeDatosSales(pool); const cashDb = iniciarBaseDeDatosCash(pool);
  let first; let second;
  try {
    const suffix = String(Date.now()); first = await fixture(pool, `${suffix}-1`); second = await fixture(pool, `${suffix}-2`, false);
    await cashService.inicializarCaja(cashDb, first.tenantId, first.userId, { requestId: randomUUID(), amount: '10.00' }, 'sales-cash');
    const requestId = randomUUID(); const input = { requestId, drawPublicId: first.drawPublicId, items: [{ number: '00', amount: '50.00' }, { number: '01', amount: '25.00' }] };
    const created = await salesService.crearTicket(salesDb, first.tenantId, first.userId, input, 'sale');
    assert(created.ticket.totalAmount === '75.00' && created.cashBalance === '85.00', 'La venta no actualizó ticket y caja.');
    const replay = await salesService.crearTicket(salesDb, first.tenantId, first.userId, input, 'replay'); assert(replay.replay, 'El replay duplicó la venta.');
    let mismatch = false; try { await salesService.crearTicket(salesDb, first.tenantId, first.userId, { ...input, items: [{ number: '00', amount: '1.00' }] }, 'mismatch'); } catch (error) { mismatch = error.code === 'IDEMPOTENCY_KEY_REUSED'; } assert(mismatch, 'Se aceptó requestId con payload distinto.');

    const race = await Promise.allSettled(['02', '02'].map((number) => salesService.crearTicket(salesDb, first.tenantId, first.userId, { requestId: randomUUID(), drawPublicId: first.drawPublicId, items: [{ number, amount: '75.00' }] }, 'race')));
    assert(race.filter((result) => result.status === 'fulfilled').length === 1, 'La concurrencia produjo sobreventa.');
    assert(race.some((result) => result.status === 'rejected' && result.reason.code === 'NUMBER_LIMIT_EXCEEDED'), 'No se rechazó la venta excedida.');
    const concurrentTicket = race.find((result) => result.status === 'fulfilled').value;

    await salesService.actualizarLimite(salesDb, first.tenantId, first.userId, { drawPublicId: first.drawPublicId, number: '04' }, { remainingAmount: '20.00', expectedEffectiveLimit: '100.00' }, 'limit');
    let rollback = false; try { await salesService.crearTicket(salesDb, first.tenantId, first.userId, { requestId: randomUUID(), drawPublicId: first.drawPublicId, items: [{ number: '03', amount: '10.00' }, { number: '04', amount: '25.00' }] }, 'rollback'); } catch (error) { rollback = error.code === 'NUMBER_LIMIT_EXCEEDED'; } assert(rollback, 'No se rechazó ticket parcialmente inválido.');
    const matrix = await salesService.obtenerMatriz(salesDb, first.tenantId, first.drawPublicId); assert(matrix.numbers[3].soldAmount === '0.00', 'El rollback dejó un acumulado parcial.');

    await pool.execute('INSERT INTO tenant_daily_lottery_availability (tenant_id, lottery_id, business_date, is_enabled_for_sales, changed_by_user_id) SELECT ?, id, ?, FALSE, ? FROM lotteries WHERE code=\'TICA\'', [first.tenantId, first.businessDate, first.userId]);
    let paused = false; try { await salesService.crearTicket(salesDb, first.tenantId, first.userId, { requestId: randomUUID(), drawPublicId: first.drawPublicId, items: [{ number: '05', amount: '1.00' }] }, 'paused'); } catch (error) { paused = error.code === 'LOTTERY_SALES_PAUSED'; } assert(paused, 'La lotería pausada aceptó ventas.');
    await pool.execute('DELETE FROM tenant_daily_lottery_availability WHERE tenant_id=?', [first.tenantId]);

    const list = await salesService.obtenerLista(salesDb, 'sales-integration-cursor-secret-32-bytes', first.tenantId, { businessDate: first.businessDate, limit: 25 }); assert(list.items[0].numbers.length === 100, 'Lista no contiene matriz 00-99.');
    const history = await salesService.listarTickets(salesDb, 'sales-integration-cursor-secret-32-bytes', first.tenantId, { limit: 25 }); assert(history.items.length === 2, 'Historial no coincide con ventas confirmadas.');
    const detail = await salesService.obtenerTicket(salesDb, first.tenantId, created.ticket.ticketCode); assert(detail.items.length === 2, 'Búsqueda exacta no devolvió items.');
    const historicalSellerName = detail.sellerName;
    await pool.execute('UPDATE tenants SET display_name=? WHERE id=?', ['Nombre posterior', first.tenantId]);
    const receipt = await salesService.obtenerComprobante(salesDb, first.tenantId, created.ticket.ticketCode);
    assert(receipt.sellerName === historicalSellerName, 'Renombrar el puesto alteró el comprobante histórico.');
    const pdf = await renderReceiptPdf(receipt, '80mm');
    assert(pdf.subarray(0, 4).toString() === '%PDF', 'El comprobante PDF no fue generado bajo demanda.');

    const cancelInput = { requestId: randomUUID(), reason: 'Venta digitada por error' };
    const cancellations = await Promise.all([
      salesService.cancelarTicket(salesDb, first.tenantId, first.userId, created.ticket.ticketCode, cancelInput, 'cancel-1'),
      salesService.cancelarTicket(salesDb, first.tenantId, first.userId, created.ticket.ticketCode, cancelInput, 'cancel-2'),
    ]);
    assert(cancellations.filter((result) => result.replay).length === 1, 'La cancelación concurrente no produjo un único replay.');
    const cancelled = await salesService.obtenerTicket(salesDb, first.tenantId, created.ticket.ticketCode);
    assert(cancelled.status === 'CANCELLED', 'La cancelación no conservó el ticket como historial cancelado.');

    let replacementFailure = false;
    try {
      await salesService.corregirTicket(salesDb, first.tenantId, first.userId, concurrentTicket.ticket.ticketCode, {
        requestId: randomUUID(), reason: 'Corrección fuera del límite',
        items: [{ number: '04', amount: '20.01' }],
      }, 'correction-failure');
    } catch (error) { replacementFailure = error.code === 'NUMBER_LIMIT_EXCEEDED'; }
    assert(replacementFailure, 'La corrección inválida no fue rechazada.');
    const originalAfterFailure = await salesService.obtenerTicket(salesDb, first.tenantId, concurrentTicket.ticket.ticketCode);
    assert(originalAfterFailure.status === 'VALID', 'Una corrección fallida invalidó el ticket original.');

    const corrected = await salesService.corregirTicket(salesDb, first.tenantId, first.userId, concurrentTicket.ticket.ticketCode, {
      requestId: randomUUID(), reason: 'Números corregidos',
      items: [{ number: '03', amount: '20.00' }, { number: '04', amount: '20.00' }],
    }, 'correction-success');
    assert(corrected.originalStatus === 'REPLACED' && corrected.replacement.status === 'VALID', 'La corrección atómica no creó el reemplazo esperado.');
    const correctedOriginal = await salesService.obtenerTicket(salesDb, first.tenantId, concurrentTicket.ticket.ticketCode);
    const replacementDetail = await salesService.obtenerTicket(salesDb, first.tenantId, corrected.replacement.ticketCode);
    assert(correctedOriginal.status === 'REPLACED' && replacementDetail.totalAmount === '40.00', 'La relación de reemplazo no coincide con los tickets.');
    let isolated = false; try { await salesService.obtenerMatriz(salesDb, second.tenantId, first.drawPublicId); } catch (error) { isolated = error.code === 'DRAW_NOT_FOUND'; } assert(isolated, 'Otro tenant leyó el sorteo.');
    await pool.execute("INSERT INTO tenant_lotteries (tenant_id, lottery_id, is_enabled) SELECT ?, id, TRUE FROM lotteries WHERE code='TICA'", [second.tenantId]);
    const incomplete = await salesService.listarSorteosVenta(salesDb, second.tenantId, { businessDate: first.businessDate });
    assert(incomplete.draws.length === 0 && incomplete.warnings[0]?.code === 'LOTTERY_RULES_INCOMPLETE', 'No se emitió aviso para una lotería sin reglas completas.');
    const cash = await cashService.obtenerCaja(cashDb, first.tenantId); assert(cash.reconciliation.isBalanced && cash.balance === '50.00', 'Caja y ledger no concilian tras cancelación y corrección.');
    const [[totals]] = await pool.execute(`SELECT d.total_sold_amount AS drawTotal,
      (SELECT COALESCE(SUM(total_amount),0) FROM tickets WHERE tenant_id=? AND status='VALID') AS ticketTotal
      FROM draws d WHERE d.id=?`, [first.tenantId, first.drawId]);
    assert(totals.drawTotal === totals.ticketTotal && totals.drawTotal === '40.00', 'Ticket, sorteo y Lista divergieron después de los reversos.');
    const [[lifecycleRows]] = await pool.execute(`SELECT
      (SELECT COUNT(*) FROM ticket_cancellations WHERE tenant_id=?) AS cancellations,
      (SELECT COUNT(*) FROM ticket_replacements WHERE tenant_id=?) AS replacements`,
    [first.tenantId, first.tenantId]);
    assert(Number(lifecycleRows.cancellations) === 2 && Number(lifecycleRows.replacements) === 1, 'El historial de cancelación y reemplazo no es único.');
    await pool.execute("UPDATE draws SET status='CLOSED' WHERE id=?", [first.drawId]);
    let closed = false; try { await salesService.crearTicket(salesDb, first.tenantId, first.userId, { requestId: randomUUID(), drawPublicId: first.drawPublicId, items: [{ number: '06', amount: '1.00' }] }, 'closed'); } catch (error) { closed = error.code === 'DRAW_CLOSED'; } assert(closed, 'Un sorteo cerrado aceptó venta.');
    console.log('Integración de ventas aprobada: venta, comprobante, cancelación, corrección, concurrencia, caja y aislamiento.');
  } finally { await cleanup(pool, first); await cleanup(pool, second); await pool.end(); }
}
main().catch((error) => { console.error(`Integración de ventas fallida: ${error.message}`); process.exitCode = 1; });
