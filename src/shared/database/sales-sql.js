import { AppError } from '../error/app-error.js';
import { addMoney, multiplyMoneyByMultiplier, parseMoney } from '../utils/money.js';

const CREATE_TICKET = 'CREATE_TICKET';
const CANCEL_TICKET = 'CANCEL_TICKET';
const CORRECT_TICKET = 'CORRECT_TICKET';

function appError(message, code, statusCode = 409) {
  return new AppError(message, { statusCode, code });
}

async function rollbackOrUnknown(connection, error, commitStarted) {
  if (commitStarted) {
    connection.destroy?.();
    throw appError('No fue posible confirmar el resultado de la venta.', 'COMMIT_OUTCOME_UNKNOWN', 503);
  }
  try { await connection.rollback(); } catch { connection.destroy?.(); }
  throw error;
}

async function transaction(pool, operation) {
  const connection = await pool.getConnection();
  let commitStarted = false;
  try {
    await connection.beginTransaction();
    const result = await operation(connection);
    commitStarted = true;
    await connection.commit();
    return result;
  } catch (error) {
    return rollbackOrUnknown(connection, error, commitStarted);
  } finally {
    connection.release?.();
  }
}

async function lockActor(connection, tenantId, userId, roles) {
  const placeholders = roles.map(() => '?').join(', ');
  const [rows] = await connection.execute(
    `SELECT tm.id, tm.role, t.display_name AS sellerName,
            COALESCE(tbs.receipt_fields, JSON_OBJECT()) AS receiptFields
     FROM tenant_memberships tm
     JOIN tenants t ON t.id = tm.tenant_id
     JOIN users u ON u.id = tm.user_id
     LEFT JOIN tenant_business_settings tbs ON tbs.tenant_id = t.id
     WHERE tm.tenant_id = ? AND tm.user_id = ? AND tm.role IN (${placeholders})
       AND tm.status = 'ACTIVE' AND t.status = 'ACTIVE' AND u.status = 'ACTIVE'
     LIMIT 1 FOR UPDATE`,
    [tenantId, userId, ...roles],
  );
  if (!rows[0]) throw appError('No tiene permisos para realizar esta operación.', 'INSUFFICIENT_ROLE', 403);
  return rows[0];
}

function json(value) {
  if (value == null) return null;
  return typeof value === 'string' ? JSON.parse(value) : value;
}

async function findRequest(
  connection, userId, operationType, requestId, payloadFingerprint,
) {
  const [rows] = await connection.execute(
    `SELECT payload_fingerprint AS payloadFingerprint, status,
            response_snapshot AS response
     FROM operation_requests
     WHERE actor_scope = 'USER' AND actor_id = ?
       AND operation_type = ? AND request_id = ?
     LIMIT 1 FOR UPDATE`,
    [userId, operationType, requestId],
  );
  const existing = rows[0];
  if (!existing) return null;
  if (!Buffer.isBuffer(existing.payloadFingerprint)
    || Buffer.compare(existing.payloadFingerprint, payloadFingerprint) !== 0) {
    throw appError('El requestId ya fue utilizado con una venta diferente.', 'IDEMPOTENCY_KEY_REUSED');
  }
  if (existing.status === 'COMPLETED' && existing.response) {
    return { ...json(existing.response), replay: true };
  }
  throw appError('La venta anterior todavía requiere conciliación.', 'OPERATION_IN_PROGRESS');
}

async function audit(connection, data) {
  await connection.execute(
    `INSERT INTO audit_events
      (tenant_id, actor_scope, actor_id, event_type, entity_type, entity_id,
       correlation_id, metadata)
     VALUES (?, 'USER', ?, ?, ?, ?, ?, ?)`,
    [data.tenantId, data.userId, data.eventType, data.entityType, data.entityId,
      data.correlationId, JSON.stringify(data.metadata)],
  );
}

function drawPublic(row) {
  return {
    drawPublicId: row.drawPublicId,
    businessDate: row.businessDate,
    scheduledAt: row.scheduledAt,
    closesAt: row.closesAt,
    status: row.status,
    lottery: { code: row.lotteryCode, name: row.lotteryName },
    modality: { code: row.modalityCode, name: row.modalityName },
    multiplier: row.multiplier,
    totalSoldAmount: row.totalSoldAmount,
    validTicketCount: Number(row.validTicketCount),
  };
}

function potentialPrize(amount, multiplier) {
  try {
    return multiplyMoneyByMultiplier(amount, multiplier);
  } catch (error) {
    if (error?.code === 'INEXACT_MONEY_RESULT') {
      throw appError(
        'La jugada produciría un premio con fracciones menores a un céntimo.',
        'POTENTIAL_PRIZE_NOT_EXACT',
        422,
      );
    }
    throw appError(
      'El premio potencial supera la capacidad monetaria permitida.',
      'POTENTIAL_PRIZE_OUT_OF_RANGE',
      422,
    );
  }
}

