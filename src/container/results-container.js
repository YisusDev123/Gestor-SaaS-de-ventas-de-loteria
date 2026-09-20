import config from '../../config.js';
import { pool } from '../config/pool.js';
import { createAuthTokenManager } from '../modules/auth/auth-token.js';
import { iniciarResultsController } from '../modules/results/results-controller.js';
import * as resultsService from '../modules/results/results-services.js';
import { iniciarBaseDeDatosAuth } from '../shared/database/auth-sql.js';
import { iniciarBaseDeDatosResults } from '../shared/database/results-sql.js';
import { iniciarAuthMiddleware } from '../shared/middleware/auth-middleware.js';
import { iniciarMembershipActivaMiddleware } from '../shared/middleware/membership-middleware.js';
import { requireRoles } from '../shared/middleware/role-middleware.js';
import { subscriptionAccessMiddleware } from '../shared/middleware/subscription-access-middleware.js';

const authDatabase = iniciarBaseDeDatosAuth(pool);
const resultsDatabase = iniciarBaseDeDatosResults(pool);
const tokenManager = createAuthTokenManager(config);

export const resultsContainer = Object.freeze({
  controladorResults: iniciarResultsController(resultsService, resultsDatabase),
  authMiddleware: iniciarAuthMiddleware(authDatabase, tokenManager),
  membershipActivaMiddleware: iniciarMembershipActivaMiddleware(authDatabase),
  subscriptionAccessMiddleware,
  resultRoleMiddleware: requireRoles('OWNER', 'MANAGER'),
  paymentRoleMiddleware: requireRoles('OWNER', 'MANAGER', 'SELLER'),
  readRoleMiddleware: requireRoles('OWNER', 'MANAGER', 'SELLER', 'VIEWER'),
});
