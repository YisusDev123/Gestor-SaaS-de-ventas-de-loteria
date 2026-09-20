import request from 'supertest';

import { createApp } from '../../app.js';
import { loadConfig } from '../config/environment.js';
import { createMetricsRegistry } from '../shared/observability/metrics.js';

const runtimeConfig = loadConfig({ NODE_ENV: 'test' });

describe('aplicación base', () => {
  test('responde liveness y conserva correlation id seguro', async () => {
    const app = createApp(runtimeConfig, { readinessCheck: async () => true });
    const response = await request(app)
      .get('/health/live')
      .set('X-Correlation-Id', 'test-correlation-1');

    expect(response.status).toBe(200);
    expect(response.headers['x-correlation-id']).toBe('test-correlation-1');
    expect(response.body).toEqual({
      success: true,
      data: { status: 'live' },
      correlationId: 'test-correlation-1',
    });
  });

  test('readiness responde 503 sin revelar el error interno', async () => {
    const app = createApp(runtimeConfig, {
      readinessCheck: async () => { throw new Error('detalle privado'); },
    });
    const response = await request(app).get('/health/ready');

    expect(response.status).toBe(503);
    expect(response.body.error).toEqual({
      code: 'SERVICE_NOT_READY',
      message: 'El servicio no está listo.',
    });
    expect(JSON.stringify(response.body)).not.toContain('detalle privado');
  });

  test('rechaza un origen CORS ajeno a la allowlist', async () => {
    const app = createApp(runtimeConfig, { readinessCheck: async () => true });
    const response = await request(app)
      .get('/health/live')
      .set('Origin', 'https://example.invalid');

    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe('CORS_ORIGIN_DENIED');
  });

  test('normaliza rutas desconocidas', async () => {
    const app = createApp(runtimeConfig, { readinessCheck: async () => true });
    const response = await request(app).get('/ruta-inexistente');

    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe('ROUTE_NOT_FOUND');
  });

  test('monta la configuración tenant detrás de autenticación', async () => {
    const app = createApp(runtimeConfig, { readinessCheck: async () => true });
    const response = await request(app).get('/tenant-settings');

    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe('AUTHENTICATION_REQUIRED');
  });

  test('protege release y rol detrás del token de observabilidad', async () => {
    const app = createApp(runtimeConfig, { readinessCheck: async () => true });
    const response = await request(app)
      .get('/internal/version')
      .set('Authorization', `Bearer ${runtimeConfig.security.observabilityToken}`);

    expect(response.status).toBe(200);
    expect(response.body.data).toEqual({
      release: 'test',
      environment: 'test',
      role: 'all',
    });
    expect(JSON.stringify(response.body)).not.toContain(runtimeConfig.security.jwtSecret);
  });

  test('permite healthchecks internos por HTTP cuando la política exige HTTPS', async () => {
    const secureConfig = {
      ...runtimeConfig,
      app: { ...runtimeConfig.app, requireHttps: true },
    };
    const app = createApp(secureConfig, { readinessCheck: async () => true });
    const liveResponse = await request(app).get('/health/live');
    const readyResponse = await request(app).get('/health/ready');

    expect(liveResponse.status).toBe(200);
    expect(readyResponse.status).toBe(200);
  });

  test('rechaza HTTP en rutas ajenas a los healthchecks', async () => {
    const secureConfig = {
      ...runtimeConfig,
      app: { ...runtimeConfig.app, requireHttps: true },
    };
    const app = createApp(secureConfig, { readinessCheck: async () => true });
    const response = await request(app).get('/ruta-inexistente');

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('HTTPS_REQUIRED');
  });

  test('protege las métricas internas y entrega formato Prometheus', async () => {
    const metricsRegistry = createMetricsRegistry();
    const app = createApp(runtimeConfig, {
      readinessCheck: async () => true,
      metricsRegistry,
    });

    const missing = await request(app).get('/internal/metrics');
    expect(missing.status).toBe(401);
    expect(missing.body.error.code).toBe('OBSERVABILITY_AUTH_REQUIRED');

    const invalid = await request(app)
      .get('/internal/metrics')
      .set('Authorization', 'Bearer invalid-token');
    expect(invalid.status).toBe(403);
    expect(invalid.body.error.code).toBe('OBSERVABILITY_AUTH_INVALID');

    const valid = await request(app)
      .get('/internal/metrics')
      .set('Authorization', `Bearer ${runtimeConfig.security.observabilityToken}`);
    expect(valid.status).toBe(200);
    expect(valid.headers['content-type']).toContain('text/plain');
    expect(valid.text).toContain('saas_http_requests_total');
    expect(valid.text).toContain('saas_mysql_pool_open 0');
    expect(valid.text).not.toContain(runtimeConfig.security.observabilityToken);
  });
});
