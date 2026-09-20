import compression from 'compression';
import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import hpp from 'hpp';

import config from './config.js';
import { createCorsOptions } from './src/config/cors.js';
import { database } from './src/config/pool.js';
import routesAuth from './src/modules/auth/auth-routes.js';
import routesCash from './src/modules/cash/cash-routes.js';
import routesReports from './src/modules/reports/reports-routes.js';
import routesResults from './src/modules/results/results-routes.js';
import routesSaasAdmin from './src/modules/saas-admin/saas-admin-routes.js';
import routesSales from './src/modules/sales/sales-routes.js';
import routesTenantSettings from './src/modules/tenant-settings/tenant-settings-routes.js';
import { createSystemRouter } from './src/modules/system/system-routes.js';
import { globalErrorHandler } from './src/shared/error/global-error-handler.js';
import { correlationId } from './src/shared/middleware/correlation-id.js';
import { notFoundHandler } from './src/shared/middleware/not-found.js';
import { requireHttps } from './src/shared/middleware/require-https.js';
import { logger } from './src/shared/observability/logger.js';
import { metricsRegistry as defaultMetricsRegistry } from './src/shared/observability/metrics.js';
import { createRequestLogger } from './src/shared/observability/request-logger.js';
import { crearLimiter } from './src/shared/middleware/rate-limit.js';

export function createApp(runtimeConfig = config, dependencies = {}) {
  const app = express();
  const readinessCheck = dependencies.readinessCheck || (() => database.readiness());
  const metricsRegistry = dependencies.metricsRegistry || defaultMetricsRegistry;
  const requestLogger = dependencies.logger || logger;

  app.disable('x-powered-by');
  app.set('port', runtimeConfig.app.port);
  app.set('trust proxy', runtimeConfig.app.trustProxy);

  app.use(correlationId);
  app.use(metricsRegistry.httpMiddleware);
  app.use(createRequestLogger(requestLogger));
  app.use(helmet());
  app.use(hpp());
  app.use(compression());
  app.use(requireHttps(runtimeConfig));
  app.use(cors(createCorsOptions(runtimeConfig.security.corsAllowedOrigins)));
  app.use(crearLimiter(300, { name: 'global', windowMs: 60_000 }));
  app.use(express.json({ limit: '16kb' }));
  app.use(express.urlencoded({ extended: false, limit: '16kb' }));

  app.use('/auth', routesAuth);
  app.use('/cash', routesCash);
  app.use('/reports', routesReports);
  app.use('/results', routesResults);
  app.use('/saas-admin', routesSaasAdmin);
  app.use('/sales', routesSales);
  app.use('/tenant-settings', routesTenantSettings);
  app.use(createSystemRouter({ readinessCheck, runtimeConfig, metricsRegistry }));
  app.use(notFoundHandler);
  app.use(globalErrorHandler);
  return app;
}
