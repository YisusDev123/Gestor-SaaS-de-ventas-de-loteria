import config from '../../config.js';
import { pool } from '../config/pool.js';
import { createAuthTokenManager } from '../modules/auth/auth-token.js';
import { jobsContainer } from './jobs-container.js';
import { iniciarSaasAdminController } from '../modules/saas-admin/saas-admin-controller.js';
import * as servicioSaasAdmin from '../modules/saas-admin/saas-admin-services.js';
import { createSaasAdminTokenManager } from '../modules/saas-admin/saas-admin-token.js';
import { iniciarBaseDeDatosSaasAdmin } from '../shared/database/saas-admin-sql.js';
import { iniciarProveedorRecuperacionAcceso } from '../shared/email/password-reset-provider.js';
import { iniciarSaasAdminAuthMiddleware } from '../shared/middleware/saas-admin-auth-middleware.js';

const baseDeDatosSaasAdmin = iniciarBaseDeDatosSaasAdmin(pool);
const adminTokenManager = createSaasAdminTokenManager(config);
const userTokenManager = createAuthTokenManager(config);
const proveedorRecuperacion = iniciarProveedorRecuperacionAcceso(config);
const controladorSaasAdmin = iniciarSaasAdminController(
  servicioSaasAdmin,
  baseDeDatosSaasAdmin,
  adminTokenManager,
  userTokenManager,
  proveedorRecuperacion,
  config,
  jobsContainer.jobsService,
  `${config.security.jwtSecret}:saas-admin-cursor`,
);
const saasAdminAuthMiddleware = iniciarSaasAdminAuthMiddleware(
  baseDeDatosSaasAdmin,
  adminTokenManager,
);

export const saasAdminContainer = {
  controladorSaasAdmin,
  saasAdminAuthMiddleware,
};
