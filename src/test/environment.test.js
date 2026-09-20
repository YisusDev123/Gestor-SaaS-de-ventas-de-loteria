import { ConfigurationError, loadConfig } from '../config/environment.js';
import { iniciarProveedorRecuperacionAcceso } from '../shared/email/password-reset-provider.js';

describe('configuración de entorno', () => {
  const productionEnvironment = {
    NODE_ENV: 'production',
    PORT: '2000',
    APP_RELEASE: 'release-1',
    MYSQL_HOST: 'db.internal',
    MYSQL_PORT: '3306',
    MYSQL_USER: 'app',
    MYSQL_PASSWORD: 'database-password',
    MYSQL_DB: 'saas_jps',
    MYSQL_SSL_CA: 'C:\\certs\\mysql-ca.pem',
    PASSWORD_RESET_PROVIDER: 'manual',
    MYSQL_CONNECTION_LIMIT: '3',
    MYSQL_QUEUE_LIMIT: '50',
    MYSQL_ACQUIRE_TIMEOUT_MS: '10000',
    MYSQL_QUERY_TIMEOUT_MS: '8000',
    MYSQL_LOCK_WAIT_TIMEOUT_SECONDS: '5',
    JWT_SECRET: 'production-jwt-secret-with-more-than-32-bytes',
    OBSERVABILITY_TOKEN: 'production-observability-token-over-32-bytes',
    CORS_ALLOWED_ORIGINS: 'https://app.example.com',
    TRUST_PROXY: 'loopback',
    REQUIRE_HTTPS: 'true',
    PROCESS_ROLE: 'all',
  };

  test('crea una configuración segura de prueba con defaults aislados', () => {
    const config = loadConfig({ NODE_ENV: 'test' });

    expect(config.app.port).toBe(2000);
    expect(config.app.processRole).toBe('all');
    expect(config.mysql.connectionLimit).toBe(20);
    expect(config.security.corsAllowedOrigins).toContain('http://localhost:3000');
    expect(Object.isFrozen(config)).toBe(true);
  });

  test('rechaza CORS con comodín', () => {
    expect(() => loadConfig({
      NODE_ENV: 'test',
      CORS_ALLOWED_ORIGINS: '*',
    })).toThrow(ConfigurationError);
  });

  test('rechaza headers timeout mayor que request timeout', () => {
    expect(() => loadConfig({
      NODE_ENV: 'test',
      HTTP_REQUEST_TIMEOUT_MS: '5000',
      HTTP_HEADERS_TIMEOUT_MS: '6000',
    })).toThrow(/HTTP_HEADERS_TIMEOUT_MS/);
  });

  test('exige HTTPS y configuración explícita en producción', () => {
    expect(() => loadConfig({ NODE_ENV: 'production' })).toThrow(ConfigurationError);
  });

  test('acepta una configuración completa y segura de producción', () => {
    const config = loadConfig(productionEnvironment);

    expect(config.app.requireHttps).toBe(true);
    expect(config.app.trustProxy).toBe('loopback');
    expect(config.mysql.database).toBe('saas_jps');
    expect(config.security.passwordReset.provider).toBe('manual');
    expect(config.security.passwordReset.webhookUrl).toBeUndefined();
  });

  test('conserva webhook como alternativa opcional de entrega', () => {
    const config = loadConfig({
      ...productionEnvironment,
      PASSWORD_RESET_PROVIDER: 'webhook',
      PASSWORD_RESET_WEBHOOK_URL: 'https://mail.example.com/password-reset',
      PASSWORD_RESET_WEBHOOK_TOKEN: 'password-reset-webhook-token-with-32-bytes',
    });

    expect(config.security.passwordReset.provider).toBe('webhook');
  });

  test('el modo manual omite envíos y permite entregar el enlace desde administración', async () => {
    const config = loadConfig(productionEnvironment);
    const provider = iniciarProveedorRecuperacionAcceso(config);

    await expect(provider.enviarTokenRestablecimiento({ token: 'secreto-de-un-solo-uso' }))
      .resolves.toEqual({ skipped: true });
    expect(provider.name).toBe('manual');
  });

  test('acepta proxy y MySQL por la red privada cifrada de Railway', () => {
    const config = loadConfig({
      ...productionEnvironment,
      TRUST_PROXY: '100.0.0.0/8',
      MYSQL_HOST: 'mysql.railway.internal',
      MYSQL_SSL_CA: undefined,
    });

    expect(config.app.trustProxy).toBe('100.0.0.0/8');
    expect(config.mysql.host).toBe('mysql.railway.internal');
    expect(config.mysql.sslCa).toBeUndefined();
  });

  test('no confunde un dominio público parecido con la red privada de Railway', () => {
    expect(() => loadConfig({
      ...productionEnvironment,
      MYSQL_HOST: 'mysql.evilrailway.internal',
      MYSQL_SSL_CA: undefined,
    })).toThrow(/MYSQL_SSL_CA/);
  });

  test.each([
    [{ NODE_ENV: 'invalid' }, 'NODE_ENV'],
    [{ NODE_ENV: 'test', PORT: '0' }, 'PORT'],
    [{ NODE_ENV: 'test', MYSQL_DB: 'bad/name' }, 'MYSQL_DB'],
    [{ NODE_ENV: 'test', TRUST_PROXY: 'everywhere' }, 'TRUST_PROXY'],
    [{ NODE_ENV: 'test', REQUIRE_HTTPS: 'yes' }, 'REQUIRE_HTTPS'],
    [{ NODE_ENV: 'test', APP_RELEASE: 'bad release' }, 'APP_RELEASE'],
    [{ NODE_ENV: 'test', JWT_SECRET: 'short' }, 'JWT_SECRET'],
    [{ NODE_ENV: 'test', CORS_ALLOWED_ORIGINS: 'https://example.com/path' }, 'CORS_ALLOWED_ORIGINS'],
    [{ NODE_ENV: 'test', CORS_ALLOWED_ORIGINS: 'https://example.com,' }, 'CORS_ALLOWED_ORIGINS'],
    [{ NODE_ENV: 'test', CORS_ALLOWED_ORIGINS: 'not-a-url' }, 'CORS_ALLOWED_ORIGINS'],
    [{ NODE_ENV: 'test', REFRESH_COOKIE_NAME: 'invalid cookie' }, 'REFRESH_COOKIE_NAME'],
    [{ NODE_ENV: 'test', PASSWORD_RESET_PROVIDER: 'smtp' }, 'PASSWORD_RESET_PROVIDER'],
    [{ NODE_ENV: 'test', PASSWORD_RESET_PROVIDER: 'webhook' }, 'PASSWORD_RESET_WEBHOOK_URL'],
    [{
      NODE_ENV: 'test',
      PASSWORD_RESET_PROVIDER: 'webhook',
      PASSWORD_RESET_WEBHOOK_URL: 'https://mail.example.com/reset',
      PASSWORD_RESET_WEBHOOK_TOKEN: 'short',
    }, 'PASSWORD_RESET_WEBHOOK_TOKEN'],
  ])('rechaza configuración inválida de %s', (overrides, variable) => {
    expect(() => loadConfig(overrides)).toThrow(variable);
  });

  test('exige al menos tres conexiones para rol worker', () => {
    expect(() => loadConfig({
      NODE_ENV: 'test',
      PROCESS_ROLE: 'worker',
      MYSQL_CONNECTION_LIMIT: '2',
    })).toThrow(/MYSQL_CONNECTION_LIMIT/);
  });

  test.each([
    [{ TRUST_PROXY: undefined }, 'TRUST_PROXY'],
    [{ REQUIRE_HTTPS: 'false' }, 'REQUIRE_HTTPS'],
    [{ MYSQL_DB: 'saas_jps_test' }, 'MYSQL_DB'],
    [{ MYSQL_SSL_CA: undefined }, 'MYSQL_SSL_CA'],
    [{ CORS_ALLOWED_ORIGINS: 'http://app.example.com' }, 'CORS_ALLOWED_ORIGINS'],
    [{ PASSWORD_RESET_PROVIDER: 'disabled' }, 'PASSWORD_RESET_PROVIDER'],
    [{ JWT_SECRET: 'test-only-jwt-secret-with-at-least-32-bytes' }, 'JWT_SECRET'],
  ])('rechaza una configuración insegura de producción en %s', (overrides, variable) => {
    expect(() => loadConfig({ ...productionEnvironment, ...overrides })).toThrow(variable);
  });
});
