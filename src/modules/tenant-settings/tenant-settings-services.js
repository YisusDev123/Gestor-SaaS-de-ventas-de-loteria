import { AppError } from '../../shared/error/app-error.js';
import { formatMoney, parseMoney } from '../../shared/utils/money.js';
import { solicitarRecuperacionTenant } from '../jobs/jobs-recovery.js';

function parseJsonObject(value) {
  if (!value) return {};
  if (typeof value === 'object') return value;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function booleanValue(value) {
  return Number(value) === 1 || value === true;
}

function normalizeMultiplier(value) {
  const normalized = String(value).trim();
  if (!/^(?:0\.(?:0[1-9]|[1-9]\d?)|[1-9]\d{0,9}(?:\.\d{1,2})?)$/.test(normalized)) {
    throw new AppError('El multiplicador debe ser positivo y tener máximo dos decimales.', {
      statusCode: 400,
      code: 'INVALID_MULTIPLIER',
    });
  }
  const [integer, fraction = ''] = normalized.split('.');
  return `${BigInt(integer)}.${fraction.padEnd(2, '0')}`;
}

function mapCatalog(rows) {
  const lotteries = new Map();
  for (const row of rows) {
    let lottery = lotteries.get(row.lotteryCode);
    if (!lottery) {
      lottery = {
        code: row.lotteryCode,
        name: row.lotteryName,
        catalogActive: booleanValue(row.lotteryCatalogActive),
        enabled: booleanValue(row.lotteryEnabled),
        configVersion: Number(row.lotteryConfigVersion),
        modalities: [],
      };
      lotteries.set(row.lotteryCode, lottery);
    }
    if (!row.modalityCode) continue;
    let modality = lottery.modalities.find((item) => item.code === row.modalityCode);
    if (!modality) {
      modality = {
        code: row.modalityCode,
        name: row.modalityName,
        catalogActive: booleanValue(row.modalityCatalogActive),
        enabled: booleanValue(row.modalityEnabled),
        multiplier: row.multiplier ?? null,
        configVersion: Number(row.modalityConfigVersion),
        schedules: [],
      };
      lottery.modalities.push(modality);
    }
    if (!row.scheduleCode) continue;
    modality.schedules.push({
      code: row.scheduleCode,
      localTime: row.localTimeValue,
      weekdays: row.weekdays ? String(row.weekdays).split(',').map(Number) : [],
      catalogActive: booleanValue(row.scheduleCatalogActive),
      enabled: booleanValue(row.scheduleEnabled),
      closeMinutesBefore: Number(row.closeMinutesBefore),
      defaultCloseMinutesBefore: Number(row.defaultCloseMinutesBefore),
      configVersion: Number(row.scheduleConfigVersion),
    });
  }
  return [...lotteries.values()];
}

export async function obtenerConfiguracion(baseDeDatos, tenantId) {
  const result = await baseDeDatos.obtenerCatalogoConfigurado(tenantId);
  if (!result.business) {
    throw new AppError('La configuración del tenant no está disponible.', {
      statusCode: 404,
      code: 'TENANT_SETTINGS_NOT_FOUND',
    });
  }
  return {
    business: {
      displayName: result.business.displayName,
      timezone: result.business.timezone,
      currencyCode: result.business.currencyCode,
      receiptFields: parseJsonObject(result.business.receiptFields),
      configVersion: Number(result.business.businessConfigVersion),
    },
    generalLimit: {
      amount: result.business.generalNumberLimit ?? null,
      configVersion: Number(result.business.limitConfigVersion),
    },
    lotteries: mapCatalog(result.rows),
  };
}

export async function obtenerDisponibilidadDiaria(baseDeDatos, tenantId, businessDate) {
  const rows = await baseDeDatos.obtenerDisponibilidadDiaria(tenantId, businessDate);
  return {
    businessDate,
    lotteries: rows.map((row) => ({
      code: row.lotteryCode,
      name: row.lotteryName,
      permanentlyEnabled: booleanValue(row.permanentlyEnabled),
      enabledForSales: booleanValue(row.enabledForSales),
      configVersion: Number(row.configVersion),
      reason: row.reason,
      changedAt: row.changedAt,
    })),
  };
}

export async function actualizarNegocio(baseDeDatos, tenantId, userId, input, correlationId) {
  return baseDeDatos.actualizarNegocioTransaccional(
    tenantId, userId, input, correlationId,
  );
}

export async function actualizarLoteria(
  baseDeDatos, tenantId, userId, lotteryCode, input, correlationId, jobsService = null,
) {
  const result = await baseDeDatos.actualizarLoteriaTransaccional(
    tenantId, userId, lotteryCode, input, correlationId,
  );
  if (!input.isEnabled) return result;
  return { ...result, ...await solicitarRecuperacionTenant(
    jobsService, tenantId, 'LOTTERY_ENABLED',
  ) };
}

export async function actualizarModalidad(
  baseDeDatos, tenantId, userId, codes, input, correlationId, jobsService = null,
) {
  const result = await baseDeDatos.actualizarModalidadTransaccional(
    tenantId,
    userId,
    codes,
    { ...input, multiplier: normalizeMultiplier(input.multiplier) },
    correlationId,
  );
  if (!input.isEnabled) return result;
  return { ...result, ...await solicitarRecuperacionTenant(
    jobsService, tenantId, 'MODALITY_ENABLED',
  ) };
}

export async function actualizarHorario(
  baseDeDatos, tenantId, userId, codes, input, correlationId, jobsService = null,
) {
  const result = await baseDeDatos.actualizarHorarioTransaccional(
    tenantId, userId, codes, input, correlationId,
  );
  if (!input.isEnabled) return result;
  return { ...result, ...await solicitarRecuperacionTenant(
    jobsService, tenantId, 'SCHEDULE_ENABLED',
  ) };
}

export async function actualizarLimiteGeneral(
  baseDeDatos, tenantId, userId, input, correlationId, jobsService = null,
) {
  const generalNumberLimit = formatMoney(parseMoney(input.generalNumberLimit));
  const result = await baseDeDatos.actualizarLimiteGeneralTransaccional(
    tenantId, userId, { ...input, generalNumberLimit }, correlationId,
  );
  return { ...result, ...await solicitarRecuperacionTenant(
    jobsService, tenantId, 'GENERAL_LIMIT_UPDATED',
  ) };
}

export async function actualizarDisponibilidadDiaria(
  baseDeDatos, tenantId, userId, lotteryCode, input, correlationId,
) {
  return baseDeDatos.actualizarDisponibilidadDiariaTransaccional(
    tenantId, userId, lotteryCode, input, correlationId,
  );
}
