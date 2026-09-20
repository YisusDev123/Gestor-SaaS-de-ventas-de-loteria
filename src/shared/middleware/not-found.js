import { AppError } from '../error/app-error.js';

export function notFoundHandler(req, _res, next) {
  next(new AppError('La ruta solicitada no existe.', {
    statusCode: 404,
    code: 'ROUTE_NOT_FOUND',
  }));
}
