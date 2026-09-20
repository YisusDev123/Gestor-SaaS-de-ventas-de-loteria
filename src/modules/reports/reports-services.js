import { AppError } from '../../shared/error/app-error.js';
import { getCostaRicaBusinessDate } from '../../shared/utils/costa-rica-time.js';
import { createCursorCodec, parseUtcCursorDate, serializeUtcDate } from '../../shared/utils/cursor.js';
import { addMoney, subtractMoney } from '../../shared/utils/money.js';
import { formatTicketCode } from '../../shared/utils/ticket-code.js';

function dateRange(query, maximumDays, now = new Date()) {
  const today = getCostaRicaBusinessDate(now);
  const dateFrom = query.dateFrom || query.dateTo || today;
  const dateTo = query.dateTo || dateFrom;
  const from = Date.parse(`${dateFrom}T00:00:00Z`);
  const to = Date.parse(`${dateTo}T00:00:00Z`);
  const days = Math.floor((to - from) / 86_400_000) + 1;
  if (!Number.isInteger(days) || days < 1) {
    throw new AppError('El rango de fechas no es válido.', { statusCode: 400, code: 'INVALID_DATE_RANGE' });
  }
  if (days > maximumDays) {
    throw new AppError(`El rango máximo permitido es de ${maximumDays} días.`, {
      statusCode: 400, code: 'REPORT_RANGE_TOO_LARGE',
    });
  }
  return { dateFrom, dateTo, days };
}

function decodeCursor(secret, encoded) {
  if (!encoded) return null;
  try {
    const decoded = createCursorCodec(secret).decode(encoded);
    if (Object.keys(decoded).length !== 2 || typeof decoded.createdAt !== 'string'
      || typeof decoded.id !== 'string' || !/^[1-9]\d*$/.test(decoded.id)) throw new Error();
    return { createdAt: parseUtcCursorDate(decoded.createdAt), id: decoded.id };
  } catch {
    throw new AppError('El cursor no es válido.', { statusCode: 400, code: 'INVALID_CURSOR' });
  }
}

function paginated(secret, rows, limit) {
  const hasMore = rows.length > limit;
  const items = hasMore ? rows.slice(0, limit) : rows;
  const last = items.at(-1);
  return {
    items,
    limit,
    nextCursor: hasMore && last ? createCursorCodec(secret).encode({
      createdAt: parseUtcCursorDate(last.createdAt).toISOString(), id: String(last.id),
    }) : null,
  };
}

export async function obtenerDashboard(database, tenantId, query, now = new Date()) {
  const businessDate = query.businessDate || getCostaRicaBusinessDate(now);
  const data = await database.obtenerDashboard(tenantId, businessDate);
  const netSalesAmount = subtractMoney(data.grossSalesAmount, data.cancelledSalesAmount);
  const adjustmentsNetAmount = subtractMoney(
    data.adjustmentCreditsAmount, data.adjustmentDebitsAmount,
  );
  const realizedResult = addMoney(netSalesAmount, `-${data.generatedPrizesAmount}`,
    `-${data.expensesAmount}`, adjustmentsNetAmount);
  const provisionalResult = addMoney(realizedResult, `-${data.openExposureAmount}`);
  return {
    businessDate,
    sales: {
      grossAmount: data.grossSalesAmount,
      cancelledAmount: data.cancelledSalesAmount,
      netAmount: netSalesAmount,
      ticketCount: Number(data.ticketCount),
    },
    cash: {
      openingBalance: data.openingBalance,
      currentBalance: data.currentBalance,
      ledgerBalance: data.ledgerBalance,
      isBalanced: data.currentBalance === data.ledgerBalance,
    },
    exposure: { openAmount: data.openExposureAmount },
    prizes: {
      generatedAmount: data.generatedPrizesAmount,
      paidAmount: data.paidPrizesAmount,
      pendingAmount: data.pendingPrizesAmount,
      pendingCount: Number(data.pendingPrizeCount),
    },
    refunds: {
      pendingAmount: data.pendingRefundAmount,
      pendingCount: Number(data.pendingRefundCount),
    },
    operation: {
      expensesAmount: data.expensesAmount,
      cashEntriesAmount: data.cashEntriesAmount,
      cashWithdrawalsAmount: data.cashWithdrawalsAmount,
      adjustmentCreditsAmount: data.adjustmentCreditsAmount,
      adjustmentDebitsAmount: data.adjustmentDebitsAmount,
      adjustmentsNetAmount,
    },
    result: { provisionalAmount: provisionalResult, realizedAmount: realizedResult },
    upcomingDraws: data.upcomingDraws.map((draw) => ({
      ...draw,
      scheduledAt: serializeUtcDate(draw.scheduledAt),
      closesAt: serializeUtcDate(draw.closesAt),
    })),
    alerts: [
      ...(data.currentBalance === data.ledgerBalance ? [] : [{ code: 'CASH_RECONCILIATION_DIFFERENCE' }]),
      ...(Number(data.pendingPrizeCount) ? [{ code: 'PENDING_PRIZES' }] : []),
    ],
  };
}

