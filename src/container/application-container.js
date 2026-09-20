import config from '../../config.js';
import { database } from '../config/pool.js';
import { metricsRegistry } from '../shared/observability/metrics.js';
import { jobsContainer } from './jobs-container.js';

export function createApplicationContainer({
  runtimeConfig = config,
  databaseLifecycle = database,
  metrics = metricsRegistry,
  jobsLifecycle = jobsContainer.jobsScheduler,
} = {}) {
  return Object.freeze({
    runtimeConfig,
    database: databaseLifecycle,
    readinessCheck: () => databaseLifecycle.readiness(),
    metrics,
    jobs: Object.freeze({
      async start() {
        const started = await jobsLifecycle.start();
        metrics.setJobsRunning(true);
        return started;
      },
      async stop() {
        await jobsLifecycle.stop();
        metrics.setJobsRunning(false);
      },
      isRunning: () => jobsLifecycle.isRunning(),
    }),
  });
}

export const applicationContainer = createApplicationContainer();
