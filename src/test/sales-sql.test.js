import { createHash } from 'node:crypto';
import { jest } from '@jest/globals';

import { iniciarBaseDeDatosSales } from '../shared/database/sales-sql.js';

function transactionPool(handler) {
  const connection = {
    execute: jest.fn(handler), query: jest.fn().mockResolvedValue([{ affectedRows: 2 }]),
    beginTransaction: jest.fn(), commit: jest.fn(), rollback: jest.fn(), release: jest.fn(),
    destroy: jest.fn(),
  };
  return { pool: { getConnection: jest.fn().mockResolvedValue(connection) }, connection };
}

function saleInput(overrides = {}) {
  return {
    requestId: 'request', drawPublicId: '01J00000000000000000000000',
    items: [{ number: '01', amount: '10.00' }, { number: '02', amount: '20.00' }],
    totalAmount: '30.00', payloadFingerprint: createHash('sha256').update('x').digest(),
    ticketCodeCandidates: ['0123456789ABCDEF'], correlationId: 'correlation',
    ...overrides,
  };
}

function lifecycleInput(overrides = {}) {
  return {
    requestId: 'lifecycle-request', reason: 'Corrección solicitada',
    payloadFingerprint: createHash('sha256').update('lifecycle').digest(),
    correlationId: 'correlation', items: [{ number: '02', amount: '20.00' }],
    totalAmount: '20.00', ticketCodeCandidates: ['AAAAAAAAAAAAAAAA', 'BBBBBBBBBBBBBBBB'],
    ...overrides,
  };
}

