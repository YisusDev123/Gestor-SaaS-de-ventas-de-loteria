import { Router } from 'express';

import { success } from '../../shared/utils/http-response.js';
import { requireObservabilityToken } from '../../shared/observability/require-observability-token.js';

export function createSystemRouter({ readinessCheck, runtimeConfig, metricsRegistry }) {
  const router = Router();

  router.get('/health/live', (_req, res) => success(res, { status: 'live' }));

  router.get('/health/ready', async (_req, res) => {
    try {
      await readinessCheck();
      return success(res, { status: 'ready' });
    } catch {
      return res.status(503).json({
        success: false,
        error: { code: 'SERVICE_NOT_READY', message: 'El servicio no está listo.' },
        correlationId: res.req.correlationId,
      });
    }
  });

  router.get(
    '/internal/version',
    requireObservabilityToken(runtimeConfig.security.observabilityToken),
    (_req, res) => success(res, {
      release: runtimeConfig.app.release,
      environment: runtimeConfig.app.environment,
      role: runtimeConfig.app.processRole,
    }),
  );

  router.get(
    '/internal/metrics',
    requireObservabilityToken(runtimeConfig.security.observabilityToken),
    (_req, res) => {
      res.type('text/plain; version=0.0.4');
      return res.send(metricsRegistry.render());
    },
  );

  return router;
}
