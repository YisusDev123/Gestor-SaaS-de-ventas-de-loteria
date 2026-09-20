import { AppError } from '../error/app-error.js';
import { addMoney, parseMoney } from '../utils/money.js';

const PUBLISH_RESULT = 'PUBLISH_RESULT';
const CORRECT_RESULT = 'CORRECT_RESULT';
const PAY_PRIZE = 'PAY_PRIZE';

function operationError(message, code, statusCode = 409) {
  return new AppError(message, { statusCode, code });
}

function json(value) {
  if (value == null || typeof value === 'object') return value;
  return JSON.parse(value);
}

async function rollbackOrUnknown(connection, error, commitStarted) {
  if (commitStarted) {
    connection.destroy?.();
    throw operationError(
      'No fue posible confirmar el resultado de la operación.',
      'COMMIT_OUTCOME_UNKNOWN',
      503,
    );
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
  const [rows] = await connection.execute(
    `SELECT tm.id FROM tenant_memberships tm
     JOIN tenants t ON t.id=tm.tenant_id
     JOIN users u ON u.id=tm.user_id
     WHERE tm.tenant_id=? AND tm.user_id=?
       AND tm.role IN (${roles.map(() => '?').join(', ')})
       AND tm.status='ACTIVE' AND t.status='ACTIVE' AND u.status='ACTIVE'
     LIMIT 1 FOR UPDATE`,
    [tenantId, userId, ...roles],
  );
  if (!rows[0]) throw operationError('No tiene permisos para esta operación.', 'INSUFFICIENT_ROLE', 403);
}

async function findOperation(connection, userId, operationType, input) {
  const [rows] = await connection.execute(
    `SELECT payload_fingerprint AS payloadFingerprint, status,
            response_snapshot AS response
     FROM operation_requests
     WHERE actor_scope='USER' AND actor_id=? AND operation_type=? AND request_id=?
     LIMIT 1 FOR UPDATE`,
    [userId, operationType, input.requestId],
  );
  const existing = rows[0];
  if (!existing) return null;
  if (!Buffer.isBuffer(existing.payloadFingerprint)
    || Buffer.compare(existing.payloadFingerprint, input.payloadFingerprint) !== 0) {
    throw operationError('El requestId ya fue utilizado con datos diferentes.', 'IDEMPOTENCY_KEY_REUSED');
  }
  if (existing.status === 'COMPLETED' && existing.response) {
    return { ...json(existing.response), replay: true };
  }
  throw operationError('La operación anterior todavía requiere conciliación.', 'OPERATION_IN_PROGRESS');
}

async function createOperation(connection, tenantId, userId, operationType, input) {
  const [result] = await connection.execute(
    `INSERT INTO operation_requests
      (tenant_id,actor_scope,actor_id,operation_type,request_id,payload_fingerprint,status)
     VALUES (?,'USER',?,?,?,?,'PROCESSING')`,
    [tenantId, userId, operationType, input.requestId, input.payloadFingerprint],
  );
  return result.insertId;
}

async function completeOperation(connection, operationId, resourceType, resourceId, content) {
  await connection.execute(
    `UPDATE operation_requests SET status='COMPLETED',resource_type=?,resource_id=?,
       http_status=201,response_snapshot=?,completed_at=UTC_TIMESTAMP(6) WHERE id=?`,
    [resourceType, resourceId, JSON.stringify(content), operationId],
  );
}

async function audit(connection, data) {
  await connection.execute(
    `INSERT INTO audit_events
      (tenant_id,actor_scope,actor_id,event_type,entity_type,entity_id,
       correlation_id,reason,metadata)
     VALUES (?,'USER',?,?,?,?,?,?,?)`,
    [data.tenantId, data.userId, data.eventType, data.entityType, data.entityId,
      data.correlationId, data.reason || null, JSON.stringify(data.metadata)],
  );
}

async function evaluationSummary(connection, resultVersionId) {
  const [rows] = await connection.execute(
    `SELECT COUNT(*) AS evaluatedTicketCount,
            COALESCE(SUM(is_winner),0) AS winningTicketCount,
            COALESCE(SUM(prize_amount),0) AS totalPrizeAmount
     FROM ticket_prize_evaluations WHERE result_version_id=?`,
    [resultVersionId],
  );
  return {
    evaluatedTicketCount: Number(rows[0].evaluatedTicketCount),
    winningTicketCount: Number(rows[0].winningTicketCount),
    totalPrizeAmount: rows[0].totalPrizeAmount,
  };
}

async function insertEvaluations(connection, tenantId, drawId, resultVersionId, winningNumber) {
  await connection.execute(
    `INSERT INTO ticket_prize_evaluations
      (tenant_id,draw_id,result_version_id,ticket_id,is_winner,winning_number,
       winning_bet_amount,multiplier_snapshot,prize_amount)
     SELECT ?, ?, ?, t.id, wi.id IS NOT NULL, ?,
            COALESCE(wi.bet_amount,0), wi.multiplier_snapshot,
            COALESCE(wi.potential_prize_amount,0)
     FROM tickets t
     LEFT JOIN ticket_items wi
       ON wi.tenant_id=t.tenant_id AND wi.ticket_id=t.id AND wi.number_value=?
     WHERE t.tenant_id=? AND t.draw_id=? AND t.status='VALID'
     ORDER BY t.id`,
    [tenantId, drawId, resultVersionId, winningNumber, winningNumber, tenantId, drawId],
  );
}

async function refreshGeneratedPrizeSummary(connection, tenantId, businessDate) {
  await connection.execute(
    `UPDATE tenant_daily_summaries tds
     JOIN (
       SELECT COALESCE(SUM(e.prize_amount),0) AS amount
       FROM draws d
       JOIN ticket_prize_evaluations e
         ON e.draw_id=d.id AND e.result_version_id=d.current_result_version_id
        AND e.is_winner=TRUE
       WHERE d.tenant_id=? AND d.business_date=?
     ) live
     SET tds.calculation_version=tds.calculation_version
           + IF(tds.generated_prizes_amount<=>live.amount,0,1),
         tds.status=IF(tds.generated_prizes_amount<=>live.amount,tds.status,'RECALCULATED'),
         tds.generated_prizes_amount=live.amount,tds.calculated_at=UTC_TIMESTAMP(6)
     WHERE tds.tenant_id=? AND tds.business_date=?`,
    [tenantId, businessDate, tenantId, businessDate],
  );
}

async function refreshPaidPrizeSummary(connection, tenantId, businessDate) {
  await connection.execute(
    `UPDATE tenant_daily_summaries tds
     JOIN (
       SELECT COALESCE(SUM(amount),0) AS amount FROM cash_movements
       WHERE tenant_id=? AND business_date=? AND movement_type='PRIZE_PAYMENT'
     ) live
     SET tds.calculation_version=tds.calculation_version
           + IF(tds.paid_prizes_amount<=>live.amount,0,1),
         tds.status=IF(tds.paid_prizes_amount<=>live.amount,tds.status,'RECALCULATED'),
         tds.paid_prizes_amount=live.amount,tds.calculated_at=UTC_TIMESTAMP(6)
     WHERE tds.tenant_id=? AND tds.business_date=?`,
    [tenantId, businessDate, tenantId, businessDate],
  );
}

export function iniciarBaseDeDatosResults(pool) {
  return {
    async obtenerResultado(tenantId, drawPublicId) {
      const [drawRows] = await pool.execute(
        `SELECT d.id,d.public_id AS drawPublicId,d.status,
                DATE_FORMAT(d.business_date,'%Y-%m-%d') AS businessDate,
                d.scheduled_at_utc AS scheduledAt,d.lottery_name_snapshot AS lotteryName,
                d.modality_name_snapshot AS modalityName,
                rv.id AS currentVersionId,rv.version_number AS currentVersionNumber,
                LPAD(rv.winning_number,2,'0') AS winningNumber,rv.created_at AS resultedAt
         FROM draws d
         LEFT JOIN draw_result_versions rv ON rv.id=d.current_result_version_id
         WHERE d.tenant_id=? AND d.public_id=? LIMIT 1`,
        [tenantId, drawPublicId],
      );
      if (!drawRows[0]) return null;
      const [versions] = await pool.execute(
        `SELECT rv.id,rv.version_number AS versionNumber,
                LPAD(rv.winning_number,2,'0') AS winningNumber,
                rv.change_reason AS reason,rv.created_at AS createdAt,
                u.public_id AS createdByUserPublicId,
                (SELECT JSON_UNQUOTE(JSON_EXTRACT(a.metadata,'$.sourceNote'))
                 FROM audit_events a
                 WHERE a.tenant_id=rv.tenant_id AND a.entity_type='DRAW_RESULT'
                   AND a.entity_id=rv.id
                 ORDER BY a.id LIMIT 1) AS sourceNote,
                COUNT(e.id) AS evaluatedTicketCount,
                COALESCE(SUM(e.is_winner),0) AS winningTicketCount,
                COALESCE(SUM(e.prize_amount),0) AS totalPrizeAmount
         FROM draw_result_versions rv
         JOIN users u ON u.id=rv.created_by_user_id
         LEFT JOIN ticket_prize_evaluations e ON e.result_version_id=rv.id
         WHERE rv.tenant_id=? AND rv.draw_id=?
         GROUP BY rv.id ORDER BY rv.version_number DESC`,
        [tenantId, drawRows[0].id],
      );
      const draw = drawRows[0];
      return {
        drawPublicId: draw.drawPublicId,
        status: draw.status,
        businessDate: draw.businessDate,
        scheduledAt: draw.scheduledAt,
        lotteryName: draw.lotteryName,
        modalityName: draw.modalityName,
        current: draw.currentVersionId ? {
          id: String(draw.currentVersionId),
          versionNumber: Number(draw.currentVersionNumber),
          winningNumber: draw.winningNumber,
          resultedAt: draw.resultedAt,
        } : null,
        versions: versions.map((version) => ({
          ...version,
          id: String(version.id),
          versionNumber: Number(version.versionNumber),
          evaluatedTicketCount: Number(version.evaluatedTicketCount),
          winningTicketCount: Number(version.winningTicketCount),
        })),
      };
    },

    async publicarResultadoTransaccional(tenantId, userId, drawPublicId, input) {
      return transaction(pool, async (connection) => {
        await lockActor(connection, tenantId, userId, ['OWNER', 'MANAGER']);
        const replay = await findOperation(connection, userId, PUBLISH_RESULT, input);
        if (replay) return replay;
        const [drawRows] = await connection.execute(
          `SELECT id,status,DATE_FORMAT(business_date,'%Y-%m-%d') AS businessDate,
                  current_result_version_id AS currentResultId
           FROM draws WHERE tenant_id=? AND public_id=? LIMIT 1 FOR UPDATE`,
          [tenantId, drawPublicId],
        );
        const draw = drawRows[0];
        if (!draw) throw operationError('El sorteo no existe.', 'DRAW_NOT_FOUND', 404);
        if (draw.status !== 'CLOSED' || draw.currentResultId) {
          throw operationError('El sorteo no está listo para recibir su resultado.', 'DRAW_NOT_READY_FOR_RESULT');
        }
        const operationId = await createOperation(connection, tenantId, userId, PUBLISH_RESULT, input);
        const [version] = await connection.execute(
          `INSERT INTO draw_result_versions
            (tenant_id,draw_id,version_number,winning_number,created_by_user_id)
           VALUES (?,?,1,?,?)`,
          [tenantId, draw.id, input.winningNumber, userId],
        );
        await insertEvaluations(connection, tenantId, draw.id, version.insertId, input.winningNumber);
        await connection.execute(
          `UPDATE draws SET current_result_version_id=?,status='RESULTED' WHERE id=?`,
          [version.insertId, draw.id],
        );
        await refreshGeneratedPrizeSummary(connection, tenantId, draw.businessDate);
        const summary = await evaluationSummary(connection, version.insertId);
        const content = {
          drawPublicId, status: 'RESULTED', resultVersionId: String(version.insertId),
          versionNumber: 1, winningNumber: String(input.winningNumber).padStart(2, '0'),
          ...summary,
        };
        await audit(connection, {
          tenantId, userId, eventType: 'DRAW_RESULT_PUBLISHED', entityType: 'DRAW_RESULT',
          entityId: version.insertId, correlationId: input.correlationId,
          metadata: { drawPublicId, winningNumber: content.winningNumber, sourceNote: input.sourceNote },
        });
        await completeOperation(connection, operationId, 'DRAW_RESULT', version.insertId, content);
        return { ...content, replay: false };
      });
    },

    async corregirResultadoTransaccional(tenantId, userId, drawPublicId, input) {
      return transaction(pool, async (connection) => {
        await lockActor(connection, tenantId, userId, ['OWNER', 'MANAGER']);
        const replay = await findOperation(connection, userId, CORRECT_RESULT, input);
        if (replay) return replay;
        const [drawRows] = await connection.execute(
          `SELECT d.id,d.status,DATE_FORMAT(d.business_date,'%Y-%m-%d') AS businessDate,
                  d.current_result_version_id AS currentResultId,
                  rv.version_number AS currentVersionNumber,rv.winning_number AS currentWinningNumber
           FROM draws d
           LEFT JOIN draw_result_versions rv ON rv.id=d.current_result_version_id
           WHERE d.tenant_id=? AND d.public_id=? LIMIT 1 FOR UPDATE`,
          [tenantId, drawPublicId],
        );
        const draw = drawRows[0];
        if (!draw) throw operationError('El sorteo no existe.', 'DRAW_NOT_FOUND', 404);
        if (draw.status !== 'RESULTED' || !draw.currentResultId) {
          throw operationError('El sorteo todavía no posee un resultado corregible.', 'RESULT_NOT_FOUND');
        }
        if (Number(draw.currentWinningNumber) === input.winningNumber) {
          throw operationError('El número corregido debe ser diferente al vigente.', 'RESULT_UNCHANGED');
        }
        const [payments] = await connection.execute(
          `SELECT pp.id FROM prize_payments pp
           JOIN tickets t ON t.id=pp.ticket_id AND t.tenant_id=pp.tenant_id
           WHERE pp.tenant_id=? AND t.draw_id=? LIMIT 1 FOR UPDATE`,
          [tenantId, draw.id],
        );
        if (payments[0]) throw operationError('No puede corregirse un resultado con premios pagados.', 'RESULT_HAS_PAID_PRIZES');
        const operationId = await createOperation(connection, tenantId, userId, CORRECT_RESULT, input);
        const versionNumber = Number(draw.currentVersionNumber) + 1;
        const [version] = await connection.execute(
          `INSERT INTO draw_result_versions
            (tenant_id,draw_id,version_number,winning_number,previous_version_id,
             change_reason,created_by_user_id)
           VALUES (?,?,?,?,?,?,?)`,
          [tenantId, draw.id, versionNumber, input.winningNumber, draw.currentResultId,
            input.reason, userId],
        );
        await insertEvaluations(connection, tenantId, draw.id, version.insertId, input.winningNumber);
        await connection.execute(
          'UPDATE draws SET current_result_version_id=? WHERE id=?',
          [version.insertId, draw.id],
        );
        await refreshGeneratedPrizeSummary(connection, tenantId, draw.businessDate);
        const summary = await evaluationSummary(connection, version.insertId);
        const content = {
          drawPublicId, status: 'RESULTED', previousResultVersionId: String(draw.currentResultId),
          resultVersionId: String(version.insertId), versionNumber,
          winningNumber: String(input.winningNumber).padStart(2, '0'), ...summary,
        };
        await audit(connection, {
          tenantId, userId, eventType: 'DRAW_RESULT_CORRECTED', entityType: 'DRAW_RESULT',
          entityId: version.insertId, correlationId: input.correlationId, reason: input.reason,
          metadata: {
            drawPublicId, previousWinningNumber: String(draw.currentWinningNumber).padStart(2, '0'),
            winningNumber: content.winningNumber, sourceNote: input.sourceNote,
          },
        });
        await completeOperation(connection, operationId, 'DRAW_RESULT', version.insertId, content);
        return { ...content, replay: false };
      });
    },

    async obtenerPremio(tenantId, ticketCode) {
      const [rows] = await pool.execute(
        `SELECT t.public_code AS ticketCode,t.status AS ticketStatus,
                t.total_amount AS ticketTotal,d.public_id AS drawPublicId,d.status AS drawStatus,
                d.lottery_name_snapshot AS lotteryName,d.modality_name_snapshot AS modalityName,
                LPAD(rv.winning_number,2,'0') AS winningNumber,
                e.is_winner AS isWinner,COALESCE(e.prize_amount,0) AS prizeAmount,
                pp.id AS paymentId,pp.paid_at AS paidAt,
                CASE
                  WHEN t.status <> 'VALID' THEN 'INELIGIBLE'
                  WHEN d.current_result_version_id IS NULL THEN 'PENDING_RESULT'
                  WHEN e.is_winner = FALSE THEN 'NOT_WINNER'
                  WHEN pp.id IS NULL THEN 'PENDING_PAYMENT'
                  ELSE 'PAID'
                END AS prizeStatus
         FROM tickets t
         JOIN draws d ON d.id=t.draw_id AND d.tenant_id=t.tenant_id
         LEFT JOIN draw_result_versions rv ON rv.id=d.current_result_version_id
         LEFT JOIN ticket_prize_evaluations e
           ON e.ticket_id=t.id AND e.result_version_id=d.current_result_version_id
         LEFT JOIN prize_payments pp ON pp.ticket_id=t.id
         WHERE t.tenant_id=? AND t.public_code=? LIMIT 1`,
        [tenantId, ticketCode],
      );
      if (!rows[0]) return null;
      return {
        ...rows[0],
        isWinner: rows[0].isWinner == null ? null : Boolean(rows[0].isWinner),
        paymentId: rows[0].paymentId ? String(rows[0].paymentId) : null,
      };
    },

    async pagarPremioTransaccional(tenantId, userId, ticketCode, input) {
      return transaction(pool, async (connection) => {
        await lockActor(connection, tenantId, userId, ['OWNER', 'MANAGER', 'SELLER']);
        const replay = await findOperation(connection, userId, PAY_PRIZE, input);
        if (replay) return replay;
        const [ticketRefs] = await connection.execute(
          'SELECT id,draw_id AS drawId FROM tickets WHERE tenant_id=? AND public_code=? LIMIT 1',
          [tenantId, ticketCode],
        );
        if (!ticketRefs[0]) throw operationError('El ticket no existe.', 'TICKET_NOT_FOUND', 404);
        const [drawRows] = await connection.execute(
          `SELECT id,status,current_result_version_id AS currentResultId
           FROM draws WHERE tenant_id=? AND id=? LIMIT 1 FOR UPDATE`,
          [tenantId, ticketRefs[0].drawId],
        );
        const draw = drawRows[0];
        if (!draw?.currentResultId || !['RESULTED', 'SETTLED'].includes(draw.status)) {
          throw operationError('El sorteo todavía no posee un resultado pagable.', 'RESULT_NOT_FOUND');
        }
        const [evaluationRows] = await connection.execute(
          `SELECT t.id AS ticketId,t.status AS ticketStatus,e.id AS evaluationId,
                  e.is_winner AS isWinner,e.prize_amount AS prizeAmount,pp.id AS paymentId
           FROM tickets t
           LEFT JOIN ticket_prize_evaluations e
             ON e.ticket_id=t.id AND e.result_version_id=? AND e.tenant_id=t.tenant_id
           LEFT JOIN prize_payments pp ON pp.ticket_id=t.id
           WHERE t.tenant_id=? AND t.id=? LIMIT 1 FOR UPDATE`,
          [draw.currentResultId, tenantId, ticketRefs[0].id],
        );
        const evaluation = evaluationRows[0];
        if (evaluation.paymentId) throw operationError('El premio de este ticket ya fue pagado.', 'PRIZE_ALREADY_PAID');
        if (evaluation.ticketStatus !== 'VALID' || !evaluation.evaluationId) {
          throw operationError('El ticket no es elegible para pago.', 'TICKET_NOT_ELIGIBLE');
        }
        if (!evaluation.isWinner) throw operationError('El ticket no es ganador.', 'TICKET_NOT_WINNER');
        if (evaluation.prizeAmount !== input.expectedPrizeAmount) {
          throw operationError('El monto del premio cambió; revise antes de confirmar.', 'PRIZE_AMOUNT_CHANGED');
        }
        const [cashRows] = await connection.execute(
          `SELECT id,current_balance AS balance FROM cash_accounts
           WHERE tenant_id=? AND initialized_at IS NOT NULL LIMIT 1 FOR UPDATE`,
          [tenantId],
        );
        if (!cashRows[0] || parseMoney(cashRows[0].balance) < parseMoney(evaluation.prizeAmount)) {
          throw operationError('La caja no posee saldo suficiente para pagar el premio.', 'INSUFFICIENT_CASH_BALANCE');
        }
        const operationId = await createOperation(connection, tenantId, userId, PAY_PRIZE, input);
        const [payment] = await connection.execute(
          `INSERT INTO prize_payments
            (tenant_id,ticket_id,result_version_id,evaluation_id,amount,
             operation_request_id,paid_by_user_id)
           VALUES (?,?,?,?,?,?,?)`,
          [tenantId, evaluation.ticketId, draw.currentResultId, evaluation.evaluationId,
            evaluation.prizeAmount, operationId, userId],
        );
        const balance = addMoney(cashRows[0].balance, `-${evaluation.prizeAmount}`);
        await connection.execute(
          'UPDATE cash_accounts SET current_balance=? WHERE id=?',
          [balance, cashRows[0].id],
        );
        const [movement] = await connection.execute(
          `INSERT INTO cash_movements
            (tenant_id,cash_account_id,business_date,movement_type,direction,amount,
             balance_after,reference_type,reference_id,operation_request_id,created_by_user_id)
           VALUES (?,?,?,'PRIZE_PAYMENT','DEBIT',?,?,'TICKET',?,?,?)`,
          [tenantId, cashRows[0].id, input.businessDate, evaluation.prizeAmount, balance,
            evaluation.ticketId, operationId, userId],
        );
        await refreshPaidPrizeSummary(connection, tenantId, input.businessDate);
        const content = {
          ticketCode, prizeStatus: 'PAID', paymentId: String(payment.insertId),
          prizeAmount: evaluation.prizeAmount, cashBalance: balance,
        };
        await audit(connection, {
          tenantId, userId, eventType: 'PRIZE_PAID', entityType: 'PRIZE_PAYMENT',
          entityId: payment.insertId, correlationId: input.correlationId,
          metadata: { ticketCode, amount: evaluation.prizeAmount, cashMovementId: String(movement.insertId) },
        });
        await completeOperation(connection, operationId, 'PRIZE_PAYMENT', payment.insertId, content);
        return { ...content, replay: false };
      });
    },
  };
}
