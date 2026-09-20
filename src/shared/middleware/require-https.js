import { AppError } from '../error/app-error.js';

const INTERNAL_HTTP_HEALTHCHECK_PATHS = new Set([
  '/health/live',
  '/health/ready',
]);

export function requireHttps(runtimeConfig) {
  return function httpsGuard(req, _res, next) {
    if (
      !runtimeConfig.app.requireHttps
      || req.secure
      || INTERNAL_HTTP_HEALTHCHECK_PATHS.has(req.path)
    ) return next();
    return next(new AppError('La conexión segura es obligatoria.', {
      statusCode: 400,
      code: 'HTTPS_REQUIRED',
    }));
  };
}
