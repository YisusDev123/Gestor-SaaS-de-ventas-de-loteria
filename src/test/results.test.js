import { jest } from '@jest/globals';

import * as service from '../modules/results/results-services.js';

describe('service funcional de resultados y premios', () => {
  test('exige doble campo coincidente antes de publicar', async () => {
    const database = { publicarResultadoTransaccional: jest.fn() };
    await expect(service.publicarResultado(database, '10', '20', 'draw', {
      requestId: 'request', winningNumber: '01', confirmWinningNumber: '02',
      confirmed: true, sourceNote: 'Fuente oficial',
    })).rejects.toMatchObject({ code: 'RESULT_CONFIRMATION_MISMATCH', statusCode: 400 });
    expect(database.publicarResultadoTransaccional).not.toHaveBeenCalled();
  });

  test('publica el número canónico con fingerprint idempotente', async () => {
    const database = { publicarResultadoTransaccional: jest.fn().mockResolvedValue({ replay: false }) };
    await service.publicarResultado(database, '10', '20', 'draw', {
      requestId: 'request', winningNumber: '07', confirmWinningNumber: '07',
      confirmed: true, sourceNote: 'Fuente oficial',
    }, 'correlation');
    expect(database.publicarResultadoTransaccional).toHaveBeenCalledWith(
      '10', '20', 'draw', expect.objectContaining({
        winningNumber: 7, payloadFingerprint: expect.any(Buffer), correlationId: 'correlation',
      }),
    );
  });

  test('corrige conservando motivo y fuente en el contrato', async () => {
    const database = { corregirResultadoTransaccional: jest.fn().mockResolvedValue({ replay: false }) };
    await service.corregirResultado(database, '10', '20', 'draw', {
      requestId: 'request', winningNumber: '08', confirmWinningNumber: '08', confirmed: true,
      reason: 'Resultado anterior incorrecto', sourceNote: 'Acta corregida',
    }, 'correlation');
    expect(database.corregirResultadoTransaccional).toHaveBeenCalledWith(
      '10', '20', 'draw', expect.objectContaining({ winningNumber: 8, payloadFingerprint: expect.any(Buffer) }),
    );
  });

  test('normaliza el ticket al consultar y pagar el premio', async () => {
    const database = {
      obtenerPremio: jest.fn().mockResolvedValue({ ticketCode: '0123456789ABCDEF' }),
      pagarPremioTransaccional: jest.fn().mockResolvedValue({
        ticketCode: '0123456789ABCDEF', prizeStatus: 'PAID', replay: false,
      }),
    };
    const prize = await service.obtenerPremio(database, '10', 'T-0123-4567-89AB-CDEF');
    expect(prize.ticketCode).toBe('T-0123-4567-89AB-CDEF');
    const paid = await service.pagarPremio(database, '10', '20', 'T-0123-4567-89AB-CDEF', {
      requestId: 'request', expectedPrizeAmount: '80', confirmed: true,
    }, 'correlation', new Date('2026-09-09T12:00:00Z'));
    expect(paid.ticketCode).toBe('T-0123-4567-89AB-CDEF');
    expect(database.pagarPremioTransaccional).toHaveBeenCalledWith(
      '10', '20', '0123456789ABCDEF', expect.objectContaining({
        expectedPrizeAmount: '80.00', businessDate: '2026-09-09',
        payloadFingerprint: expect.any(Buffer),
      }),
    );
  });

  test('presenta ausencias y códigos inválidos como errores públicos', async () => {
    const database = { obtenerResultado: jest.fn().mockResolvedValue(null), obtenerPremio: jest.fn().mockResolvedValue(null) };
    await expect(service.obtenerResultado(database, '10', 'draw'))
      .rejects.toMatchObject({ code: 'DRAW_NOT_FOUND', statusCode: 404 });
    await expect(service.obtenerPremio(database, '10', 'incorrecto'))
      .rejects.toMatchObject({ code: 'INVALID_TICKET_CODE', statusCode: 400 });
    await expect(service.obtenerPremio(database, '10', '0123456789ABCDEF'))
      .rejects.toMatchObject({ code: 'TICKET_NOT_FOUND', statusCode: 404 });
  });
});
