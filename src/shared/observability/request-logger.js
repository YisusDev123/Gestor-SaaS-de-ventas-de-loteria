export function createRequestLogger(logger) {
  return function requestLogger(req, res, next) {
    const startedAt = process.hrtime.bigint();
    res.once('finish', () => {
      const durationMs = Number(process.hrtime.bigint() - startedAt) / 1e6;
      const metadata = {
        correlationId: req.correlationId,
        method: req.method,
        route: req.route?.path || 'unmatched',
        statusCode: res.statusCode,
        durationMs: Number(durationMs.toFixed(3)),
      };
      if (res.statusCode >= 500) logger.error('HTTP request completed', metadata);
      else if (res.statusCode >= 400) logger.warn('HTTP request completed', metadata);
      else logger.info('HTTP request completed', metadata);
    });
    next();
  };
}
