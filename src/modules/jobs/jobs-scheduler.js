import cron from 'node-cron';

import { BUSINESS_TIME_ZONE } from '../../shared/utils/costa-rica-time.js';

export function iniciarJobsScheduler(jobsService, logger, cronClient = cron) {
  let running = false;
  let tasks = [];
  const activeExecutions = new Set();

  function track(name, operation) {
    const execution = Promise.resolve()
      .then(operation)
      .catch((error) => {
        logger.error('Job execution failed', {
          jobName: name,
          errorCode: error?.code || error?.name || 'JOB_EXECUTION_FAILED',
        });
      })
      .finally(() => activeExecutions.delete(execution));
    activeExecutions.add(execution);
    return execution;
  }

  return Object.freeze({
    async start() {
      if (running) return false;
      running = true;
      try {
        await jobsService.recuperarEjecucionesAbandonadas();
        await track('GENERATE_DRAWS', () => jobsService.generarSorteosDelDia({ trigger: 'STARTUP' }));
        await track('CLOSE_DRAWS', () => jobsService.cerrarSorteosVencidos({ trigger: 'STARTUP' }));
        await track('RECOVER_CASH_DAILY_CUTOFF', () => jobsService.recuperarCortesCaja());
        tasks = [
          cronClient.schedule('0 0 * * *', () => track(
            'GENERATE_DRAWS', () => jobsService.generarSorteosDelDia(),
          ), { timezone: BUSINESS_TIME_ZONE }),
          cronClient.schedule('*/5 * * * *', () => track(
            'RECOVER_DRAWS', () => jobsService.generarSorteosDelDia({ trigger: 'PERIODIC_RECOVERY' }),
          ), { timezone: BUSINESS_TIME_ZONE }),
          cronClient.schedule('* * * * *', () => track(
            'CLOSE_DRAWS', () => jobsService.cerrarSorteosVencidos(),
          ), { timezone: BUSINESS_TIME_ZONE }),
          cronClient.schedule('5 0 * * *', () => track(
            'CASH_DAILY_CUTOFF', () => jobsService.cerrarCajaDiaria(),
          ), { timezone: BUSINESS_TIME_ZONE }),
        ];
        return true;
      } catch (error) {
        for (const task of tasks) task.stop();
        tasks = [];
        running = false;
        throw error;
      }
    },

    async stop() {
      for (const task of tasks) task.stop();
      tasks = [];
      await Promise.allSettled([...activeExecutions]);
      running = false;
    },

    isRunning() {
      return running;
    },
  });
}
