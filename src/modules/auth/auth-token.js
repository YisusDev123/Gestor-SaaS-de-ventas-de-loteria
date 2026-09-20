import { createHash, randomBytes, randomUUID } from 'node:crypto';

import jwt from 'jsonwebtoken';

import { AppError } from '../../shared/error/app-error.js';

const ISSUER = 'saas-jps-api';
const AUDIENCE = 'saas-jps-seller';

export function createAuthTokenManager(runtimeConfig) {
  const {
    jwtSecret,
    accessTokenTtlSeconds,
    refreshTokenTtlDays,
    passwordResetTokenTtlMinutes,
  } = runtimeConfig.security;

  function issueAccessToken(context, sessionId) {
    return jwt.sign({
      tenantId: String(context.tenantId),
      membershipId: String(context.membershipId),
      sessionId: String(sessionId),
    }, jwtSecret, {
      algorithm: 'HS256',
      subject: String(context.userId),
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
      throw new AppError('La sesión no es válida o expiró.', {
        statusCode: 401, code: 'INVALID_ACCESS_TOKEN',
      });
    }
  }

  function createRefreshToken() {
    const raw = randomBytes(48).toString('base64url');
    return { raw, hash: hashRefreshToken(raw) };
  }

  function refreshExpiry(now = new Date()) {
    return new Date(now.getTime() + refreshTokenTtlDays * 86_400_000);
  }

  function createPasswordResetToken() {
    const raw = randomBytes(32).toString('base64url');
    return { raw, hash: hashPasswordResetToken(raw) };
  }

  function passwordResetExpiry(now = new Date()) {
    return new Date(now.getTime() + passwordResetTokenTtlMinutes * 60_000);
  }

  return Object.freeze({
    issueAccessToken,
    verifyAccessToken,
    createRefreshToken,
    refreshExpiry,
    createPasswordResetToken,
    passwordResetExpiry,
    newFamilyId: randomUUID,
    accessTokenTtlSeconds,
  });
}

export function hashRefreshToken(token) {
  return createHash('sha256').update(token, 'utf8').digest();
}

export function hashPasswordResetToken(token) {
  return createHash('sha256').update(token, 'utf8').digest();
}
