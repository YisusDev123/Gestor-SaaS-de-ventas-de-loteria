import path from 'node:path';

import winston from 'winston';
import DailyRotateFile from 'winston-daily-rotate-file';

import config from '../../../config.js';
import { sanitizeMetadata } from './sanitize.js';

function buildTransports(environment) {
  if (environment === 'test') {
    return [new winston.transports.Console({ silent: true })];
  }

  const transports = [new winston.transports.Console()];
  transports.push(new DailyRotateFile({
    dirname: path.resolve('logs'),
    filename: 'application-%DATE%.log',
    datePattern: 'YYYY-MM-DD',
    zippedArchive: true,
    maxSize: '10m',
    maxFiles: '14d',
    level: 'info',
  }));
  transports.push(new DailyRotateFile({
    dirname: path.resolve('logs'),
    filename: 'error-%DATE%.log',
    datePattern: 'YYYY-MM-DD',
    zippedArchive: true,
    maxSize: '10m',
    maxFiles: '30d',
    level: 'error',
  }));
  return transports;
}

export function createLogger(runtimeConfig = config, transportOverride) {
  const baseLogger = winston.createLogger({
    level: runtimeConfig.app.environment === 'development' ? 'debug' : 'info',
    format: winston.format.combine(
      winston.format.timestamp(),
      winston.format.json(),
    ),
    defaultMeta: {
      service: 'saas-jps-api',
      release: runtimeConfig.app.release,
      environment: runtimeConfig.app.environment,
    },
    transports: transportOverride || buildTransports(runtimeConfig.app.environment),
    exitOnError: false,
  });

  function write(level, message, metadata = {}) {
    const safeMessage = sanitizeMetadata({ message: String(message).slice(0, 300) }).message;
    baseLogger.log(level, safeMessage, sanitizeMetadata(metadata));
  }

  return Object.freeze({
    debug: (message, metadata) => write('debug', message, metadata),
    info: (message, metadata) => write('info', message, metadata),
    warn: (message, metadata) => write('warn', message, metadata),
    error: (message, metadata) => write('error', message, metadata),
    close: () => baseLogger.close(),
  });
}

export const logger = createLogger();
