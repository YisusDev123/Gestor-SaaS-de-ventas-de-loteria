import Joi from 'joi';

import {
  businessDateSchema,
  moneyAmountSchema,
  positiveMoneyAmountSchema,
  requestIdSchema,
} from './common-schema.js';
import { paginationQuerySchema } from './pagination-schema.js';

export const initializeCashSchema = Joi.object({
  requestId: requestIdSchema,
  amount: moneyAmountSchema,
}).required();

export const createCashMovementSchema = Joi.object({
  requestId: requestIdSchema,
  movementType: Joi.string().valid('ENTRY', 'WITHDRAWAL', 'EXPENSE', 'ADJUSTMENT').required(),
  direction: Joi.string().valid('CREDIT', 'DEBIT').when('movementType', {
    is: 'ADJUSTMENT',
    then: Joi.required(),
    otherwise: Joi.forbidden(),
  }),
  amount: positiveMoneyAmountSchema,
  reason: Joi.string().trim().min(3).max(500).required(),
}).required();

export const cashMovementsQuerySchema = paginationQuerySchema.keys({
  businessDate: businessDateSchema.optional(),
});
