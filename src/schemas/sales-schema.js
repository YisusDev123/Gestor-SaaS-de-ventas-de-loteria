import Joi from 'joi';

import {
  businessDateSchema, lotteryNumberSchema, moneyAmountSchema,
  positiveMoneyAmountSchema, requestIdSchema,
} from './common-schema.js';
import { paginationQuerySchema } from './pagination-schema.js';

const publicIdSchema = Joi.string().length(26).pattern(/^[0-9A-HJKMNP-TV-Z]+$/).required();

export const salesDrawsQuerySchema = Joi.object({
  businessDate: businessDateSchema.optional(),
});

export const drawParamsSchema = Joi.object({ drawPublicId: publicIdSchema });

export const numberParamsSchema = Joi.object({
  drawPublicId: publicIdSchema,
  number: lotteryNumberSchema,
});

export const updateNumberLimitSchema = Joi.object({
  remainingAmount: moneyAmountSchema,
  expectedEffectiveLimit: moneyAmountSchema,
}).required();

export const createTicketSchema = Joi.object({
  requestId: requestIdSchema,
  drawPublicId: publicIdSchema,
  items: Joi.array().items(Joi.object({
    number: lotteryNumberSchema,
    amount: positiveMoneyAmountSchema,
  })).min(1).max(100).unique('number').required(),
}).required();

export const salesListQuerySchema = paginationQuerySchema.keys({
  businessDate: businessDateSchema,
  lotteryCode: Joi.string().trim().uppercase().max(40).optional(),
  modalityCode: Joi.string().trim().uppercase().max(50).optional(),
  status: Joi.string().valid('PENDING', 'OPEN', 'CLOSED', 'RESULTED', 'SETTLED', 'CANCELLED').optional(),
});

export const ticketHistoryQuerySchema = paginationQuerySchema.keys({
  businessDate: businessDateSchema.optional(),
  status: Joi.string().valid('VALID', 'CANCELLED', 'REPLACED').optional(),
  prizeStatus: Joi.string().valid('PENDING_RESULT', 'PENDING_PAYMENT', 'NOT_WINNER', 'PAID').optional(),
});

export const ticketCodeParamsSchema = Joi.object({
  ticketCode: Joi.string().trim().min(16).max(21).required(),
});

export const cancelTicketSchema = Joi.object({
  requestId: requestIdSchema,
  reason: Joi.string().trim().min(3).max(500).required(),
}).required();

export const correctTicketSchema = cancelTicketSchema.keys({
  drawPublicId: publicIdSchema,
  items: Joi.array().items(Joi.object({
    number: lotteryNumberSchema,
    amount: positiveMoneyAmountSchema,
  })).min(1).max(100).unique('number').required(),
});

export const receiptPdfQuerySchema = Joi.object({
  paper: Joi.string().valid('58mm', '80mm', 'letter').default('80mm'),
});
