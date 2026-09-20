import Joi from 'joi';

export const requestIdSchema = Joi.string().guid({ version: ['uuidv4'] }).required();

export const moneyAmountSchema = Joi.string()
  .trim()
  .pattern(/^(0|[1-9]\d{0,12})(?:\.\d{1,2})?$/)
  .required();

export const positiveMoneyAmountSchema = moneyAmountSchema.custom((value, helpers) => {
  if (/^0(?:\.0{1,2})?$/.test(value)) return helpers.error('money.positive');
  return value;
}).messages({
  'money.positive': 'El monto debe ser mayor que cero.',
});

export const lotteryNumberSchema = Joi.string()
  .pattern(/^\d{2}$/)
  .custom((value, helpers) => {
    const number = Number(value);
    if (number < 0 || number > 99) return helpers.error('number.range');
    return value;
  })
  .messages({
    'number.range': 'El número debe estar entre 00 y 99.',
  })
  .required();

export const businessDateSchema = Joi.string()
  .pattern(/^\d{4}-\d{2}-\d{2}$/)
  .custom((value, helpers) => {
    const [year, month, day] = value.split('-').map(Number);
    const date = new Date(Date.UTC(year, month - 1, day));
    if (date.getUTCFullYear() !== year
      || date.getUTCMonth() !== month - 1
      || date.getUTCDate() !== day) {
      return helpers.error('date.format');
    }
    return value;
  })
  .required();

export const closeMinutesSchema = Joi.number().integer().min(10).max(20).default(10);
