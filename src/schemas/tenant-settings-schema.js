import Joi from 'joi';

import { businessDateSchema, moneyAmountSchema } from './common-schema.js';

const catalogCode = Joi.string().trim().uppercase().pattern(/^[A-Z0-9_]{1,60}$/);
const expectedVersion = Joi.number().integer().min(0).max(Number.MAX_SAFE_INTEGER).required();

export const lotteryCodeParamsSchema = Joi.object({
  lotteryCode: catalogCode.max(40).required(),
}).required();

export const modalityCodeParamsSchema = Joi.object({
  lotteryCode: catalogCode.max(40).required(),
  modalityCode: catalogCode.max(50).required(),
}).required();

export const scheduleCodeParamsSchema = Joi.object({
  lotteryCode: catalogCode.max(40).required(),
  modalityCode: catalogCode.max(50).required(),
  scheduleCode: catalogCode.max(60).required(),
}).required();

export const businessDateQuerySchema = Joi.object({
  businessDate: businessDateSchema,
}).required();

export const updateBusinessSettingsSchema = Joi.object({
  displayName: Joi.string().trim().min(1).max(120).required(),
  receiptFields: Joi.object().pattern(
    Joi.string().pattern(/^[a-z][a-zA-Z0-9]{0,39}$/),
    Joi.string().trim().allow('').max(500),
  ).max(20).required(),
  expectedVersion,
}).required();

export const updateLotterySchema = Joi.object({
  isEnabled: Joi.boolean().strict().required(),
  expectedVersion,
}).required();

export const updateModalitySchema = Joi.object({
  isEnabled: Joi.boolean().strict().required(),
  multiplier: Joi.string().trim().pattern(/^(?:0\.(?:0[1-9]|[1-9]\d?)|[1-9]\d{0,9}(?:\.\d{1,2})?)$/).required(),
  confirmed: Joi.boolean().valid(true).required(),
  expectedVersion,
}).required();

export const updateScheduleSchema = Joi.object({
  isEnabled: Joi.boolean().strict().required(),
  closeMinutesBefore: Joi.number().integer().min(10).max(20).required(),
  expectedVersion,
}).required();

export const updateGeneralLimitSchema = Joi.object({
  generalNumberLimit: moneyAmountSchema,
  applyToOpenDraws: Joi.boolean().strict().default(false),
  expectedVersion,
}).required();

export const updateDailyAvailabilitySchema = Joi.object({
  businessDate: businessDateSchema,
  isEnabledForSales: Joi.boolean().strict().required(),
  reason: Joi.string().trim().min(3).max(255).allow(null).default(null),
  expectedVersion,
}).required();
