import { AppError } from '../error/app-error.js';

export function iniciarSaasAdminAuthMiddleware(baseDeDatos, tokenManager) {
  return async function saasAdminAuthMiddleware(req, _res, next) {
    const authorization = req.get('authorization') || '';
    const match = /^Bearer ([^\s]+)$/.exec(authorization);
    if (!match) {
      return next(new AppError('Se requiere autenticación administrativa.', {
        statusCode: 401,
        code: 'ADMIN_AUTHENTICATION_REQUIRED',
      }));
    }

    try {
      const payload = tokenManager.verifyAccessToken(match[1]);
      const admin = await baseDeDatos.buscarSesionAdminActiva(payload.sessionId, payload.sub);
      if (!admin) {
        throw new AppError('La sesión administrativa expiró o fue revocada.', {
          statusCode: 401,
          code: 'ADMIN_SESSION_INACTIVE',
        });
      }
      req.adminId = String(admin.adminId);
      req.adminEmail = admin.email;
      req.adminSessionId = String(admin.id);
      return next();
    } catch (error) {
      return next(error);
    }
  };
}
