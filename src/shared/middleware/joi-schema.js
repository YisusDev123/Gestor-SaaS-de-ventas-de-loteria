import { AppError } from '../error/app-error.js';

export function validar(schema, source = 'body') {
  return function validarSolicitud(req, _res, next) {
    const input = req.validated?.[source] ?? req[source];
    const result = schema.validate(input, {
      abortEarly: false,
      allowUnknown: false,
      convert: true,
      stripUnknown: false,
    });

    if (result.error) {
      return next(new AppError('La solicitud contiene datos inválidos.', {
        statusCode: 400,
        code: 'VALIDATION_ERROR',
        details: result.error.details.map((detail) => ({
          field: detail.path.join('.'),
          rule: detail.type,
        })),
      }));
    }

    req.validated = req.validated || {};
    req.validated[source] = result.value;
    if (source === 'body') req.body = result.value;
    if (source === 'params') {
      Object.keys(req.params).forEach((key) => delete req.params[key]);
      Object.assign(req.params, result.value);
    }
    return next();
  };
}
