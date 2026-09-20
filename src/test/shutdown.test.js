import { jest } from '@jest/globals';

import { configureHttpServer } from '../config/http-server.js';
import { createFatalErrorHandler } from '../config/process-errors.js';
import { createGracefulShutdown } from '../config/shutdown.js';

describe('ciclo de vida HTTP', () => {
  test('aplica timeouts explícitos al servidor', () => {
    const server = {};
    configureHttpServer(server, {
      requestTimeoutMs: 15000,
      headersTimeoutMs: 10000,
      keepAliveTimeoutMs: 5000,
    });

    expect(server).toMatchObject({
      requestTimeout: 15000,
      headersTimeout: 10000,
      keepAliveTimeout: 5000,
    });
  });

  test('detiene HTTP, jobs y base una sola vez', async () => {
    const server = {
      close: jest.fn((callback) => callback()),
      closeIdleConnections: jest.fn(),
    };
    const stopJobs = jest.fn().mockResolvedValue(undefined);
    const closeDatabase = jest.fn().mockResolvedValue(undefined);
    const exit = jest.fn();
    const shutdown = createGracefulShutdown({
      getServer: () => server,
      stopJobs,
      closeDatabase,
      timeoutMs: 1000,
      exit,
    });

    await expect(shutdown('SIGTERM')).resolves.toBe(true);
    await expect(shutdown('SIGINT')).resolves.toBe(false);
    expect(server.close).toHaveBeenCalledTimes(1);
    expect(stopJobs).toHaveBeenCalledTimes(1);
    expect(closeDatabase).toHaveBeenCalledTimes(1);
    expect(exit).toHaveBeenCalledWith(0);
  });

  test('rechaza una relación insegura entre timeouts HTTP', () => {
    expect(() => configureHttpServer({}, {
      requestTimeoutMs: 5000,
      headersTimeoutMs: 6000,
      keepAliveTimeoutMs: 1000,
    })).toThrow('HTTP_HEADERS_TIMEOUT_EXCEEDS_REQUEST_TIMEOUT');
  });

  test('sale con error cuando falla el apagado', async () => {
    const exit = jest.fn();
    const shutdown = createGracefulShutdown({
      getServer: () => null,
      stopJobs: jest.fn().mockRejectedValue(new Error('stop failed')),
      closeDatabase: jest.fn(),
      timeoutMs: 1000,
      exit,
    });

    await expect(shutdown('SIGTERM')).resolves.toBe(false);
    expect(exit).toHaveBeenCalledWith(1);
  });

  test('el manejador fatal registra sólo un código seguro y actúa una vez', async () => {
    const shutdown = jest.fn().mockResolvedValue(true);
    const log = jest.fn();
    const fatal = createFatalErrorHandler({ shutdown, log });

    await expect(fatal('test', { code: 'SAFE_CODE', secret: 'hidden' })).resolves.toBe(true);
    await expect(fatal('again', new Error('hidden'))).resolves.toBe(false);
    expect(log).toHaveBeenCalledWith('[FATAL] test:SAFE_CODE');
    expect(shutdown).toHaveBeenCalledTimes(1);
  });
});
