import { logger } from '../observability/logger.js';

export function globalErrorHandler(error, req, res, _next) {
  const operational = error?.isOperational === true
    || (Number.isInteger(error?.statusCode) && error.statusCode >= 400 && error.statusCode < 500);
  const statusCode = operational ? error.statusCode : 500;
  const code = operational ? (error.code || error.publicCode || 'REQUEST_REJECTED') : 'INTERNAL_ERROR';
  const message = operational ? error.message : 'Ocurrió un error inesperado.';

  if (!operational) {
    const safeCode = typeof error?.code === 'string' ? error.code : (error?.name || 'Error');
    logger.error('Unexpected request error', {
      correlationId: req.correlationId,
      errorCode: safeCode,
    });
  }

  return res.status(statusCode).json({
    success: false,
    error: {
      code,
      message,
      ...(operational && error.details ? { details: error.details } : {}),
    },
    correlationId: req.correlationId,
  });
}
