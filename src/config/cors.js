import { AppError } from '../shared/error/app-error.js';

export function createCorsOptions(allowedOrigins) {
  const allowed = new Set(allowedOrigins);
  return {
    origin(origin, callback) {
      if (!origin || allowed.has(origin)) return callback(null, true);
      return callback(new AppError('El origen de la solicitud no está permitido.', {
        statusCode: 403,
        code: 'CORS_ORIGIN_DENIED',
      }));
    },
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    exposedHeaders: ['Content-Disposition', 'X-Correlation-Id'],
    credentials: true,
    optionsSuccessStatus: 204,
  };
}
