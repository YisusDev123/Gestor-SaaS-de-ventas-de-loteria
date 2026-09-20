import config from '../../config.js';
import { pool } from '../config/pool.js';
import { createAuthTokenManager } from '../modules/auth/auth-token.js';
import { iniciarSalesController } from '../modules/sales/sales-controller.js';
import { renderReceiptPdf } from '../modules/sales/sales-receipt-pdf.js';
import * as salesService from '../modules/sales/sales-services.js';
import { iniciarBaseDeDatosAuth } from '../shared/database/auth-sql.js';
import { iniciarBaseDeDatosSales } from '../shared/database/sales-sql.js';
import { iniciarAuthMiddleware } from '../shared/middleware/auth-middleware.js';
import { iniciarMembershipActivaMiddleware } from '../shared/middleware/membership-middleware.js';
import { requireRoles } from '../shared/middleware/role-middleware.js';
import { subscriptionAccessMiddleware } from '../shared/middleware/subscription-access-middleware.js';

const authDatabase = iniciarBaseDeDatosAuth(pool);
const salesDatabase = iniciarBaseDeDatosSales(pool);
const tokenManager = createAuthTokenManager(config);

export const salesContainer = Object.freeze({
  controladorSales: iniciarSalesController(
    salesService, salesDatabase, `${config.security.jwtSecret}:sales-cursor`, renderReceiptPdf,
  ),
  authMiddleware: iniciarAuthMiddleware(authDatabase, tokenManager),
  membershipActivaMiddleware: iniciarMembershipActivaMiddleware(authDatabase),
  subscriptionAccessMiddleware,
  salesRoleMiddleware: requireRoles('OWNER', 'MANAGER', 'SELLER'),
  limitRoleMiddleware: requireRoles('OWNER', 'MANAGER'),
  readRoleMiddleware: requireRoles('OWNER', 'MANAGER', 'SELLER', 'VIEWER'),
});
