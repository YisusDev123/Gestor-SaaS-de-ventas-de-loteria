import { createHash } from 'node:crypto';

import { AppError } from '../../shared/error/app-error.js';
import { getCostaRicaBusinessDate } from '../../shared/utils/costa-rica-time.js';
import { createCursorCodec, parseUtcCursorDate, serializeUtcDate } from '../../shared/utils/cursor.js';
import { addMoney, formatMoney, parseMoney } from '../../shared/utils/money.js';
import { formatTicketCode, generateTicketCode, normalizeTicketCode } from '../../shared/utils/ticket-code.js';
import { createReceipt } from './sales-receipt.js';

function canonicalItems(items) {
  return items.map((item) => ({
    number: item.number,
    amount: formatMoney(parseMoney(item.amount, { allowZero: false })),
  })).sort((left, right) => left.number.localeCompare(right.number));
}

function fingerprint(payload) {
  return createHash('sha256').update(JSON.stringify(payload)).digest();
}

function canonicalTicketCode(ticketCode) {
  try {
    return normalizeTicketCode(ticketCode);
  } catch {
    throw new AppError('El código del ticket no es válido.', {
      statusCode: 400, code: 'INVALID_TICKET_CODE',
    });
  }
}

function cursorFor(codec, encoded) {
  if (!encoded) return null;
  try {
    const cursor = codec.decode(encoded);
    if (Object.keys(cursor).length !== 2
      || typeof cursor.createdAt !== 'string'
      || typeof cursor.id !== 'string'
      || !/^[1-9]\d*$/.test(cursor.id)) throw new Error('Invalid cursor');
    return { createdAt: parseUtcCursorDate(cursor.createdAt), id: cursor.id };
  } catch {
    throw new AppError('El cursor no es válido.', { statusCode: 400, code: 'INVALID_CURSOR' });
  }
}

function page(codec, rows, limit) {
  const hasMore = rows.length > limit;
  const items = hasMore ? rows.slice(0, limit) : rows;
  const last = items.at(-1);
  return {
    items,
    limit,
    nextCursor: hasMore && last
      ? codec.encode({
        createdAt: parseUtcCursorDate(last.createdAt).toISOString(), id: String(last.id),
      }) : null,
  };
}

export async function listarSorteosVenta(database, tenantId, query, now = new Date()) {
  const businessDate = query.businessDate ?? getCostaRicaBusinessDate(now);
  const result = await database.listarSorteosVenta(tenantId, businessDate, query.status ?? 'OPEN');
  return {
    ...result,
    draws: result.draws.map((draw) => ({
      ...draw,
      scheduledAt: serializeUtcDate(draw.scheduledAt),
      closesAt: serializeUtcDate(draw.closesAt),
    })),
  };
}

export async function obtenerMatriz(database, tenantId, drawPublicId) {
  const result = await database.obtenerMatriz(tenantId, drawPublicId);
  if (!result) throw new AppError('El sorteo no existe.', { statusCode: 404, code: 'DRAW_NOT_FOUND' });
  return result;
}

export async function actualizarLimite(database, tenantId, userId, params, input, correlationId) {
  return database.actualizarLimiteTransaccional(tenantId, userId, {
    drawPublicId: params.drawPublicId,
    number: Number(params.number),
    remainingAmount: formatMoney(parseMoney(input.remainingAmount)),
    expectedEffectiveLimit: formatMoney(parseMoney(input.expectedEffectiveLimit)),
    correlationId,
  });
}

export async function crearTicket(database, tenantId, userId, input, correlationId) {
  const items = canonicalItems(input.items);
  let totalAmount;
  try {
    totalAmount = addMoney(...items.map((item) => item.amount));
  } catch {
    throw new AppError('El total del ticket supera el monto permitido.', {
      statusCode: 400, code: 'TICKET_TOTAL_OUT_OF_RANGE',
    });
  }
  const canonical = { tenantId, drawPublicId: input.drawPublicId, items };
  const result = await database.crearTicketTransaccional(tenantId, userId, {
    requestId: input.requestId,
    drawPublicId: input.drawPublicId,
    items,
    totalAmount,
    payloadFingerprint: fingerprint(canonical),
    ticketCodeCandidates: Array.from({ length: 3 }, () => generateTicketCode()),
    correlationId,
  });
  return {
    ...result,
    ticket: { ...result.ticket, ticketCode: formatTicketCode(result.ticket.ticketCode) },
  };
}

export async function obtenerLista(database, cursorSecret, tenantId, query) {
  const codec = createCursorCodec(cursorSecret);
  const cursor = cursorFor(codec, query.cursor);
  const rows = await database.obtenerLista(tenantId, query, cursor, query.limit + 1);
  const result = page(codec, rows, query.limit);
  result.items = result.items.map((draw) => ({ ...draw, createdAt: serializeUtcDate(draw.createdAt) }));
  return result;
}

export async function listarTickets(database, cursorSecret, tenantId, query) {
  const codec = createCursorCodec(cursorSecret);
  const cursor = cursorFor(codec, query.cursor);
  const rows = await database.listarTickets(tenantId, query, cursor, query.limit + 1);
  const result = page(codec, rows, query.limit);
  result.items = result.items.map((ticket) => ({
    ...ticket,
    ticketCode: formatTicketCode(ticket.ticketCode),
    createdAt: serializeUtcDate(ticket.createdAt),
    ...(ticket.scheduledAt ? { scheduledAt: serializeUtcDate(ticket.scheduledAt) } : {}),
  }));
  return result;
}

export async function obtenerTicket(database, tenantId, ticketCode) {
  const canonical = canonicalTicketCode(ticketCode);
  const result = await database.obtenerTicket(tenantId, canonical);
  if (!result) throw new AppError('El ticket no existe.', { statusCode: 404, code: 'TICKET_NOT_FOUND' });
  return { ...result, ticketCode: formatTicketCode(result.ticketCode) };
}

export async function obtenerComprobante(database, tenantId, ticketCode) {
  return createReceipt(await obtenerTicket(database, tenantId, ticketCode));
}

export async function cancelarTicket(database, tenantId, userId, ticketCode, input, correlationId) {
  const canonicalCode = canonicalTicketCode(ticketCode);
  const canonical = { tenantId, ticketCode: canonicalCode, reason: input.reason };
  const result = await database.cancelarTicketTransaccional(tenantId, userId, canonicalCode, {
    ...input, payloadFingerprint: fingerprint(canonical), correlationId,
  });
  return { ...result, ticketCode: formatTicketCode(result.ticketCode) };
}

export async function corregirTicket(database, tenantId, userId, ticketCode, input, correlationId) {
  const canonicalCode = canonicalTicketCode(ticketCode);
  const items = canonicalItems(input.items);
  let totalAmount;
  try { totalAmount = addMoney(...items.map((item) => item.amount)); } catch {
    throw new AppError('El total del ticket supera el monto permitido.', {
      statusCode: 400, code: 'TICKET_TOTAL_OUT_OF_RANGE',
    });
  }
  const canonical = {
    tenantId, ticketCode: canonicalCode, drawPublicId: input.drawPublicId, reason: input.reason, items,
  };
  const result = await database.corregirTicketTransaccional(tenantId, userId, canonicalCode, {
    ...input, items, totalAmount, payloadFingerprint: fingerprint(canonical), correlationId,
    ticketCodeCandidates: Array.from({ length: 3 }, () => generateTicketCode()),
  });
  return {
    ...result,
    originalTicketCode: formatTicketCode(result.originalTicketCode),
    replacement: {
      ...result.replacement,
      ticketCode: formatTicketCode(result.replacement.ticketCode),
    },
  };
}
