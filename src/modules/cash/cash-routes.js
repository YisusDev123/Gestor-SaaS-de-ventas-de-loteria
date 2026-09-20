import { Router } from 'express';

import { cashContainer } from '../../container/cash-container.js';
import {
  cashMovementsQuerySchema,
  createCashMovementSchema,
  initializeCashSchema,
} from '../../schemas/cash-schema.js';
import { validar } from '../../shared/middleware/joi-schema.js';

const {
  controladorCash,
  authMiddleware,
  membershipActivaMiddleware,
  subscriptionAccessMiddleware,
  cashRoleMiddleware,
} = cashContainer;
const router = Router();

router.use(
  authMiddleware,
  membershipActivaMiddleware,
  subscriptionAccessMiddleware,
  cashRoleMiddleware,
);
router.get('/', controladorCash.getCash);
router.post('/initialize', validar(initializeCashSchema), controladorCash.initialize);
router.get('/movements', validar(cashMovementsQuerySchema, 'query'), controladorCash.listMovements);
router.post('/movements', validar(createCashMovementSchema), controladorCash.createMovement);

export default router;
