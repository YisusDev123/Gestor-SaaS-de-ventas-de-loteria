import crypto from 'node:crypto';

export class CursorError extends Error {
  constructor() {
    super('El cursor de paginación no es válido.');
    this.name = 'CursorError';
    this.code = 'INVALID_CURSOR';
  }
}

export function createCursorCodec(secret) {
  if (typeof secret !== 'string' || Buffer.byteLength(secret, 'utf8') < 32) {
    throw new TypeError('El secreto del cursor debe contener al menos 32 bytes.');
  }

  function signature(payload) {
    return crypto.createHmac('sha256', secret).update(`cursor:v1:${payload}`).digest('base64url');
  }

  function encode(data) {
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw new CursorError();
    const payload = Buffer.from(JSON.stringify({ version: 1, data }), 'utf8').toString('base64url');
    return `${payload}.${signature(payload)}`;
  }

  function decode(cursor) {
    if (typeof cursor !== 'string' || cursor.length > 1024) throw new CursorError();
    const [payload, providedSignature, extra] = cursor.split('.');
    if (!payload || !providedSignature || extra !== undefined) throw new CursorError();
    const expected = Buffer.from(signature(payload), 'utf8');
    const provided = Buffer.from(providedSignature, 'utf8');
    if (expected.length !== provided.length || !crypto.timingSafeEqual(expected, provided)) {
      throw new CursorError();
    }
    try {
      const decoded = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
      if (decoded?.version !== 1
        || !decoded.data
        || typeof decoded.data !== 'object'
        || Array.isArray(decoded.data)) {
        throw new CursorError();
      }
      return decoded.data;
    } catch (error) {
      if (error instanceof CursorError) throw error;
      throw new CursorError();
    }
  }

  return Object.freeze({ encode, decode });
}

export function parseUtcCursorDate(value) {
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) throw new CursorError();
    return value;
  }
  if (typeof value !== 'string') throw new CursorError();
  const mysqlUtc = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(?:\.\d{1,6})?$/.test(value)
    ? `${value.replace(' ', 'T')}Z`
    : value;
  const date = new Date(mysqlUtc);
  if (Number.isNaN(date.getTime())) throw new CursorError();
  return date;
}

// MySQL DATETIME se entrega como texto UTC (el pool usa dateStrings=true).
// Los contratos HTTP deben exponer siempre un instante ISO inequívoco.
export function serializeUtcDate(value) {
  return parseUtcCursorDate(value).toISOString();
}
