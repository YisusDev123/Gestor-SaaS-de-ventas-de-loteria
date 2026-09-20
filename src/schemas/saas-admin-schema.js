import Joi from 'joi';

import { positiveMoneyAmountSchema, requestIdSchema } from './common-schema.js';
import { paginationQuerySchema } from './pagination-schema.js';

const email = Joi.string().trim().lowercase().email({ tlds: { allow: false } }).max(254);
const publicId = Joi.string().trim().uppercase().pattern(/^[0-9A-HJKMNP-TV-Z]{26}$/);

export const saasAdminLoginSchema = Joi.object({
  email: email.required(),
  password: Joi.string().min(8).max(128).required(),
}).required();

export const createTenantSchema = Joi.object({
  displayName: Joi.string().trim().min(1).max(120).required(),
  ownerEmail: email.required(),
  planCode: Joi.string().trim().uppercase().pattern(/^[A-Z0-9_]{1,40}$/)
    .default('MONTHLY_BASE'),
}).required();

export const tenantPublicIdParamsSchema = Joi.object({
  tenantId: publicId.required(),
}).required();

export const changeTenantStatusSchema = Joi.object({
  status: Joi.string().valid('ACTIVE', 'SUSPENDED', 'CLOSED').required(),
  reason: Joi.string().trim().min(3).max(500).when('status', {
    is: 'ACTIVE',
    then: Joi.optional(),
    otherwise: Joi.required(),
  }),
}).required();

export const saasAdminWebSessionSchema = Joi.object({}).max(0).required();

export const planCodeParamsSchema = Joi.object({
  planCode: Joi.string().trim().uppercase().pattern(/^[A-Z0-9_]{1,40}$/).required(),
}).required();

export const updatePlanPriceSchema = Joi.object({
  currentPrice: positiveMoneyAmountSchema,
}).required();

export const confirmSubscriptionPaymentSchema = Joi.object({
  requestId: requestIdSchema,
  amount: positiveMoneyAmountSchema,
  startsAt: Joi.date().iso().required(),
  accessEndsAt: Joi.date().iso().greater(Joi.ref('startsAt')).required(),
  paidAt: Joi.date().iso().required(),
  note: Joi.string().trim().min(1).max(500).optional(),
}).required();

export const listTenantsQuerySchema = paginationQuerySchema.keys({
  status: Joi.string().valid('ACTIVE', 'SUSPENDED', 'CLOSED').optional(),
  subscriptionStatus: Joi.string().valid('TRIAL', 'ACTIVE', 'EXPIRED', 'SUSPENDED', 'CLOSED').optional(),
  search: Joi.string().trim().max(120).optional(),
});

export const listAuditEventsQuerySchema = paginationQuerySchema.keys({
  tenantId: publicId.optional(),
  actorScope: Joi.string().valid('USER', 'ADMIN', 'JOB', 'SYSTEM').optional(),
  eventType: Joi.string().trim().uppercase().pattern(/^[A-Z0-9_]{1,80}$/).optional(),
});
