import { AppError } from '../error/app-error.js';

const REQUEST_PARTS = ['params', 'query', 'body'];

function validationDetails(error) {
  return error.details.map((detail) => ({
    field: detail.path.join('.'),
    rule: detail.type,
  }));
}

export function validateRequest(schemas) {
  const configuredParts = REQUEST_PARTS.filter((part) => schemas[part]);

  return function requestValidation(req, _res, next) {
    const validated = {};

    for (const part of configuredParts) {
      const result = schemas[part].validate(req[part], {
        abortEarly: false,
        allowUnknown: false,
        convert: true,
        stripUnknown: false,
      });
      if (result.error) {
        return next(new AppError('La solicitud contiene datos inválidos.', {
          statusCode: 400,
          code: 'VALIDATION_ERROR',
          details: validationDetails(result.error),
        }));
      }
      validated[part] = result.value;
    }

    req.validated = Object.freeze(validated);
    return next();
  };
}
