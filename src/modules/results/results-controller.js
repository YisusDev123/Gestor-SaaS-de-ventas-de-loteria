import { success } from '../../shared/utils/http-response.js';

export function iniciarResultsController(service, database) {
  return {
    async getResult(req, res, next) {
      try {
        return success(res, await service.obtenerResultado(
          database, req.tenantId, req.params.drawPublicId,
        ));
      } catch (error) { return next(error); }
    },
    async publishResult(req, res, next) {
      try {
        const content = await service.publicarResultado(
          database, req.tenantId, req.userId, req.params.drawPublicId,
          req.body, req.correlationId,
        );
        return success(res, content, { statusCode: content.replay ? 200 : 201 });
      } catch (error) { return next(error); }
    },
    async correctResult(req, res, next) {
      try {
        const content = await service.corregirResultado(
          database, req.tenantId, req.userId, req.params.drawPublicId,
          req.body, req.correlationId,
        );
        return success(res, content, { statusCode: content.replay ? 200 : 201 });
      } catch (error) { return next(error); }
    },
    async getPrize(req, res, next) {
      try {
        return success(res, await service.obtenerPremio(
          database, req.tenantId, req.params.ticketCode,
        ));
      } catch (error) { return next(error); }
    },
    async payPrize(req, res, next) {
      try {
        const content = await service.pagarPremio(
          database, req.tenantId, req.userId, req.params.ticketCode,
          req.body, req.correlationId,
        );
        return success(res, content, { statusCode: content.replay ? 200 : 201 });
      } catch (error) { return next(error); }
    },
  };
}
