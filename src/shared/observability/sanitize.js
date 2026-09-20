const REDACTED = '[REDACTED]';
const SENSITIVE_KEY = /(authorization|cookie|password|passwd|secret|token|api.?key|document|bank|account.?number)/i;
const MAX_DEPTH = 6;
const MAX_STRING_LENGTH = 1000;

function sanitizeString(value) {
  return value
    .replace(/Bearer\s+[^\s]+/gi, 'Bearer [REDACTED]')
    .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, REDACTED)
    .slice(0, MAX_STRING_LENGTH);
}

function sanitizeValue(value, key, depth, seen) {
  if (SENSITIVE_KEY.test(key)) return REDACTED;
  if (value === null || value === undefined) return value;
  if (typeof value === 'string') return sanitizeString(value);
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (typeof value === 'bigint') return value.toString();
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? 'Invalid Date' : value.toISOString();
  if (value instanceof Error) {
    return {
      name: value.name,
      code: typeof value.code === 'string' ? value.code : undefined,
      operational: value.isOperational === true,
    };
  }
  if (typeof value !== 'object') return String(value);
  if (depth >= MAX_DEPTH) return '[MAX_DEPTH]';
  if (seen.has(value)) return '[CIRCULAR]';
  seen.add(value);

  if (Array.isArray(value)) {
    const result = value.slice(0, 50).map((item) => sanitizeValue(item, '', depth + 1, seen));
    seen.delete(value);
    return result;
  }

  const result = {};
  for (const [childKey, childValue] of Object.entries(value).slice(0, 100)) {
    result[childKey] = sanitizeValue(childValue, childKey, depth + 1, seen);
  }
  seen.delete(value);
  return result;
}

export function sanitizeMetadata(metadata) {
  return sanitizeValue(metadata, '', 0, new WeakSet());
}
