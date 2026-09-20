const BUSINESS_TIME_ZONE = 'America/Costa_Rica';
const COSTA_RICA_OFFSET = '-06:00';
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const TIME_PATTERN = /^(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/;

const businessDateFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: BUSINESS_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

function assertBusinessDate(value) {
  if (!DATE_PATTERN.test(value)) throw new RangeError('Fecha de negocio inválida.');
  const [year, month, day] = value.split('-').map(Number);
  const candidate = new Date(Date.UTC(year, month - 1, day));
  if (candidate.getUTCFullYear() !== year
    || candidate.getUTCMonth() !== month - 1
    || candidate.getUTCDate() !== day) {
    throw new RangeError('Fecha de negocio inválida.');
  }
}

export function getCostaRicaBusinessDate(instant = new Date()) {
  if (!(instant instanceof Date) || Number.isNaN(instant.getTime())) {
    throw new TypeError('Se requiere una fecha válida.');
  }
  const parts = Object.fromEntries(
    businessDateFormatter.formatToParts(instant)
      .filter((part) => part.type !== 'literal')
      .map((part) => [part.type, part.value]),
  );
  return `${parts.year}-${parts.month}-${parts.day}`;
}

export function getIsoWeekday(businessDate) {
  assertBusinessDate(businessDate);
  const day = new Date(`${businessDate}T00:00:00Z`).getUTCDay();
  return day === 0 ? 7 : day;
}

export function shiftBusinessDate(businessDate, days) {
  assertBusinessDate(businessDate);
  if (!Number.isInteger(days)) throw new TypeError('El desplazamiento debe ser entero.');
  const date = new Date(`${businessDate}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function createCostaRicaDrawTimes(businessDate, localTime, closeMinutes = 10) {
  assertBusinessDate(businessDate);
  if (typeof localTime !== 'string' || !TIME_PATTERN.test(localTime)) {
    throw new RangeError('Hora local inválida.');
  }
  if (!Number.isInteger(closeMinutes) || closeMinutes < 10 || closeMinutes > 20) {
    throw new RangeError('El cierre debe estar entre 10 y 20 minutos.');
  }
  const canonicalTime = localTime.length === 5 ? `${localTime}:00` : localTime;
  const scheduledAtUtc = new Date(`${businessDate}T${canonicalTime}${COSTA_RICA_OFFSET}`);
  if (Number.isNaN(scheduledAtUtc.getTime())) throw new RangeError('Horario de sorteo inválido.');
  const closesAtUtc = new Date(scheduledAtUtc.getTime() - (closeMinutes * 60_000));
  return Object.freeze({ scheduledAtUtc, closesAtUtc, closeMinutes });
}

export { BUSINESS_TIME_ZONE };
