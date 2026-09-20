import { paginated, success } from '../../shared/utils/http-response.js';

export function iniciarSalesController(service, database, cursorSecret, renderPdf) {
  return {
    async listSaleDraws(req, res, next) {
      try {
        return success(res, await service.listarSorteosVenta(
          database, req.tenantId, req.validated.query,
        ));
      } catch (error) { return next(error); }
    },
    async getMatrix(req, res, next) {
      try {
        return success(res, await service.obtenerMatriz(
          database, req.tenantId, req.params.drawPublicId,
        ));
      } catch (error) { return next(error); }
    },
    async updateLimit(req, res, next) {
      try {
        return success(res, await service.actualizarLimite(
          database, req.tenantId, req.userId, req.params, req.body, req.correlationId,
        ));
      } catch (error) { return next(error); }
    },
    async createTicket(req, res, next) {
      try {
        const content = await service.crearTicket(
          database, req.tenantId, req.userId, req.body, req.correlationId,
        );
        return success(res, content, { statusCode: content.replay ? 200 : 201 });
      } catch (error) { return next(error); }
    },
    async getList(req, res, next) {
      try {
        const result = await service.obtenerLista(
          database, cursorSecret, req.tenantId, req.validated.query,
        );
        return paginated(res, result.items, result);
      } catch (error) { return next(error); }
    },
    async listTickets(req, res, next) {
      try {
        const result = await service.listarTickets(
          database, cursorSecret, req.tenantId, req.validated.query,
        );
        return paginated(res, result.items, result);
      } catch (error) { return next(error); }
    },
    async getTicket(req, res, next) {
      try {
        return success(res, await service.obtenerTicket(
          database, req.tenantId, req.params.ticketCode,
        ));
      } catch (error) { return next(error); }
    },
    async getReceipt(req, res, next) {
      try {
        return success(res, await service.obtenerComprobante(
          database, req.tenantId, req.params.ticketCode,
        ));
      } catch (error) { return next(error); }
    },
    async getReceiptPdf(req, res, next) {
      try {
        const receipt = await service.obtenerComprobante(
          database, req.tenantId, req.params.ticketCode,
        );
        const content = await renderPdf(receipt, req.validated.query.paper);
        res.set('Content-Type', 'application/pdf');
        res.set('Content-Disposition', `attachment; filename="${receipt.ticketCode}.pdf"`);
        return res.status(200).send(content);
      } catch (error) { return next(error); }
    },
    async cancelTicket(req, res, next) {
      try {
        const content = await service.cancelarTicket(
          database, req.tenantId, req.userId, req.params.ticketCode,
          req.body, req.correlationId,
        );
        return success(res, content, { statusCode: content.replay ? 200 : 201 });
      } catch (error) { return next(error); }
    },
    async correctTicket(req, res, next) {
      try {
        const content = await service.corregirTicket(
          database, req.tenantId, req.userId, req.params.ticketCode,
          req.body, req.correlationId,
        );
        return success(res, content, { statusCode: content.replay ? 200 : 201 });
      } catch (error) { return next(error); }
    },
  };
}
