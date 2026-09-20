import { Router } from 'express';

import { resultsContainer } from '../../container/results-container.js';
import {
  correctResultSchema, payPrizeSchema, prizeTicketParamsSchema,
  publishResultSchema, resultDrawParamsSchema,
} from '../../schemas/results-schema.js';
import { validar } from '../../shared/middleware/joi-schema.js';

const {
  controladorResults, authMiddleware, membershipActivaMiddleware,
  subscriptionAccessMiddleware, resultRoleMiddleware, paymentRoleMiddleware, readRoleMiddleware,
} = resultsContainer;
const router = Router();

router.use(authMiddleware, membershipActivaMiddleware, subscriptionAccessMiddleware);
router.get('/draws/:drawPublicId', readRoleMiddleware, validar(resultDrawParamsSchema, 'params'), controladorResults.getResult);
router.post('/draws/:drawPublicId', resultRoleMiddleware, validar(resultDrawParamsSchema, 'params'), validar(publishResultSchema), controladorResults.publishResult);
router.post('/draws/:drawPublicId/corrections', resultRoleMiddleware, validar(resultDrawParamsSchema, 'params'), validar(correctResultSchema), controladorResults.correctResult);
router.get('/tickets/:ticketCode/prize', readRoleMiddleware, validar(prizeTicketParamsSchema, 'params'), controladorResults.getPrize);
router.post('/tickets/:ticketCode/prize/pay', paymentRoleMiddleware, validar(prizeTicketParamsSchema, 'params'), validar(payPrizeSchema), controladorResults.payPrize);

export default router;
