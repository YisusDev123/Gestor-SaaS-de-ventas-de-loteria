import { createApp } from './app.js';
import { configureHttpServer } from './src/config/http-server.js';
import { createFatalErrorHandler } from './src/config/process-errors.js';
import { createGracefulShutdown } from './src/config/shutdown.js';
import { applicationContainer } from './src/container/application-container.js';
import { logger } from './src/shared/observability/logger.js';

async function main() {
  const {
    runtimeConfig,
    database,
    jobs,
    readinessCheck,
    metrics,
  } = applicationContainer;
  const role = runtimeConfig.app.processRole;
  let server = null;

  const shutdown = createGracefulShutdown({
    getServer: () => server,
    stopJobs: () => jobs.stop(),
    closeDatabase: () => database.close(),
    timeoutMs: runtimeConfig.app.http.shutdownTimeoutMs,
  });
  const fatal = createFatalErrorHandler({
    shutdown,
    log: (message) => logger.error(message),
  });

  process.once('SIGTERM', () => shutdown('SIGTERM'));
  process.once('SIGINT', () => shutdown('SIGINT'));
  process.once('uncaughtException', (error) => fatal('uncaughtException', error));
  process.once('unhandledRejection', (error) => fatal('unhandledRejection', error));

  await database.initialize();
  if (role === 'all' || role === 'worker') await jobs.start();

  if (role === 'all' || role === 'api') {
    const app = createApp(runtimeConfig, { readinessCheck, metricsRegistry: metrics });
    server = app.listen(runtimeConfig.app.port, () => {
      logger.info('API started', { port: runtimeConfig.app.port, role });
    });
    configureHttpServer(server, runtimeConfig.app.http);
    server.on('error', (error) => fatal('httpServer', error));
  } else {
    logger.info('Worker started without HTTP server');
  }
}

main().catch(async (error) => {
  const safeCode = error?.code || error?.name || 'BOOT_FAILURE';
  logger.error('Fatal boot error', { errorCode: safeCode });
  await applicationContainer.jobs.stop().catch(() => {});
  await applicationContainer.database.close().catch(() => {});
  process.exitCode = 1;
});
