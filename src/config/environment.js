const TEST_DEFAULTS = Object.freeze({
  MYSQL_HOST: '127.0.0.1',
  MYSQL_PORT: '3306',
  MYSQL_USER: 'test-user',
  MYSQL_PASSWORD: 'test-password',
  MYSQL_DB: 'saas-jps-test',
  MYSQL_SSL_CA: undefined,
  JWT_SECRET: 'test-only-jwt-secret-with-at-least-32-bytes',
  CORS_ALLOWED_ORIGINS: 'http://localhost:3000,http://127.0.0.1:3000',
  OBSERVABILITY_TOKEN: 'test-observability-token-with-at-least-32-bytes',
  APP_RELEASE: 'test',
  PROCESS_ROLE: 'all',
  MYSQL_CONNECTION_LIMIT: '20',
  MYSQL_QUEUE_LIMIT: '50',
  MYSQL_ACQUIRE_TIMEOUT_MS: '1000',
  MYSQL_QUERY_TIMEOUT_MS: '8000',
  MYSQL_LOCK_WAIT_TIMEOUT_SECONDS: '5',
  REQUIRE_HTTPS: 'false',
  ACCESS_TOKEN_TTL_SECONDS: '900',
  REFRESH_TOKEN_TTL_DAYS: '30',
  PASSWORD_RESET_TOKEN_TTL_MINUTES: '60',
  REFRESH_COOKIE_NAME: 'saas_jps_refresh',
  ADMIN_REFRESH_COOKIE_NAME: 'saas_jps_admin_refresh',
  PASSWORD_RESET_PROVIDER: 'disabled',
  PASSWORD_RESET_WEBHOOK_URL: undefined,
  PASSWORD_RESET_WEBHOOK_TOKEN: undefined,
});

const INSECURE_VALUES = new Set([
  'secret',
  'changeme',
  'change-me',
  'replace_with_at_least_32_random_bytes',
  'replace-with-at-least-32-random-bytes',
]);

export class ConfigurationError extends Error {
  constructor(variable, reason) {
    super(`Configuración inválida en ${variable}: ${reason}`);
    this.name = 'ConfigurationError';
    this.code = 'INVALID_CONFIGURATION';
  }
}

function environmentValue(environment, key, nodeEnv) {
  const value = environment[key];
  if ((value === undefined || value === '') && nodeEnv === 'test') {
    return TEST_DEFAULTS[key];
  }
  return value;
}

function requiredString(environment, key, nodeEnv) {
  const value = environmentValue(environment, key, nodeEnv);
  if (typeof value !== 'string' || value.trim() === '') {
    throw new ConfigurationError(key, 'es obligatoria y no puede estar vacía');
  }
  return value.trim();
}

function parseInteger(environment, key, nodeEnv, { defaultValue, min, max }) {
  const raw = environmentValue(environment, key, nodeEnv) ?? defaultValue;
  if (!/^\d+$/.test(String(raw ?? ''))) {
    throw new ConfigurationError(key, `debe ser un entero entre ${min} y ${max}`);
  }
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw new ConfigurationError(key, `debe estar entre ${min} y ${max}`);
  }
  return value;
}

function parseBoolean(environment, key, nodeEnv, defaultValue) {
  const raw = environmentValue(environment, key, nodeEnv) ?? defaultValue;
  const value = String(raw ?? '').trim().toLowerCase();
  if (value === 'true') return true;
  if (value === 'false') return false;
  throw new ConfigurationError(key, 'sólo admite true o false');
}

function parseNodeEnvironment(environment) {
  const nodeEnv = environment.NODE_ENV || 'development';
  if (!['development', 'test', 'production'].includes(nodeEnv)) {
    throw new ConfigurationError('NODE_ENV', 'sólo admite development, test o production');
  }
  return nodeEnv;
}

