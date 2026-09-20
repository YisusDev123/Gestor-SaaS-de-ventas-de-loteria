import { jest } from '@jest/globals';

import { loadConfig } from '../config/environment.js';
import { createApplicationContainer } from '../container/application-container.js';

describe('composition root', () => {
  test('inyecta configuración y ciclo de vida sin efectos laterales', async () => {
    const runtimeConfig = loadConfig({ NODE_ENV: 'test' });
    const databaseLifecycle = {
      readiness: jest.fn().mockResolvedValue(true),
    };
    const metrics = { setJobsRunning: jest.fn() };
    let jobsRunning = false;
    const jobsLifecycle = {
      start: jest.fn(async () => { jobsRunning = true; }),
      stop: jest.fn(async () => { jobsRunning = false; }),
      isRunning: jest.fn(() => jobsRunning),
    };
    const container = createApplicationContainer({
      runtimeConfig, databaseLifecycle, metrics, jobsLifecycle,
    });

    expect(container.runtimeConfig).toBe(runtimeConfig);
    expect(container.database).toBe(databaseLifecycle);
    await expect(container.readinessCheck()).resolves.toBe(true);
    await expect(container.jobs.start()).resolves.toBeUndefined();
    expect(container.jobs.isRunning()).toBe(true);
    await expect(container.jobs.stop()).resolves.toBeUndefined();
    expect(container.jobs.isRunning()).toBe(false);
    expect(metrics.setJobsRunning).toHaveBeenNthCalledWith(1, true);
    expect(metrics.setJobsRunning).toHaveBeenNthCalledWith(2, false);
  });
});