describe('adaptador SQL de ventas', () => {
  test('confirma ticket, posiciones, sorteo y caja en una transacción', async () => {
    const handler = async (sql) => {
      if (sql.includes('FROM tenant_memberships')) return [[{ sellerName: 'Puesto', receiptFields: {} }]];
      if (sql.includes('FROM operation_requests')) return [[]];
      if (sql.includes('FROM draws d') && sql.includes('enabledForSales')) return [[{
        id: '30', businessDate: '2026-09-09', scheduledAt: '2026-09-10 00:00:00',
        closesAt: '2026-09-09 23:00:00', status: 'OPEN', beforeClose: 1,
        lotteryName: 'Tica', modalityName: 'Normal', multiplier: '80.00', enabledForSales: 1,
      }]];
      if (sql.includes('FROM draw_number_positions') && sql.includes('FOR UPDATE')) return [[
        { number: 1, effectiveLimit: '100.00', soldAmount: '0.00' },
        { number: 2, effectiveLimit: '100.00', soldAmount: '0.00' },
      ]];
      if (sql.includes('SELECT current_balance AS balance')) return [[{ balance: '40.00' }]];
      if (sql.includes('FROM cash_accounts')) return [[{
        id: '40', initializedAt: 'date', currentBalance: '10.00',
      }]];
      if (sql.includes('INSERT INTO operation_requests')) return [{ insertId: '50' }];
      if (sql.includes('INSERT INTO tickets')) return [{ insertId: '60' }];
      return [{ affectedRows: 1, insertId: '70' }];
    };
    const { pool, connection } = transactionPool(handler);
    await expect(iniciarBaseDeDatosSales(pool).crearTicketTransaccional(
      '10', '20', saleInput(),
    )).resolves.toMatchObject({
      replay: false, ticket: { id: '60', ticketCode: '0123456789ABCDEF' },
      cashBalance: '40.00',
    });
    expect(connection.query).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO ticket_items'), expect.any(Array),
    );
    expect(connection.commit).toHaveBeenCalledTimes(1);
  });

  test('un timeout durante commit queda incierto, destruye la conexión y no afirma rollback', async () => {
    const handler = async (sql) => {
      if (sql.includes('FROM tenant_memberships')) return [[{ sellerName: 'Puesto', receiptFields: {} }]];
      if (sql.includes('FROM operation_requests')) return [[]];
      if (sql.includes('FROM draws d') && sql.includes('enabledForSales')) return [[{
        id: '30', businessDate: '2026-09-09', scheduledAt: '2026-09-10 00:00:00',
        closesAt: '2026-09-09 23:00:00', status: 'OPEN', beforeClose: 1,
        lotteryName: 'Tica', modalityName: 'Normal', multiplier: '80.00', enabledForSales: 1,
      }]];
      if (sql.includes('FROM draw_number_positions') && sql.includes('FOR UPDATE')) return [[
        { number: 1, effectiveLimit: '100.00', soldAmount: '0.00' },
        { number: 2, effectiveLimit: '100.00', soldAmount: '0.00' },
      ]];
      if (sql.includes('SELECT current_balance AS balance')) return [[{ balance: '40.00' }]];
      if (sql.includes('FROM cash_accounts')) return [[{ id: '40', initializedAt: 'date', currentBalance: '10.00' }]];
      if (sql.includes('INSERT INTO operation_requests')) return [{ insertId: '50' }];
      if (sql.includes('INSERT INTO tickets')) return [{ insertId: '60' }];
      return [{ affectedRows: 1, insertId: '70' }];
    };
    const { pool, connection } = transactionPool(handler);
    connection.commit.mockRejectedValueOnce(Object.assign(new Error('socket timeout'), { code: 'ETIMEDOUT' }));

    await expect(iniciarBaseDeDatosSales(pool).crearTicketTransaccional(
      '10', '20', saleInput(),
    )).rejects.toMatchObject({ code: 'COMMIT_OUTCOME_UNKNOWN', statusCode: 503 });
    expect(connection.destroy).toHaveBeenCalledTimes(1);
    expect(connection.rollback).not.toHaveBeenCalled();
  });

  test('rechaza sobreventa y revierte sin crear ticket', async () => {
    const handler = async (sql) => {
      if (sql.includes('FROM tenant_memberships')) return [[{ sellerName: 'Puesto' }]];
      if (sql.includes('FROM operation_requests')) return [[]];
      if (sql.includes('FROM draws d')) return [[{
        id: '30', status: 'OPEN', beforeClose: 1, enabledForSales: 1, closesAt: 'future',
      }]];
      if (sql.includes('FROM draw_number_positions')) return [[
        { number: 1, effectiveLimit: '10.00', soldAmount: '5.00' },
        { number: 2, effectiveLimit: '100.00', soldAmount: '0.00' },
      ]];
      return [{ affectedRows: 1 }];
    };
    const { pool, connection } = transactionPool(handler);
    await expect(iniciarBaseDeDatosSales(pool).crearTicketTransaccional(
      '10', '20', saleInput(),
    )).rejects.toMatchObject({ code: 'NUMBER_LIMIT_EXCEEDED' });
    expect(connection.rollback).toHaveBeenCalledTimes(1);
  });

  test('rechaza premios que no sean exactos a dos decimales sin redondear', async () => {
    const handler = async (sql) => {
      if (sql.includes('FROM tenant_memberships')) return [[{ sellerName: 'Puesto', receiptFields: {} }]];
      if (sql.includes('FROM operation_requests')) return [[]];
      if (sql.includes('FROM draws d')) return [[{
        id: '30', businessDate: '2026-09-09', scheduledAt: '2026-09-10 00:00:00',
        status: 'OPEN', beforeClose: 1, enabledForSales: 1,
        lotteryName: 'Tica', modalityName: 'Normal', multiplier: '1.50',
      }]];
      if (sql.includes('FROM draw_number_positions')) return [[{
        number: 1, effectiveLimit: '100.00', soldAmount: '0.00',
      }]];
      if (sql.includes('FROM cash_accounts')) return [[{
        id: '40', initializedAt: 'date', currentBalance: '10.00',
      }]];
      if (sql.includes('INSERT INTO operation_requests')) return [{ insertId: '50' }];
      if (sql.includes('INSERT INTO tickets')) return [{ insertId: '60' }];
      return [{ affectedRows: 1 }];
    };
    const { pool, connection } = transactionPool(handler);
    await expect(iniciarBaseDeDatosSales(pool).crearTicketTransaccional(
      '10', '20', saleInput({
        items: [{ number: '01', amount: '0.01' }], totalAmount: '0.01',
      }),
    )).rejects.toMatchObject({ code: 'POTENTIAL_PRIZE_NOT_EXACT', statusCode: 422 });
    expect(connection.rollback).toHaveBeenCalledTimes(1);
  });

  test('devuelve replay y rechaza reutilización de clave con otro fingerprint', async () => {
    const data = saleInput();
    const snapshot = { ticket: { ticketCode: '0123456789ABCDEF' }, cashBalance: '10.00' };
    const run = async (fingerprint) => {
      const { pool } = transactionPool(async (sql) => {
        if (sql.includes('FROM tenant_memberships')) return [[{ sellerName: 'Puesto' }]];
        if (sql.includes('FROM operation_requests')) return [[{
          payloadFingerprint: fingerprint, status: 'COMPLETED', response: snapshot,
        }]];
        return [[]];
      });
      return iniciarBaseDeDatosSales(pool).crearTicketTransaccional('10', '20', data);
    };
    await expect(run(data.payloadFingerprint)).resolves.toEqual({ ...snapshot, replay: true });
    await expect(run(Buffer.alloc(32))).rejects.toMatchObject({ code: 'IDEMPOTENCY_KEY_REUSED' });
  });

  test.each([
    [{ status: 'CLOSED', beforeClose: 0, enabledForSales: 1 }, 'DRAW_CLOSED'],
    [{ status: 'OPEN', beforeClose: 1, enabledForSales: 0 }, 'LOTTERY_SALES_PAUSED'],
  ])('rechaza estados no vendibles', async (drawState, code) => {
    const { pool } = transactionPool(async (sql) => {
      if (sql.includes('FROM tenant_memberships')) return [[{ sellerName: 'Puesto' }]];
      if (sql.includes('FROM operation_requests')) return [[]];
      if (sql.includes('FROM draws d')) return [[{ id: '30', ...drawState }]];
      return [[]];
    });
    await expect(iniciarBaseDeDatosSales(pool).crearTicketTransaccional(
      '10', '20', saleInput(),
    )).rejects.toMatchObject({ code });
  });

  test('actualiza disponibilidad restante y audita', async () => {
    let positionReads = 0;
    const handler = async (sql) => {
      if (sql.includes('FROM tenant_memberships')) return [[{ role: 'OWNER' }]];
      if (sql.includes('FROM draws WHERE')) return [[{ id: '30', status: 'OPEN' }]];
      if (sql.includes('FROM draw_number_positions')) {
        positionReads += 1;
        if (positionReads === 1) return [[{ baseLimit: '100.00', effectiveLimit: '100.00', soldAmount: '20.00' }]];
        return [[{ effectiveLimit: '25.00', soldAmount: '20.00', remainingAmount: '5.00' }]];
      }
      return [{ affectedRows: 1 }];
    };
    const { pool } = transactionPool(handler);
    await expect(iniciarBaseDeDatosSales(pool).actualizarLimiteTransaccional('10', '20', {
      drawPublicId: 'draw', number: 2, remainingAmount: '5.00',
      expectedEffectiveLimit: '100.00', correlationId: 'correlation',
    })).resolves.toMatchObject({ number: '02', effectiveLimit: '25.00' });
  });

  test('resuelve lecturas de venta, Lista, historial y detalle aisladas por tenant', async () => {
    const draw = {
      id: '30', drawPublicId: 'draw', businessDate: '2026-09-09', scheduledAt: new Date(),
      closesAt: new Date(), status: 'OPEN', lotteryCode: 'TICA', lotteryName: 'Tica',
      modalityCode: 'NORMAL', modalityName: 'Normal', multiplier: '80.00',
      totalSoldAmount: '10.00', validTicketCount: '1', createdAt: new Date(),
    };
    const position = { drawId: '30', number: '01', soldAmount: '10.00', effectiveLimit: '100.00', remainingAmount: '90.00', validTicketCount: '1' };
    const pool = { execute: jest.fn() };
    const db = iniciarBaseDeDatosSales(pool);
    pool.execute.mockResolvedValueOnce([[draw]]).mockResolvedValueOnce([[{ lotteryCode: 'NICA', lotteryName: 'Nica' }]]);
    await expect(db.listarSorteosVenta('10', '2026-09-09')).resolves.toMatchObject({ draws: [{ validTicketCount: 1 }], warnings: [{ code: 'LOTTERY_RULES_INCOMPLETE' }] });
    pool.execute.mockResolvedValueOnce([[draw]]).mockResolvedValueOnce([[position]]);
    await expect(db.obtenerMatriz('10', 'draw')).resolves.toMatchObject({ numbers: [{ validTicketCount: 1 }] });
    pool.execute.mockResolvedValueOnce([[draw]]).mockResolvedValueOnce([[position]]);
    await expect(db.obtenerLista('10', { businessDate: '2026-09-09' }, null, 26)).resolves.toMatchObject([{ id: '30', numbers: [{ number: '01' }] }]);
    pool.execute.mockResolvedValueOnce([[{ ...draw, ticketCode: '0123456789ABCDEF', itemCount: '1' }]]);
    await expect(db.listarTickets('10', {}, null, 26)).resolves.toMatchObject([{ itemCount: 1 }]);
    pool.execute.mockResolvedValueOnce([[{ ...draw, ticketCode: '0123456789ABCDEF', receiptFields: '{}' }]]).mockResolvedValueOnce([[{ number: '01' }]]);
    await expect(db.obtenerTicket('10', '0123456789ABCDEF')).resolves.toMatchObject({ id: '30', items: [{ number: '01' }] });
    pool.execute.mockResolvedValueOnce([[]]);
    await expect(db.obtenerMatriz('10', 'missing')).resolves.toBeNull();
    pool.execute.mockResolvedValueOnce([[]]);
    await expect(db.obtenerLista('10', { businessDate: '2026-09-09' }, null, 26)).resolves.toEqual([]);
    pool.execute.mockResolvedValueOnce([[]]);
    await expect(db.obtenerTicket('10', 'missing')).resolves.toBeNull();
  });

  test('cancela una sola vez y revierte caja y acumulados dentro de la transacción', async () => {
    const handler = async (sql) => {
      if (sql.includes('FROM tenant_memberships')) return [[{ sellerName: 'Puesto', receiptFields: {} }]];
      if (sql.includes('FROM operation_requests')) return [[]];
      if (sql.includes('FROM tickets t JOIN draws')) return [[{
        id: '60', drawId: '30', status: 'VALID', totalAmount: '30.00',
        businessDate: '2026-09-09', drawStatus: 'OPEN', beforeClose: 1, resultId: null,
      }]];
      if (sql.includes('FROM ticket_items')) return [[
        { number: 1, amount: '10.00' }, { number: 2, amount: '20.00' },
      ]];
      if (sql.includes('SELECT id, current_balance AS balance')) return [[{ id: '40', balance: '50.00' }]];
      if (sql.includes('INSERT INTO operation_requests')) return [{ insertId: '50' }];
      if (sql.includes('INSERT INTO ticket_cancellations')) return [{ insertId: '70' }];
      return [{ affectedRows: 1, insertId: '80' }];
    };
    const { pool, connection } = transactionPool(handler);
    await expect(iniciarBaseDeDatosSales(pool).cancelarTicketTransaccional(
      '10', '20', '0123456789ABCDEF', lifecycleInput(),
    )).resolves.toMatchObject({
      status: 'CANCELLED', cancelledAmount: '30.00', cashBalance: '20.00', replay: false,
    });
    expect(connection.execute).toHaveBeenCalledWith(
      expect.stringContaining("movement_type, direction"), expect.arrayContaining(['30.00', '20.00']),
    );
    expect(connection.commit).toHaveBeenCalledTimes(1);
  });

  test('corrige de forma atómica y regenera el código cuando colisiona', async () => {
    let ticketInsertAttempts = 0;
    const handler = async (sql) => {
      if (sql.includes('FROM tenant_memberships')) return [[{
        sellerName: 'Puesto', receiptFields: { informationalText: 'Gracias' },
      }]];
      if (sql.includes('FROM operation_requests')) return [[]];
      if (sql.includes('FROM tickets t JOIN draws')) return [[{
        id: '60', drawId: '30', status: 'VALID', totalAmount: '10.00',
        businessDate: '2026-09-09', drawPublicId: 'draw', drawStatus: 'OPEN',
        beforeClose: 1, resultId: null, multiplier: '80.00', lotteryName: 'Tica',
        modalityName: 'Normal', scheduledAt: '2026-09-09 18:00:00',
      }]];
      if (sql.includes('FROM ticket_items')) return [[{ number: 1, amount: '10.00' }]];
      if (sql.includes('FROM draw_number_positions')) return [[
        { number: 1, soldAmount: '10.00', effectiveLimit: '100.00' },
        { number: 2, soldAmount: '0.00', effectiveLimit: '100.00' },
      ]];
      if (sql.includes('SELECT id, current_balance AS balance')) return [[{ id: '40', balance: '50.00' }]];
      if (sql.includes('INSERT INTO operation_requests')) return [{ insertId: '50' }];
      if (sql.includes('INSERT INTO tickets')) {
        ticketInsertAttempts += 1;
        if (ticketInsertAttempts === 1) throw Object.assign(new Error('duplicate'), { code: 'ER_DUP_ENTRY' });
        return [{ insertId: '61' }];
      }
      if (sql.includes('INSERT INTO ticket_replacements')) return [{ insertId: '71' }];
      return [{ affectedRows: 1, insertId: '70' }];
    };
    const { pool, connection } = transactionPool(handler);
    await expect(iniciarBaseDeDatosSales(pool).corregirTicketTransaccional(
      '10', '20', '0123456789ABCDEF', lifecycleInput(),
    )).resolves.toMatchObject({
      originalStatus: 'REPLACED', cashBalance: '60.00', replay: false,
      replacement: { id: '61', ticketCode: 'BBBBBBBBBBBBBBBB', totalAmount: '20.00' },
    });
    expect(ticketInsertAttempts).toBe(2);
    expect(connection.query).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO ticket_items'), expect.any(Array),
    );
    expect(connection.commit).toHaveBeenCalledTimes(1);
  });

  test('si no puede crear el reemplazo revierte y no invalida el original', async () => {
    const handler = async (sql) => {
      if (sql.includes('FROM tenant_memberships')) return [[{ sellerName: 'Puesto', receiptFields: {} }]];
      if (sql.includes('FROM operation_requests')) return [[]];
      if (sql.includes('FROM tickets t JOIN draws')) return [[{
        id: '60', drawId: '30', status: 'VALID', totalAmount: '10.00',
        businessDate: '2026-09-09', drawStatus: 'OPEN', beforeClose: 1,
        resultId: null, multiplier: '80.00', lotteryName: 'Tica',
      }]];
      if (sql.includes('FROM ticket_items')) return [[{ number: 1, amount: '10.00' }]];
      if (sql.includes('FROM draw_number_positions')) return [[
        { number: 1, soldAmount: '10.00', effectiveLimit: '100.00' },
        { number: 2, soldAmount: '0.00', effectiveLimit: '100.00' },
      ]];
      if (sql.includes('SELECT id, current_balance AS balance')) return [[{ id: '40', balance: '50.00' }]];
      if (sql.includes('INSERT INTO operation_requests')) return [{ insertId: '50' }];
      if (sql.includes('INSERT INTO tickets')) throw Object.assign(new Error('duplicate'), { code: 'ER_DUP_ENTRY' });
      return [{ affectedRows: 1 }];
    };
    const { pool, connection } = transactionPool(handler);
    await expect(iniciarBaseDeDatosSales(pool).corregirTicketTransaccional(
      '10', '20', '0123456789ABCDEF', lifecycleInput(),
    )).rejects.toMatchObject({ code: 'TICKET_CODE_COLLISION' });
    expect(connection.execute.mock.calls.some(([sql]) => sql.includes("SET status='REPLACED'"))).toBe(false);
    expect(connection.rollback).toHaveBeenCalledTimes(1);
  });
});
