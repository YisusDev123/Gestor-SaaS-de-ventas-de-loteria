import config from '../../config.js';
import { pool } from '../config/pool.js';
import { createAuthTokenManager } from '../modules/auth/auth-token.js';
import { iniciarReportsController } from '../modules/reports/reports-controller.js';
import { renderDailyReportPdf } from '../modules/reports/reports-pdf.js';
import * as reportsService from '../modules/reports/reports-services.js';
import { iniciarBaseDeDatosAuth } from '../shared/database/auth-sql.js';
import { iniciarBaseDeDatosReports } from '../shared/database/reports-sql.js';
import { iniciarAuthMiddleware } from '../shared/middleware/auth-middleware.js';
import { iniciarMembershipActivaMiddleware } from '../shared/middleware/membership-middleware.js';
import { requireRoles } from '../shared/middleware/role-middleware.js';
import { subscriptionAccessMiddleware } from '../shared/middleware/subscription-access-middleware.js';

const authDatabase = iniciarBaseDeDatosAuth(pool);
const reportsDatabase = iniciarBaseDeDatosReports(pool);
const tokenManager = createAuthTokenManager(config);

export const reportsContainer = Object.freeze({
  controladorReports: iniciarReportsController(
    reportsService, reportsDatabase, `${config.security.jwtSecret}:reports-cursor`, renderDailyReportPdf,
  ),
  authMiddleware: iniciarAuthMiddleware(authDatabase, tokenManager),
  membershipActivaMiddleware: iniciarMembershipActivaMiddleware(authDatabase),
  subscriptionAccessMiddleware,
  readRoleMiddleware: requireRoles('OWNER', 'MANAGER', 'SELLER', 'VIEWER'),
  reconciliationRoleMiddleware: requireRoles('OWNER', 'MANAGER'),
});
