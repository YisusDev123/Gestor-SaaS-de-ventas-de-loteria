import { paginated, success } from '../../shared/utils/http-response.js';
import {
  clearAdminRefreshCookie,
  readAdminRefreshCookie,
  setAdminRefreshCookie,
} from '../../shared/utils/session-cookie.js';

export function iniciarSaasAdminController(
  servicio,
  baseDeDatos,
  adminTokenManager,
  userTokenManager,
  proveedorRecuperacion,
  runtimeConfig,
  jobsService = null,
  cursorSecret = null,
) {
  return {
    async login(req, res, next) {
      try {
        const { email, password } = req.body;
        const resultado = await servicio.login(
          baseDeDatos, adminTokenManager, email, password, req.ip, req.get('user-agent'),
        );
        setAdminRefreshCookie(
          res, resultado.refreshToken, resultado.refreshExpiresAt, runtimeConfig,
        );
        return success(res, resultado.contenido);
      } catch (error) {
        return next(error);
      }
    },

    async refresh(req, res, next) {
      try {
        const refreshToken = readAdminRefreshCookie(req, runtimeConfig);
        const resultado = await servicio.refrescarToken(
          baseDeDatos,
          adminTokenManager,
          refreshToken,
          req.ip,
          req.get('user-agent'),
        );
        setAdminRefreshCookie(
          res, resultado.refreshToken, resultado.refreshExpiresAt, runtimeConfig,
        );
        return success(res, resultado.contenido);
      } catch (error) {
        if (error?.statusCode === 401) clearAdminRefreshCookie(res, runtimeConfig);
        return next(error);
      }
    },

    async logout(req, res, next) {
      try {
        const refreshToken = readAdminRefreshCookie(req, runtimeConfig);
        const contenido = await servicio.logout(baseDeDatos, refreshToken);
        clearAdminRefreshCookie(res, runtimeConfig);
        return success(res, contenido);
      } catch (error) {
        return next(error);
      }
    },

    async getMe(req, res, next) {
      try {
        return success(res, servicio.obtenerPerfil(req.adminEmail));
      } catch (error) {
        return next(error);
      }
    },

    async listarTenants(req, res, next) {
      try {
        const result = await servicio.listarTenants(
          baseDeDatos, cursorSecret, req.validated.query,
        );
        return paginated(res, result.items, result);
      } catch (error) {
        return next(error);
      }
    },

    async obtenerTenant(req, res, next) {
      try {
        return success(res, await servicio.obtenerTenant(baseDeDatos, req.params.tenantId));
      } catch (error) {
        return next(error);
      }
    },

    async listarPlanes(req, res, next) {
      try {
        return success(res, await servicio.listarPlanes(baseDeDatos));
      } catch (error) {
        return next(error);
      }
    },

    async listarAuditoria(req, res, next) {
      try {
        const result = await servicio.listarAuditoria(
          baseDeDatos, cursorSecret, req.validated.query,
        );
        return paginated(res, result.items, result);
      } catch (error) {
        return next(error);
      }
    },

    async crearTenant(req, res, next) {
      try {
        const contenido = await servicio.crearTenant(
          baseDeDatos,
          userTokenManager,
          proveedorRecuperacion,
          req.adminId,
          req.body,
          req.correlationId,
          jobsService,
        );
        return success(res, contenido, { statusCode: 201 });
      } catch (error) {
        return next(error);
      }
    },

    async cambiarEstadoTenant(req, res, next) {
      try {
        const contenido = await servicio.cambiarEstadoTenant(
          baseDeDatos,
          req.adminId,
          req.params.tenantId,
          req.body,
          req.correlationId,
          jobsService,
        );
        return success(res, contenido);
      } catch (error) {
        return next(error);
      }
    },

    async restablecerAccesoTenant(req, res, next) {
      try {
        const contenido = await servicio.restablecerAccesoTenant(
          baseDeDatos,
          userTokenManager,
          proveedorRecuperacion,
          req.adminId,
          req.params.tenantId,
          req.correlationId,
        );
        return success(res, contenido);
      } catch (error) {
        return next(error);
      }
    },

    async actualizarPrecioPlan(req, res, next) {
      try {
        const contenido = await servicio.actualizarPrecioPlan(
          baseDeDatos,
          req.adminId,
          req.params.planCode,
          req.body.currentPrice,
          req.correlationId,
        );
        return success(res, contenido);
      } catch (error) {
        return next(error);
      }
    },

    async confirmarPagoSuscripcion(req, res, next) {
      try {
        const resultado = await servicio.confirmarPagoSuscripcion(
          baseDeDatos,
          req.adminId,
          req.params.tenantId,
          req.body,
          req.correlationId,
          jobsService,
        );
        return success(res, resultado.contenido, {
          statusCode: resultado.replay ? 200 : 201,
        });
      } catch (error) {
        return next(error);
      }
    },
  };
}
