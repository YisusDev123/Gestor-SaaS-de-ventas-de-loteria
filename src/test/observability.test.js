import { jest } from '@jest/globals';

import { createMetricsRegistry } from '../shared/observability/metrics.js';
import { createRequestLogger } from '../shared/observability/request-logger.js';
import { sanitizeMetadata } from '../shared/observability/sanitize.js';

describe('sanitización de observabilidad', () => {
  test('redacta secretos anidados, bearer y JWT sin mutar el origen', () => {
    const source = {
      user: 'seller',
      password: 'hidden',
      nested: {
        authorization: 'Bearer abc.def.ghi',
        note: 'Authorization Bearer visible-secret',
      },
      amount: 1000n,
    };
    const sanitized = sanitizeMetadata(source);

    expect(sanitized).toEqual({
      user: 'seller',
      password: '[REDACTED]',
      nested: {
        authorization: '[REDACTED]',
        note: 'Authorization Bearer [REDACTED]',
      },
      amount: '1000',
    });
    expect(source.password).toBe('hidden');
  });

  test('controla ciclos, errores y profundidad', () => {
    const circular = { level: 1 };
    circular.self = circular;
    const sanitized = sanitizeMetadata({
      circular,
      error: Object.assign(new Error('private message'), { code: 'SAFE_ERROR' }),
    });

    expect(sanitized.circular.self).toBe('[CIRCULAR]');
    expect(sanitized.error).toEqual({
      name: 'Error',
      code: 'SAFE_ERROR',
      operational: false,
    });
    expect(JSON.stringify(sanitized)).not.toContain('private message');
  });
});

describe('métricas', () => {
  test('registra MySQL y jobs con contadores de baja cardinalidad', () => {
    const metrics = createMetricsRegistry();
    metrics.setMysqlPoolOpen(true);
    metrics.recordMysqlAcquisition({ success: true });
    metrics.recordMysqlAcquisition({ success: false, code: 'POOL_ACQUIRE_TIMEOUT' });
    metrics.recordMysqlSessionError();
    metrics.recordReadiness(true);
    metrics.recordReadiness(false);
    metrics.setJobsRunning(true);

    const output = metrics.render();
    expect(output).toContain('saas_mysql_pool_open 1');
    expect(output).toContain('saas_mysql_acquisitions_total 2');
    expect(output).toContain('saas_mysql_acquisition_failures_total 1');
    expect(output).toContain('saas_mysql_acquisition_timeouts_total 1');
    expect(output).toContain('saas_mysql_session_errors_total 1');
    expect(output).toContain('saas_mysql_readiness_success_total 1');
    expect(output).toContain('saas_mysql_readiness_failures_total 1');
    expect(output).toContain('saas_jobs_running 1');
  });
});

describe('request logger', () => {
  test.each([
    [200, 'info'],
    [404, 'warn'],
    [500, 'error'],
  ])('elige nivel seguro para status %s', (statusCode, expectedMethod) => {
    const logger = {
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    };
    const middleware = createRequestLogger(logger);
    const listeners = {};
    const req = { method: 'GET', correlationId: 'cid', route: { path: '/resource/:id' } };
    const res = {
      statusCode,
      once: jest.fn((event, handler) => { listeners[event] = handler; }),
    };
    const next = jest.fn();

    middleware(req, res, next);
    listeners.finish();

    expect(next).toHaveBeenCalledTimes(1);
    expect(logger[expectedMethod]).toHaveBeenCalledWith(
      'HTTP request completed',
      expect.objectContaining({
        correlationId: 'cid',
        method: 'GET',
        route: '/resource/:id',
        statusCode,
      }),
    );
  });

  test('no registra query, body, cookies, autorización ni identificadores concretos', () => {
    const logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn() };
    const listeners = {};
    const middleware = createRequestLogger(logger);
    const req = {
      method: 'POST',
      originalUrl: '/tickets/private-id?token=secret',
      body: { password: 'secret', buyerReference: 'private-buyer' },
      headers: { authorization: 'Bearer secret', cookie: 'session=secret' },
      correlationId: 'safe-correlation',
      route: { path: '/tickets/:ticketCode' },
    };
    const res = {
      statusCode: 201,
      once: jest.fn((event, handler) => { listeners[event] = handler; }),
    };

    middleware(req, res, jest.fn());
    listeners.finish();

    const serialized = JSON.stringify(logger.info.mock.calls);
    expect(serialized).toContain('/tickets/:ticketCode');
    expect(serialized).not.toContain('private-id');
    expect(serialized).not.toContain('private-buyer');
    expect(serialized).not.toContain('session=secret');
    expect(serialized).not.toContain('Bearer secret');
  });
});
