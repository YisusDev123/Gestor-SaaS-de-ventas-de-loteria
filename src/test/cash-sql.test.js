import { createHash } from 'node:crypto';
import { jest } from '@jest/globals';

import { iniciarBaseDeDatosCash } from '../shared/database/cash-sql.js';

function transactionPool(responses) {
  const connection = {
    execute: jest.fn(),
    beginTransaction: jest.fn().mockResolvedValue(),
    commit: jest.fn().mockResolvedValue(),
    rollback: jest.fn().mockResolvedValue(),
    release: jest.fn(),
    destroy: jest.fn(),
  };
  responses.forEach((response) => connection.execute.mockResolvedValueOnce(response));
  return { pool: { getConnection: jest.fn().mockResolvedValue(connection) }, connection };
}

function input(overrides = {}) {
  return {
    requestId: 'e7bf6e15-b995-4fb0-897c-71d9c39f6df2',
    amount: '100.00', businessDate: '2026-09-08',
    payloadFingerprint: createHash('sha256').update('payload').digest(),
    correlationId: 'correlation',
    ...overrides,
  };
}

describe('adaptador SQL de caja', () => {
  test('inicializa cuenta, ledger, auditoría e idempotencia en una transacción', async () => {
    const { pool, connection } = transactionPool([
      [[{ id: '30' }]], [[]], [{ affectedRows: 1 }],
      [[{ id: '40', initializedAt: null }]], [{ insertId: '50' }],
      [{ affectedRows: 1 }], [{ insertId: '60' }], [{ insertId: '70' }],
      [{ affectedRows: 1 }],
    ]);
    const result = await iniciarBaseDeDatosCash(pool)
      .inicializarCajaTransaccional('10', '20', input());
    expect(result).toMatchObject({
      replay: false,
      cash: { initialized: true, balance: '100.00' },
      movement: { id: '60', movementType: 'INITIAL', direction: 'CREDIT' },
    });
    expect(connection.execute).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO cash_movements'),
      expect.arrayContaining(['10', '40', '2026-09-08', '100.00']),
    );
    expect(connection.commit).toHaveBeenCalledTimes(1);
  });

  test('revierte un débito que produciría saldo negativo', async () => {
    const { pool, connection } = transactionPool([
      [[{ id: '30' }]], [[]], [[{ id: '40', initializedAt: new Date() }]],
      [{ insertId: '50' }], [{ affectedRows: 0 }],
    ]);
    const promise = iniciarBaseDeDatosCash(pool).registrarMovimientoTransaccional(
      '10', '20', input({
        movementType: 'WITHDRAWAL', direction: 'DEBIT', signedAmount: '-100.00',
        reason: 'Retiro operativo',
      }),
    );
    await expect(promise).rejects.toMatchObject({ code: 'INSUFFICIENT_CASH_BALANCE' });
    expect(connection.rollback).toHaveBeenCalledTimes(1);
    expect(connection.commit).not.toHaveBeenCalled();
  });

  test('un replay idempotente devuelve el snapshot sin duplicar movimiento', async () => {
    const data = input();
    const snapshot = { cash: { balance: '100.00' }, movement: { id: '60' } };
    const { pool, connection } = transactionPool([
      [[{ id: '30' }]], [[{
        id: '50', payloadFingerprint: data.payloadFingerprint,
        status: 'COMPLETED', response: snapshot,
      }]],
    ]);
    await expect(iniciarBaseDeDatosCash(pool).inicializarCajaTransaccional(
      '10', '20', data,
    )).resolves.toEqual({ ...snapshot, replay: true });
    expect(connection.execute).toHaveBeenCalledTimes(2);
  });

  test('el corte diario se calcula como una sola sentencia por fecha', async () => {
    const pool = {
      execute: jest.fn()
        .mockResolvedValueOnce([{ affectedRows: 2 }])
        .mockResolvedValueOnce([[{ total: 2 }]]),
    };
    await expect(iniciarBaseDeDatosCash(pool).cerrarResumenDiario('2026-09-07'))
      .resolves.toBe(2);
    expect(pool.execute.mock.calls[0][0]).toContain('tenant_daily_summaries');
    expect(pool.execute.mock.calls[0][1]).toEqual(Array(14).fill('2026-09-07'));
  });
});
