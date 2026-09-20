export function formatCrc(value) {
  const amount = Number(value ?? 0);
  return new Intl.NumberFormat('es-CR', {
    style: 'currency', currency: 'CRC', minimumFractionDigits: 2,
  }).format(Number.isFinite(amount) ? amount : 0);
}

export function formatCostaRicaDateTime(value) {
  if (!value) return '—';
  return new Intl.DateTimeFormat('es-CR', {
    timeZone: 'America/Costa_Rica', dateStyle: 'medium', timeStyle: 'short',
  }).format(new Date(value));
}

export function costaRicaBusinessDate(instant = new Date()) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Costa_Rica', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(instant).map((part) => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}
