const MONEY_SCALE = 2;
const MAX_MONEY_MINOR_UNITS = 999_999_999_999_999n;

export class DecimalValidationError extends Error {
  constructor(message, code = 'INVALID_DECIMAL') {
    super(message);
    this.name = 'DecimalValidationError';
    this.code = code;
  }
}

function parseScaledDecimal(value, {
  scale,
  maxIntegerDigits,
  allowNegative,
  allowZero,
  label,
}) {
  if (typeof value !== 'string') {
    throw new DecimalValidationError(`${label} debe recibirse como string decimal.`);
  }
  const normalized = value.trim();
  const signPattern = allowNegative ? '-?' : '';
  const pattern = new RegExp(`^${signPattern}(0|[1-9]\\d{0,${maxIntegerDigits - 1}})(?:\\.(\\d{1,${scale}}))?$`);
  const match = normalized.match(pattern);
  if (!match) {
    throw new DecimalValidationError(`${label} no tiene un formato decimal válido.`);
  }

  const negative = normalized.startsWith('-');
  const unsigned = negative ? normalized.slice(1) : normalized;
  const [integerPart, fractionalPart = ''] = unsigned.split('.');
  const units = (BigInt(integerPart) * (10n ** BigInt(scale)))
    + BigInt(fractionalPart.padEnd(scale, '0'));
  const signedUnits = negative ? -units : units;
  if (!allowZero && signedUnits === 0n) {
    throw new DecimalValidationError(`${label} debe ser mayor que cero.`, 'DECIMAL_MUST_BE_POSITIVE');
  }
  return signedUnits;
}

export function parseMoney(value, { allowNegative = false, allowZero = true } = {}) {
  const units = parseScaledDecimal(value, {
    scale: MONEY_SCALE,
    maxIntegerDigits: 13,
    allowNegative,
    allowZero,
    label: 'El monto',
  });
  if (units > MAX_MONEY_MINOR_UNITS || units < -MAX_MONEY_MINOR_UNITS) {
    throw new DecimalValidationError('El monto supera la capacidad permitida.', 'DECIMAL_OUT_OF_RANGE');
  }
  return units;
}

export function formatMoney(units) {
  if (typeof units !== 'bigint') {
    throw new DecimalValidationError('Las unidades monetarias deben ser BigInt.');
  }
  if (units > MAX_MONEY_MINOR_UNITS || units < -MAX_MONEY_MINOR_UNITS) {
    throw new DecimalValidationError('El monto supera la capacidad permitida.', 'DECIMAL_OUT_OF_RANGE');
  }
  const negative = units < 0n;
  const absolute = negative ? -units : units;
  const integerPart = absolute / 100n;
  const fractionPart = String(absolute % 100n).padStart(2, '0');
  return `${negative ? '-' : ''}${integerPart}.${fractionPart}`;
}

export function addMoney(...values) {
  return formatMoney(values.reduce((total, value) => total + parseMoney(value, {
    allowNegative: true,
  }), 0n));
}

export function subtractMoney(left, right) {
  return formatMoney(parseMoney(left, { allowNegative: true })
    - parseMoney(right, { allowNegative: true }));
}

export function multiplyMoneyByMultiplier(amount, multiplier) {
  const moneyUnits = parseMoney(amount, { allowZero: false });
  const multiplierUnits = parseScaledDecimal(multiplier, {
    scale: 2,
    maxIntegerDigits: 10,
    allowNegative: false,
    allowZero: false,
    label: 'El multiplicador',
  });
  const rawProduct = moneyUnits * multiplierUnits;
  if (rawProduct % 100n !== 0n) {
    throw new DecimalValidationError(
      'El premio no puede representarse exactamente con dos decimales.',
      'INEXACT_MONEY_RESULT',
    );
  }
  return formatMoney(rawProduct / 100n);
}