function parseProcessRole(environment, nodeEnv) {
  const role = environmentValue(environment, 'PROCESS_ROLE', nodeEnv)
    ?? (nodeEnv === 'production' ? undefined : 'all');
  if (!['all', 'api', 'worker'].includes(role)) {
    throw new ConfigurationError('PROCESS_ROLE', 'sólo admite all, api o worker');
  }
  return role;
}

function parseTrustProxy(environment, nodeEnv) {
  const raw = environment.TRUST_PROXY ?? (nodeEnv === 'production' ? undefined : 'false');
  if (raw === undefined) {
    throw new ConfigurationError('TRUST_PROXY', 'debe declararse expresamente en producción');
  }
  const value = String(raw).trim().toLowerCase();
  if (value === 'false') return false;
  if (value === 'loopback') return 'loopback';
  if (value === '100.0.0.0/8') return '100.0.0.0/8';
  if (value === '1' && nodeEnv !== 'production') return 1;
  throw new ConfigurationError(
    'TRUST_PROXY',
    'sólo admite false, loopback, 100.0.0.0/8 o 1 fuera de producción',
  );
}

function parseOptionalString(environment, key, nodeEnv) {
  const value = environmentValue(environment, key, nodeEnv);
  if (value === undefined || value === '') return undefined;
  if (typeof value !== 'string') throw new ConfigurationError(key, 'debe ser texto');
  return value.trim() || undefined;
}

function parsePasswordReset(environment, nodeEnv) {
  const provider = parseOptionalString(environment, 'PASSWORD_RESET_PROVIDER', nodeEnv) || 'disabled';
  if (!['disabled', 'manual', 'webhook'].includes(provider)) {
    throw new ConfigurationError('PASSWORD_RESET_PROVIDER', 'sólo admite disabled, manual o webhook');
  }
  const webhookUrl = parseOptionalString(environment, 'PASSWORD_RESET_WEBHOOK_URL', nodeEnv);
  const webhookToken = parseOptionalString(environment, 'PASSWORD_RESET_WEBHOOK_TOKEN', nodeEnv);
  if (provider === 'webhook') {
    if (!webhookUrl || !/^https:\/\//i.test(webhookUrl)) {
      throw new ConfigurationError('PASSWORD_RESET_WEBHOOK_URL', 'debe ser una URL HTTPS');
    }
    if (!webhookToken || Buffer.byteLength(webhookToken, 'utf8') < 32) {
      throw new ConfigurationError('PASSWORD_RESET_WEBHOOK_TOKEN', 'debe contener al menos 32 bytes');
    }
  }
  if (nodeEnv === 'production' && provider === 'disabled') {
    throw new ConfigurationError(
      'PASSWORD_RESET_PROVIDER',
      'debe configurarse como manual o webhook en producción',
    );
  }
  return Object.freeze({ provider, webhookUrl, webhookToken });
}

function parseSecret(environment, key, nodeEnv) {
  const secret = requiredString(environment, key, nodeEnv);
  const looksLikeNonProductionSecret = /(?:test-only|stage10|local-test|development|changeme)/i.test(secret);
  if (Buffer.byteLength(secret, 'utf8') < 32 || INSECURE_VALUES.has(secret.toLowerCase())
    || (nodeEnv === 'production' && looksLikeNonProductionSecret)) {
    throw new ConfigurationError(key, 'debe contener al menos 32 bytes seguros');
  }
  return secret;
}

