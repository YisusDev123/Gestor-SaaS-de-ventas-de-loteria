import Joi from 'joi';

export const paginationQuerySchema = Joi.object({
  cursor: Joi.string().trim().max(1024).pattern(/^[A-Za-z0-9._-]+$/).optional(),
  limit: Joi.number().integer().min(1).max(100).default(25),
});
