import { AppError } from '../error/app-error.js';

export function requireRoles(...allowedRoles) {
  const allowed = new Set(allowedRoles);
  return function roleMiddleware(req, _res, next) {
    if (!req.role || !allowed.has(req.role)) {
      return next(new AppError('No tiene permisos para modificar esta configuración.', {
        statusCode: 403,
        code: 'INSUFFICIENT_ROLE',
      }));
    }
    return next();
  };
}
