import Joi from 'joi';

import {
  lotteryNumberSchema, positiveMoneyAmountSchema, requestIdSchema,
} from './common-schema.js';

const publicIdSchema = Joi.string().length(26).pattern(/^[0-9A-HJKMNP-TV-Z]+$/).required();
const resultFields = {
  requestId: requestIdSchema,
  winningNumber: lotteryNumberSchema,
  confirmWinningNumber: lotteryNumberSchema,
  confirmed: Joi.boolean().valid(true).required(),
  sourceNote: Joi.string().trim().min(3).max(500).optional(),
};

export const resultDrawParamsSchema = Joi.object({ drawPublicId: publicIdSchema });

export const publishResultSchema = Joi.object(resultFields).required();

export const correctResultSchema = Joi.object({
  ...resultFields,
  reason: Joi.string().trim().min(3).max(500).optional(),
}).required();

export const prizeTicketParamsSchema = Joi.object({
  ticketCode: Joi.string().trim().min(16).max(21).required(),
});

export const payPrizeSchema = Joi.object({
  requestId: requestIdSchema,
  expectedPrizeAmount: positiveMoneyAmountSchema,
  confirmed: Joi.boolean().valid(true).required(),
}).required();
