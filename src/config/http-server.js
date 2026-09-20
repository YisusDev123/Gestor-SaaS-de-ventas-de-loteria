export function configureHttpServer(server, httpConfig) {
  if (httpConfig.headersTimeoutMs > httpConfig.requestTimeoutMs) {
    throw new Error('HTTP_HEADERS_TIMEOUT_EXCEEDS_REQUEST_TIMEOUT');
  }
  server.requestTimeout = httpConfig.requestTimeoutMs;
  server.headersTimeout = httpConfig.headersTimeoutMs;
  server.keepAliveTimeout = httpConfig.keepAliveTimeoutMs;
  return server;
}