export function iniciarBaseDeDatosSales(pool) {
  return {
    async listarSorteosVenta(tenantId, businessDate, status = 'OPEN') {
      const closingFilter = status === 'OPEN' ? ' AND d.closes_at_utc > UTC_TIMESTAMP(6)' : '';
      const availabilityJoin = status === 'OPEN' ? `
         JOIN lotteries l ON l.code = d.lottery_code_snapshot
         JOIN tenant_lotteries tl ON tl.tenant_id = d.tenant_id AND tl.lottery_id = l.id
         LEFT JOIN tenant_daily_lottery_availability a
           ON a.tenant_id = d.tenant_id AND a.lottery_id = l.id
          AND a.business_date = d.business_date` : '';
      const availabilityFilter = status === 'OPEN'
        ? ' AND COALESCE(a.is_enabled_for_sales, tl.is_enabled) = TRUE' : '';
      const [rows] = await pool.execute(
        `SELECT d.public_id AS drawPublicId,
                DATE_FORMAT(d.business_date, '%Y-%m-%d') AS businessDate,
                d.scheduled_at_utc AS scheduledAt, d.closes_at_utc AS closesAt,
                d.status, d.lottery_code_snapshot AS lotteryCode,
                d.lottery_name_snapshot AS lotteryName,
                d.modality_code_snapshot AS modalityCode,
                d.modality_name_snapshot AS modalityName,
                d.multiplier_snapshot AS multiplier,
                d.total_sold_amount AS totalSoldAmount,
                d.valid_ticket_count AS validTicketCount
         FROM draws d
         ${availabilityJoin}
         WHERE d.tenant_id = ? AND d.business_date = ? AND d.status = ?
           ${closingFilter}
           ${availabilityFilter}
         ORDER BY d.scheduled_at_utc, d.lottery_code_snapshot, d.modality_code_snapshot`,
        [tenantId, businessDate, status],
      );
      const [warningRows] = await pool.execute(
        `SELECT l.code AS lotteryCode, l.name AS lotteryName
         FROM tenant_lotteries tl
         JOIN lotteries l ON l.id = tl.lottery_id AND l.is_active = TRUE
         LEFT JOIN tenant_limit_settings tls ON tls.tenant_id = tl.tenant_id
         WHERE tl.tenant_id = ? AND tl.is_enabled = TRUE
           AND (tls.tenant_id IS NULL OR NOT EXISTS (
             SELECT 1
             FROM tenant_modalities tm
             JOIN lottery_modalities lm ON lm.id = tm.lottery_modality_id
             JOIN tenant_schedules ts ON ts.tenant_id = tm.tenant_id
             JOIN draw_schedules ds ON ds.id = ts.draw_schedule_id
               AND ds.lottery_modality_id = lm.id
             WHERE tm.tenant_id = tl.tenant_id AND lm.lottery_id = tl.lottery_id
               AND tm.is_enabled = TRUE AND tm.multiplier IS NOT NULL
               AND ts.is_enabled = TRUE
           ))
         ORDER BY l.sort_order, l.code`,
        [tenantId],
      );
      return {
        businessDate,
        draws: rows.map(drawPublic),
        warnings: warningRows.map((row) => ({ ...row, code: 'LOTTERY_RULES_INCOMPLETE' })),
      };
    },

    async obtenerMatriz(tenantId, drawPublicId) {
      const [drawRows] = await pool.execute(
        `SELECT d.public_id AS drawPublicId,
                DATE_FORMAT(d.business_date, '%Y-%m-%d') AS businessDate,
                d.scheduled_at_utc AS scheduledAt, d.closes_at_utc AS closesAt,
                d.status, d.lottery_code_snapshot AS lotteryCode,
                d.lottery_name_snapshot AS lotteryName,
                d.modality_code_snapshot AS modalityCode,
                d.modality_name_snapshot AS modalityName,
                d.multiplier_snapshot AS multiplier,
                d.total_sold_amount AS totalSoldAmount,
                d.valid_ticket_count AS validTicketCount
         FROM draws d WHERE d.tenant_id = ? AND d.public_id = ? LIMIT 1`,
        [tenantId, drawPublicId],
      );
      if (!drawRows[0]) return null;
      const [positions] = await pool.execute(
        `SELECT LPAD(number_value, 2, '0') AS number,
                effective_limit_amount AS effectiveLimit,
                sold_amount AS soldAmount,
                CAST(effective_limit_amount - sold_amount AS CHAR) AS remainingAmount,
                valid_ticket_count AS validTicketCount
         FROM draw_number_positions WHERE draw_id = (
           SELECT id FROM draws WHERE tenant_id = ? AND public_id = ? LIMIT 1
         ) ORDER BY number_value`,
        [tenantId, drawPublicId],
      );
      return {
        draw: drawPublic(drawRows[0]),
        numbers: positions.map((row) => ({ ...row, validTicketCount: Number(row.validTicketCount) })),
      };
    },

    async actualizarLimiteTransaccional(tenantId, userId, input) {
      return transaction(pool, async (connection) => {
        await lockActor(connection, tenantId, userId, ['OWNER', 'MANAGER']);
        const [drawRows] = await connection.execute(
          `SELECT id, status, closes_at_utc AS closesAt
           FROM draws WHERE tenant_id = ? AND public_id = ? LIMIT 1 FOR UPDATE`,
          [tenantId, input.drawPublicId],
        );
        const draw = drawRows[0];
        if (!draw) throw appError('El sorteo no existe.', 'DRAW_NOT_FOUND', 404);
        if (draw.status !== 'OPEN') throw appError('El sorteo ya no permite editar límites.', 'DRAW_NOT_EDITABLE');
        const [positions] = await connection.execute(
          `SELECT base_limit_amount AS baseLimit, effective_limit_amount AS effectiveLimit,
                  sold_amount AS soldAmount
           FROM draw_number_positions
           WHERE draw_id = ? AND number_value = ? LIMIT 1 FOR UPDATE`,
          [draw.id, input.number],
        );
        const position = positions[0];
        if (!position) throw appError('La matriz del sorteo está incompleta.', 'DRAW_LIMITS_INCOMPLETE', 503);
        const [update] = await connection.execute(
          `UPDATE draw_number_positions
           SET effective_limit_amount = sold_amount + CAST(? AS DECIMAL(15,2)),
               limit_adjustment_amount = sold_amount + CAST(? AS DECIMAL(15,2)) - base_limit_amount
           WHERE draw_id = ? AND number_value = ?
             AND effective_limit_amount = CAST(? AS DECIMAL(15,2))
             AND EXISTS (SELECT 1 FROM draws d WHERE d.id = draw_id
               AND d.status = 'OPEN' AND d.closes_at_utc > UTC_TIMESTAMP(6))`,
          [input.remainingAmount, input.remainingAmount, draw.id, input.number,
            input.expectedEffectiveLimit],
        );
        if (update.affectedRows !== 1) {
          if (position.effectiveLimit !== input.expectedEffectiveLimit) {
            throw appError('El límite cambió en otra sesión.', 'LIMIT_CHANGED');
          }
          throw appError('El sorteo alcanzó su hora de cierre.', 'DRAW_CLOSED');
        }
        const [updatedRows] = await connection.execute(
          `SELECT effective_limit_amount AS effectiveLimit, sold_amount AS soldAmount,
                  CAST(effective_limit_amount - sold_amount AS CHAR) AS remainingAmount
           FROM draw_number_positions WHERE draw_id = ? AND number_value = ?`,
          [draw.id, input.number],
        );
        const content = {
          drawPublicId: input.drawPublicId,
          number: String(input.number).padStart(2, '0'),
          previousEffectiveLimit: position.effectiveLimit,
          ...updatedRows[0],
        };
        await audit(connection, {
          tenantId, userId, eventType: 'DRAW_NUMBER_LIMIT_UPDATED',
          entityType: 'DRAW', entityId: draw.id, correlationId: input.correlationId,
          metadata: content,
        });
        return content;
      });
    },

    async crearTicketTransaccional(tenantId, userId, input) {
      return transaction(pool, async (connection) => {
        const actor = await lockActor(connection, tenantId, userId, ['OWNER', 'MANAGER', 'SELLER']);
        const replay = await findRequest(
          connection, userId, CREATE_TICKET, input.requestId, input.payloadFingerprint,
        );
        if (replay) return replay;
        const [drawRows] = await connection.execute(
          `SELECT d.id, d.business_date AS businessDate, d.scheduled_at_utc AS scheduledAt,
                  d.closes_at_utc AS closesAt, d.status,
                  d.closes_at_utc > UTC_TIMESTAMP(6) AS beforeClose,
                  d.lottery_code_snapshot AS lotteryCode,
                  d.lottery_name_snapshot AS lotteryName,
                  d.modality_code_snapshot AS modalityCode,
                  d.modality_name_snapshot AS modalityName,
                  d.multiplier_snapshot AS multiplier,
                  COALESCE(a.is_enabled_for_sales, tl.is_enabled) AS enabledForSales
           FROM draws d
           JOIN lotteries l ON l.code = d.lottery_code_snapshot
           JOIN tenant_lotteries tl ON tl.tenant_id = d.tenant_id AND tl.lottery_id = l.id
           LEFT JOIN tenant_daily_lottery_availability a
             ON a.tenant_id = d.tenant_id AND a.lottery_id = l.id
            AND a.business_date = d.business_date
           WHERE d.tenant_id = ? AND d.public_id = ? LIMIT 1 FOR UPDATE`,
          [tenantId, input.drawPublicId],
        );
        const draw = drawRows[0];
        if (!draw) throw appError('El sorteo no existe.', 'DRAW_NOT_FOUND', 404);
        if (draw.status !== 'OPEN' || !draw.beforeClose) {
          throw appError('El sorteo está cerrado.', 'DRAW_CLOSED');
        }
        if (!draw.enabledForSales) throw appError('La lotería está pausada para nuevas ventas.', 'LOTTERY_SALES_PAUSED');

        const numbers = input.items.map((item) => Number(item.number));
        const placeholders = numbers.map(() => '?').join(', ');
        const [positions] = await connection.execute(
          `SELECT number_value AS number, effective_limit_amount AS effectiveLimit,
                  sold_amount AS soldAmount
           FROM draw_number_positions
           WHERE draw_id = ? AND number_value IN (${placeholders})
           ORDER BY number_value FOR UPDATE`,
          [draw.id, ...numbers],
        );
        if (positions.length !== input.items.length) {
          throw appError('La matriz del sorteo está incompleta.', 'DRAW_LIMITS_INCOMPLETE', 503);
        }
        const itemByNumber = new Map(input.items.map((item) => [Number(item.number), item]));
        for (const position of positions) {
          const item = itemByNumber.get(Number(position.number));
          if (parseMoney(position.soldAmount) + parseMoney(item.amount)
            > parseMoney(position.effectiveLimit)) {
            throw appError(`El número ${item.number} no tiene disponibilidad suficiente.`, 'NUMBER_LIMIT_EXCEEDED');
          }
        }
        const [cashRows] = await connection.execute(
          `SELECT id, initialized_at AS initializedAt, current_balance AS currentBalance
           FROM cash_accounts WHERE tenant_id = ? LIMIT 1 FOR UPDATE`,
          [tenantId],
        );
        if (!cashRows[0]?.initializedAt) throw appError('Debe inicializar la caja antes de vender.', 'CASH_NOT_INITIALIZED');
        try {
          addMoney(cashRows[0].currentBalance, input.totalAmount);
        } catch {
          throw appError('La venta supera la capacidad monetaria de la caja.', 'CASH_BALANCE_OUT_OF_RANGE', 422);
        }

        const [requestResult] = await connection.execute(
          `INSERT INTO operation_requests
            (tenant_id, actor_scope, actor_id, operation_type, request_id,
             payload_fingerprint, status)
           VALUES (?, 'USER', ?, ?, ?, ?, 'PROCESSING')`,
          [tenantId, userId, CREATE_TICKET, input.requestId, input.payloadFingerprint],
        );
        let ticketResult;
        let selectedCode;
        for (const candidate of input.ticketCodeCandidates) {
          try {
            [ticketResult] = await connection.execute(
              `INSERT INTO tickets
                (public_code, tenant_id, draw_id, status, total_amount, business_date,
                 operation_request_id, seller_name_snapshot, receipt_fields_snapshot,
                 lottery_name_snapshot, modality_name_snapshot, scheduled_at_snapshot,
                 created_by_user_id)
               VALUES (?, ?, ?, 'VALID', ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
              [candidate, tenantId, draw.id, input.totalAmount, draw.businessDate,
                requestResult.insertId, actor.sellerName, JSON.stringify(json(actor.receiptFields) || {}),
                draw.lotteryName, draw.modalityName, draw.scheduledAt, userId],
            );
            selectedCode = candidate;
            break;
          } catch (error) {
            if (error?.code !== 'ER_DUP_ENTRY') throw error;
          }
        }
        if (!ticketResult) throw appError('No fue posible asignar un código al ticket.', 'TICKET_CODE_COLLISION', 503);
        const ticketId = ticketResult.insertId;
        const itemValues = input.items.map((item) => [
          tenantId, ticketId, draw.id, Number(item.number), item.amount,
          draw.multiplier, potentialPrize(item.amount, draw.multiplier),
        ]);
        await connection.query(
          `INSERT INTO ticket_items
            (tenant_id, ticket_id, draw_id, number_value, bet_amount,
             multiplier_snapshot, potential_prize_amount)
           VALUES ?`,
          [itemValues],
        );
        for (const item of input.items) {
          await connection.execute(
            `UPDATE draw_number_positions
             SET sold_amount = sold_amount + CAST(? AS DECIMAL(15,2)),
                 valid_ticket_count = valid_ticket_count + 1
             WHERE draw_id = ? AND number_value = ?`,
            [item.amount, draw.id, Number(item.number)],
          );
        }
        await connection.execute(
          `UPDATE draws
           SET total_sold_amount = total_sold_amount + CAST(? AS DECIMAL(15,2)),
               valid_ticket_count = valid_ticket_count + 1
           WHERE id = ?`,
          [input.totalAmount, draw.id],
        );
        await connection.execute(
          `UPDATE cash_accounts
           SET current_balance = current_balance + CAST(? AS DECIMAL(15,2)) WHERE id = ?`,
          [input.totalAmount, cashRows[0].id],
        );
        const [balanceRows] = await connection.execute(
          'SELECT current_balance AS balance FROM cash_accounts WHERE id = ?',
          [cashRows[0].id],
        );
        await connection.execute(
          `INSERT INTO cash_movements
            (tenant_id, cash_account_id, business_date, movement_type, direction,
             amount, balance_after, reference_type, reference_id,
             operation_request_id, created_by_user_id)
           VALUES (?, ?, ?, 'SALE', 'CREDIT', ?, ?, 'TICKET', ?, ?, ?)`,
          [tenantId, cashRows[0].id, draw.businessDate, input.totalAmount,
            balanceRows[0].balance, ticketId, requestResult.insertId, userId],
        );
        const content = {
          ticket: {
            id: String(ticketId), ticketCode: selectedCode, status: 'VALID',
            totalAmount: input.totalAmount, businessDate: String(draw.businessDate),
            drawPublicId: input.drawPublicId,
          },
          cashBalance: balanceRows[0].balance,
        };
        await audit(connection, {
          tenantId, userId, eventType: 'TICKET_CREATED', entityType: 'TICKET',
          entityId: ticketId, correlationId: input.correlationId,
          metadata: { ticketCode: selectedCode, totalAmount: input.totalAmount, itemCount: input.items.length },
        });
        await connection.execute(
          `UPDATE operation_requests
           SET status = 'COMPLETED', resource_type = 'TICKET', resource_id = ?,
               http_status = 201, response_snapshot = ?, completed_at = UTC_TIMESTAMP(6)
           WHERE id = ?`,
          [ticketId, JSON.stringify(content), requestResult.insertId],
        );
        return { ...content, replay: false };
      });
    },

    async cancelarTicketTransaccional(tenantId, userId, ticketCode, input) {
      return transaction(pool, async (connection) => {
        await lockActor(connection, tenantId, userId, ['OWNER', 'MANAGER', 'SELLER']);
        const replay = await findRequest(
          connection, userId, CANCEL_TICKET, input.requestId, input.payloadFingerprint,
        );
        if (replay) return replay;
        const [ticketRows] = await connection.execute(
          `SELECT t.id, t.draw_id AS drawId, t.status, t.total_amount AS totalAmount,
                  t.business_date AS businessDate, d.status AS drawStatus,
                  d.closes_at_utc > UTC_TIMESTAMP(6) AS beforeClose,
                  d.current_result_version_id AS resultId
           FROM tickets t JOIN draws d ON d.id = t.draw_id AND d.tenant_id = t.tenant_id
           WHERE t.tenant_id = ? AND t.public_code = ? LIMIT 1 FOR UPDATE`,
          [tenantId, ticketCode],
        );
        const ticket = ticketRows[0];
        if (!ticket) throw appError('El ticket no existe.', 'TICKET_NOT_FOUND', 404);
        if (ticket.status !== 'VALID') throw appError('El ticket ya no puede cancelarse.', 'TICKET_NOT_VALID');
        if (ticket.drawStatus !== 'OPEN' || !ticket.beforeClose || ticket.resultId) {
          throw appError('El sorteo ya no permite cancelar tickets.', 'TICKET_CANCELLATION_CLOSED');
        }
        const [items] = await connection.execute(
          `SELECT number_value AS number, bet_amount AS amount
           FROM ticket_items WHERE tenant_id = ? AND ticket_id = ?
           ORDER BY number_value FOR UPDATE`,
          [tenantId, ticket.id],
        );
        if (!items.length) throw appError('El ticket no contiene jugadas conciliables.', 'TICKET_DATA_INCOMPLETE', 503);
        const numbers = items.map((item) => item.number);
        await connection.execute(
          `SELECT number_value FROM draw_number_positions
           WHERE draw_id = ? AND number_value IN (${numbers.map(() => '?').join(', ')})
           ORDER BY number_value FOR UPDATE`,
          [ticket.drawId, ...numbers],
        );
        const [cashRows] = await connection.execute(
          `SELECT id, current_balance AS balance FROM cash_accounts
           WHERE tenant_id = ? AND initialized_at IS NOT NULL LIMIT 1 FOR UPDATE`,
          [tenantId],
        );
        if (!cashRows[0] || parseMoney(cashRows[0].balance) < parseMoney(ticket.totalAmount)) {
          throw appError('La caja no posee saldo suficiente para revertir la venta.', 'INSUFFICIENT_CASH_BALANCE');
        }
        const [request] = await connection.execute(
          `INSERT INTO operation_requests
            (tenant_id, actor_scope, actor_id, operation_type, request_id,
             payload_fingerprint, status)
           VALUES (?, 'USER', ?, ?, ?, ?, 'PROCESSING')`,
          [tenantId, userId, CANCEL_TICKET, input.requestId, input.payloadFingerprint],
        );
        await connection.execute(
          `UPDATE tickets SET status = 'CANCELLED', cancelled_at = UTC_TIMESTAMP(6)
           WHERE id = ? AND status = 'VALID'`, [ticket.id],
        );
        const [cancellation] = await connection.execute(
          `INSERT INTO ticket_cancellations
            (tenant_id, ticket_id, operation_request_id, reason,
             cancelled_amount, cancelled_by_user_id)
           VALUES (?, ?, ?, ?, ?, ?)`,
          [tenantId, ticket.id, request.insertId, input.reason, ticket.totalAmount, userId],
        );
        for (const item of items) {
          await connection.execute(
            `UPDATE draw_number_positions SET sold_amount = sold_amount - ?,
                 valid_ticket_count = valid_ticket_count - 1
             WHERE draw_id = ? AND number_value = ?`,
            [item.amount, ticket.drawId, item.number],
          );
        }
        await connection.execute(
          `UPDATE draws SET total_sold_amount = total_sold_amount - ?,
               valid_ticket_count = valid_ticket_count - 1 WHERE id = ?`,
          [ticket.totalAmount, ticket.drawId],
        );
        await connection.execute(
          'UPDATE cash_accounts SET current_balance = current_balance - ? WHERE id = ?',
          [ticket.totalAmount, cashRows[0].id],
        );
        const balance = addMoney(cashRows[0].balance, `-${ticket.totalAmount}`);
        await connection.execute(
          `INSERT INTO cash_movements
            (tenant_id, cash_account_id, business_date, movement_type, direction,
             amount, balance_after, reference_type, reference_id,
             operation_request_id, reason, created_by_user_id)
           VALUES (?, ?, ?, 'CANCELLATION', 'DEBIT', ?, ?, 'TICKET', ?, ?, ?, ?)`,
          [tenantId, cashRows[0].id, ticket.businessDate, ticket.totalAmount, balance,
            ticket.id, request.insertId, input.reason, userId],
        );
        const content = {
          ticketCode, status: 'CANCELLED', cancelledAmount: ticket.totalAmount,
          cashBalance: balance,
        };
        await audit(connection, {
          tenantId, userId, eventType: 'TICKET_CANCELLED', entityType: 'TICKET',
          entityId: ticket.id, correlationId: input.correlationId,
          metadata: { ticketCode, amount: ticket.totalAmount, reason: input.reason },
        });
        await connection.execute(
          `UPDATE operation_requests SET status='COMPLETED', resource_type='TICKET_CANCELLATION',
             resource_id=?, http_status=201, response_snapshot=?, completed_at=UTC_TIMESTAMP(6)
           WHERE id=?`,
          [cancellation.insertId, JSON.stringify(content), request.insertId],
        );
        return { ...content, replay: false };
      });
    },

    async corregirTicketTransaccional(tenantId, userId, ticketCode, input) {
      return transaction(pool, async (connection) => {
        const actor = await lockActor(connection, tenantId, userId, ['OWNER', 'MANAGER', 'SELLER']);
        const replay = await findRequest(
          connection, userId, CORRECT_TICKET, input.requestId, input.payloadFingerprint,
        );
        if (replay) return replay;
        const [ticketRows] = await connection.execute(
          `SELECT t.id, t.draw_id AS drawId, t.status, t.total_amount AS totalAmount,
                  t.business_date AS businessDate, d.public_id AS drawPublicId,
                  d.status AS drawStatus, d.closes_at_utc > UTC_TIMESTAMP(6) AS beforeClose,
                  d.current_result_version_id AS resultId, d.multiplier_snapshot AS multiplier,
                  d.lottery_name_snapshot AS lotteryName,
                  d.modality_name_snapshot AS modalityName,
                  d.scheduled_at_utc AS scheduledAt
           FROM tickets t JOIN draws d ON d.id=t.draw_id AND d.tenant_id=t.tenant_id
           WHERE t.tenant_id=? AND t.public_code=? LIMIT 1 FOR UPDATE`,
          [tenantId, ticketCode],
        );
        const original = ticketRows[0];
        if (!original) throw appError('El ticket no existe.', 'TICKET_NOT_FOUND', 404);
        if (original.status !== 'VALID') throw appError('El ticket ya no puede corregirse.', 'TICKET_NOT_VALID');
        if (original.drawStatus !== 'OPEN' || !original.beforeClose || original.resultId) {
          throw appError('El sorteo ya no permite corregir tickets.', 'TICKET_CORRECTION_CLOSED');
        }
        if (input.drawPublicId && parseMoney(original.totalAmount) !== parseMoney(input.totalAmount)) {
          throw appError('El reemplazo debe conservar exactamente el monto total del ticket original.', 'TICKET_TOTAL_MUST_MATCH');
        }
        let target = { ...original, id: original.drawId };
        if (input.drawPublicId) {
          const [targetRows] = await connection.execute(
          `SELECT d.id,d.public_id AS drawPublicId,d.business_date AS businessDate,d.status,
                  d.closes_at_utc > UTC_TIMESTAMP(6) AS beforeClose,
                  d.current_result_version_id AS resultId,d.multiplier_snapshot AS multiplier,
                  d.lottery_name_snapshot AS lotteryName,d.modality_name_snapshot AS modalityName,
                  d.scheduled_at_utc AS scheduledAt
           FROM draws d
           JOIN lotteries l ON l.code=d.lottery_code_snapshot
           JOIN tenant_lotteries tl ON tl.tenant_id=d.tenant_id AND tl.lottery_id=l.id
           LEFT JOIN tenant_daily_lottery_availability a
             ON a.tenant_id=d.tenant_id AND a.lottery_id=l.id AND a.business_date=d.business_date
           WHERE d.tenant_id=? AND d.public_id=? AND COALESCE(a.is_enabled_for_sales,tl.is_enabled)=TRUE
           LIMIT 1 FOR UPDATE`,
            [tenantId, input.drawPublicId],
          );
          target = targetRows[0];
          if (!target || target.status !== 'OPEN' || !target.beforeClose || target.resultId
            || String(target.businessDate).slice(0, 10) !== String(original.businessDate).slice(0, 10)) {
            throw appError('El sorteo elegido no está disponible para reemplazar el ticket.', 'TICKET_TARGET_DRAW_UNAVAILABLE');
          }
        }
        const [oldItems] = await connection.execute(
          `SELECT number_value AS number, bet_amount AS amount FROM ticket_items
           WHERE tenant_id=? AND ticket_id=? ORDER BY number_value FOR UPDATE`,
          [tenantId, original.id],
        );
        if (!oldItems.length) throw appError('El ticket no contiene jugadas conciliables.', 'TICKET_DATA_INCOMPLETE', 503);
        const oldMap = new Map(oldItems.map((item) => [Number(item.number), item.amount]));
        const newMap = new Map(input.items.map((item) => [Number(item.number), item.amount]));
        const numbers = [...new Set([...oldMap.keys(), ...newMap.keys()])].sort((a, b) => a - b);
        const oldNumbers = [...oldMap.keys()].sort((a, b) => a - b);
        const newNumbers = [...newMap.keys()].sort((a, b) => a - b);
        const queriedOldNumbers = input.drawPublicId ? oldNumbers : numbers;
        const [positions] = await connection.execute(
          `SELECT number_value AS number, sold_amount AS soldAmount,
                  effective_limit_amount AS effectiveLimit
           FROM draw_number_positions WHERE draw_id=?
             AND number_value IN (${queriedOldNumbers.map(() => '?').join(', ')})
           ORDER BY number_value FOR UPDATE`,
          [original.drawId, ...queriedOldNumbers],
        );
        if (positions.length !== queriedOldNumbers.length) throw appError('La matriz está incompleta.', 'DRAW_LIMITS_INCOMPLETE', 503);
        for (const position of positions) {
          const number = Number(position.number);
          const nextSold = parseMoney(position.soldAmount) - parseMoney(oldMap.get(number) || '0.00')
            + (target.id === original.drawId ? parseMoney(newMap.get(number) || '0.00') : 0n);
          if (nextSold > parseMoney(position.effectiveLimit)) {
            throw appError(`El número ${String(number).padStart(2, '0')} no tiene disponibilidad suficiente.`, 'NUMBER_LIMIT_EXCEEDED');
          }
        }
        const [targetPositions] = input.drawPublicId ? await connection.execute(
          `SELECT number_value AS number, sold_amount AS soldAmount, effective_limit_amount AS effectiveLimit
           FROM draw_number_positions WHERE draw_id=?
             AND number_value IN (${newNumbers.map(() => '?').join(', ')})
           ORDER BY number_value FOR UPDATE`,
          [target.id, ...newNumbers],
        ) : [positions.filter((position) => newMap.has(Number(position.number)))];
        if (targetPositions.length !== newNumbers.length) throw appError('La matriz está incompleta.', 'DRAW_LIMITS_INCOMPLETE', 503);
        for (const position of targetPositions) {
          const number = Number(position.number);
          const released = target.id === original.drawId ? parseMoney(oldMap.get(number) || '0.00') : 0n;
          const nextSold = parseMoney(position.soldAmount) - released + parseMoney(newMap.get(number));
          if (nextSold > parseMoney(position.effectiveLimit)) {
            throw appError(`El número ${String(number).padStart(2, '0')} no tiene disponibilidad suficiente.`, 'NUMBER_LIMIT_EXCEEDED');
          }
        }
        const [cashRows] = await connection.execute(
          `SELECT id, current_balance AS balance FROM cash_accounts
          WHERE tenant_id=? AND initialized_at IS NOT NULL LIMIT 1 FOR UPDATE`, [tenantId],
        );
        if (!cashRows[0]) throw appError('La caja debe inicializarse antes de corregir.', 'CASH_NOT_INITIALIZED');
        let balance;
        try { balance = addMoney(cashRows[0].balance, `-${original.totalAmount}`, input.totalAmount); } catch {
          throw appError('La corrección dejaría un saldo de caja inválido.', 'INSUFFICIENT_CASH_BALANCE');
        }
        if (parseMoney(balance, { allowNegative: true }) < 0n) throw appError('La corrección dejaría la caja negativa.', 'INSUFFICIENT_CASH_BALANCE');
        const [request] = await connection.execute(
          `INSERT INTO operation_requests
            (tenant_id,actor_scope,actor_id,operation_type,request_id,payload_fingerprint,status)
           VALUES (?,'USER',?,?,?,?,'PROCESSING')`,
          [tenantId, userId, CORRECT_TICKET, input.requestId, input.payloadFingerprint],
        );
        let replacement; let replacementCode;
        for (const candidate of input.ticketCodeCandidates) {
          try {
            [replacement] = await connection.execute(
              `INSERT INTO tickets
                (public_code,tenant_id,draw_id,status,total_amount,business_date,
                 operation_request_id,seller_name_snapshot,receipt_fields_snapshot,
                 lottery_name_snapshot,modality_name_snapshot,scheduled_at_snapshot,created_by_user_id)
               VALUES (?,?,?,'VALID',?,?,?,?,?,?,?,?,?)`,
              [candidate, tenantId, target.id, input.totalAmount, target.businessDate,
                request.insertId, actor.sellerName, JSON.stringify(json(actor.receiptFields) || {}),
                target.lotteryName, target.modalityName, target.scheduledAt, userId],
            ); replacementCode = candidate; break;
          } catch (error) { if (error?.code !== 'ER_DUP_ENTRY') throw error; }
        }
        if (!replacement) throw appError('No fue posible asignar código al reemplazo.', 'TICKET_CODE_COLLISION', 503);
        const replacementId = replacement.insertId;
        await connection.query(
          `INSERT INTO ticket_items
            (tenant_id,ticket_id,draw_id,number_value,bet_amount,multiplier_snapshot,potential_prize_amount)
           VALUES ?`,
          [input.items.map((item) => [tenantId, replacementId, target.id,
            Number(item.number), item.amount, target.multiplier,
            potentialPrize(item.amount, target.multiplier)])],
        );
        await connection.execute(
          `UPDATE tickets SET status='REPLACED', cancelled_at=UTC_TIMESTAMP(6)
           WHERE id=? AND status='VALID'`, [original.id],
        );
        await connection.execute(
          `INSERT INTO ticket_cancellations
            (tenant_id,ticket_id,operation_request_id,reason,cancelled_amount,cancelled_by_user_id)
           VALUES (?,?,?,?,?,?)`,
          [tenantId, original.id, request.insertId, input.reason, original.totalAmount, userId],
        );
        const [relation] = await connection.execute(
          `INSERT INTO ticket_replacements
            (tenant_id,original_ticket_id,replacement_ticket_id,operation_request_id,reason,created_by_user_id)
           VALUES (?,?,?,?,?,?)`,
          [tenantId, original.id, replacementId, request.insertId, input.reason, userId],
        );
        for (const number of oldNumbers) await connection.execute(
          `UPDATE draw_number_positions SET sold_amount=sold_amount-?, valid_ticket_count=valid_ticket_count-1
           WHERE draw_id=? AND number_value=?`, [oldMap.get(number), original.drawId, number],
        );
        for (const number of newNumbers) await connection.execute(
          `UPDATE draw_number_positions SET sold_amount=sold_amount+?, valid_ticket_count=valid_ticket_count+1
           WHERE draw_id=? AND number_value=?`, [newMap.get(number), target.id, number],
        );
        await connection.execute(
          'UPDATE draws SET total_sold_amount=total_sold_amount-?, valid_ticket_count=valid_ticket_count-1 WHERE id=?',
          [original.totalAmount, original.drawId],
        );
        await connection.execute(
          'UPDATE draws SET total_sold_amount=total_sold_amount+?, valid_ticket_count=valid_ticket_count+1 WHERE id=?',
          [input.totalAmount, target.id],
        );
        await connection.execute('UPDATE cash_accounts SET current_balance=? WHERE id=?', [balance, cashRows[0].id]);
        await connection.execute(
          `INSERT INTO cash_movements
            (tenant_id,cash_account_id,business_date,movement_type,direction,amount,balance_after,
             reference_type,reference_id,operation_request_id,reason,created_by_user_id)
           VALUES (?, ?, ?, 'CANCELLATION','DEBIT',?,?,'TICKET',?,?,?,?),
                  (?, ?, ?, 'SALE','CREDIT',?,?,'TICKET',?,?,NULL,?)`,
          [tenantId, cashRows[0].id, original.businessDate, original.totalAmount,
            addMoney(cashRows[0].balance, `-${original.totalAmount}`), original.id,
            request.insertId, input.reason, userId,
            tenantId, cashRows[0].id, original.businessDate, input.totalAmount, balance,
            replacementId, request.insertId, userId],
        );
        const content = { originalTicketCode: ticketCode, originalStatus: 'REPLACED',
          replacement: { id: String(replacementId), ticketCode: replacementCode,
            status: 'VALID', totalAmount: input.totalAmount }, cashBalance: balance };
        await audit(connection, { tenantId, userId, eventType: 'TICKET_CORRECTED',
          entityType: 'TICKET_REPLACEMENT', entityId: relation.insertId,
          correlationId: input.correlationId, metadata: { originalTicketCode: ticketCode,
            replacementTicketCode: replacementCode, reason: input.reason } });
        await connection.execute(
          `UPDATE operation_requests SET status='COMPLETED',resource_type='TICKET_REPLACEMENT',
             resource_id=?,http_status=201,response_snapshot=?,completed_at=UTC_TIMESTAMP(6) WHERE id=?`,
          [relation.insertId, JSON.stringify(content), request.insertId],
        );
        return { ...content, replay: false };
      });
    },

    async obtenerLista(tenantId, filters, cursor, limit) {
      const conditions = ['d.tenant_id = ?', 'd.business_date = ?'];
      const parameters = [tenantId, filters.businessDate];
      if (filters.lotteryCode) { conditions.push('d.lottery_code_snapshot = ?'); parameters.push(filters.lotteryCode); }
      if (filters.modalityCode) { conditions.push('d.modality_code_snapshot = ?'); parameters.push(filters.modalityCode); }
      if (filters.status) { conditions.push('d.status = ?'); parameters.push(filters.status); }
      if (cursor) {
        conditions.push('(d.scheduled_at_utc < ? OR (d.scheduled_at_utc = ? AND d.id < ?))');
        parameters.push(cursor.createdAt, cursor.createdAt, cursor.id);
      }
      parameters.push(limit);
      const [drawRows] = await pool.execute(
        `SELECT d.id, d.public_id AS drawPublicId, d.scheduled_at_utc AS createdAt,
                d.status, d.lottery_code_snapshot AS lotteryCode,
                d.lottery_name_snapshot AS lotteryName,
                d.modality_code_snapshot AS modalityCode,
                d.modality_name_snapshot AS modalityName,
                d.total_sold_amount AS totalSoldAmount,
                d.valid_ticket_count AS validTicketCount
         FROM draws d WHERE ${conditions.join(' AND ')}
         ORDER BY d.scheduled_at_utc DESC, d.id DESC LIMIT ?`,
        parameters,
      );
      if (!drawRows.length) return [];
      const ids = drawRows.map((row) => row.id);
      const [positions] = await pool.execute(
        `SELECT draw_id AS drawId, LPAD(number_value, 2, '0') AS number,
                sold_amount AS soldAmount, effective_limit_amount AS effectiveLimit,
                CAST(effective_limit_amount - sold_amount AS CHAR) AS remainingAmount,
                valid_ticket_count AS validTicketCount
         FROM draw_number_positions WHERE draw_id IN (${ids.map(() => '?').join(', ')})
         ORDER BY draw_id, number_value`,
        ids,
      );
      const byDraw = Map.groupBy(positions, (position) => String(position.drawId));
      return drawRows.map((row) => ({
        ...row, id: String(row.id), validTicketCount: Number(row.validTicketCount),
        numbers: (byDraw.get(String(row.id)) || []).map((position) => ({
          number: position.number, soldAmount: position.soldAmount,
          effectiveLimit: position.effectiveLimit, remainingAmount: position.remainingAmount,
          validTicketCount: Number(position.validTicketCount),
        })),
      }));
    },

    async listarTickets(tenantId, filters, cursor, limit) {
      const conditions = ['t.tenant_id = ?'];
      const parameters = [tenantId];
      if (filters.businessDate) { conditions.push('t.business_date = ?'); parameters.push(filters.businessDate); }
      if (filters.status) { conditions.push('t.status = ?'); parameters.push(filters.status); }
      const prizeStatusConditions = {
        PENDING_RESULT: 'd.current_result_version_id IS NULL',
        NOT_WINNER: `d.current_result_version_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM ticket_prize_evaluations e_filter WHERE e_filter.tenant_id = t.tenant_id AND e_filter.ticket_id = t.id AND e_filter.result_version_id = d.current_result_version_id AND e_filter.is_winner = TRUE)`,
        PENDING_PAYMENT: `d.current_result_version_id IS NOT NULL AND EXISTS (SELECT 1 FROM ticket_prize_evaluations e_filter WHERE e_filter.tenant_id = t.tenant_id AND e_filter.ticket_id = t.id AND e_filter.result_version_id = d.current_result_version_id AND e_filter.is_winner = TRUE) AND NOT EXISTS (SELECT 1 FROM prize_payments pp_filter WHERE pp_filter.tenant_id = t.tenant_id AND pp_filter.ticket_id = t.id)`,
        PAID: `d.current_result_version_id IS NOT NULL AND EXISTS (SELECT 1 FROM ticket_prize_evaluations e_filter WHERE e_filter.tenant_id = t.tenant_id AND e_filter.ticket_id = t.id AND e_filter.result_version_id = d.current_result_version_id AND e_filter.is_winner = TRUE) AND EXISTS (SELECT 1 FROM prize_payments pp_filter WHERE pp_filter.tenant_id = t.tenant_id AND pp_filter.ticket_id = t.id)`,
      };
      if (filters.prizeStatus && prizeStatusConditions[filters.prizeStatus]) conditions.push(prizeStatusConditions[filters.prizeStatus]);
      if (cursor) { conditions.push('(t.created_at < ? OR (t.created_at = ? AND t.id < ?))'); parameters.push(cursor.createdAt, cursor.createdAt, cursor.id); }
      parameters.push(limit);
      const [rows] = await pool.execute(
        `SELECT t.id, t.public_code AS ticketCode, t.status,
                t.total_amount AS totalAmount,
                DATE_FORMAT(t.business_date, '%Y-%m-%d') AS businessDate,
                t.created_at AS createdAt, COUNT(ti.id) AS itemCount,
                d.public_id AS drawPublicId,
                t.lottery_name_snapshot AS lotteryName,
                t.modality_name_snapshot AS modalityName,
                d.scheduled_at_utc AS scheduledAt,
                CASE
                  WHEN t.status <> 'VALID' THEN 'INELIGIBLE'
                  WHEN d.current_result_version_id IS NULL THEN 'PENDING_RESULT'
                  WHEN MAX(e.is_winner) = FALSE THEN 'NOT_WINNER'
                  WHEN MAX(pp.id) IS NULL THEN 'PENDING_PAYMENT'
                  ELSE 'PAID'
                END AS prizeStatus,
                COALESCE(MAX(e.prize_amount),0) AS prizeAmount
         FROM tickets t
         JOIN draws d ON d.id = t.draw_id AND d.tenant_id = t.tenant_id
         JOIN ticket_items ti ON ti.ticket_id = t.id AND ti.tenant_id = t.tenant_id
         LEFT JOIN ticket_prize_evaluations e
           ON e.ticket_id=t.id AND e.result_version_id=d.current_result_version_id
         LEFT JOIN prize_payments pp ON pp.ticket_id=t.id
         WHERE ${conditions.join(' AND ')}
         GROUP BY t.id, d.public_id
         ORDER BY t.created_at DESC, t.id DESC LIMIT ?`,
        parameters,
      );
      return rows.map((row) => ({ ...row, id: String(row.id), itemCount: Number(row.itemCount) }));
    },

    async obtenerTicket(tenantId, ticketCode) {
      const [rows] = await pool.execute(
        `SELECT t.id, t.public_code AS ticketCode, t.status,
                t.total_amount AS totalAmount,
                DATE_FORMAT(t.business_date, '%Y-%m-%d') AS businessDate,
                t.created_at AS createdAt, t.seller_name_snapshot AS sellerName,
                t.receipt_fields_snapshot AS receiptFields,
                t.lottery_name_snapshot AS lotteryName,
                t.modality_name_snapshot AS modalityName,
                t.scheduled_at_snapshot AS scheduledAt,
                d.public_id AS drawPublicId,
                LPAD(rv.winning_number,2,'0') AS winningNumber,
                e.is_winner AS isWinner,COALESCE(e.prize_amount,0) AS prizeAmount,
                pp.paid_at AS prizePaidAt,
                CASE
                  WHEN t.status <> 'VALID' THEN 'INELIGIBLE'
                  WHEN d.current_result_version_id IS NULL THEN 'PENDING_RESULT'
                  WHEN e.is_winner = FALSE THEN 'NOT_WINNER'
                  WHEN pp.id IS NULL THEN 'PENDING_PAYMENT'
                  ELSE 'PAID'
                END AS prizeStatus
         FROM tickets t JOIN draws d ON d.id = t.draw_id
         LEFT JOIN draw_result_versions rv ON rv.id=d.current_result_version_id
         LEFT JOIN ticket_prize_evaluations e
           ON e.ticket_id=t.id AND e.result_version_id=d.current_result_version_id
         LEFT JOIN prize_payments pp ON pp.ticket_id=t.id
         WHERE t.tenant_id = ? AND t.public_code = ? LIMIT 1`,
        [tenantId, ticketCode],
      );
      if (!rows[0]) return null;
      const [items] = await pool.execute(
        `SELECT LPAD(number_value, 2, '0') AS number, bet_amount AS amount,
                multiplier_snapshot AS multiplier,
                potential_prize_amount AS potentialPrizeAmount
         FROM ticket_items WHERE tenant_id = ? AND ticket_id = ? ORDER BY number_value`,
        [tenantId, rows[0].id],
      );
      return {
        ...rows[0],
        id: String(rows[0].id),
        isWinner: rows[0].isWinner == null ? null : Boolean(rows[0].isWinner),
        receiptFields: json(rows[0].receiptFields) || {},
        items,
      };
    },
  };
}
