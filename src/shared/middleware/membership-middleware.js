import { AppError } from '../error/app-error.js';

export function iniciarMembershipActivaMiddleware(baseDeDatos) {
  return async function membershipActivaMiddleware(req, _res, next) {
    try {
      const identidad = req.authenticatedIdentity;
      if (!identidad) {
        throw new AppError('Se requiere autenticación.', {
          statusCode: 401,
          code: 'AUTHENTICATION_REQUIRED',
        });
      }

      const contexto = await baseDeDatos.obtenerMembershipActual(
        identidad.userId,
        identidad.tenantId,
        identidad.membershipId,
      );
      if (!contexto || contexto.userStatus !== 'ACTIVE'
        || contexto.membershipStatus !== 'ACTIVE' || contexto.tenantStatus !== 'ACTIVE') {
        throw new AppError('La cuenta no está disponible.', {
          statusCode: 403,
          code: 'ACCOUNT_UNAVAILABLE',
        });
      }
      req.userId = String(contexto.userId);
      req.sessionId = identidad.sessionId;
      req.tenantId = String(contexto.tenantId);
      req.membershipId = String(contexto.membershipId);
      req.role = contexto.role;
      req.tenantContext = Object.freeze({ ...contexto });
      return next();
    } catch (error) {
      return next(error);
    }
  };
}
