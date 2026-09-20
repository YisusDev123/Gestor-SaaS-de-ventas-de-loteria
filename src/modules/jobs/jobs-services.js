import { randomUUID } from 'node:crypto';

import {
  createCostaRicaDrawTimes,
  getCostaRicaBusinessDate,
  getIsoWeekday,
  shiftBusinessDate,
} from '../../shared/utils/costa-rica-time.js';
import { createPublicId } from '../../shared/utils/public-id.js';

const GENERATION_LOCK = 'saas-jps:jobs:generate-draws';
const CLOSING_LOCK = 'saas-jps:jobs:close-draws';
const CASH_CUTOFF_LOCK = 'saas-jps:jobs:cash-daily-cutoff';
const TENANT_BATCH_SIZE = 100;
const CLOSING_BATCH_SIZE = 200;

function safeErrorCode(error) {
  const code = String(error?.code || error?.name || 'JOB_ITEM_FAILED');
  return /^[A-Z0-9_]{1,80}$/.test(code) ? code : 'JOB_ITEM_FAILED';
}

function newRunKey(jobName, businessDate) {
  return `${jobName}:${businessDate}:${randomUUID()}`;
}

async function createConfiguredDraw(baseDeDatos, jobRunId, tenantId, businessDate,
  isoWeekday, schedule, generalLimit, now) {
  const times = createCostaRicaDrawTimes(
    businessDate, schedule.localTimeValue, Number(schedule.closeMinutesBefore),
  );
  if (times.closesAtUtc.getTime() <= now.getTime()) return { pastClosing: true };

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const result = await baseDeDatos.crearSorteoTransaccional(jobRunId, {
      tenantId,
      businessDate,
      isoWeekday,
      scheduleId: schedule.scheduleId,
      scheduleCode: schedule.scheduleCode,
      localTime: schedule.localTimeValue,
      scheduledAtUtc: times.scheduledAtUtc,
      closesAtUtc: times.closesAtUtc,
      closeMinutesBefore: Number(schedule.closeMinutesBefore),
      lotteryCode: schedule.lotteryCode,
      lotteryName: schedule.lotteryName,
      modalityCode: schedule.modalityCode,
      modalityName: schedule.modalityName,
      multiplier: schedule.multiplier,
      status: schedule.multiplier === null ? 'PENDING' : 'OPEN',
      generalNumberLimit: generalLimit.generalNumberLimit,
      lotteryConfigVersion: schedule.lotteryConfigVersion,
      modalityConfigVersion: schedule.modalityConfigVersion,
      scheduleConfigVersion: schedule.scheduleConfigVersion,
      limitConfigVersion: generalLimit.limitConfigVersion,
      publicId: createPublicId(),
    });
    if (!result.retryPublicId) return result;
  }
  const error = new Error('No fue posible asignar un identificador público al sorteo.');
  error.code = 'DRAW_PUBLIC_ID_COLLISION';
  throw error;
}

async function processTenant(baseDeDatos, jobRunId, tenantId, businessDate, isoWeekday, now) {
  const itemId = await baseDeDatos.iniciarItem(
    jobRunId, tenantId, `tenant:${tenantId}:date:${businessDate}`,
  );
  try {
    const configuration = await baseDeDatos.obtenerConfiguracionGeneracion(
      tenantId, isoWeekday,
    );
    if (configuration.counts.enabledLotteries === 0) {
      await baseDeDatos.finalizarItem(itemId, 'SKIPPED', 'NO_ENABLED_LOTTERIES');
      return { skipped: 1, code: 'NO_ENABLED_LOTTERIES' };
    }
    if (!configuration.generalLimit
      || configuration.counts.enabledModalities === 0
      || configuration.counts.enabledSchedules === 0) {
      await baseDeDatos.finalizarItem(itemId, 'SKIPPED', 'TENANT_DRAW_CONFIGURATION_INCOMPLETE');
      return { skipped: 1, incomplete: 1, code: 'TENANT_DRAW_CONFIGURATION_INCOMPLETE' };
    }
    if (configuration.schedules.length === 0) {
      await baseDeDatos.finalizarItem(itemId, 'COMPLETED');
      return { noSchedulesToday: 1 };
    }

    const summary = { created: 0, existing: 0, skipped: 0, pastClosing: 0 };
    for (const schedule of configuration.schedules) {
      const result = await createConfiguredDraw(
        baseDeDatos, jobRunId, tenantId, businessDate, isoWeekday,
        schedule, configuration.generalLimit, now,
      );
      if (result.created) summary.created += 1;
      else if (result.exists) summary.existing += 1;
      else if (result.pastClosing) summary.pastClosing += 1;
      else summary.skipped += 1;
    }
    await baseDeDatos.finalizarItem(itemId, 'COMPLETED');
    return summary;
  } catch (error) {
    await baseDeDatos.finalizarItem(itemId, 'FAILED', safeErrorCode(error));
    return { failed: 1, code: safeErrorCode(error) };
  }
}

function addSummary(target, addition) {
  for (const [key, value] of Object.entries(addition)) {
    if (typeof value === 'number') target[key] = (target[key] || 0) + value;
  }
}

