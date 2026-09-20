import config from '../../config.js';
import { pool } from '../config/pool.js';
import { iniciarAuthController } from '../modules/auth/auth-controller.js';
import * as servicioAuth from '../modules/auth/auth-services.js';
import { createAuthTokenManager } from '../modules/auth/auth-token.js';
import { iniciarBaseDeDatosAuth } from '../shared/database/auth-sql.js';
import { iniciarProveedorRecuperacionAcceso } from '../shared/email/password-reset-provider.js';
import { iniciarAuthMiddleware } from '../shared/middleware/auth-middleware.js';
import { iniciarMembershipActivaMiddleware } from '../shared/middleware/membership-middleware.js';
import { subscriptionAccessMiddleware } from '../shared/middleware/subscription-access-middleware.js';

const baseDeDatosAuth = iniciarBaseDeDatosAuth(pool);
const tokenManager = createAuthTokenManager(config);
const proveedorRecuperacionAcceso = iniciarProveedorRecuperacionAcceso(config);
const controladorAuth = iniciarAuthController(
  servicioAuth,
  baseDeDatosAuth,
  tokenManager,
  config,
  proveedorRecuperacionAcceso,
);
const authMiddleware = iniciarAuthMiddleware(baseDeDatosAuth, tokenManager);
const membershipActivaMiddleware = iniciarMembershipActivaMiddleware(baseDeDatosAuth);

export const contenedor = {
  controladorAuth,
  authMiddleware,
  membershipActivaMiddleware,
  subscriptionAccessMiddleware,
};
