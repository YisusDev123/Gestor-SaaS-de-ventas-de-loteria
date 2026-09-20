import { access } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';

import dotenv from 'dotenv';
import mysql from 'mysql2/promise';

import * as cashService from '../src/modules/cash/cash-services.js';
import * as resultsService from '../src/modules/results/results-services.js';
import * as reportsService from '../src/modules/reports/reports-services.js';
import { renderDailyReportPdf } from '../src/modules/reports/reports-pdf.js';
import * as salesService from '../src/modules/sales/sales-services.js';
import { iniciarBaseDeDatosCash } from '../src/shared/database/cash-sql.js';
import { iniciarBaseDeDatosResults } from '../src/shared/database/results-sql.js';
import { iniciarBaseDeDatosReports } from '../src/shared/database/reports-sql.js';
import { iniciarBaseDeDatosSales } from '../src/shared/database/sales-sql.js';
import { getCostaRicaBusinessDate } from '../src/shared/utils/costa-rica-time.js';
import { createPublicId } from '../src/shared/utils/public-id.js';

const TEST_DATABASE = 'saas_jps_test';
function required(name) { const value = process.env[name]?.trim(); if (!value) throw new Error(`Falta ${name}.`); return value; }
function assert(condition, message) { if (!condition) throw new Error(message); }
function guard() { if (process.env.NODE_ENV !== 'test' || process.env.ALLOW_DB_INTEGRATION !== 'true') throw new Error('Integración no autorizada.'); }

async function fixture(pool, suffix, withDraw = true) {
  const [tenant] = await pool.execute("INSERT INTO tenants (public_id,display_name,status) VALUES (?,?,'ACTIVE')", [createPublicId(), `Resultados ${suffix}`]);
  const [owner] = await pool.execute("INSERT INTO users (public_id,email_normalized,password_hash,status) VALUES (?,?,'x','ACTIVE')", [createPublicId(), `results-owner-${suffix}@example.test`]);
  const [manager] = await pool.execute("INSERT INTO users (public_id,email_normalized,password_hash,status) VALUES (?,?,'x','ACTIVE')", [createPublicId(), `results-manager-${suffix}@example.test`]);
  await pool.execute("INSERT INTO tenant_memberships (tenant_id,user_id,role,status) VALUES (?,?,'OWNER','ACTIVE'),(?,?,'MANAGER','ACTIVE')", [tenant.insertId, owner.insertId, tenant.insertId, manager.insertId]);
  const base = { tenantId: String(tenant.insertId), ownerId: String(owner.insertId), managerId: String(manager.insertId) };
  if (!withDraw) return base;
  const [[catalog]] = await pool.execute(`SELECT l.id AS lotteryId,lm.id AS modalityId,ds.id AS scheduleId
    FROM lotteries l JOIN lottery_modalities lm ON lm.lottery_id=l.id
    JOIN draw_schedules ds ON ds.lottery_modality_id=lm.id
    WHERE l.code='TICA' ORDER BY ds.id LIMIT 1`);
  await pool.execute('INSERT INTO tenant_lotteries (tenant_id,lottery_id,is_enabled) VALUES (?,?,TRUE)', [tenant.insertId, catalog.lotteryId]);
  await pool.execute('INSERT INTO tenant_modalities (tenant_id,lottery_modality_id,is_enabled,multiplier,updated_by_user_id) VALUES (?,?,TRUE,80.00,?)', [tenant.insertId, catalog.modalityId, owner.insertId]);
  await pool.execute('INSERT INTO tenant_schedules (tenant_id,draw_schedule_id,is_enabled,close_minutes_before,updated_by_user_id) VALUES (?,?,TRUE,10,?)', [tenant.insertId, catalog.scheduleId, owner.insertId]);
  await pool.execute('INSERT INTO tenant_limit_settings (tenant_id,general_number_limit,updated_by_user_id) VALUES (?,1000.00,?)', [tenant.insertId, owner.insertId]);
  const drawPublicId = createPublicId(); const businessDate = getCostaRicaBusinessDate();
  const [draw] = await pool.execute(`INSERT INTO draws
    (public_id,tenant_id,draw_schedule_id,business_date,scheduled_at_utc,closes_at_utc,status,
     lottery_code_snapshot,lottery_name_snapshot,modality_code_snapshot,modality_name_snapshot,
     local_time_snapshot,multiplier_snapshot,general_limit_snapshot)
    VALUES (?,?,?,?,DATE_ADD(UTC_TIMESTAMP(6),INTERVAL 2 DAY),DATE_ADD(UTC_TIMESTAMP(6),INTERVAL 1 DAY),
      'OPEN','TICA','Tica','NORMAL','Normal','13:00:00',80.00,1000.00)`,
  [drawPublicId, tenant.insertId, catalog.scheduleId, businessDate]);
  await pool.query('INSERT INTO draw_number_positions (draw_id,number_value,base_limit_amount,effective_limit_amount) VALUES ?', [Array.from({ length: 100 }, (_, number) => [draw.insertId, number, '1000.00', '1000.00'])]);
  return { ...base, drawId: String(draw.insertId), drawPublicId, businessDate };
}

