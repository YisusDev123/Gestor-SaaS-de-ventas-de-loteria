import { paginated, success } from '../../shared/utils/http-response.js';

export function iniciarReportsController(service, database, cursorSecret, renderPdf) {
  return {
    async getDashboard(req, res, next) {
      try { return success(res, await service.obtenerDashboard(database, req.tenantId, req.validated.query)); }
      catch (error) { return next(error); }
    },
    async listReportedDraws(req, res, next) {
      try {
        const result = await service.listarSorteosRealizados(
          database, cursorSecret, req.tenantId, req.validated.query,
        );
        return paginated(res, result.items, result);
      } catch (error) { return next(error); }
    },
    async listWinners(req, res, next) {
      try {
        const result = await service.listarGanadores(
          database, cursorSecret, req.tenantId, req.params.drawPublicId, req.validated.query,
        );
        return paginated(res, result.items, result);
      } catch (error) { return next(error); }
    },
    async getDailyReport(req, res, next) {
      try { return success(res, await service.obtenerReporteDiario(database, req.tenantId, req.validated.query)); }
      catch (error) { return next(error); }
    },
    async exportCsv(req, res, next) {
      try {
        const content = await service.exportarReporteCsv(database, req.tenantId, req.validated.query);
        res.set('Content-Type', 'text/csv; charset=utf-8');
        res.set('Content-Disposition', 'attachment; filename="reporte-diario.csv"');
        return res.status(200).send(content);
      } catch (error) { return next(error); }
    },
    async exportPdf(req, res, next) {
      try {
        const report = await service.prepararReportePdf(database, req.tenantId, req.validated.query);
        const content = await renderPdf(report);
        res.set('Content-Type', 'application/pdf');
        res.set('Content-Disposition', 'attachment; filename="reporte-diario.pdf"');
        return res.status(200).send(content);
      } catch (error) { return next(error); }
    },
    async getReconciliation(req, res, next) {
      try { return success(res, await service.obtenerConciliacion(database, req.tenantId, req.validated.query)); }
      catch (error) { return next(error); }
    },
  };
}
