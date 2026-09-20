import { AppError } from '../error/app-error.js';

export function subscriptionAccessMiddleware(req, _res, next) {
  if (!req.tenantContext) {
    return next(new AppError('Se requiere un contexto tenant autenticado.', {
      statusCode: 401,
      code: 'AUTHENTICATION_REQUIRED',
    }));
  }
  if (Number(req.tenantContext.hasAccess) !== 1) {
    return next(new AppError('La suscripción requiere renovación.', {
      statusCode: 403,
      code: 'SUBSCRIPTION_RENEWAL_REQUIRED',
      details: {
        status: req.tenantContext.subscriptionStatus,
        accessEndsAt: req.tenantContext.accessEndsAt,
      },
    }));
  }
  return next();
}
