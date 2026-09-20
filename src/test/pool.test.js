import { jest } from '@jest/globals';

import { loadConfig } from '../config/environment.js';
import { createDatabaseLifecycle } from '../config/pool.js';

describe('ciclo de vida MySQL', () => {
  test('no crea el pool ni conecta durante la construcción', async () => {
    const fakePool = {
      on: jest.fn(),
      end: jest.fn().mockResolvedValue(undefined),
    };
    const mysqlClient = { createPool: jest.fn(() => fakePool) };
    const lifecycle = createDatabaseLifecycle(
      loadConfig({ NODE_ENV: 'test' }),
      mysqlClient,
    );

    expect(mysqlClient.createPool).not.toHaveBeenCalled();
    expect(lifecycle.getPool()).toBe(fakePool);
    expect(mysqlClient.createPool).toHaveBeenCalledTimes(1);
    expect(lifecycle.getPool()).toBe(fakePool);
    expect(mysqlClient.createPool).toHaveBeenCalledTimes(1);

    await lifecycle.close();
    expect(fakePool.end).toHaveBeenCalledTimes(1);
  });

  test('cerrar sin haber creado el pool es seguro', async () => {
    const mysqlClient = { createPool: jest.fn() };
    const lifecycle = createDatabaseLifecycle(
      loadConfig({ NODE_ENV: 'test' }),
      mysqlClient,
    );

    await expect(lifecycle.close()).resolves.toBeUndefined();
    expect(mysqlClient.createPool).not.toHaveBeenCalled();
  });

  test('inicializa, comprueba readiness y cierra usando conexiones liberadas', async () => {
    const connection = {
      query: jest.fn().mockResolvedValue([[{ database_ready: 1 }]]),
      release: jest.fn(),
    };
    const fakePool = {
      on: jest.fn(),
      getConnection: jest.fn().mockResolvedValue(connection),
      end: jest.fn().mockResolvedValue(undefined),
    };
    const lifecycle = createDatabaseLifecycle(
      loadConfig({ NODE_ENV: 'test' }),
      { createPool: jest.fn(() => fakePool) },
    );

    await expect(lifecycle.initialize()).resolves.toBeUndefined();
    await expect(lifecycle.readiness()).resolves.toBe(true);
    expect(connection.release).toHaveBeenCalledTimes(2);
    await lifecycle.close();
    expect(fakePool.end).toHaveBeenCalledTimes(1);
  });

  test('normaliza fallos de inicialización sin revelar el error de MySQL', async () => {
    const fakePool = {
      on: jest.fn(),
      getConnection: jest.fn().mockRejectedValue(new Error('secret-db-detail')),
      end: jest.fn().mockResolvedValue(undefined),
    };
    const lifecycle = createDatabaseLifecycle(
      loadConfig({ NODE_ENV: 'test' }),
      { createPool: jest.fn(() => fakePool) },
    );

    await expect(lifecycle.initialize()).rejects.toMatchObject({
      code: 'DATABASE_UNAVAILABLE',
      message: 'No se pudo inicializar MySQL.',
    });
    await lifecycle.close();
  });

  test('destruye una conexión física si no puede fijar la sesión segura', () => {
    const fakePool = { on: jest.fn(), end: jest.fn() };
    const lifecycle = createDatabaseLifecycle(
      loadConfig({ NODE_ENV: 'test' }),
      { createPool: jest.fn(() => fakePool) },
    );
    lifecycle.getPool();
    const connectionHandler = fakePool.on.mock.calls[0][1];
    const physicalConnection = {
      query: jest.fn((_options, callback) => callback(new Error('session error'))),
      destroy: jest.fn(),
    };

    connectionHandler(physicalConnection);
    expect(physicalConnection.destroy).toHaveBeenCalledTimes(1);
  });
});
