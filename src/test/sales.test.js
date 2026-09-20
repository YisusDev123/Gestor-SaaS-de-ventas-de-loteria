import { jest } from '@jest/globals';

import * as service from '../modules/sales/sales-services.js';

describe('service funcional de ventas', () => {
  test('normaliza, ordena y suma el ticket sin punto flotante', async () => {
    const database = { crearTicketTransaccional: jest.fn().mockResolvedValue({
      ticket: { ticketCode: '0123456789ABCDEF', totalAmount: '0.30' }, replay: false,
    }) };
    const result = await service.crearTicket(database, '10', '20', {
      requestId: 'request', drawPublicId: '01J00000000000000000000000',
      items: [{ number: '09', amount: '0.2' }, { number: '01', amount: '0.1' }],
    }, 'correlation');
    expect(database.crearTicketTransaccional).toHaveBeenCalledWith(
      '10', '20', expect.objectContaining({
        totalAmount: '0.30',
        items: [{ number: '01', amount: '0.10' }, { number: '09', amount: '0.20' }],
        payloadFingerprint: expect.any(Buffer),
      }),
    );
    expect(result.ticket.ticketCode).toBe('T-0123-4567-89AB-CDEF');
  });

  test('normaliza el código visible para una búsqueda exacta', async () => {
    const database = { obtenerTicket: jest.fn().mockResolvedValue({
      ticketCode: '0123456789ABCDEF', items: [],
    }) };
    await service.obtenerTicket(database, '10', 'T-0123-4567-89AB-CDEF');
    expect(database.obtenerTicket).toHaveBeenCalledWith('10', '0123456789ABCDEF');
  });

  test('rechaza cursor adulterado antes de consultar SQL', async () => {
    const database = { listarTickets: jest.fn() };
    await expect(service.listarTickets(
      database, 'sales-cursor-secret-with-at-least-32-bytes', '10',
      { cursor: 'invalid.invalid', limit: 25 },
    )).rejects.toMatchObject({ code: 'INVALID_CURSOR' });
  });

  test('presenta ausencia de sorteo y código inválido como errores públicos', async () => {
    const database = { obtenerMatriz: jest.fn().mockResolvedValue(null), obtenerTicket: jest.fn() };
    await expect(service.obtenerMatriz(database, '10', 'missing'))
      .rejects.toMatchObject({ code: 'DRAW_NOT_FOUND', statusCode: 404 });
    await expect(service.obtenerTicket(database, '10', 'bad'))
      .rejects.toMatchObject({ code: 'INVALID_TICKET_CODE', statusCode: 400 });
  });

  test('pagina historial con cursor UTC firmado', async () => {
    const database = {
      listarTickets: jest.fn()
        .mockResolvedValueOnce([
          { id: '2', ticketCode: '0123456789ABCDEF', createdAt: '2026-09-09 12:00:00.000000' },
          { id: '1', ticketCode: '0123456789ABCDEG', createdAt: '2026-09-09 11:00:00.000000' },
        ])
        .mockResolvedValueOnce([]),
    };
    const secret = 'sales-cursor-secret-with-at-least-32-bytes';
    const first = await service.listarTickets(database, secret, '10', { limit: 1 });
    expect(first.nextCursor).toEqual(expect.any(String));
    await service.listarTickets(database, secret, '10', {
      limit: 1, cursor: first.nextCursor,
    });
    expect(database.listarTickets.mock.calls[1][2]).toMatchObject({
      id: '2', createdAt: new Date('2026-09-09T12:00:00.000Z'),
    });
  });
});