export async function listarSorteosRealizados(database, cursorSecret, tenantId, query, now = new Date()) {
  const businessDate = query.businessDate || getCostaRicaBusinessDate(now);
  const cursor = decodeCursor(cursorSecret, query.cursor);
  const rows = await database.listarSorteosRealizados(tenantId, businessDate, cursor, query.limit + 1);
  const result = paginated(cursorSecret, rows, query.limit);
  result.items = result.items.map((draw) => ({ ...draw, createdAt: serializeUtcDate(draw.createdAt) }));
  return { businessDate, ...result };
}

export async function listarGanadores(database, cursorSecret, tenantId, drawPublicId, query) {
  const cursor = decodeCursor(cursorSecret, query.cursor);
  const result = await database.listarGanadores(tenantId, drawPublicId, cursor, query.limit + 1);
  if (!result) throw new AppError('El sorteo no existe o no posee resultado.', { statusCode: 404, code: 'RESULT_NOT_FOUND' });
  result.rows = result.rows.map((row) => ({ ...row, ticketCode: formatTicketCode(row.ticketCode) }));
  return { draw: result.draw, ...paginated(cursorSecret, result.rows, query.limit) };
}

export async function obtenerReporteDiario(database, tenantId, query, now = new Date()) {
  const range = dateRange(query, 366, now);
  const rows = await database.obtenerReporteDiario(tenantId, range.dateFrom, range.dateTo);
  const days = dailyRows(rows);
  return {
    ...range,
    days,
    totals: summarizeRows(days),
    comparisons: {
      weeks: groupedSummaries(days, isoWeekKey),
      months: groupedSummaries(days, (date) => date.slice(0, 7)),
    },
  };
}

function safeCsvCell(value) {
  let text = String(value ?? '');
  if (/^[=+\-@]/.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}

function dailyRows(rows) {
  return rows.map((day) => {
    const realizedResultAmount = addMoney(
      day.netSalesAmount, `-${day.generatedPrizesAmount}`, `-${day.expensesAmount}`,
      day.adjustmentsNetAmount,
    );
    return {
      ...day,
      realizedResultAmount,
      provisionalResultAmount: addMoney(realizedResultAmount, `-${day.openExposureAmount}`),
    };
  });
}

const SUM_FIELDS = [
  'grossSalesAmount', 'cancelledSalesAmount', 'netSalesAmount', 'generatedPrizesAmount',
  'paidPrizesAmount', 'expensesAmount', 'adjustmentsNetAmount', 'openExposureAmount',
  'realizedResultAmount', 'provisionalResultAmount',
];

function summarizeRows(rows) {
  const summary = Object.fromEntries(SUM_FIELDS.map((field) => [field, '0.00']));
  for (const row of rows) {
    for (const field of SUM_FIELDS) summary[field] = addMoney(summary[field], row[field]);
  }
  return {
    ...summary,
    openingBalance: rows[0]?.openingBalance || '0.00',
    closingBalance: rows.at(-1)?.closingBalance || '0.00',
  };
}

function isoWeekKey(businessDate) {
  const date = new Date(`${businessDate}T00:00:00Z`);
  const weekday = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - weekday);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const week = Math.ceil((((date - yearStart) / 86_400_000) + 1) / 7);
  return `${date.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

function groupedSummaries(rows, keyFor) {
  const groups = new Map();
  for (const row of rows) {
    const key = keyFor(row.businessDate);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }
  return [...groups].map(([period, periodRows]) => ({ period, ...summarizeRows(periodRows) }));
}

export async function exportarReporteCsv(database, tenantId, query, now = new Date()) {
  const range = dateRange(query, 31, now);
  const days = dailyRows(await database.obtenerReporteDiario(
    tenantId, range.dateFrom, range.dateTo,
  ));
  const headers = ['Fecha', 'Ventas brutas', 'Cancelaciones', 'Ventas netas', 'Premios generados',
    'Premios pagados', 'Gastos', 'Ajustes netos', 'Saldo inicial', 'Saldo final'];
  const rows = days.map((day) => [day.businessDate, day.grossSalesAmount,
    day.cancelledSalesAmount, day.netSalesAmount, day.generatedPrizesAmount,
    day.paidPrizesAmount, day.expensesAmount, day.adjustmentsNetAmount,
    day.openingBalance, day.closingBalance]);
  const totals = summarizeRows(days);
  rows.push(['TOTAL', totals.grossSalesAmount, totals.cancelledSalesAmount,
    totals.netSalesAmount, totals.generatedPrizesAmount, totals.paidPrizesAmount,
    totals.expensesAmount, totals.adjustmentsNetAmount,
    totals.openingBalance, totals.closingBalance]);
  return `\uFEFF${[headers, ...rows].map((row) => row.map(safeCsvCell).join(',')).join('\r\n')}\r\n`;
}

export async function prepararReportePdf(database, tenantId, query, now = new Date()) {
  const range = dateRange(query, 31, now);
  const rows = await database.obtenerReporteDiario(tenantId, range.dateFrom, range.dateTo);
  const days = dailyRows(rows);
  return { ...range, days, totals: summarizeRows(days) };
}

export async function obtenerConciliacion(database, tenantId, query, now = new Date()) {
  const businessDate = query.businessDate || getCostaRicaBusinessDate(now);
  const result = await database.obtenerConciliacion(tenantId, businessDate);
  return {
    businessDate,
    ...result,
    isBalanced: result.cash.difference === '0.00'
      && result.tickets.differenceCount === 0
      && result.positions.differenceCount === 0
      && result.prizes.differenceCount === 0
      && result.payments.differenceCount === 0,
  };
}
