import { jest } from '@jest/globals';

import { iniciarBaseDeDatosReports } from '../shared/database/reports-sql.js';

describe('adaptador SQL de reportes', () => {
  test('obtiene dashboard con valores cero seguros y próximos cierres', async () => {
    const pool = { execute: jest.fn()
      .mockResolvedValueOnce([[{ currentBalance: '10.00', ledgerBalance: '10.00' }]])
      .mockResolvedValueOnce([[{ generatedPrizesAmount: '5.00', pendingPrizeCount: '1' }]])
      .mockResolvedValueOnce([[{ openExposureAmount: '20.00' }]])
      .mockResolvedValueOnce([[{ ticketCount: '2' }]])
      .mockResolvedValueOnce([[{ drawPublicId: 'draw' }]]) };
    await expect(iniciarBaseDeDatosReports(pool).obtenerDashboard('10', '2026-09-09'))
      .resolves.toMatchObject({
        currentBalance: '10.00', grossSalesAmount: '0.00', generatedPrizesAmount: '5.00',
        pendingPrizeCount: 1, openExposureAmount: '20.00', ticketCount: 2,
        upcomingDraws: [{ drawPublicId: 'draw' }],
      });
  });

  test('lista sorteos realizados y ganadores vigentes', async () => {
    const pool = { execute: jest.fn() };
    const database = iniciarBaseDeDatosReports(pool);
    pool.execute.mockResolvedValueOnce([[
      { id: '30', winningTicketCount: '2', createdAt: new Date() },
    ]]);
    await expect(database.listarSorteosRealizados('10', '2026-09-09', null, 26))
      .resolves.toMatchObject([{ id: '30', winningTicketCount: 2 }]);
    pool.execute.mockResolvedValueOnce([[{ id: '30', drawPublicId: 'draw' }]])
      .mockResolvedValueOnce([[{ id: '60', ticketCode: 'code' }]]);
    await expect(database.listarGanadores('10', 'draw', null, 26))
      .resolves.toMatchObject({ draw: { drawPublicId: 'draw' }, rows: [{ id: '60' }] });
    pool.execute.mockResolvedValueOnce([[]]);
    await expect(database.listarGanadores('10', 'missing', null, 26)).resolves.toBeNull();
  });

  test('deriva reporte diario y conserva versión del snapshot', async () => {
    const pool = { execute: jest.fn().mockResolvedValue([[
      { businessDate: '2026-09-09', snapshotVersion: '2' },
      { businessDate: '2026-09-10', snapshotVersion: null },
    ]]) };
    await expect(iniciarBaseDeDatosReports(pool).obtenerReporteDiario(
      '10', '2026-09-09', '2026-09-10',
    )).resolves.toEqual([
      { businessDate: '2026-09-09', snapshotVersion: 2 },
      { businessDate: '2026-09-10', snapshotVersion: null },
    ]);
  });

  test('concilia caja, tickets, posiciones, premios y pagos', async () => {
    const pool = { execute: jest.fn()
      .mockResolvedValueOnce([[{ cachedBalance: '10.00', ledgerBalance: '10.00', difference: '0.00' }]])
      .mockResolvedValueOnce([[{ differenceCount: '0' }]])
      .mockResolvedValueOnce([[{ differenceCount: '1' }]])
      .mockResolvedValueOnce([[{ differenceCount: '0' }]])
      .mockResolvedValueOnce([[{ differenceCount: '0' }]]) };
    await expect(iniciarBaseDeDatosReports(pool).obtenerConciliacion('10', '2026-09-09'))
      .resolves.toEqual({
        cash: { cachedBalance: '10.00', ledgerBalance: '10.00', difference: '0.00' },
        tickets: { differenceCount: 0 }, positions: { differenceCount: 1 },
        prizes: { differenceCount: 0 }, payments: { differenceCount: 0 },
      });
  });
});
