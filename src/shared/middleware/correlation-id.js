import crypto from 'node:crypto';

const SAFE_CORRELATION_ID = /^[A-Za-z0-9._:-]{1,80}$/;

export function correlationId(req, res, next) {
  const candidate = req.get('X-Correlation-Id');
  const value = candidate && SAFE_CORRELATION_ID.test(candidate)
    ? candidate
    : crypto.randomUUID();
  req.correlationId = value;
  res.set('X-Correlation-Id', value);
  next();
}
