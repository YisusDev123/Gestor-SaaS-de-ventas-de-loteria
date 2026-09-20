import { createHash } from 'node:crypto';

import { AppError } from '../../shared/error/app-error.js';
import { getCostaRicaBusinessDate } from '../../shared/utils/costa-rica-time.js';
import { formatMoney, parseMoney } from '../../shared/utils/money.js';
import { formatTicketCode, normalizeTicketCode } from '../../shared/utils/ticket-code.js';

function fingerprint(payload) {
  return createHash('sha256').update(JSON.stringify(payload)).digest();
}

function confirmedNumber(input) {
  if (input.winningNumber !== input.confirmWinningNumber) {
    throw new AppError('Los números de resultado no coinciden.', {
      statusCode: 400, code: 'RESULT_CONFIRMATION_MISMATCH',
    });
  }
  return Number(input.winningNumber);
}

function canonicalTicketCode(ticketCode) {
  try { return normalizeTicketCode(ticketCode); } catch {
    throw new AppError('El código del ticket no es válido.', {
      statusCode: 400, code: 'INVALID_TICKET_CODE',
    });
  }
}

export async function obtenerResultado(database, tenantId, drawPublicId) {
  const result = await database.obtenerResultado(tenantId, drawPublicId);
  if (!result) throw new AppError('El sorteo no existe.', { statusCode: 404, code: 'DRAW_NOT_FOUND' });
  return result;
}

export async function publicarResultado(database, tenantId, userId, drawPublicId, input, correlationId) {
  const winningNumber = confirmedNumber(input);
  const sourceNote = input.sourceNote || 'Carga manual desde panel';
  const canonical = { tenantId, drawPublicId, winningNumber, sourceNote };
  return database.publicarResultadoTransaccional(tenantId, userId, drawPublicId, {
    ...input, sourceNote, winningNumber, payloadFingerprint: fingerprint(canonical), correlationId,
  });
}

export async function corregirResultado(database, tenantId, userId, drawPublicId, input, correlationId) {
  const winningNumber = confirmedNumber(input);
  const canonical = {
    tenantId, drawPublicId, winningNumber,
  };
  return database.corregirResultadoTransaccional(tenantId, userId, drawPublicId, {
    ...input, reason: input.reason || 'Corrección manual desde panel', sourceNote: input.sourceNote || 'Corrección manual desde panel', winningNumber, payloadFingerprint: fingerprint(canonical), correlationId,
  });
}

export async function obtenerPremio(database, tenantId, ticketCode) {
  const result = await database.obtenerPremio(tenantId, canonicalTicketCode(ticketCode));
  if (!result) throw new AppError('El ticket no existe.', { statusCode: 404, code: 'TICKET_NOT_FOUND' });
  return { ...result, ticketCode: formatTicketCode(result.ticketCode) };
}

export async function pagarPremio(
  database, tenantId, userId, ticketCode, input, correlationId, now = new Date(),
) {
  const canonicalCode = canonicalTicketCode(ticketCode);
  const expectedPrizeAmount = formatMoney(parseMoney(input.expectedPrizeAmount, { allowZero: false }));
  const canonical = { tenantId, ticketCode: canonicalCode, expectedPrizeAmount };
  const result = await database.pagarPremioTransaccional(tenantId, userId, canonicalCode, {
    ...input,
    expectedPrizeAmount,
    businessDate: getCostaRicaBusinessDate(now),
    payloadFingerprint: fingerprint(canonical),
    correlationId,
  });
  return { ...result, ticketCode: formatTicketCode(result.ticketCode) };
}
