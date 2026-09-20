import { jest } from '@jest/globals';

import { renderReceiptPdf } from '../modules/sales/sales-receipt-pdf.js';
import { createReceipt } from '../modules/sales/sales-receipt.js';
import * as service from '../modules/sales/sales-services.js';

const ticket = {
  id: '60', ticketCode: 'T-0123-4567-89AB-CDEF', status: 'VALID',
  sellerName: 'Puesto histórico', createdAt: '2026-09-09 15:00:00.000000',
  drawPublicId: '01J00000000000000000000000', businessDate: '2026-09-09',
  scheduledAt: '2026-09-09 18:00:00.000000', lotteryName: 'Tica',
  modalityName: 'Normal', totalAmount: '10.00',
  receiptFields: { informationalText: 'Gracias por su compra' },
  items: [{ number: '01', amount: '10.00', multiplier: '80.00', potentialPrizeAmount: '800.00' }],
};

describe('ciclo de vida y comprobante de ventas', () => {
  test('reconstruye el comprobante únicamente desde snapshots históricos', () => {
    const receipt = createReceipt(ticket);
    expect(receipt).toMatchObject({
      sellerName: 'Puesto histórico', ticketCode: 'T-0123-4567-89AB-CDEF',
      issuedAt: '2026-09-09T15:00:00.000Z',
      draw: { lotteryName: 'Tica', scheduledAt: '2026-09-09T18:00:00.000Z' },
      printLayouts: ['58mm', '80mm', 'letter'],
    });
    expect(Object.isFrozen(receipt)).toBe(true);
  });

  test.each(['58mm', '80mm', 'letter'])('genera PDF %s bajo demanda', async (paper) => {
    const pdf = await renderReceiptPdf(createReceipt(ticket), paper);
    expect(pdf.subarray(0, 4).toString()).toBe('%PDF');
    expect(pdf.length).toBeGreaterThan(500);
  });

  test('normaliza y formatea una cancelación idempotente', async () => {
    const database = { cancelarTicketTransaccional: jest.fn().mockResolvedValue({
      ticketCode: '0123456789ABCDEF', status: 'CANCELLED', replay: false,
    }) };
    const result = await service.cancelarTicket(
      database, '10', '20', 'T-0123-4567-89AB-CDEF',
      { requestId: 'cancel-1', reason: 'Error de digitación' }, 'correlation',
    );
    expect(database.cancelarTicketTransaccional).toHaveBeenCalledWith(
      '10', '20', '0123456789ABCDEF', expect.objectContaining({
        payloadFingerprint: expect.any(Buffer), correlationId: 'correlation',
      }),
    );
    expect(result.ticketCode).toBe('T-0123-4567-89AB-CDEF');
  });

  test('ordena las jugadas y formatea ambos códigos al corregir', async () => {
    const database = { corregirTicketTransaccional: jest.fn().mockResolvedValue({
      originalTicketCode: '0123456789ABCDEF', originalStatus: 'REPLACED',
      replacement: { id: '61', ticketCode: '0123456789ABCDEG', totalAmount: '3.00' },
      replay: false,
    }) };
    const result = await service.corregirTicket(
      database, '10', '20', '0123456789ABCDEF', {
        requestId: 'correct-1', reason: 'Números incorrectos',
        items: [{ number: '09', amount: '2' }, { number: '01', amount: '1' }],
      }, 'correlation',
    );
    expect(database.corregirTicketTransaccional).toHaveBeenCalledWith(
      '10', '20', '0123456789ABCDEF', expect.objectContaining({
        items: [{ number: '01', amount: '1.00' }, { number: '09', amount: '2.00' }],
        totalAmount: '3.00', ticketCodeCandidates: expect.any(Array),
      }),
    );
    expect(result).toMatchObject({
      originalTicketCode: 'T-0123-4567-89AB-CDEF',
      replacement: { ticketCode: 'T-0123-4567-89AB-CDEG' },
    });
  });

  test('presenta el código inválido como error público también al mutar', async () => {
    const database = { cancelarTicketTransaccional: jest.fn(), corregirTicketTransaccional: jest.fn() };
    await expect(service.cancelarTicket(database, '10', '20', 'incorrecto', {
      requestId: 'cancel', reason: 'Motivo válido',
    })).rejects.toMatchObject({ code: 'INVALID_TICKET_CODE', statusCode: 400 });
    await expect(service.corregirTicket(database, '10', '20', 'incorrecto', {
      requestId: 'correct', reason: 'Motivo válido', items: [{ number: '01', amount: '1.00' }],
    })).rejects.toMatchObject({ code: 'INVALID_TICKET_CODE', statusCode: 400 });
  });
});
