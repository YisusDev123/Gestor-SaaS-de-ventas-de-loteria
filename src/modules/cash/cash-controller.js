import { paginated, success } from '../../shared/utils/http-response.js';

export function iniciarCashController(service, database, cursorSecret) {
  return {
    async getCash(req, res, next) {
      try {
        return success(res, await service.obtenerCaja(database, req.tenantId));
      } catch (error) {
        return next(error);
      }
    },
    async initialize(req, res, next) {
      try {
        const content = await service.inicializarCaja(
          database, req.tenantId, req.userId, req.body, req.correlationId,
        );
        return success(res, content, { statusCode: content.replay ? 200 : 201 });
      } catch (error) {
        return next(error);
      }
    },
    async createMovement(req, res, next) {
      try {
        const content = await service.registrarMovimiento(
          database, req.tenantId, req.userId, req.body, req.correlationId,
        );
        return success(res, content, { statusCode: content.replay ? 200 : 201 });
      } catch (error) {
        return next(error);
      }
    },
    async listMovements(req, res, next) {
      try {
        const result = await service.listarMovimientos(
          database, cursorSecret, req.tenantId, req.validated.query,
        );
        return paginated(res, result.items, result);
      } catch (error) {
        return next(error);
      }
    },
  };
}
