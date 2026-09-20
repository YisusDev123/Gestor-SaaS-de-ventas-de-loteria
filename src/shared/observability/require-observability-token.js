import crypto from 'node:crypto';

import { AppError } from '../error/app-error.js';

export function requireObservabilityToken(expectedToken) {
  const expected = Buffer.from(expectedToken, 'utf8');

  return function observabilityTokenGuard(req, _res, next) {
    const authorization = req.get('Authorization');
    if (!authorization?.startsWith('Bearer ')) {
      return next(new AppError('Se requiere autenticación interna.', {
        statusCode: 401,
        code: 'OBSERVABILITY_AUTH_REQUIRED',
      }));
    }
    const provided = Buffer.from(authorization.slice(7), 'utf8');
    if (provided.length !== expected.length || !crypto.timingSafeEqual(provided, expected)) {
      return next(new AppError('La autenticación interna no es válida.', {
        statusCode: 403,
        code: 'OBSERVABILITY_AUTH_INVALID',
      }));
    }
    return next();
  };
}
