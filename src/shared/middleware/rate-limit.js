import { createHash } from 'node:crypto';

import rateLimit, { ipKeyGenerator } from 'express-rate-limit';

import config from '../../../config.js';
import { pool } from '../../config/pool.js';
import { createMySqlRateLimitStore } from './mysql-rate-limit-store.js';

function claveIp(req) {
  return `ip:${ipKeyGenerator(req.ip)}`;
}

export function claveIdentidad(req) {
  const email = req.validated?.body?.email ?? req.body?.email;
  if (typeof email !== 'string' || email.trim() === '') return claveIp(req);
  const hash = createHash('sha256').update(email.trim().toLowerCase()).digest('hex');
  return `identity:${hash}`;
}

function claveAdmin(req) {
  return req.adminId ? `admin:${String(req.adminId)}` : claveIp(req);
}

export function crearLimiter(limit, {
  keyGenerator = claveIp,
  skipSuccessfulRequests = false,
  environment = config.app.environment,
  name = 'default',
  windowMs = 15 * 60_000,
} = {}) {
  return rateLimit({
    windowMs,
    limit: environment === 'test' ? 1000 : limit,
    keyGenerator,
    skipSuccessfulRequests,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    ...(config.app.environment === 'production'
      ? { store: createMySqlRateLimitStore(pool, name, windowMs) } : {}),
    handler(req, res) {
      return res.status(429).json({
        success: false,
        error: {
          code: 'RATE_LIMITED',
          message: 'Has realizado demasiadas solicitudes. Intenta nuevamente más tarde.',
        },
        correlationId: req.correlationId,
      });
    },
  });
}

export const userLoginIpLimiter = crearLimiter(30, { name: 'user-login-ip', skipSuccessfulRequests: true });
export const userLoginIdentityLimiter = crearLimiter(10, {
  name: 'user-login-identity',
  keyGenerator: claveIdentidad,
  skipSuccessfulRequests: true,
});
export const passwordResetIpLimiter = crearLimiter(20, { name: 'password-reset-ip' });
export const passwordResetIdentityLimiter = crearLimiter(5, {
  name: 'password-reset-identity',
  keyGenerator: claveIdentidad,
});
export const saasAdminLoginIpLimiter = crearLimiter(15, { name: 'admin-login-ip', skipSuccessfulRequests: true });
export const saasAdminLoginIdentityLimiter = crearLimiter(5, {
  name: 'admin-login-identity',
  keyGenerator: claveIdentidad,
  skipSuccessfulRequests: true,
});
export const saasAdminOperationLimiter = crearLimiter(120, { name: 'admin-operation', keyGenerator: claveAdmin });
export const sessionLimiter = crearLimiter(60, { name: 'session' });
