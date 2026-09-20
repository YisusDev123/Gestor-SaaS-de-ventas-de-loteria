import config from '../../../config.js';

import { AppError } from '../error/app-error.js';

export function iniciarTrustedOrigin(allowedOrigins) {
  const allowed = new Set(allowedOrigins);
  return function requireTrustedOrigin(req, _res, next) {
    const origin = req.get('origin');
    if (!origin || !allowed.has(origin)) {
      return next(new AppError('El origen de la solicitud no está autorizado.', {
        statusCode: 403,
        code: 'UNTRUSTED_ORIGIN',
      }));
    }
    return next();
  };
}

export const requireTrustedOrigin = iniciarTrustedOrigin(
  config.security.corsAllowedOrigins,
);
