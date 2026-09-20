import config from '../../config.js';
import { pool } from '../config/pool.js';
import { createAuthTokenManager } from '../modules/auth/auth-token.js';
import { jobsContainer } from './jobs-container.js';
import { iniciarTenantSettingsController } from '../modules/tenant-settings/tenant-settings-controller.js';
import * as tenantSettingsService from '../modules/tenant-settings/tenant-settings-services.js';
import { iniciarBaseDeDatosAuth } from '../shared/database/auth-sql.js';
import { iniciarBaseDeDatosTenantSettings } from '../shared/database/tenant-settings-sql.js';
import { iniciarAuthMiddleware } from '../shared/middleware/auth-middleware.js';
import { iniciarMembershipActivaMiddleware } from '../shared/middleware/membership-middleware.js';
import { requireRoles } from '../shared/middleware/role-middleware.js';
import { subscriptionAccessMiddleware } from '../shared/middleware/subscription-access-middleware.js';

const baseDeDatosAuth = iniciarBaseDeDatosAuth(pool);
const baseDeDatosTenantSettings = iniciarBaseDeDatosTenantSettings(pool);
const tokenManager = createAuthTokenManager(config);

export const tenantSettingsContainer = {
  controladorTenantSettings: iniciarTenantSettingsController(
    tenantSettingsService, baseDeDatosTenantSettings, jobsContainer.jobsService,
  ),
  authMiddleware: iniciarAuthMiddleware(baseDeDatosAuth, tokenManager),
  membershipActivaMiddleware: iniciarMembershipActivaMiddleware(baseDeDatosAuth),
  subscriptionAccessMiddleware,
  configuracionRoleMiddleware: requireRoles('OWNER', 'MANAGER'),
};
