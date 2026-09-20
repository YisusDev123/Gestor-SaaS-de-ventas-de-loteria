import fs from 'node:fs';

import mysql from 'mysql2/promise';

import config from '../../config.js';
import { metricsRegistry } from '../shared/observability/metrics.js';

export function createDatabaseLifecycle(
  runtimeConfig = config,
  mysqlClient = mysql,
  metrics = metricsRegistry,
) {
  let pool = null;

  function getPool() {
    if (pool) return pool;
    const mysqlOptions = {
      host: runtimeConfig.mysql.host,
      port: runtimeConfig.mysql.port,
      user: runtimeConfig.mysql.user,
      password: runtimeConfig.mysql.password,
      database: runtimeConfig.mysql.database,
      waitForConnections: true,
      connectionLimit: runtimeConfig.mysql.connectionLimit,
      queueLimit: runtimeConfig.mysql.queueLimit,
      namedPlaceholders: true,
      timezone: '+00:00',
      dateStrings: true,
      supportBigNumbers: true,
      bigNumberStrings: true,
      decimalNumbers: false,
      enableKeepAlive: true,
      keepAliveInitialDelay: 0,
      connectTimeout: runtimeConfig.mysql.acquireTimeoutMs,
    };
    if (runtimeConfig.mysql.sslCa) {
      mysqlOptions.ssl = { ca: fs.readFileSync(runtimeConfig.mysql.sslCa, 'utf8') };
    }
    pool = mysqlClient.createPool(mysqlOptions);
    metrics.setMysqlPoolOpen(true);

    pool.on('connection', (connection) => {
      connection.query({
        sql: 'SET SESSION time_zone = "+00:00", innodb_lock_wait_timeout = ?, max_execution_time = ?',
        timeout: runtimeConfig.mysql.queryTimeoutMs,
        values: [
          runtimeConfig.mysql.lockWaitTimeoutSeconds,
          runtimeConfig.mysql.queryTimeoutMs,
        ],
      }, (error) => {
        if (error) {
          metrics.recordMysqlSessionError();
          connection.destroy();
        }
      });
    });
    return pool;
  }

  async function getConnection() {
    const activePool = getPool();
    let settled = false;
    let timer;
    const acquisition = activePool.getConnection().then(
      (connection) => {
        if (settled) {
          connection.release();
          return null;
        }
        settled = true;
        clearTimeout(timer);
        metrics.recordMysqlAcquisition({ success: true });
        return connection;
      },
      (error) => {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          metrics.recordMysqlAcquisition({ success: false, code: error?.code });
        }
        throw error;
      },
    );
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        const error = new Error('Tiempo de adquisición de conexión agotado.');
        error.code = 'POOL_ACQUIRE_TIMEOUT';
        metrics.recordMysqlAcquisition({ success: false, code: error.code });
        reject(error);
      }, runtimeConfig.mysql.acquireTimeoutMs);
      timer.unref?.();
    });
    return Promise.race([acquisition, timeout]);
  }

  async function queryWithConnection(sql) {
    const connection = await getConnection();
    try {
      return await connection.query({ sql, timeout: runtimeConfig.mysql.queryTimeoutMs });
    } finally {
      connection.release();
    }
  }

  async function initialize() {
    try {
      await queryWithConnection('SELECT 1 AS database_ready');
    } catch {
      const error = new Error('No se pudo inicializar MySQL.');
      error.name = 'DatabaseInitializationError';
      error.code = 'DATABASE_UNAVAILABLE';
      throw error;
    }
  }

  async function readiness() {
    try {
      await queryWithConnection('SELECT 1 AS database_ready');
      metrics.recordReadiness(true);
      return true;
    } catch (error) {
      metrics.recordReadiness(false);
      throw error;
    }
  }

  async function close() {
    if (!pool) return;
    const activePool = pool;
    pool = null;
    try {
      await activePool.end();
    } finally {
      metrics.setMysqlPoolOpen(false);
    }
  }

  return Object.freeze({ getPool, getConnection, initialize, readiness, close });
}

export const database = createDatabaseLifecycle();

// Proxy perezoso para conservar el patrón de factories SQL del proyecto original
// sin abrir el pool durante la importación de módulos.
export const pool = Object.freeze({
  query: (...args) => database.getPool().query(...args),
  execute: (...args) => database.getPool().execute(...args),
  getConnection: () => database.getConnection(),
});
