import { success } from '../../shared/utils/http-response.js';
import {
  clearRefreshCookie,
  readRefreshCookie,
  setRefreshCookie,
} from '../../shared/utils/session-cookie.js';

export function iniciarAuthController(
  servicioAuth,
  baseDeDatos,
  tokenManager,
  runtimeConfig,
  proveedorRecuperacionAcceso,
) {
  return {
    async login(req, res, next) {
      try {
        const { email, password } = req.body;
        const resultado = await servicioAuth.login(
          baseDeDatos,
          tokenManager,
          email,
          password,
          req.ip,
          req.get('user-agent'),
        );
        setRefreshCookie(
          res,
          resultado.refreshToken,
          resultado.refreshExpiresAt,
          runtimeConfig,
        );
        return success(res, resultado.contenido);
      } catch (error) {
        return next(error);
      }
    },

    async refresh(req, res, next) {
      try {
        const refreshToken = readRefreshCookie(req, runtimeConfig);
        const resultado = await servicioAuth.refrescarToken(
          baseDeDatos,
          tokenManager,
          refreshToken,
          req.ip,
          req.get('user-agent'),
        );
        setRefreshCookie(
          res,
          resultado.refreshToken,
          resultado.refreshExpiresAt,
          runtimeConfig,
        );
        return success(res, resultado.contenido);
      } catch (error) {
        if (error?.statusCode === 401) clearRefreshCookie(res, runtimeConfig);
        return next(error);
      }
    },

    async logout(req, res, next) {
      try {
        const refreshToken = readRefreshCookie(req, runtimeConfig);
        const contenido = await servicioAuth.logout(baseDeDatos, refreshToken);
        clearRefreshCookie(res, runtimeConfig);
        return success(res, contenido);
      } catch (error) {
        return next(error);
      }
    },

    async getMe(req, res, next) {
      try {
        const contenido = await servicioAuth.obtenerPerfil(req.tenantContext);
        return success(res, contenido);
      } catch (error) {
        return next(error);
      }
    },

    async getRenewal(req, res, next) {
      try {
        return success(res, servicioAuth.obtenerRenovacion(req.tenantContext));
      } catch (error) {
        return next(error);
      }
    },

    async forgotPassword(req, res, next) {
      try {
        const { email } = req.body;
        const contenido = await servicioAuth.solicitarRestablecimiento(
          baseDeDatos,
          tokenManager,
          proveedorRecuperacionAcceso,
          email,
        );
        return success(res, contenido);
      } catch (error) {
        return next(error);
      }
    },

    async resetPassword(req, res, next) {
      try {
        const { token, newPassword } = req.body;
        const contenido = await servicioAuth.confirmarRestablecimiento(
          baseDeDatos,
          token,
          newPassword,
        );
        clearRefreshCookie(res, runtimeConfig);
        return success(res, contenido);
      } catch (error) {
        return next(error);
      }
    },
  };
}
