import { jest } from '@jest/globals';

import { renderDailyReportPdf } from '../modules/reports/reports-pdf.js';
import * as service from '../modules/reports/reports-services.js';

const secret = 'reports-test-cursor-secret-at-least-32-bytes';
const day = {
  businessDate: '2026-09-09', grossSalesAmount: '100.00', cancelledSalesAmount: '10.00',
  netSalesAmount: '90.00', generatedPrizesAmount: '20.00', paidPrizesAmount: '5.00',
  expensesAmount: '3.00', adjustmentsNetAmount: '2.00', openingBalance: '50.00',
  closingBalance: '134.00', openExposureAmount: '30.00',
};

describe('service funcional de reportes', () => {
  test('arma dashboard separando caja, rentabilidad, premios y exposición', async () => {
    const database = { obtenerDashboard: jest.fn().mockResolvedValue({
      currentBalance: '50.00', ledgerBalance: '49.00', openingBalance: '10.00',
      grossSalesAmount: '100.00', cancelledSalesAmount: '10.00',
      generatedPrizesAmount: '20.00', paidPrizesAmount: '5.00', pendingPrizesAmount: '15.00',
      pendingPrizeCount: 1, openExposureAmount: '60.00', expensesAmount: '3.00',
      cashEntriesAmount: '1000.00', cashWithdrawalsAmount: '0.00',
      adjustmentCreditsAmount: '2.00', adjustmentDebitsAmount: '1.00',
      ticketCount: 2, upcomingDraws: [],
    }) };
    const result = await service.obtenerDashboard(database, '10', { businessDate: '2026-09-09' });
    expect(result).toMatchObject({
      sales: { netAmount: '90.00', ticketCount: 2 },
      cash: { isBalanced: false },
      result: { realizedAmount: '68.00', provisionalAmount: '8.00' },
      alerts: [
        { code: 'CASH_RECONCILIATION_DIFFERENCE' }, { code: 'PENDING_PRIZES' },
      ],
    });
  });

  test('pagina sorteos y ganadores mediante cursor firmado', async () => {
    const database = {
      listarSorteosRealizados: jest.fn().mockResolvedValue([
        { id: '2', createdAt: '2026-09-09 12:00:00.000000' },
        { id: '1', createdAt: '2026-09-09 11:00:00.000000' },
      ]),
      listarGanadores: jest.fn().mockResolvedValue({
        draw: { drawPublicId: 'draw' },
        rows: [{ id: '2', ticketCode: '0123456789ABCDEF', createdAt: '2026-09-09 12:00:00.000000' }],
      }),
    };
    const draws = await service.listarSorteosRealizados(database, secret, '10', {
      businessDate: '2026-09-09', limit: 1,
    });
    expect(draws.nextCursor).toEqual(expect.any(String));
    const winners = await service.listarGanadores(database, secret, '10', 'draw', { limit: 25 });
    expect(winners.items[0].ticketCode).toBe('T-0123-4567-89AB-CDEF');
    await service.listarSorteosRealizados(database, secret, '10', {
      businessDate: '2026-09-09', limit: 1, cursor: draws.nextCursor,
    });
    expect(database.listarSorteosRealizados.mock.calls[1][2]).toMatchObject({ id: '2' });
  });

  test('calcula resultados diarios, CSV seguro y PDF bajo demanda', async () => {
    const database = { obtenerReporteDiario: jest.fn().mockResolvedValue([day]) };
    const report = await service.obtenerReporteDiario(database, '10', {
      dateFrom: '2026-09-09', dateTo: '2026-09-09',
    });
    expect(report.days[0]).toMatchObject({
      realizedResultAmount: '69.00', provisionalResultAmount: '39.00',
    });
    database.obtenerReporteDiario.mockResolvedValueOnce([{ ...day, businessDate: '=2+2' }]);
    const csv = await service.exportarReporteCsv(database, '10', {
      dateFrom: '2026-09-09', dateTo: '2026-09-09',
    });
    expect(csv).toContain("\"'=2+2\"");
    const pdf = await renderDailyReportPdf(report);
    expect(pdf.subarray(0, 4).toString()).toBe('%PDF');
  });

  test('limita rangos, rechaza cursores y reporta conciliación', async () => {
    const database = { obtenerReporteDiario: jest.fn(), obtenerConciliacion: jest.fn().mockResolvedValue({
      cash: { difference: '0.00' }, tickets: { differenceCount: 0 },
      positions: { differenceCount: 0 }, prizes: { differenceCount: 0 },
      payments: { differenceCount: 0 },
    }), listarSorteosRealizados: jest.fn(), listarGanadores: jest.fn().mockResolvedValue(null) };
    await expect(service.exportarReporteCsv(database, '10', {
      dateFrom: '2026-01-01', dateTo: '2026-02-01',
    })).rejects.toMatchObject({ code: 'REPORT_RANGE_TOO_LARGE' });
    await expect(service.obtenerReporteDiario(database, '10', {
      dateFrom: '2026-09-10', dateTo: '2026-09-09',
    })).rejects.toMatchObject({ code: 'INVALID_DATE_RANGE' });
    await expect(service.listarSorteosRealizados(database, secret, '10', {
      limit: 25, cursor: 'invalid.invalid',
    })).rejects.toMatchObject({ code: 'INVALID_CURSOR' });
    await expect(service.listarGanadores(database, secret, '10', 'draw', { limit: 25 }))
      .rejects.toMatchObject({ code: 'RESULT_NOT_FOUND', statusCode: 404 });
    await expect(service.obtenerConciliacion(database, '10', { businessDate: '2026-09-09' }))
      .resolves.toMatchObject({ isBalanced: true });
  });
});