function parseOrigins(environment, nodeEnv) {
  const raw = requiredString(environment, 'CORS_ALLOWED_ORIGINS', nodeEnv);
  const values = raw.split(',');
  if (values.some((value) => value.trim() === '')) {
    throw new ConfigurationError('CORS_ALLOWED_ORIGINS', 'contiene una entrada vacía');
  }

  const origins = values.map((value) => {
    if (value.trim() === '*') {
      throw new ConfigurationError('CORS_ALLOWED_ORIGINS', 'no permite el comodín *');
    }
    let url;
    try {
      url = new URL(value.trim());
    } catch {
      throw new ConfigurationError('CORS_ALLOWED_ORIGINS', 'contiene un origen inválido');
    }
    if (!['http:', 'https:'].includes(url.protocol)
      || url.username
      || url.password
      || (url.pathname !== '/' && url.pathname !== '')
      || url.search
      || url.hash) {
      throw new ConfigurationError(
        'CORS_ALLOWED_ORIGINS',
        'sólo admite orígenes HTTP(S) sin credenciales, ruta, query o fragmento',
      );
    }
    if (nodeEnv === 'production' && url.protocol !== 'https:') {
      throw new ConfigurationError('CORS_ALLOWED_ORIGINS', 'sólo admite HTTPS en producción');
    }
    return url.origin;
  });
  return Object.freeze([...new Set(origins)]);
}

function parseRelease(environment, nodeEnv) {
  const value = environmentValue(environment, 'APP_RELEASE', nodeEnv)
    ?? (nodeEnv === 'development' ? 'local' : undefined);
  if (typeof value !== 'string' || !/^[A-Za-z0-9._-]{1,64}$/.test(value.trim())) {
    throw new ConfigurationError('APP_RELEASE', 'debe tener entre 1 y 64 caracteres seguros');
  }
  return value.trim();
}

function parseCookieName(environment, nodeEnv, name, defaultValue) {
  const value = environmentValue(environment, name, nodeEnv) ?? defaultValue;
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(value)) {
    throw new ConfigurationError(name, 'debe ser un nombre de cookie seguro');
  }
  return value;
}

function parseHttp(environment, nodeEnv) {
  const http = {
    requestTimeoutMs: parseInteger(environment, 'HTTP_REQUEST_TIMEOUT_MS', nodeEnv, {
      defaultValue: '15000', min: 1000, max: 120000,
    }),
    headersTimeoutMs: parseInteger(environment, 'HTTP_HEADERS_TIMEOUT_MS', nodeEnv, {
      defaultValue: '10000', min: 1000, max: 60000,
    }),
    keepAliveTimeoutMs: parseInteger(environment, 'HTTP_KEEP_ALIVE_TIMEOUT_MS', nodeEnv, {
      defaultValue: '5000', min: 1000, max: 60000,
    }),
    shutdownTimeoutMs: parseInteger(environment, 'SHUTDOWN_TIMEOUT_MS', nodeEnv, {
      defaultValue: '10000', min: 1000, max: 60000,
    }),
  };
  if (http.headersTimeoutMs > http.requestTimeoutMs) {
    throw new ConfigurationError(
      'HTTP_HEADERS_TIMEOUT_MS',
      'no puede superar HTTP_REQUEST_TIMEOUT_MS',
    );
  }
  return Object.freeze(http);
}

