import { AppError } from '../error/app-error.js';

export function iniciarAuthMiddleware(baseDeDatos, tokenManager) {
  return async function authMiddleware(req, _res, next) {
    const authorization = req.get('authorization') || '';
    const match = /^Bearer ([^\s]+)$/.exec(authorization);
    if (!match) {
      return next(new AppError('Se requiere autenticación.', {
        statusCode: 401,
        code: 'AUTHENTICATION_REQUIRED',
      }));
    }

    try {
      const payload = tokenManager.verifyAccessToken(match[1]);
      const sesionActiva = await baseDeDatos.buscarSesionActiva(
        payload.sessionId,
        payload.sub,
        payload.tenantId,
        payload.membershipId,
      );
      if (!sesionActiva) {
        throw new AppError('La sesión expiró o fue revocada.', {
          statusCode: 401,
          code: 'SESSION_INACTIVE',
        });
      }

      req.authenticatedIdentity = Object.freeze({
        userId: String(sesionActiva.userId),
        sessionId: String(sesionActiva.id),
        tenantId: String(sesionActiva.tenantId),
        membershipId: String(sesionActiva.membershipId),
      });
      return next();
    } catch (error) {
      return next(error);
    }
  };
}
