import crypto from 'node:crypto';

const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const CANONICAL_PATTERN = /^[0-9A-HJKMNP-TV-Z]{16}$/;

export function generateTicketCode(randomBytes = crypto.randomBytes) {
  const bytes = randomBytes(10);
  if (!Buffer.isBuffer(bytes) || bytes.length !== 10) {
    throw new TypeError('La fuente aleatoria debe devolver exactamente 10 bytes.');
  }
  let value = 0n;
  for (const byte of bytes) value = (value << 8n) | BigInt(byte);

  let code = '';
  for (let index = 0; index < 16; index += 1) {
    code = ALPHABET[Number(value & 31n)] + code;
    value >>= 5n;
  }
  return code;
}

export function formatTicketCode(canonicalCode) {
  const code = normalizeTicketCode(canonicalCode);
  return `T-${code.match(/.{4}/g).join('-')}`;
}

export function normalizeTicketCode(input) {
  if (typeof input !== 'string') throw new TypeError('El código debe ser texto.');
  const upper = input.trim().toUpperCase();
  const withoutPrefix = upper.startsWith('T-') ? upper.slice(2) : upper;
  const compact = withoutPrefix.replaceAll('-', '')
    .replaceAll('O', '0')
    .replace(/[IL]/g, '1');
  if (!CANONICAL_PATTERN.test(compact)) {
    const error = new Error('El código de ticket no es válido.');
    error.code = 'INVALID_TICKET_CODE';
    throw error;
  }
  return compact;
}
