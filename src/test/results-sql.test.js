import { createHash } from 'node:crypto';
import { jest } from '@jest/globals';

import { iniciarBaseDeDatosResults } from '../shared/database/results-sql.js';

function transactionPool(handler) {
  const connection = {
    execute: jest.fn(handler), beginTransaction: jest.fn(), commit: jest.fn(),
    rollback: jest.fn(), release: jest.fn(),
  };
  return { pool: { getConnection: jest.fn().mockResolvedValue(connection) }, connection };
}

function operationInput(overrides = {}) {
  return {
    requestId: 'request', winningNumber: 7, sourceNote: 'Fuente oficial',
    payloadFingerprint: createHash('sha256').update('result').digest(),
    correlationId: 'correlation', reason: 'Corrección necesaria',
    ...overrides,
  };
}

describe('adaptador SQL de resultados y premios', () => {
  test('publica y evalúa todos los tickets sin tocar caja', async () => {
    const handler = async (sql) => {
      if (sql.includes('FROM tenant_memberships')) return [[{ id: '1' }]];
      if (sql.includes('FROM operation_requests')) return [[]];
      if (sql.includes('FROM draws WHERE')) return [[{ id: '30', status: 'CLOSED', currentResultId: null }]];
      if (sql.includes('INSERT INTO operation_requests')) return [{ insertId: '40' }];
      if (sql.includes('INSERT INTO draw_result_versions')) return [{ insertId: '50' }];
      if (sql.includes('COUNT(*) AS evaluatedTicketCount')) return [[{
        evaluatedTicketCount: '2', winningTicketCount: '1', totalPrizeAmount: '800.00',
      }]];
      return [{ affectedRows: 2, insertId: '60' }];
    };
    const { pool, connection } = transactionPool(handler);
    await expect(iniciarBaseDeDatosResults(pool).publicarResultadoTransaccional(
      '10', '20', 'draw', operationInput(),
    )).resolves.toMatchObject({
      status: 'RESULTED', winningNumber: '07', evaluatedTicketCount: 2,
      winningTicketCount: 1, totalPrizeAmount: '800.00', replay: false,
    });
    expect(connection.execute).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO ticket_prize_evaluations'), expect.any(Array),
    );
    expect(connection.execute.mock.calls.some(([sql]) => sql.includes('cash_'))).toBe(false);
    expect(connection.commit).toHaveBeenCalledTimes(1);
  });

  test('corrige creando una nueva versión y nuevas evaluaciones sin mover caja', async () => {
    const handler = async (sql) => {
      if (sql.includes('FROM tenant_memberships')) return [[{ id: '1' }]];
      if (sql.includes('FROM operation_requests')) return [[]];
      if (sql.includes('FROM draws d')) return [[{
        id: '30', status: 'RESULTED', currentResultId: '50',
        currentVersionNumber: '1', currentWinningNumber: 7,
      }]];
      if (sql.includes('FROM prize_payments')) return [[]];
      if (sql.includes('INSERT INTO operation_requests')) return [{ insertId: '40' }];
      if (sql.includes('INSERT INTO draw_result_versions')) return [{ insertId: '51' }];
      if (sql.includes('COUNT(*) AS evaluatedTicketCount')) return [[{
        evaluatedTicketCount: '2', winningTicketCount: '1', totalPrizeAmount: '400.00',
      }]];
      return [{ affectedRows: 2, insertId: '60' }];
    };
    const { pool, connection } = transactionPool(handler);
    await expect(iniciarBaseDeDatosResults(pool).corregirResultadoTransaccional(
      '10', '20', 'draw', operationInput({ winningNumber: 8 }),
    )).resolves.toMatchObject({
      previousResultVersionId: '50', resultVersionId: '51', versionNumber: 2,
      winningNumber: '08', totalPrizeAmount: '400.00', replay: false,
    });
    expect(connection.execute.mock.calls.some(([sql]) => sql.includes('cash_'))).toBe(false);
    expect(connection.commit).toHaveBeenCalledTimes(1);
  });

  test('impide corregir después de cualquier pago', async () => {
    const { pool, connection } = transactionPool(async (sql) => {
      if (sql.includes('FROM tenant_memberships')) return [[{ id: '1' }]];
      if (sql.includes('FROM operation_requests')) return [[]];
      if (sql.includes('FROM draws d')) return [[{
        id: '30', status: 'RESULTED', currentResultId: '50',
        currentVersionNumber: '1', currentWinningNumber: 7,
      }]];
      if (sql.includes('FROM prize_payments')) return [[{ id: '70' }]];
      return [[]];
    });
    await expect(iniciarBaseDeDatosResults(pool).corregirResultadoTransaccional(
      '10', '20', 'draw', operationInput({ winningNumber: 8 }),
    )).rejects.toMatchObject({ code: 'RESULT_HAS_PAID_PRIZES' });
    expect(connection.rollback).toHaveBeenCalledTimes(1);
  });

  test('paga una vez, debita caja y registra ledger idempotente', async () => {
    const handler = async (sql) => {
      if (sql.includes('FROM tenant_memberships')) return [[{ id: '1' }]];
      if (sql.includes('FROM operation_requests')) return [[]];
      if (sql.startsWith('SELECT id,draw_id')) return [[{ id: '60', drawId: '30' }]];
      if (sql.includes('FROM draws WHERE')) return [[{ id: '30', status: 'RESULTED', currentResultId: '50' }]];
      if (sql.includes('FROM tickets t') && sql.includes('evaluationId')) return [[{
        ticketId: '60', ticketStatus: 'VALID', evaluationId: '70',
        isWinner: 1, prizeAmount: '80.00', paymentId: null,
      }]];
      if (sql.includes('FROM cash_accounts')) return [[{ id: '80', balance: '100.00' }]];
      if (sql.includes('INSERT INTO operation_requests')) return [{ insertId: '40' }];
      if (sql.includes('INSERT INTO prize_payments')) return [{ insertId: '90' }];
      if (sql.includes('INSERT INTO cash_movements')) return [{ insertId: '100' }];
      return [{ affectedRows: 1 }];
    };
    const { pool, connection } = transactionPool(handler);
    await expect(iniciarBaseDeDatosResults(pool).pagarPremioTransaccional(
      '10', '20', '0123456789ABCDEF', operationInput({
        expectedPrizeAmount: '80.00', businessDate: '2026-09-09',
      }),
    )).resolves.toMatchObject({
      ticketCode: '0123456789ABCDEF', prizeStatus: 'PAID', paymentId: '90',
      prizeAmount: '80.00', cashBalance: '20.00', replay: false,
    });
    expect(connection.execute).toHaveBeenCalledWith(
      expect.stringContaining("'PRIZE_PAYMENT','DEBIT'"), expect.any(Array),
    );
    expect(connection.commit).toHaveBeenCalledTimes(1);
  });

  test('resuelve detalle del resultado y estado del premio aislados por tenant', async () => {
    const pool = { execute: jest.fn() };
    const database = iniciarBaseDeDatosResults(pool);
    pool.execute.mockResolvedValueOnce([[{
      id: '30', drawPublicId: 'draw', status: 'RESULTED', currentVersionId: '50',
      currentVersionNumber: '1', winningNumber: '07',
    }]]).mockResolvedValueOnce([[
      { id: '50', versionNumber: '1', evaluatedTicketCount: '2', winningTicketCount: '1' },
    ]]);
    await expect(database.obtenerResultado('10', 'draw')).resolves.toMatchObject({
      current: { id: '50', versionNumber: 1, winningNumber: '07' },
      versions: [{ id: '50', evaluatedTicketCount: 2, winningTicketCount: 1 }],
    });
    pool.execute.mockResolvedValueOnce([[{
      ticketCode: '0123456789ABCDEF', isWinner: 1, prizeAmount: '80.00',
      prizeStatus: 'PENDING_PAYMENT', paymentId: null,
    }]]);
    await expect(database.obtenerPremio('10', '0123456789ABCDEF')).resolves.toMatchObject({
      isWinner: true, prizeStatus: 'PENDING_PAYMENT', paymentId: null,
    });
    pool.execute.mockResolvedValueOnce([[]]);
    await expect(database.obtenerResultado('10', 'missing')).resolves.toBeNull();
    pool.execute.mockResolvedValueOnce([[]]);
    await expect(database.obtenerPremio('10', 'missing')).resolves.toBeNull();
  });
});
