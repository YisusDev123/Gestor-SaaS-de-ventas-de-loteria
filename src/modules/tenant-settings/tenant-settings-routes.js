import { Router } from 'express';

import { tenantSettingsContainer } from '../../container/tenant-settings-container.js';
import {
  businessDateQuerySchema,
  lotteryCodeParamsSchema,
  modalityCodeParamsSchema,
  scheduleCodeParamsSchema,
  updateBusinessSettingsSchema,
  updateDailyAvailabilitySchema,
  updateGeneralLimitSchema,
  updateLotterySchema,
  updateModalitySchema,
  updateScheduleSchema,
} from '../../schemas/tenant-settings-schema.js';
import { validar } from '../../shared/middleware/joi-schema.js';

const {
  controladorTenantSettings,
  authMiddleware,
  membershipActivaMiddleware,
  subscriptionAccessMiddleware,
  configuracionRoleMiddleware,
} = tenantSettingsContainer;
const router = Router();

router.use(authMiddleware, membershipActivaMiddleware, subscriptionAccessMiddleware);
router.get('/', controladorTenantSettings.obtenerConfiguracion);
router.get('/daily-availability', validar(businessDateQuerySchema, 'query'), controladorTenantSettings.obtenerDisponibilidadDiaria);
router.patch('/business', configuracionRoleMiddleware, validar(updateBusinessSettingsSchema), controladorTenantSettings.actualizarNegocio);
router.put('/lotteries/:lotteryCode', configuracionRoleMiddleware, validar(lotteryCodeParamsSchema, 'params'), validar(updateLotterySchema), controladorTenantSettings.actualizarLoteria);
router.put('/lotteries/:lotteryCode/modalities/:modalityCode', configuracionRoleMiddleware, validar(modalityCodeParamsSchema, 'params'), validar(updateModalitySchema), controladorTenantSettings.actualizarModalidad);
router.put('/lotteries/:lotteryCode/modalities/:modalityCode/schedules/:scheduleCode', configuracionRoleMiddleware, validar(scheduleCodeParamsSchema, 'params'), validar(updateScheduleSchema), controladorTenantSettings.actualizarHorario);
router.put('/limits/general', configuracionRoleMiddleware, validar(updateGeneralLimitSchema), controladorTenantSettings.actualizarLimiteGeneral);
router.put('/daily-availability/:lotteryCode', configuracionRoleMiddleware, validar(lotteryCodeParamsSchema, 'params'), validar(updateDailyAvailabilitySchema), controladorTenantSettings.actualizarDisponibilidadDiaria);

export default router;
