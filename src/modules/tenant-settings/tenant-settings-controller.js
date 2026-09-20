import { success } from '../../shared/utils/http-response.js';

export function iniciarTenantSettingsController(servicio, baseDeDatos, jobsService = null) {
  return {
    async obtenerConfiguracion(req, res, next) {
      try {
        const contenido = await servicio.obtenerConfiguracion(baseDeDatos, req.tenantId);
        return success(res, contenido);
      } catch (error) {
        return next(error);
      }
    },

    async obtenerDisponibilidadDiaria(req, res, next) {
      try {
        const contenido = await servicio.obtenerDisponibilidadDiaria(
          baseDeDatos, req.tenantId, req.validated.query.businessDate,
        );
        return success(res, contenido);
      } catch (error) {
        return next(error);
      }
    },

    async actualizarNegocio(req, res, next) {
      try {
        const contenido = await servicio.actualizarNegocio(
          baseDeDatos, req.tenantId, req.userId, req.body, req.correlationId,
        );
        return success(res, contenido);
      } catch (error) {
        return next(error);
      }
    },

    async actualizarLoteria(req, res, next) {
      try {
        const contenido = await servicio.actualizarLoteria(
          baseDeDatos, req.tenantId, req.userId, req.params.lotteryCode,
          req.body, req.correlationId, jobsService,
        );
        return success(res, contenido);
      } catch (error) {
        return next(error);
      }
    },

    async actualizarModalidad(req, res, next) {
      try {
        const contenido = await servicio.actualizarModalidad(
          baseDeDatos, req.tenantId, req.userId,
          { lotteryCode: req.params.lotteryCode, modalityCode: req.params.modalityCode },
          req.body, req.correlationId, jobsService,
        );
        return success(res, contenido);
      } catch (error) {
        return next(error);
      }
    },

    async actualizarHorario(req, res, next) {
      try {
        const contenido = await servicio.actualizarHorario(
          baseDeDatos, req.tenantId, req.userId,
          {
            lotteryCode: req.params.lotteryCode,
            modalityCode: req.params.modalityCode,
            scheduleCode: req.params.scheduleCode,
          },
          req.body, req.correlationId, jobsService,
        );
        return success(res, contenido);
      } catch (error) {
        return next(error);
      }
    },

    async actualizarLimiteGeneral(req, res, next) {
      try {
        const contenido = await servicio.actualizarLimiteGeneral(
          baseDeDatos, req.tenantId, req.userId, req.body, req.correlationId, jobsService,
        );
        return success(res, contenido);
      } catch (error) {
        return next(error);
      }
    },

    async actualizarDisponibilidadDiaria(req, res, next) {
      try {
        const contenido = await servicio.actualizarDisponibilidadDiaria(
          baseDeDatos, req.tenantId, req.userId, req.params.lotteryCode,
          req.body, req.correlationId,
        );
        return success(res, contenido);
      } catch (error) {
        return next(error);
      }
    },
  };
}
