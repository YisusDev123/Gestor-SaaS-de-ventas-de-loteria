import config from '../../config.js';
import { pool } from '../config/pool.js';
import { iniciarCashController } from '../modules/cash/cash-controller.js';
import * as cashService from '../modules/cash/cash-services.js';
import { createAuthTokenManager } from '../modules/auth/auth-token.js';
import { iniciarBaseDeDatosAuth } from '../shared/database/auth-sql.js';
import { iniciarBaseDeDatosCash } from '../shared/database/cash-sql.js';
import { iniciarAuthMiddleware } from '../shared/middleware/auth-middleware.js';
import { iniciarMembershipActivaMiddleware } from '../shared/middleware/membership-middleware.js';
import { requireRoles } from '../shared/middleware/role-middleware.js';
import { subscriptionAccessMiddleware } from '../shared/middleware/subscription-access-middleware.js';

const baseDeDatosAuth = iniciarBaseDeDatosAuth(pool);
const baseDeDatosCash = iniciarBaseDeDatosCash(pool);
const tokenManager = createAuthTokenManager(config);
const cursorSecret = `${config.security.jwtSecret}:cash-movements`;

export const cashContainer = Object.freeze({
  controladorCash: iniciarCashController(cashService, baseDeDatosCash, cursorSecret),
  authMiddleware: iniciarAuthMiddleware(baseDeDatosAuth, tokenManager),
  membershipActivaMiddleware: iniciarMembershipActivaMiddleware(baseDeDatosAuth),
  subscriptionAccessMiddleware,
  cashRoleMiddleware: requireRoles('OWNER', 'MANAGER'),
});
