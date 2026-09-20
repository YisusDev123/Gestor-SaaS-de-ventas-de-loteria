import Joi from 'joi';

export const loginSchema = Joi.object({
  email: Joi.string().trim().lowercase().email({ tlds: { allow: false } }).max(254).required(),
  password: Joi.string().min(8).max(128).required(),
}).required();

export const webSessionSchema = Joi.object({}).max(0).required();

export const forgotPasswordSchema = Joi.object({
  email: Joi.string().trim().lowercase().email({ tlds: { allow: false } }).max(254).required(),
}).required();

export const resetPasswordSchema = Joi.object({
  token: Joi.string().trim().pattern(/^[A-Za-z0-9_-]{43}$/).required(),
  newPassword: Joi.string().min(8).max(128).required(),
}).required();
