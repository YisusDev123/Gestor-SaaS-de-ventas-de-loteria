import { jest } from '@jest/globals';

import { iniciarJobsScheduler } from '../modules/jobs/jobs-scheduler.js';
import { solicitarRecuperacionTenant } from '../modules/jobs/jobs-recovery.js';
import { iniciarJobsService } from '../modules/jobs/jobs-services.js';

function completeConfiguration(schedules) {
  return {
    generalLimit: { generalNumberLimit: '10000.00', limitConfigVersion: '1' },
    counts: { enabledLotteries: 1, enabledModalities: 1, enabledSchedules: 1 },
    schedules,
  };
}

function schedule(overrides = {}) {
  return {
    scheduleId: '8', scheduleCode: '1800', localTimeValue: '18:00:00',
    lotteryCode: 'NICA', lotteryName: 'Nica', modalityCode: 'NORMAL',
    modalityName: 'Normal', multiplier: '80.00', closeMinutesBefore: 10,
    lotteryConfigVersion: 1, modalityConfigVersion: 1, scheduleConfigVersion: 1,
    ...overrides,
  };
}

function database(overrides = {}) {
  return {
    conAdvisoryLock: jest.fn(async (_name, operation) => ({
      acquired: true, result: await operation(),
    })),
    iniciarEjecucion: jest.fn().mockResolvedValue('50'),
    finalizarEjecucion: jest.fn().mockResolvedValue(),
    listarTenantsElegibles: jest.fn()
      .mockResolvedValueOnce([{ tenantId: '10' }])
      .mockResolvedValueOnce([]),
    iniciarItem: jest.fn().mockResolvedValue('60'),
    finalizarItem: jest.fn().mockResolvedValue(),
    obtenerConfiguracionGeneracion: jest.fn().mockResolvedValue(
      completeConfiguration([schedule()]),
    ),
    crearSorteoTransaccional: jest.fn().mockResolvedValue({ created: true, drawId: '70' }),
    cerrarSorteosVencidosTransaccional: jest.fn().mockResolvedValue(0),
    recuperarEjecucionesAbandonadas: jest.fn().mockResolvedValue({ runs: 0, items: 0 }),
    ...overrides,
  };
}

describe('jobs funcionales de sorteos privados', () => {
  test('genera un sorteo OPEN con snapshots para el tenant elegible', async () => {
    const db = database();
    const result = await iniciarJobsService(db).generarSorteosDelDia({
      now: new Date('2026-09-08T12:00:00.000Z'),
    });

    expect(result.result).toMatchObject({ status: 'COMPLETED', created: 1, tenants: 1 });
    expect(db.crearSorteoTransaccional).toHaveBeenCalledWith(
      '50', expect.objectContaining({
        tenantId: '10', businessDate: '2026-09-08', isoWeekday: 2,
        lotteryCode: 'NICA', multiplier: '80.00', generalNumberLimit: '10000.00',
        status: 'OPEN',
        closeMinutesBefore: 10,
        scheduledAtUtc: new Date('2026-09-09T00:00:00.000Z'),
        closesAtUtc: new Date('2026-09-08T23:50:00.000Z'),
      }),
    );
  });

  test('genera PENDING cuando el vendedor todavía no definió el multiplicador', async () => {
    const db = database({
      obtenerConfiguracionGeneracion: jest.fn().mockResolvedValue(
        completeConfiguration([schedule({ multiplier: null })]),
      ),
    });
    const result = await iniciarJobsService(db).generarSorteosParaTenant('10', {
      now: new Date('2026-09-08T12:00:00.000Z'),
      trigger: 'TENANT_CREATED',
    });

    expect(result.result).toMatchObject({ status: 'COMPLETED', created: 1 });
    expect(db.crearSorteoTransaccional).toHaveBeenCalledWith(
      '50', expect.objectContaining({ multiplier: null, status: 'PENDING' }),
    );
  });

  test('omite configuración incompleta sin asumir reglas financieras', async () => {
    const db = database({
      obtenerConfiguracionGeneracion: jest.fn().mockResolvedValue({
        generalLimit: null,
        counts: { enabledLotteries: 1, enabledModalities: 0, enabledSchedules: 0 },
        schedules: [],
      }),
    });
    const result = await iniciarJobsService(db).generarSorteosDelDia({
      now: new Date('2026-09-08T12:00:00.000Z'),
    });
    expect(result.result.incomplete).toBe(1);
    expect(db.crearSorteoTransaccional).not.toHaveBeenCalled();
    expect(db.finalizarItem).toHaveBeenCalledWith(
      '60', 'SKIPPED', 'TENANT_DRAW_CONFIGURATION_INCOMPLETE',
    );
  });

  test('no genera después del cierre y no duplica si otro worker posee el lock', async () => {
    const lateDb = database();
    const late = await iniciarJobsService(lateDb).generarSorteosDelDia({
      now: new Date('2026-09-09T00:00:00.000Z'),
    });
    expect(late.result.pastClosing).toBe(1);
    expect(lateDb.crearSorteoTransaccional).not.toHaveBeenCalled();

    const lockedDb = database({
      conAdvisoryLock: jest.fn().mockResolvedValue({ acquired: false }),
    });
    await expect(iniciarJobsService(lockedDb).generarSorteosDelDia())
      .resolves.toEqual({ acquired: false });
    expect(lockedDb.iniciarEjecucion).not.toHaveBeenCalled();
  });

  test('cierra por lotes hasta agotar vencidos', async () => {
    const db = database({
      cerrarSorteosVencidosTransaccional: jest.fn()
        .mockResolvedValueOnce(200)
        .mockResolvedValueOnce(3),
    });
    const result = await iniciarJobsService(db).cerrarSorteosVencidos({
      now: new Date('2026-09-08T20:00:00.000Z'),
    });
    expect(result.result.closed).toBe(203);
    expect(db.cerrarSorteosVencidosTransaccional).toHaveBeenCalledTimes(2);
  });

  test('cierra la caja del día anterior sin reiniciar el saldo continuo', async () => {
    const db = database();
    const cashDb = { cerrarResumenDiario: jest.fn().mockResolvedValue(2) };
    const result = await iniciarJobsService(db, cashDb).cerrarCajaDiaria({
      now: new Date('2026-09-08T06:05:00.000Z'),
    });
    expect(result.result).toMatchObject({
      status: 'COMPLETED', businessDate: '2026-09-07', tenants: 2,
    });
    expect(cashDb.cerrarResumenDiario).toHaveBeenCalledWith('2026-09-07');
  });

  test('recupera en orden todos los cortes omitidos', async () => {
    const db = database();
    const cashDb = {
      obtenerSiguienteFechaCorte: jest.fn()
        .mockResolvedValueOnce('2026-09-06')
        .mockResolvedValueOnce('2026-09-07')
        .mockResolvedValueOnce(null),
      cerrarResumenDiario: jest.fn().mockResolvedValue(2),
    };
    const result = await iniciarJobsService(db, cashDb).recuperarCortesCaja({
      now: new Date('2026-09-08T12:00:00.000Z'),
    });
    expect(result.result).toEqual({
      days: 2, tenants: 4, throughBusinessDate: '2026-09-07',
    });
    expect(cashDb.cerrarResumenDiario.mock.calls).toEqual([
      ['2026-09-06'], ['2026-09-07'],
    ]);
  });
});

