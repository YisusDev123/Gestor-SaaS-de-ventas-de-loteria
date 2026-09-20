import { createHash, randomBytes, randomUUID } from 'node:crypto';

import jwt from 'jsonwebtoken';

import { AppError } from '../../shared/error/app-error.js';

const ISSUER = 'saas-jps-api';
const AUDIENCE = 'saas-jps-admin';

export function createSaasAdminTokenManager(runtimeConfig) {
  const { jwtSecret, accessTokenTtlSeconds, refreshTokenTtlDays } = runtimeConfig.security;

  function issueAccessToken(adminId, sessionId) {
    return jwt.sign({ sessionId: String(sessionId), scope: 'SAAS_ADMIN' }, jwtSecret, {
      algorithm: 'HS256',
      subject: String(adminId),
      issuer: ISSUER,
      audience: AUDIENCE,
      expiresIn: accessTokenTtlSeconds,
      jwtid: randomUUID(),
    });
  }

  function verifyAccessToken(token) {
    try {
      return jwt.verify(token, jwtSecret, {
        algorithms: ['HS256'], issuer: ISSUER, audience: AUDIENCE,
      });
    } catch {
      throw new AppError('La sesión administrativa no es válida o expiró.', {
        statusCode: 401,
        code: 'INVALID_ADMIN_ACCESS_TOKEN',
      });
    }
  }

  function createRefreshToken() {
    const raw = randomBytes(48).toString('base64url');
    return { raw, hash: hashAdminRefreshToken(raw) };
  }

  function refreshExpiry(now = new Date()) {
    return new Date(now.getTime() + refreshTokenTtlDays * 86_400_000);
  }

  return Object.freeze({
    issueAccessToken,
    verifyAccessToken,
    createRefreshToken,
    refreshExpiry,
    newFamilyId: randomUUID,
    accessTokenTtlSeconds,
  });
}

export function hashAdminRefreshToken(token) {
  return createHash('sha256').update(token, 'utf8').digest();
}
