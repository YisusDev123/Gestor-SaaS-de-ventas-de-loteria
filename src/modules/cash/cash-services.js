import { createHash } from 'node:crypto';

import { AppError } from '../../shared/error/app-error.js';
import { getCostaRicaBusinessDate } from '../../shared/utils/costa-rica-time.js';
import { createCursorCodec, parseUtcCursorDate } from '../../shared/utils/cursor.js';
import { formatMoney, parseMoney } from '../../shared/utils/money.js';

function fingerprint(payload) {
  return createHash('sha256').update(JSON.stringify(payload)).digest();
}

function movementDirection(type, direction) {
  if (type === 'ENTRY') return 'CREDIT';
  if (type === 'WITHDRAWAL' || type === 'EXPENSE') return 'DEBIT';
  return direction;
}

function signedAmount(amount, direction) {
  const units = parseMoney(amount, { allowZero: false });
  return formatMoney(direction === 'DEBIT' ? -units : units);
}

export async function obtenerCaja(baseDeDatos, tenantId) {
  const state = await baseDeDatos.obtenerEstadoCaja(tenantId);
  return {
    initialized: Boolean(state?.initializedAt),
    balance: state?.currentBalance ?? '0.00',
    initializedAt: state?.initializedAt ?? null,
    reconciliation: {
      ledgerBalance: state?.ledgerBalance ?? '0.00',
      isBalanced: !state || state.currentBalance === state.ledgerBalance,
    },
  };
}

export async function inicializarCaja(
  baseDeDatos, tenantId, userId, input, correlationId, now = new Date(),
) {
  const amount = formatMoney(parseMoney(input.amount));
  const businessDate = getCostaRicaBusinessDate(now);
  return baseDeDatos.inicializarCajaTransaccional(tenantId, userId, {
    requestId: input.requestId,
    amount,
    businessDate,
    payloadFingerprint: fingerprint({ tenantId, amount, businessDate }),
    correlationId,
  });
}

export async function registrarMovimiento(
  baseDeDatos, tenantId, userId, input, correlationId, now = new Date(),
) {
  const amount = formatMoney(parseMoney(input.amount, { allowZero: false }));
  const direction = movementDirection(input.movementType, input.direction);
  if (!direction) {
    throw new AppError('La dirección del ajuste es obligatoria.', {
      statusCode: 400,
      code: 'CASH_DIRECTION_REQUIRED',
    });
  }
  const businessDate = getCostaRicaBusinessDate(now);
  const canonical = {
    tenantId, movementType: input.movementType, direction, amount,
    reason: input.reason, businessDate,
  };
  return baseDeDatos.registrarMovimientoTransaccional(tenantId, userId, {
    ...canonical,
    requestId: input.requestId,
    signedAmount: signedAmount(amount, direction),
    payloadFingerprint: fingerprint(canonical),
    correlationId,
  });
}

export async function listarMovimientos(
  baseDeDatos, cursorSecret, tenantId, query,
) {
  const codec = createCursorCodec(cursorSecret);
  let cursor = null;
  if (query.cursor) {
    try {
      cursor = codec.decode(query.cursor);
      if (Object.keys(cursor).length !== 2
        || typeof cursor.createdAt !== 'string'
        || typeof cursor.id !== 'string'
        || !/^[1-9]\d*$/.test(cursor.id)) {
        throw new Error('Invalid cursor payload');
      }
      cursor = { createdAt: parseUtcCursorDate(cursor.createdAt), id: cursor.id };
    } catch {
      throw new AppError('El cursor no es válido.', {
        statusCode: 400,
        code: 'INVALID_CURSOR',
      });
    }
  }
  const rows = await baseDeDatos.listarMovimientos(
    tenantId, query.businessDate ?? null, cursor, query.limit + 1,
  );
  const hasMore = rows.length > query.limit;
  const items = hasMore ? rows.slice(0, query.limit) : rows;
  const last = items.at(-1);
  return {
    items,
    limit: query.limit,
    nextCursor: hasMore && last
      ? codec.encode({
        createdAt: parseUtcCursorDate(last.createdAt).toISOString(), id: String(last.id),
      })
      : null,
  };
}