export function iniciarJobsService(baseDeDatos, baseDeDatosCash) {
  async function generarSorteos({ now = new Date(), tenantId = null, trigger = 'SCHEDULED' } = {}) {
    const businessDate = getCostaRicaBusinessDate(now);
    const isoWeekday = getIsoWeekday(businessDate);
    return baseDeDatos.conAdvisoryLock(GENERATION_LOCK, async () => {
      const jobRunId = await baseDeDatos.iniciarEjecucion(
        'GENERATE_DRAWS', newRunKey(`GENERATE_DRAWS:${trigger}`, businessDate),
      );
      const summary = {
        businessDate, trigger, tenants: 0, created: 0, existing: 0,
        skipped: 0, incomplete: 0, pastClosing: 0, failed: 0, noSchedulesToday: 0,
      };
      try {
        let afterTenantId = '0';
        while (true) {
          const tenants = await baseDeDatos.listarTenantsElegibles(
            afterTenantId, TENANT_BATCH_SIZE, businessDate, tenantId,
          );
          if (tenants.length === 0) break;
          for (const tenant of tenants) {
            summary.tenants += 1;
            addSummary(summary, await processTenant(
              baseDeDatos, jobRunId, String(tenant.tenantId), businessDate, isoWeekday, now,
            ));
            afterTenantId = String(tenant.tenantId);
          }
          if (tenantId !== null || tenants.length < TENANT_BATCH_SIZE) break;
        }
        const status = summary.failed > 0 ? 'PARTIAL' : 'COMPLETED';
        await baseDeDatos.finalizarEjecucion(jobRunId, status, summary);
        return { jobRunId, status, ...summary };
      } catch (error) {
        await baseDeDatos.finalizarEjecucion(
          jobRunId, 'FAILED', summary, safeErrorCode(error),
        );
        throw error;
      }
    });
  }

  async function cerrarSorteos({ now = new Date(), trigger = 'SCHEDULED' } = {}) {
    const businessDate = getCostaRicaBusinessDate(now);
    return baseDeDatos.conAdvisoryLock(CLOSING_LOCK, async () => {
      const jobRunId = await baseDeDatos.iniciarEjecucion(
        'CLOSE_DRAWS', newRunKey(`CLOSE_DRAWS:${trigger}`, businessDate),
      );
      const summary = { businessDate, trigger, closed: 0 };
      try {
        while (true) {
          const closed = await baseDeDatos.cerrarSorteosVencidosTransaccional(
            jobRunId, CLOSING_BATCH_SIZE,
          );
          summary.closed += closed;
          if (closed < CLOSING_BATCH_SIZE) break;
        }
        await baseDeDatos.finalizarEjecucion(jobRunId, 'COMPLETED', summary);
        return { jobRunId, status: 'COMPLETED', ...summary };
      } catch (error) {
        await baseDeDatos.finalizarEjecucion(
          jobRunId, 'FAILED', summary, safeErrorCode(error),
        );
        throw error;
      }
    });
  }

  async function cerrarCajaDiaria({ now = new Date(), trigger = 'SCHEDULED' } = {}) {
    const currentBusinessDate = getCostaRicaBusinessDate(now);
    const businessDate = shiftBusinessDate(currentBusinessDate, -1);
    async function closeDate() {
      const jobRunId = await baseDeDatos.iniciarEjecucion(
        'CASH_DAILY_CUTOFF', newRunKey(`CASH_DAILY_CUTOFF:${trigger}`, businessDate),
      );
      const summary = { businessDate, trigger, tenants: 0 };
      try {
        summary.tenants = await baseDeDatosCash.cerrarResumenDiario(businessDate);
        await baseDeDatos.finalizarEjecucion(jobRunId, 'COMPLETED', summary);
        return { jobRunId, status: 'COMPLETED', ...summary };
      } catch (error) {
        await baseDeDatos.finalizarEjecucion(
          jobRunId, 'FAILED', summary, safeErrorCode(error),
        );
        throw error;
      }
    }
    return baseDeDatos.conAdvisoryLock(CASH_CUTOFF_LOCK, closeDate);
  }

  async function recuperarCortesCaja({ now = new Date() } = {}) {
    const maximumBusinessDate = shiftBusinessDate(getCostaRicaBusinessDate(now), -1);
    return baseDeDatos.conAdvisoryLock(CASH_CUTOFF_LOCK, async () => {
      const recovered = { days: 0, tenants: 0, throughBusinessDate: maximumBusinessDate };
      let businessDate = await baseDeDatosCash.obtenerSiguienteFechaCorte(maximumBusinessDate);
      while (businessDate) {
        recovered.tenants += await baseDeDatosCash.cerrarResumenDiario(businessDate);
        recovered.days += 1;
        businessDate = await baseDeDatosCash.obtenerSiguienteFechaCorte(maximumBusinessDate);
      }
      return recovered;
    });
  }

  return Object.freeze({
    recuperarEjecucionesAbandonadas: () => baseDeDatos.recuperarEjecucionesAbandonadas(),
    generarSorteosDelDia: (options) => generarSorteos(options),
    generarSorteosParaTenant: (tenantId, options = {}) => generarSorteos({
      ...options, tenantId, trigger: options.trigger || 'TENANT_RECOVERY',
    }),
    cerrarSorteosVencidos: (options) => cerrarSorteos(options),
    cerrarCajaDiaria: (options) => cerrarCajaDiaria(options),
    recuperarCortesCaja: (options) => recuperarCortesCaja(options),
  });
}
