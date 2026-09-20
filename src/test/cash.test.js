import { jest } from '@jest/globals';

import * as service from '../modules/cash/cash-services.js';

describe('service funcional de caja', () => {
  test('expone saldo y conciliación sin alterar la caja', async () => {
    const database = {
      obtenerEstadoCaja: jest.fn().mockResolvedValue({
        currentBalance: '125.50', ledgerBalance: '125.50',
        initializedAt: new Date('2026-09-08T12:00:00Z'),
      }),
    };
    await expect(service.obtenerCaja(database, '10')).resolves.toMatchObject({
      initialized: true,
      balance: '125.50',
      reconciliation: { ledgerBalance: '125.50', isBalanced: true },
    });
  });

  test('normaliza la inicialización y deriva la fecha de Costa Rica', async () => {
    const database = { inicializarCajaTransaccional: jest.fn().mockResolvedValue({}) };
    await service.inicializarCaja(
      database, '10', '20', { requestId: 'request', amount: '10.5' }, 'correlation',
      new Date('2026-09-08T05:59:00Z'),
    );
    expect(database.inicializarCajaTransaccional).toHaveBeenCalledWith(
      '10', '20', expect.objectContaining({
        requestId: 'request', amount: '10.50', businessDate: '2026-09-07',
        payloadFingerprint: expect.any(Buffer), correlationId: 'correlation',
      }),
    );
  });

  test('convierte egresos en débito y conserva montos DECIMAL', async () => {
    const database = { registrarMovimientoTransaccional: jest.fn().mockResolvedValue({}) };
    await service.registrarMovimiento(database, '10', '20', {
      requestId: 'request', movementType: 'EXPENSE', amount: '9.9', reason: 'Insumos',
    }, 'correlation', new Date('2026-09-08T12:00:00Z'));
    expect(database.registrarMovimientoTransaccional).toHaveBeenCalledWith(
      '10', '20', expect.objectContaining({
        movementType: 'EXPENSE', direction: 'DEBIT', amount: '9.90',
        signedAmount: '-9.90', businessDate: '2026-09-08',
      }),
    );
  });

  test('rechaza un cursor firmado cuyo contenido no cumple el contrato', async () => {
    const database = { listarMovimientos: jest.fn() };
    await expect(service.listarMovimientos(
      database, 'cursor-secret-with-at-least-thirty-two-bytes', '10',
      { cursor: 'invalid.invalid', limit: 25 },
    )).rejects.toMatchObject({ code: 'INVALID_CURSOR', statusCode: 400 });
    expect(database.listarMovimientos).not.toHaveBeenCalled();
  });
});
