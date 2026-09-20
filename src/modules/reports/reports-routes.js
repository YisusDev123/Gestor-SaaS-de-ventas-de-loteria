import { Router } from 'express';

import { reportsContainer } from '../../container/reports-container.js';
import {
  dashboardQuerySchema, reconciliationQuerySchema, reportDrawParamsSchema,
  reportedDrawsQuerySchema, reportRangeQuerySchema, reportWinnersQuerySchema,
} from '../../schemas/reports-schema.js';
import { validar } from '../../shared/middleware/joi-schema.js';

const {
  controladorReports, authMiddleware, membershipActivaMiddleware,
  subscriptionAccessMiddleware, readRoleMiddleware, reconciliationRoleMiddleware,
} = reportsContainer;
const router = Router();

router.use(authMiddleware, membershipActivaMiddleware, subscriptionAccessMiddleware);
router.get('/dashboard', readRoleMiddleware, validar(dashboardQuerySchema, 'query'), controladorReports.getDashboard);
router.get('/draws', readRoleMiddleware, validar(reportedDrawsQuerySchema, 'query'), controladorReports.listReportedDraws);
router.get('/draws/:drawPublicId/winners', readRoleMiddleware, validar(reportDrawParamsSchema, 'params'), validar(reportWinnersQuerySchema, 'query'), controladorReports.listWinners);
router.get('/daily', readRoleMiddleware, validar(reportRangeQuerySchema, 'query'), controladorReports.getDailyReport);
router.get('/daily.csv', readRoleMiddleware, validar(reportRangeQuerySchema, 'query'), controladorReports.exportCsv);
router.get('/daily.pdf', readRoleMiddleware, validar(reportRangeQuerySchema, 'query'), controladorReports.exportPdf);
router.get('/reconciliation', reconciliationRoleMiddleware, validar(reconciliationQuerySchema, 'query'), controladorReports.getReconciliation);

export default router;
