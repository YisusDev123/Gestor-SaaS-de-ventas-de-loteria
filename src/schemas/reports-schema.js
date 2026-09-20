import Joi from 'joi';

import { businessDateSchema } from './common-schema.js';
import { paginationQuerySchema } from './pagination-schema.js';

const publicIdSchema = Joi.string().length(26).pattern(/^[0-9A-HJKMNP-TV-Z]+$/).required();

export const dashboardQuerySchema = Joi.object({
  businessDate: businessDateSchema.optional(),
});

export const reportedDrawsQuerySchema = paginationQuerySchema.keys({
  businessDate: businessDateSchema.optional(),
});

export const reportWinnersQuerySchema = paginationQuerySchema;

export const reportDrawParamsSchema = Joi.object({ drawPublicId: publicIdSchema });

export const reportRangeQuerySchema = Joi.object({
  dateFrom: businessDateSchema.optional(),
  dateTo: businessDateSchema.optional(),
});

export const reconciliationQuerySchema = Joi.object({
  businessDate: businessDateSchema.optional(),
});
