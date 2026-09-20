import { AppError } from '../error/app-error.js';

const INITIALIZE_OPERATION = 'INITIALIZE_CASH';
const MANUAL_MOVEMENT_OPERATION = 'CREATE_CASH_MOVEMENT';

function operationError(message, code, statusCode = 409) {
  return new AppError(message, { statusCode, code });
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
  try {
    await connection.rollback();
  } catch {
    connection.destroy?.();
  }
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

async function validateActor(connection, tenantId, userId) {
  const [rows] = await connection.execute(
    `SELECT tm.id
     FROM tenant_memberships tm
     JOIN tenants t ON t.id = tm.tenant_id
     JOIN users u ON u.id = tm.user_id
     WHERE tm.tenant_id = ? AND tm.user_id = ?
       AND tm.status = 'ACTIVE' AND tm.role IN ('OWNER', 'MANAGER')
       AND t.status = 'ACTIVE' AND u.status = 'ACTIVE'
     LIMIT 1 FOR UPDATE`,
    [tenantId, userId],
  );
  if (!rows[0]) {
    throw operationError('No tiene permisos para administrar la caja.', 'INSUFFICIENT_ROLE', 403);
  }
}

function parseSnapshot(snapshot) {
  return typeof snapshot === 'string' ? JSON.parse(snapshot) : snapshot;
}

async function findOperation(connection, userId, operationType, requestId, fingerprint) {
  const [rows] = await connection.execute(
    `SELECT id, payload_fingerprint AS payloadFingerprint, status,
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
    || Buffer.compare(existing.payloadFingerprint, fingerprint) !== 0) {
    throw operationError(
      'El requestId ya fue utilizado con datos diferentes.',
      'IDEMPOTENCY_KEY_REUSED',
    );
  }
  if (existing.status === 'COMPLETED' && existing.response) {
    return { ...parseSnapshot(existing.response), replay: true };
  }
  throw operationError(
    'La operación anterior todavía requiere conciliación.',
    'OPERATION_IN_PROGRESS',
  );
}

async function createOperation(connection, tenantId, userId, operationType, input) {
  const [result] = await connection.execute(
    `INSERT INTO operation_requests
      (tenant_id, actor_scope, actor_id, operation_type, request_id,
       payload_fingerprint, status)
     VALUES (?, 'USER', ?, ?, ?, ?, 'PROCESSING')`,
    [tenantId, userId, operationType, input.requestId, input.payloadFingerprint],
  );
  return result.insertId;
}

async function completeOperation(connection, operationId, movementId, content) {
  await connection.execute(
    `UPDATE operation_requests
     SET status = 'COMPLETED', resource_type = 'CASH_MOVEMENT', resource_id = ?,
         http_status = 201, response_snapshot = ?, completed_at = UTC_TIMESTAMP(6)
     WHERE id = ?`,
    [movementId, JSON.stringify(content), operationId],
  );
}

async function audit(connection, {
  tenantId, userId, eventType, entityId, correlationId, reason, metadata,
}) {
  await connection.execute(
    `INSERT INTO audit_events
      (tenant_id, actor_scope, actor_id, event_type, entity_type, entity_id,
       correlation_id, reason, metadata)
     VALUES (?, 'USER', ?, ?, 'CASH_MOVEMENT', ?, ?, ?, ?)`,
    [
      tenantId, userId, eventType, entityId, correlationId, reason ?? null,
      JSON.stringify(metadata),
    ],
  );
}

function movementContent(movementId, input, balance) {
  return {
    cash: { initialized: true, balance },
    movement: {
      id: String(movementId),
      movementType: input.movementType,
      direction: input.direction,
      amount: input.amount,
      balanceAfter: balance,
      businessDate: input.businessDate,
      reason: input.reason ?? null,
    },
  };
}

export function iniciarBaseDeDatosCash(pool) {
  return {
    async obtenerEstadoCaja(tenantId) {
      const [rows] = await pool.execute(
        `SELECT ca.current_balance AS currentBalance, ca.initialized_at AS initializedAt,
                CAST(COALESCE(SUM(
                  CASE WHEN cm.direction = 'CREDIT' THEN cm.amount ELSE -cm.amount END
                ), 0.00) AS CHAR) AS ledgerBalance
         FROM cash_accounts ca
         LEFT JOIN cash_movements cm
           ON cm.cash_account_id = ca.id AND cm.tenant_id = ca.tenant_id
         WHERE ca.tenant_id = ?
         GROUP BY ca.id, ca.current_balance, ca.initialized_at
         LIMIT 1`,
        [tenantId],
      );
      return rows[0] || null;
    },

    async inicializarCajaTransaccional(tenantId, userId, input) {
      return transaction(pool, async (connection) => {
        await validateActor(connection, tenantId, userId);
        const replay = await findOperation(
          connection, userId, INITIALIZE_OPERATION, input.requestId, input.payloadFingerprint,
        );
        if (replay) return replay;

        await connection.execute(
          `INSERT INTO cash_accounts (tenant_id, current_balance)
           VALUES (?, 0.00)
           ON DUPLICATE KEY UPDATE tenant_id = VALUES(tenant_id)`,
          [tenantId],
        );
        const [accountRows] = await connection.execute(
          `SELECT id, initialized_at AS initializedAt
           FROM cash_accounts WHERE tenant_id = ? LIMIT 1 FOR UPDATE`,
          [tenantId],
        );
        const account = accountRows[0];
        if (account.initializedAt) {
          throw operationError('La caja ya fue inicializada.', 'CASH_ALREADY_INITIALIZED');
        }

        const operationId = await createOperation(
          connection, tenantId, userId, INITIALIZE_OPERATION, input,
        );
        await connection.execute(
          `UPDATE cash_accounts
           SET current_balance = ?, initialized_at = UTC_TIMESTAMP(6)
           WHERE id = ? AND initialized_at IS NULL`,
          [input.amount, account.id],
        );
        const [movementResult] = await connection.execute(
          `INSERT INTO cash_movements
            (tenant_id, cash_account_id, business_date, movement_type, direction,
             amount, balance_after, reference_type, reference_id,
             operation_request_id, created_by_user_id)
           VALUES (?, ?, ?, 'INITIAL', 'CREDIT', ?, ?, 'OPERATION_REQUEST', ?, ?, ?)`,
          [
            tenantId, account.id, input.businessDate, input.amount, input.amount,
            operationId, operationId, userId,
          ],
        );
        const content = movementContent(movementResult.insertId, {
          ...input, movementType: 'INITIAL', direction: 'CREDIT', reason: null,
        }, input.amount);
        await audit(connection, {
          tenantId, userId, eventType: 'CASH_INITIALIZED', entityId: movementResult.insertId,
          correlationId: input.correlationId,
          metadata: { amount: input.amount, businessDate: input.businessDate },
        });
        await completeOperation(connection, operationId, movementResult.insertId, content);
        return { ...content, replay: false };
      });
    },

    async registrarMovimientoTransaccional(tenantId, userId, input) {
      return transaction(pool, async (connection) => {
        await validateActor(connection, tenantId, userId);
        const replay = await findOperation(
          connection, userId, MANUAL_MOVEMENT_OPERATION,
          input.requestId, input.payloadFingerprint,
        );
        if (replay) return replay;

        const [accountRows] = await connection.execute(
          `SELECT id, initialized_at AS initializedAt
           FROM cash_accounts WHERE tenant_id = ? LIMIT 1 FOR UPDATE`,
          [tenantId],
        );
        const account = accountRows[0];
        if (!account?.initializedAt) {
          throw operationError(
            'Debe inicializar la caja antes de registrar movimientos.',
            'CASH_NOT_INITIALIZED',
          );
        }
        const operationId = await createOperation(
          connection, tenantId, userId, MANUAL_MOVEMENT_OPERATION, input,
        );
        const [updateResult] = await connection.execute(
          `UPDATE cash_accounts
           SET current_balance = current_balance + CAST(? AS DECIMAL(15,2))
           WHERE id = ?
             AND current_balance + CAST(? AS DECIMAL(15,2)) >= 0`,
          [input.signedAmount, account.id, input.signedAmount],
        );
        if (updateResult.affectedRows !== 1) {
          throw operationError(
            'El movimiento dejaría la caja con saldo negativo.',
            'INSUFFICIENT_CASH_BALANCE',
          );
        }
        const [balanceRows] = await connection.execute(
          'SELECT current_balance AS balance FROM cash_accounts WHERE id = ? LIMIT 1',
          [account.id],
        );
        const balance = balanceRows[0].balance;
        const [movementResult] = await connection.execute(
          `INSERT INTO cash_movements
            (tenant_id, cash_account_id, business_date, movement_type, direction,
             amount, balance_after, reference_type, reference_id,
             operation_request_id, reason, created_by_user_id)
           VALUES (?, ?, ?, ?, ?, ?, ?, 'OPERATION_REQUEST', ?, ?, ?, ?)`,
          [
            tenantId, account.id, input.businessDate, input.movementType, input.direction,
            input.amount, balance, operationId, operationId, input.reason, userId,
          ],
        );
        const content = movementContent(movementResult.insertId, input, balance);
        await audit(connection, {
          tenantId, userId, eventType: 'CASH_MOVEMENT_CREATED',
          entityId: movementResult.insertId, correlationId: input.correlationId,
          reason: input.reason,
          metadata: {
            movementType: input.movementType, direction: input.direction,
            amount: input.amount, balanceAfter: balance, businessDate: input.businessDate,
          },
        });
        await completeOperation(connection, operationId, movementResult.insertId, content);
        return { ...content, replay: false };
      });
    },

    async listarMovimientos(tenantId, businessDate, cursor, limit) {
      const filters = ['cm.tenant_id = ?'];
      const parameters = [tenantId];
      if (businessDate) {
        filters.push('cm.business_date = ?');
        parameters.push(businessDate);
      }
      if (cursor) {
        filters.push('(cm.created_at < ? OR (cm.created_at = ? AND cm.id < ?))');
        parameters.push(cursor.createdAt, cursor.createdAt, cursor.id);
      }
      parameters.push(limit);
      const [rows] = await pool.execute(
        `SELECT cm.id, cm.movement_type AS movementType, cm.direction,
                cm.amount, cm.balance_after AS balanceAfter, cm.reason,
                DATE_FORMAT(cm.business_date, '%Y-%m-%d') AS businessDate,
                cm.created_at AS createdAt
         FROM cash_movements cm
         WHERE ${filters.join(' AND ')}
         ORDER BY cm.created_at DESC, cm.id DESC
         LIMIT ?`,
        parameters,
      );
      return rows.map((row) => ({ ...row, id: String(row.id) }));
    },

    async cerrarResumenDiario(businessDate) {
      await pool.execute(
        `INSERT INTO tenant_daily_summaries
          (tenant_id, business_date, opening_balance, gross_sales_amount,
           cancelled_sales_amount, net_sales_amount, generated_prizes_amount,
           paid_prizes_amount, manual_credits_amount, manual_debits_amount,
           closing_balance, status, calculated_at, closed_at, calculation_version)
         SELECT ca.tenant_id, ?,
                COALESCE(SUM(CASE
                  WHEN cm.business_date < ? AND cm.direction = 'CREDIT' THEN cm.amount
                  WHEN cm.business_date < ? AND cm.direction = 'DEBIT' THEN -cm.amount
                  ELSE 0 END), 0.00),
                COALESCE(SUM(CASE WHEN cm.business_date = ?
                  AND cm.movement_type = 'SALE' THEN cm.amount ELSE 0 END), 0.00),
                COALESCE(SUM(CASE WHEN cm.business_date = ?
                  AND cm.movement_type = 'CANCELLATION' THEN cm.amount ELSE 0 END), 0.00),
                COALESCE(SUM(CASE WHEN cm.business_date = ?
                  AND cm.movement_type = 'SALE' THEN cm.amount
                  WHEN cm.business_date = ?
                  AND cm.movement_type = 'CANCELLATION' THEN -cm.amount
                  ELSE 0 END), 0.00),
                COALESCE((
                  SELECT SUM(e.prize_amount)
                  FROM ticket_prize_evaluations e
                  JOIN draws prize_draw
                    ON prize_draw.id=e.draw_id
                   AND prize_draw.current_result_version_id=e.result_version_id
                  WHERE e.tenant_id=ca.tenant_id
                    AND prize_draw.business_date=? AND e.is_winner=TRUE
                ),0.00),
                COALESCE(SUM(CASE WHEN cm.business_date = ?
                  AND cm.movement_type = 'PRIZE_PAYMENT' THEN cm.amount ELSE 0 END), 0.00),
                COALESCE(SUM(CASE WHEN cm.business_date = ?
                  AND cm.direction = 'CREDIT'
                  AND cm.movement_type IN ('INITIAL', 'ENTRY', 'ADJUSTMENT')
                  THEN cm.amount ELSE 0 END), 0.00),
                COALESCE(SUM(CASE WHEN cm.business_date = ?
                  AND cm.direction = 'DEBIT'
                  AND cm.movement_type IN ('WITHDRAWAL', 'EXPENSE', 'ADJUSTMENT')
                  THEN cm.amount ELSE 0 END), 0.00),
                COALESCE(SUM(CASE
                  WHEN cm.business_date <= ? AND cm.direction = 'CREDIT' THEN cm.amount
                  WHEN cm.business_date <= ? AND cm.direction = 'DEBIT' THEN -cm.amount
                  ELSE 0 END), 0.00),
                'CLOSED', UTC_TIMESTAMP(6), UTC_TIMESTAMP(6), 1
         FROM cash_accounts ca
         LEFT JOIN cash_movements cm
           ON cm.cash_account_id = ca.id AND cm.tenant_id = ca.tenant_id
         WHERE ca.initialized_at IS NOT NULL
           AND EXISTS (
             SELECT 1 FROM cash_movements initial_movement
             WHERE initial_movement.cash_account_id = ca.id
               AND initial_movement.business_date <= ?
           )
         GROUP BY ca.id, ca.tenant_id
         ON DUPLICATE KEY UPDATE
           status = IF(
             opening_balance <=> VALUES(opening_balance)
             AND gross_sales_amount <=> VALUES(gross_sales_amount)
             AND cancelled_sales_amount <=> VALUES(cancelled_sales_amount)
             AND net_sales_amount <=> VALUES(net_sales_amount)
             AND generated_prizes_amount <=> VALUES(generated_prizes_amount)
             AND paid_prizes_amount <=> VALUES(paid_prizes_amount)
             AND manual_credits_amount <=> VALUES(manual_credits_amount)
             AND manual_debits_amount <=> VALUES(manual_debits_amount)
             AND closing_balance <=> VALUES(closing_balance),
             status, 'RECALCULATED'),
           calculation_version = calculation_version + IF(
             opening_balance <=> VALUES(opening_balance)
             AND gross_sales_amount <=> VALUES(gross_sales_amount)
             AND cancelled_sales_amount <=> VALUES(cancelled_sales_amount)
             AND net_sales_amount <=> VALUES(net_sales_amount)
             AND generated_prizes_amount <=> VALUES(generated_prizes_amount)
             AND paid_prizes_amount <=> VALUES(paid_prizes_amount)
             AND manual_credits_amount <=> VALUES(manual_credits_amount)
             AND manual_debits_amount <=> VALUES(manual_debits_amount)
             AND closing_balance <=> VALUES(closing_balance), 0, 1),
           opening_balance = VALUES(opening_balance),
           gross_sales_amount = VALUES(gross_sales_amount),
           cancelled_sales_amount = VALUES(cancelled_sales_amount),
           net_sales_amount = VALUES(net_sales_amount),
           generated_prizes_amount = VALUES(generated_prizes_amount),
           paid_prizes_amount = VALUES(paid_prizes_amount),
           manual_credits_amount = VALUES(manual_credits_amount),
           manual_debits_amount = VALUES(manual_debits_amount),
           closing_balance = VALUES(closing_balance),
           calculated_at = UTC_TIMESTAMP(6),
           closed_at = COALESCE(closed_at, UTC_TIMESTAMP(6))`,
        Array(14).fill(businessDate),
      );
      const [rows] = await pool.execute(
        'SELECT COUNT(*) AS total FROM tenant_daily_summaries WHERE business_date = ?',
        [businessDate],
      );
      return Number(rows[0].total);
    },

    async obtenerSiguienteFechaCorte(maximumBusinessDate) {
      const [rows] = await pool.execute(
        `SELECT DATE_FORMAT(MIN(pending.next_date), '%Y-%m-%d') AS businessDate
         FROM (
           SELECT ca.tenant_id,
                  COALESCE(
                    DATE_ADD(MAX(tds.business_date), INTERVAL 1 DAY),
                    MIN(cm.business_date)
                  ) AS next_date
           FROM cash_accounts ca
           JOIN cash_movements cm
             ON cm.cash_account_id = ca.id AND cm.tenant_id = ca.tenant_id
           LEFT JOIN tenant_daily_summaries tds ON tds.tenant_id = ca.tenant_id
           WHERE ca.initialized_at IS NOT NULL
           GROUP BY ca.tenant_id
         ) pending
         WHERE pending.next_date <= ?`,
        [maximumBusinessDate],
      );
      return rows[0]?.businessDate ?? null;
    },
  };
}
