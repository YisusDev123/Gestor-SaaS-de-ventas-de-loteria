import { Router } from 'express';

import { saasAdminContainer } from '../../container/saas-admin-container.js';
import {
  changeTenantStatusSchema,
  confirmSubscriptionPaymentSchema,
  createTenantSchema,
  listAuditEventsQuerySchema,
  listTenantsQuerySchema,
  planCodeParamsSchema,
  saasAdminLoginSchema,
  saasAdminWebSessionSchema,
  tenantPublicIdParamsSchema,
  updatePlanPriceSchema,
} from '../../schemas/saas-admin-schema.js';
import { validar } from '../../shared/middleware/joi-schema.js';
import {
  saasAdminLoginIdentityLimiter,
  saasAdminLoginIpLimiter,
  saasAdminOperationLimiter,
  sessionLimiter,
} from '../../shared/middleware/rate-limit.js';
import { requireTrustedOrigin } from '../../shared/middleware/trusted-origin.js';

const { controladorSaasAdmin, saasAdminAuthMiddleware } = saasAdminContainer;
const router = Router();

router.post('/auth/login', requireTrustedOrigin, saasAdminLoginIpLimiter, validar(saasAdminLoginSchema), saasAdminLoginIdentityLimiter, controladorSaasAdmin.login);
router.post('/auth/refresh', requireTrustedOrigin, sessionLimiter, validar(saasAdminWebSessionSchema), controladorSaasAdmin.refresh);
router.post('/auth/logout', requireTrustedOrigin, sessionLimiter, validar(saasAdminWebSessionSchema), controladorSaasAdmin.logout);
router.get('/auth/me', saasAdminAuthMiddleware, controladorSaasAdmin.getMe);
router.get('/tenants', saasAdminAuthMiddleware, validar(listTenantsQuerySchema, 'query'), controladorSaasAdmin.listarTenants);
router.get('/tenants/:tenantId', saasAdminAuthMiddleware, validar(tenantPublicIdParamsSchema, 'params'), controladorSaasAdmin.obtenerTenant);
router.get('/plans', saasAdminAuthMiddleware, controladorSaasAdmin.listarPlanes);
router.get('/audit-events', saasAdminAuthMiddleware, validar(listAuditEventsQuerySchema, 'query'), controladorSaasAdmin.listarAuditoria);
router.post('/tenants', saasAdminAuthMiddleware, saasAdminOperationLimiter, validar(createTenantSchema), controladorSaasAdmin.crearTenant);
router.patch('/tenants/:tenantId/status', saasAdminAuthMiddleware, saasAdminOperationLimiter, validar(tenantPublicIdParamsSchema, 'params'), validar(changeTenantStatusSchema), controladorSaasAdmin.cambiarEstadoTenant);
router.post('/tenants/:tenantId/access-reset', saasAdminAuthMiddleware, saasAdminOperationLimiter, validar(tenantPublicIdParamsSchema, 'params'), validar(saasAdminWebSessionSchema), controladorSaasAdmin.restablecerAccesoTenant);
router.post('/tenants/:tenantId/subscription/payments', saasAdminAuthMiddleware, saasAdminOperationLimiter, validar(tenantPublicIdParamsSchema, 'params'), validar(confirmSubscriptionPaymentSchema), controladorSaasAdmin.confirmarPagoSuscripcion);
router.patch('/plans/:planCode/price', saasAdminAuthMiddleware, saasAdminOperationLimiter, validar(planCodeParamsSchema, 'params'), validar(updatePlanPriceSchema), controladorSaasAdmin.actualizarPrecioPlan);

export default router;