export function loadConfig(environment = process.env) {
  const nodeEnv = parseNodeEnvironment(environment);
  const processRole = parseProcessRole(environment, nodeEnv);
  const minimumConnections = processRole === 'api' ? 2 : 3;
  const requireHttps = parseBoolean(
    environment,
    'REQUIRE_HTTPS',
    nodeEnv,
    nodeEnv === 'production' ? undefined : 'false',
  );
  if (nodeEnv === 'production' && !requireHttps) {
    throw new ConfigurationError('REQUIRE_HTTPS', 'debe ser true en producción');
  }

  const databaseName = requiredString(environment, 'MYSQL_DB', nodeEnv);
  if (!/^[A-Za-z0-9_$-]{1,64}$/.test(databaseName)) {
    throw new ConfigurationError('MYSQL_DB', 'contiene caracteres no permitidos');
  }
  if (nodeEnv === 'production' && /(^|[-_])test($|[-_])/i.test(databaseName)) {
    throw new ConfigurationError('MYSQL_DB', 'no puede apuntar a una base de pruebas en producción');
  }
  const mysqlHost = requiredString(environment, 'MYSQL_HOST', nodeEnv);
  const mysqlSslCa = parseOptionalString(environment, 'MYSQL_SSL_CA', nodeEnv);
  const isLocalMysql = ['localhost', '127.0.0.1', '::1'].includes(mysqlHost);
  const isRailwayPrivateMysql = /^[A-Za-z0-9-]+\.railway\.internal$/i.test(mysqlHost);
  if (nodeEnv === 'production' && !isLocalMysql && !isRailwayPrivateMysql && !mysqlSslCa) {
    throw new ConfigurationError('MYSQL_SSL_CA', 'es obligatorio para MySQL remoto en producción');
  }
  const passwordReset = parsePasswordReset(environment, nodeEnv);

  return Object.freeze({
    app: Object.freeze({
      environment: nodeEnv,
      port: parseInteger(environment, 'PORT', nodeEnv, {
        defaultValue: nodeEnv === 'production' ? undefined : '2000', min: 1, max: 65535,
      }),
      release: parseRelease(environment, nodeEnv),
      processRole,
      trustProxy: parseTrustProxy(environment, nodeEnv),
      requireHttps,
      http: parseHttp(environment, nodeEnv),
    }),
    mysql: Object.freeze({
      host: mysqlHost,
      port: parseInteger(environment, 'MYSQL_PORT', nodeEnv, {
        defaultValue: '3306', min: 1, max: 65535,
      }),
      user: requiredString(environment, 'MYSQL_USER', nodeEnv),
      password: requiredString(environment, 'MYSQL_PASSWORD', nodeEnv),
      database: databaseName,
      sslCa: mysqlSslCa,
      connectionLimit: parseInteger(environment, 'MYSQL_CONNECTION_LIMIT', nodeEnv, {
        defaultValue: '20', min: minimumConnections, max: 100,
      }),
      queueLimit: parseInteger(environment, 'MYSQL_QUEUE_LIMIT', nodeEnv, {
        defaultValue: '50', min: 1, max: 1000,
      }),
      acquireTimeoutMs: parseInteger(environment, 'MYSQL_ACQUIRE_TIMEOUT_MS', nodeEnv, {
        defaultValue: '10000', min: 100, max: 60000,
      }),
      queryTimeoutMs: parseInteger(environment, 'MYSQL_QUERY_TIMEOUT_MS', nodeEnv, {
        defaultValue: '8000', min: 1000, max: 60000,
      }),
      lockWaitTimeoutSeconds: parseInteger(
        environment,
        'MYSQL_LOCK_WAIT_TIMEOUT_SECONDS',
        nodeEnv,
        { defaultValue: '5', min: 1, max: 60 },
      ),
    }),
    security: Object.freeze({
      jwtSecret: parseSecret(environment, 'JWT_SECRET', nodeEnv),
      accessTokenTtlSeconds: parseInteger(environment, 'ACCESS_TOKEN_TTL_SECONDS', nodeEnv, {
        defaultValue: '900', min: 300, max: 3600,
      }),
      refreshTokenTtlDays: parseInteger(environment, 'REFRESH_TOKEN_TTL_DAYS', nodeEnv, {
        defaultValue: '30', min: 1, max: 90,
      }),
      passwordResetTokenTtlMinutes: parseInteger(
        environment,
        'PASSWORD_RESET_TOKEN_TTL_MINUTES',
        nodeEnv,
        { defaultValue: '60', min: 10, max: 120 },
      ),
      refreshCookieName: parseCookieName(
        environment, nodeEnv, 'REFRESH_COOKIE_NAME', 'saas_jps_refresh',
      ),
      adminRefreshCookieName: parseCookieName(
        environment, nodeEnv, 'ADMIN_REFRESH_COOKIE_NAME', 'saas_jps_admin_refresh',
      ),
      observabilityToken: parseSecret(environment, 'OBSERVABILITY_TOKEN', nodeEnv),
      corsAllowedOrigins: parseOrigins(environment, nodeEnv),
      passwordReset,
    }),
  });
}