async function cleanup(pool, item) {
  if (!item) return;
  await pool.execute('DELETE FROM audit_events WHERE tenant_id=?', [item.tenantId]);
  await pool.execute('DELETE FROM tenant_daily_summaries WHERE tenant_id=?', [item.tenantId]);
  await pool.execute('DELETE FROM cash_movements WHERE tenant_id=?', [item.tenantId]);
  await pool.execute('DELETE FROM prize_payments WHERE tenant_id=?', [item.tenantId]);
  await pool.execute('DELETE FROM ticket_prize_evaluations WHERE tenant_id=?', [item.tenantId]);
  await pool.execute('UPDATE draws SET current_result_version_id=NULL WHERE tenant_id=?', [item.tenantId]);
  const [versions] = await pool.execute('SELECT id FROM draw_result_versions WHERE tenant_id=? ORDER BY version_number DESC', [item.tenantId]);
  for (const version of versions) await pool.execute('DELETE FROM draw_result_versions WHERE id=?', [version.id]);
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
  await pool.execute('DELETE FROM users WHERE id IN (?,?)', [item.ownerId, item.managerId]);
  await pool.execute('DELETE FROM tenants WHERE id=?', [item.tenantId]);
}

async function main() {
  guard();
  const credentials = path.resolve(required('SAAS_TEST_CREDENTIALS_FILE')); await access(credentials);
  dotenv.config({ path: credentials, override: true, quiet: true });
  const pool = mysql.createPool({ host: required('MYSQL_HOST'), port: Number(process.env.MYSQL_PORT || 3306), user: required('MYSQL_USER'), password: required('MYSQL_PASSWORD'), database: TEST_DATABASE, connectionLimit: 8, timezone: '+00:00', dateStrings: true, supportBigNumbers: true, bigNumberStrings: true, decimalNumbers: false });
  const cashDb = iniciarBaseDeDatosCash(pool); const salesDb = iniciarBaseDeDatosSales(pool);
  const resultsDb = iniciarBaseDeDatosResults(pool); const reportsDb = iniciarBaseDeDatosReports(pool);
  let first; let second;
  try {
    const suffix = String(Date.now()); first = await fixture(pool, `${suffix}-1`); second = await fixture(pool, `${suffix}-2`, false);
    await cashService.inicializarCaja(cashDb, first.tenantId, first.ownerId, { requestId: randomUUID(), amount: '1000.00' }, 'cash');
    const ticket07 = await salesService.crearTicket(salesDb, first.tenantId, first.ownerId, { requestId: randomUUID(), drawPublicId: first.drawPublicId, items: [{ number: '07', amount: '10.00' }] }, 'sale-07');
    const ticket08 = await salesService.crearTicket(salesDb, first.tenantId, first.ownerId, { requestId: randomUUID(), drawPublicId: first.drawPublicId, items: [{ number: '08', amount: '5.00' }] }, 'sale-08');
    await pool.execute("UPDATE draws SET status='CLOSED',closed_at=UTC_TIMESTAMP(6) WHERE id=?", [first.drawId]);

    const publishInput = { requestId: randomUUID(), winningNumber: '07', confirmWinningNumber: '07', confirmed: true, sourceNote: 'Acta oficial inicial' };
    const published = await resultsService.publicarResultado(resultsDb, first.tenantId, first.ownerId, first.drawPublicId, publishInput, 'publish');
    assert(published.winningTicketCount === 1 && published.totalPrizeAmount === '800.00', 'La publicación no evaluó el multiplicador histórico.');
    const publishReplay = await resultsService.publicarResultado(resultsDb, first.tenantId, first.ownerId, first.drawPublicId, publishInput, 'publish-replay');
    assert(publishReplay.replay && publishReplay.resultVersionId === published.resultVersionId, 'El replay del resultado creó otra versión.');
    const cashAfterPublish = await cashService.obtenerCaja(cashDb, first.tenantId);
    assert(cashAfterPublish.balance === '1015.00', 'Publicar resultado modificó la caja.');
    const prize07 = await resultsService.obtenerPremio(resultsDb, first.tenantId, ticket07.ticket.ticketCode);
    const prize08Before = await resultsService.obtenerPremio(resultsDb, first.tenantId, ticket08.ticket.ticketCode);
    assert(prize07.prizeStatus === 'PENDING_PAYMENT' && prize08Before.prizeStatus === 'NOT_WINNER', 'La clasificación inicial es incorrecta.');

    const correctionInput = { requestId: randomUUID(), winningNumber: '08', confirmWinningNumber: '08', confirmed: true, reason: 'Corrección del acta', sourceNote: 'Acta oficial corregida' };
    const corrected = await resultsService.corregirResultado(resultsDb, first.tenantId, first.ownerId, first.drawPublicId, correctionInput, 'correct');
    assert(corrected.versionNumber === 2 && corrected.totalPrizeAmount === '400.00', 'La corrección no creó la versión esperada.');
    const correctionReplay = await resultsService.corregirResultado(resultsDb, first.tenantId, first.ownerId, first.drawPublicId, correctionInput, 'correct-replay');
    assert(correctionReplay.replay && correctionReplay.resultVersionId === corrected.resultVersionId, 'El replay de corrección creó otra versión.');
    const prize07After = await resultsService.obtenerPremio(resultsDb, first.tenantId, ticket07.ticket.ticketCode);
    const prize08 = await resultsService.obtenerPremio(resultsDb, first.tenantId, ticket08.ticket.ticketCode);
    assert(prize07After.prizeStatus === 'NOT_WINNER' && prize08.prizeStatus === 'PENDING_PAYMENT', 'La reevaluación no cambió ganadores correctamente.');
    const [[beforePayment]] = await pool.execute("SELECT COUNT(*) AS payments,(SELECT COUNT(*) FROM cash_movements WHERE tenant_id=? AND movement_type='PRIZE_PAYMENT') AS movements FROM prize_payments WHERE tenant_id=?", [first.tenantId, first.tenantId]);
    assert(Number(beforePayment.payments) === 0 && Number(beforePayment.movements) === 0, 'Evaluar resultados creó movimientos financieros.');

    const paymentAttempts = [
      { userId: first.ownerId, input: { requestId: randomUUID(), expectedPrizeAmount: '400.00', confirmed: true }, correlationId: 'pay-owner' },
      { userId: first.managerId, input: { requestId: randomUUID(), expectedPrizeAmount: '400.00', confirmed: true }, correlationId: 'pay-manager' },
    ];
    const paymentRace = await Promise.allSettled(paymentAttempts.map((attempt) => resultsService.pagarPremio(
      resultsDb, first.tenantId, attempt.userId, ticket08.ticket.ticketCode,
      attempt.input, attempt.correlationId,
    )));
    assert(paymentRace.filter((result) => result.status === 'fulfilled').length === 1, 'Dos pagos concurrentes fueron aceptados.');
    assert(paymentRace.some((result) => result.status === 'rejected' && result.reason.code === 'PRIZE_ALREADY_PAID'), 'El pago duplicado no fue rechazado de forma segura.');
    const successfulPaymentIndex = paymentRace.findIndex((result) => result.status === 'fulfilled');
    const successfulAttempt = paymentAttempts[successfulPaymentIndex];
    const paymentReplay = await resultsService.pagarPremio(resultsDb, first.tenantId, successfulAttempt.userId, ticket08.ticket.ticketCode, successfulAttempt.input, 'pay-replay');
    assert(paymentReplay.replay, 'El replay del pago duplicó el débito.');
    const paidPrize = await resultsService.obtenerPremio(resultsDb, first.tenantId, ticket08.ticket.ticketCode);
    assert(paidPrize.prizeStatus === 'PAID', 'El premio no quedó marcado como pagado.');
    const cashAfterPayment = await cashService.obtenerCaja(cashDb, first.tenantId);
    assert(cashAfterPayment.balance === '615.00' && cashAfterPayment.reconciliation.isBalanced, 'El pago no debitó o concilió la caja exactamente una vez.');

    let correctionBlocked = false;
    try { await resultsService.corregirResultado(resultsDb, first.tenantId, first.ownerId, first.drawPublicId, { requestId: randomUUID(), winningNumber: '09', confirmWinningNumber: '09', confirmed: true, reason: 'Intento posterior', sourceNote: 'Otra fuente' }, 'late-correction'); } catch (error) { correctionBlocked = error.code === 'RESULT_HAS_PAID_PRIZES'; }
    assert(correctionBlocked, 'Se corrigió el resultado después de pagar un premio.');
    const resultHistory = await resultsService.obtenerResultado(resultsDb, first.tenantId, first.drawPublicId);
    assert(resultHistory.versions.length === 2 && resultHistory.current.winningNumber === '08'
      && resultHistory.versions[0].sourceNote === 'Acta oficial corregida'
      && resultHistory.versions[0].createdByUserPublicId,
    'No se conservó el historial, la fuente o el actor del resultado.');

    const cursorSecret = 'reports-integration-cursor-secret-32-bytes';
    const dashboard = await reportsService.obtenerDashboard(reportsDb, first.tenantId, { businessDate: first.businessDate });
    assert(dashboard.sales.grossAmount === '15.00' && dashboard.prizes.generatedAmount === '400.00'
      && dashboard.prizes.paidAmount === '400.00' && dashboard.cash.currentBalance === '615.00',
    'El dashboard no coincide con ventas, premios y caja.');
    const reportedDraws = await reportsService.listarSorteosRealizados(reportsDb, cursorSecret, first.tenantId, { businessDate: first.businessDate, limit: 25 });
    assert(reportedDraws.items.length === 1 && reportedDraws.items[0].winningNumber === '08', 'El resumen vertical no muestra el resultado vigente.');
    const winners = await reportsService.listarGanadores(reportsDb, cursorSecret, first.tenantId, first.drawPublicId, { limit: 25 });
    assert(winners.items.length === 1 && winners.items[0].prizeStatus === 'PAID'
      && winners.items[0].ticketCode === ticket08.ticket.ticketCode,
    'El detalle de ganadores no coincide con el pago vigente.');
    const daily = await reportsService.obtenerReporteDiario(reportsDb, first.tenantId, { dateFrom: first.businessDate, dateTo: first.businessDate });
    assert(daily.days[0].generatedPrizesAmount === '400.00'
      && daily.days[0].realizedResultAmount === '-385.00'
      && daily.totals.realizedResultAmount === '-385.00'
      && daily.comparisons.weeks.length === 1 && daily.comparisons.months.length === 1,
    'El reporte diario no conserva totales o comparaciones trazables.');
    const csv = await reportsService.exportarReporteCsv(reportsDb, first.tenantId, { dateFrom: first.businessDate, dateTo: first.businessDate });
    const pdfReport = await reportsService.prepararReportePdf(reportsDb, first.tenantId, { dateFrom: first.businessDate, dateTo: first.businessDate });
    const pdf = await renderDailyReportPdf(pdfReport);
    assert(csv.startsWith('\uFEFF') && csv.includes('TOTAL') && pdf.subarray(0, 4).toString() === '%PDF', 'Las exportaciones CSV/PDF no se generaron correctamente.');
    const reconciliation = await reportsService.obtenerConciliacion(reportsDb, first.tenantId, { businessDate: first.businessDate });
    assert(reconciliation.isBalanced, 'La conciliación reportó diferencias para datos consistentes.');
    await cashDb.cerrarResumenDiario(first.businessDate);
    const [[summary]] = await pool.execute('SELECT generated_prizes_amount AS generatedPrizesAmount,paid_prizes_amount AS paidPrizesAmount FROM tenant_daily_summaries WHERE tenant_id=? AND business_date=?', [first.tenantId, first.businessDate]);
    assert(summary.generatedPrizesAmount === '400.00' && summary.paidPrizesAmount === '400.00', 'El corte diario omitió premios generados o pagados.');
    const [drawPlan] = await pool.execute('EXPLAIN SELECT id FROM draws WHERE tenant_id=? AND business_date=? AND current_result_version_id IS NOT NULL', [first.tenantId, first.businessDate]);
    const [winnerPlan] = await pool.execute('EXPLAIN SELECT id FROM ticket_prize_evaluations WHERE tenant_id=? AND draw_id=? AND result_version_id=? AND is_winner=TRUE', [first.tenantId, first.drawId, corrected.resultVersionId]);
    assert(String(drawPlan[0].possible_keys).includes('ix_draws_tenant_date_status')
      && String(winnerPlan[0].possible_keys).includes('ix_ticket_prize_evaluations_winners'),
    'EXPLAIN no reconoce los índices operativos esperados.');
    let isolated = false;
    try { await resultsService.obtenerPremio(resultsDb, second.tenantId, ticket08.ticket.ticketCode); } catch (error) { isolated = error.code === 'TICKET_NOT_FOUND'; }
    assert(isolated, 'Otro tenant pudo consultar el premio.');
    console.log('Integración de resultados aprobada: versiones, reevaluación, pago único, caja y aislamiento.');
  } finally { await cleanup(pool, first); await cleanup(pool, second); await pool.end(); }
}

main().catch((error) => { console.error(`Integración de resultados fallida: ${error.message}`); process.exitCode = 1; });
