import { jest } from '@jest/globals';

import * as service from '../modules/tenant-settings/tenant-settings-services.js';
import { requireRoles } from '../shared/middleware/role-middleware.js';

describe('configuración funcional del tenant', () => {
  test('construye el catálogo anidado desde datos extensibles', async () => {
    const database = {
      obtenerCatalogoConfigurado: jest.fn().mockResolvedValue({
        business: {
          displayName: 'Puesto Uno', timezone: 'America/Costa_Rica', currencyCode: 'CRC',
          receiptFields: '{"informationalText":"Gracias"}', businessConfigVersion: '2',
          generalNumberLimit: '10000.00', limitConfigVersion: '3',
        },
        rows: [{
          lotteryCode: 'FUTURA', lotteryName: 'Futura', lotteryCatalogActive: 1,
          lotteryEnabled: 1, lotteryConfigVersion: '4', modalityCode: 'DOS_CIFRAS',
          modalityName: 'Dos cifras', modalityCatalogActive: 1, modalityEnabled: 1,
          multiplier: '80.00', modalityConfigVersion: '5', scheduleCode: '1230',
          localTimeValue: '12:30', weekdays: '1,3,5', scheduleCatalogActive: 1,
          scheduleEnabled: 1, closeMinutesBefore: 12, defaultCloseMinutesBefore: 10,
          scheduleConfigVersion: '6',
        }],
      }),
    };

    const result = await service.obtenerConfiguracion(database, 'tenant-1');

    expect(result.business.receiptFields).toEqual({ informationalText: 'Gracias' });
    expect(result.lotteries[0]).toMatchObject({
      code: 'FUTURA', enabled: true,
      modalities: [{
        code: 'DOS_CIFRAS', multiplier: '80.00',
        schedules: [{ code: '1230', weekdays: [1, 3, 5], closeMinutesBefore: 12 }],
      }],
    });
  });

  test('normaliza multiplicador y dinero sin punto flotante', async () => {
    const database = {
      actualizarModalidadTransaccional: jest.fn().mockResolvedValue({ ok: true }),
      actualizarLimiteGeneralTransaccional: jest.fn().mockResolvedValue({ ok: true }),
    };
    await service.actualizarModalidad(
      database, '10', '20', { lotteryCode: 'TICA', modalityCode: 'NORMAL' },
      { isEnabled: true, multiplier: '80.5', confirmed: true, expectedVersion: 0 }, 'c-1',
    );
    await service.actualizarLimiteGeneral(
      database, '10', '20',
      { generalNumberLimit: '5000', applyToOpenDraws: false, expectedVersion: 0 }, 'c-2',
    );
    expect(database.actualizarModalidadTransaccional).toHaveBeenCalledWith(
      '10', '20', expect.any(Object), expect.objectContaining({ multiplier: '80.50' }), 'c-1',
    );
    expect(database.actualizarLimiteGeneralTransaccional).toHaveBeenCalledWith(
      '10', '20', expect.objectContaining({ generalNumberLimit: '5000.00' }), 'c-2',
    );
  });

  test('habilitar una regla dispara recuperación del tenant sin acoplarse al scheduler', async () => {
    const database = {
      actualizarLoteriaTransaccional: jest.fn().mockResolvedValue({
        lotteryCode: 'NICA', isEnabled: true, configVersion: 1,
      }),
    };
    const jobsService = {
      generarSorteosParaTenant: jest.fn().mockResolvedValue({
        acquired: true,
        result: { status: 'COMPLETED', created: 1, existing: 0, skipped: 0, incomplete: 0 },
      }),
    };
    const result = await service.actualizarLoteria(
      database, '10', '20', 'NICA', { isEnabled: true, expectedVersion: 0 },
      'correlation', jobsService,
    );
    expect(jobsService.generarSorteosParaTenant).toHaveBeenCalledWith(
      '10', { trigger: 'LOTTERY_ENABLED' },
    );
    expect(result.drawRecovery).toMatchObject({ status: 'COMPLETED', created: 1 });
  });

  test('resuelve disponibilidad diaria sin confundir ausencia con false', async () => {
    const database = {
      obtenerDisponibilidadDiaria: jest.fn().mockResolvedValue([{
        lotteryCode: 'NICA', lotteryName: 'Nica', permanentlyEnabled: 1,
        enabledForSales: 0, configVersion: 2, reason: 'Pausa operativa',
        changedAt: '2026-09-08 12:00:00.000000',
      }]),
    };
    await expect(service.obtenerDisponibilidadDiaria(database, '1', '2026-09-08'))
      .resolves.toMatchObject({
        businessDate: '2026-09-08',
        lotteries: [{ code: 'NICA', permanentlyEnabled: true, enabledForSales: false }],
      });
  });
});

describe('autorización de configuración', () => {
  test('permite OWNER y rechaza SELLER', () => {
    const nextOwner = jest.fn();
    requireRoles('OWNER', 'MANAGER')({ role: 'OWNER' }, {}, nextOwner);
    expect(nextOwner).toHaveBeenCalledWith();

    const nextSeller = jest.fn();
    requireRoles('OWNER', 'MANAGER')({ role: 'SELLER' }, {}, nextSeller);
    expect(nextSeller.mock.calls[0][0]).toMatchObject({
      statusCode: 403, code: 'INSUFFICIENT_ROLE',
    });
  });
});
