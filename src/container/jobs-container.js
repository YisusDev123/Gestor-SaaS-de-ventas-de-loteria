import { pool } from '../config/pool.js';
import { iniciarJobsScheduler } from '../modules/jobs/jobs-scheduler.js';
import { iniciarJobsService } from '../modules/jobs/jobs-services.js';
import { iniciarBaseDeDatosJobs } from '../shared/database/jobs-sql.js';
import { iniciarBaseDeDatosCash } from '../shared/database/cash-sql.js';
import { logger } from '../shared/observability/logger.js';

const baseDeDatosJobs = iniciarBaseDeDatosJobs(pool);
const baseDeDatosCash = iniciarBaseDeDatosCash(pool);
const jobsService = iniciarJobsService(baseDeDatosJobs, baseDeDatosCash);
const jobsScheduler = iniciarJobsScheduler(jobsService, logger);

export const jobsContainer = Object.freeze({
  baseDeDatosJobs,
  jobsService,
  jobsScheduler,
});
