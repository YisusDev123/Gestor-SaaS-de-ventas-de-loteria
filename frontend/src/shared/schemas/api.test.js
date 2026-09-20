import { describe, expect, test } from 'vitest';

import { cashStateSchema, receiptSchema, saleCreationSchema } from './api.js';

describe('schemas de respuestas críticas', () => {
  test('acepta una caja conciliada con montos decimales como strings', () => {
    expect(cashStateSchema.parse({ initialized: true, balance: '100.00', initializedAt: '2026-09-09T12:00:00.000Z', reconciliation: { ledgerBalance: '100.00', isBalanced: true } }).balance).toBe('100.00');
  });

  test('rechaza montos numéricos para evitar punto flotante', () => {
    expect(() => cashStateSchema.parse({ initialized: true, balance: 100, initializedAt: null, reconciliation: { ledgerBalance: '100.00', isBalanced: true } })).toThrow();
  });

  test('valida el contrato mínimo de una venta confirmada', () => {
    expect(saleCreationSchema.parse({ ticket: { ticketCode: 'T-0123-4567-89AB-CDEF', totalAmount: '25.00' }, replay: false }).replay).toBe(false);
  });

  test('valida un comprobante reconstruido desde snapshots', () => {
    const receipt = receiptSchema.parse({ sellerName: 'Puesto', ticketCode: 'T-0123-4567-89AB-CDEF', status: 'VALID', issuedAt: '2026-09-09T12:00:00.000Z', timezone: 'America/Costa_Rica', currencyCode: 'CRC', draw: { publicId: '01J00000000000000000000000', businessDate: '2026-09-09', scheduledAt: '2026-09-09T18:00:00.000Z', lotteryName: 'NICA', modalityName: 'Normal' }, items: [{ number: '07', amount: '25.00', multiplier: '80.00', potentialPrizeAmount: '2000.00' }], totalAmount: '25.00', prize: { status: 'PENDING_RESULT', winningNumber: null, isWinner: null, amount: '0.00', paidAt: null }, informationalFields: { informationalText: 'Gracias' }, printLayouts: ['58mm', '80mm', 'letter'] });
    expect(receipt.items[0].number).toBe('07');
  });
});