describe('scheduler central', () => {
  test('recupera al iniciar, programa medianoche y cierre cada minuto, y se detiene', async () => {
    const jobsService = {
      recuperarEjecucionesAbandonadas: jest.fn().mockResolvedValue(),
      generarSorteosDelDia: jest.fn().mockResolvedValue(),
      cerrarSorteosVencidos: jest.fn().mockResolvedValue(),
      cerrarCajaDiaria: jest.fn().mockResolvedValue(),
      recuperarCortesCaja: jest.fn().mockResolvedValue(),
    };
    const tasks = [];
    const cronClient = {
      schedule: jest.fn((expression, callback, options) => {
        const task = { expression, callback, options, stop: jest.fn() };
        tasks.push(task);
        return task;
      }),
    };
    const scheduler = iniciarJobsScheduler(
      jobsService, { error: jest.fn() }, cronClient,
    );

    await expect(scheduler.start()).resolves.toBe(true);
    expect(jobsService.recuperarEjecucionesAbandonadas).toHaveBeenCalledTimes(1);
    expect(cronClient.schedule.mock.calls.map((call) => call[0]))
      .toEqual(['0 0 * * *', '*/5 * * * *', '* * * * *', '5 0 * * *']);
    expect(cronClient.schedule.mock.calls[0][2]).toEqual({ timezone: 'America/Costa_Rica' });
    await tasks[2].callback();
    expect(jobsService.cerrarSorteosVencidos).toHaveBeenCalledTimes(2);
    await tasks[3].callback();
    expect(jobsService.cerrarCajaDiaria).toHaveBeenCalledTimes(1);
    expect(jobsService.recuperarCortesCaja).toHaveBeenCalledTimes(1);
    await scheduler.stop();
    expect(tasks.every((task) => task.stop.mock.calls.length === 1)).toBe(true);
    expect(scheduler.isRunning()).toBe(false);
  });
});

describe('recuperación disparada por otros dominios', () => {
  test('expone resultado mínimo y deja pendiente una falla sin revertir la configuración guardada', async () => {
    const completed = {
      generarSorteosParaTenant: jest.fn().mockResolvedValue({
        acquired: true,
        result: { status: 'COMPLETED', created: 2, existing: 1, skipped: 0, incomplete: 0 },
      }),
    };
    await expect(solicitarRecuperacionTenant(completed, '10', 'SCHEDULE_ENABLED'))
      .resolves.toEqual({
        drawRecovery: {
          status: 'COMPLETED', created: 2, existing: 1, skipped: 0, incomplete: 0,
        },
      });
    expect(completed.generarSorteosParaTenant).toHaveBeenCalledWith(
      '10', { trigger: 'SCHEDULE_ENABLED' },
    );

    const failed = { generarSorteosParaTenant: jest.fn().mockRejectedValue(new Error('private')) };
    await expect(solicitarRecuperacionTenant(failed, '10', 'GENERAL_LIMIT_UPDATED'))
      .resolves.toEqual({ drawRecovery: { status: 'PENDING' } });
  });
});
