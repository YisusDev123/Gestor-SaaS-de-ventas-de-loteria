function statusClass(statusCode) {
  return `${Math.floor(statusCode / 100)}xx`;
}

function metricLine(name, value, labels = {}) {
  const entries = Object.entries(labels);
  const serialized = entries.length
    ? `{${entries.map(([key, item]) => `${key}="${String(item).replace(/["\\]/g, '\\$&')}"`).join(',')}}`
    : '';
  return `${name}${serialized} ${value}`;
}

export function createMetricsRegistry() {
  const httpRequests = new Map();
  let httpActive = 0;
  let httpDurationMsTotal = 0;
  let httpDurationCount = 0;
  let mysqlPoolOpen = 0;
  let mysqlAcquisitions = 0;
  let mysqlAcquisitionFailures = 0;
  let mysqlAcquisitionTimeouts = 0;
  let mysqlSessionErrors = 0;
  let mysqlReadinessSuccess = 0;
  let mysqlReadinessFailures = 0;
  let jobsRunning = 0;

  function httpMiddleware(req, res, next) {
    httpActive += 1;
    const startedAt = process.hrtime.bigint();
    let recorded = false;
    const record = () => {
      if (recorded) return;
      recorded = true;
      httpActive = Math.max(0, httpActive - 1);
      const durationMs = Number(process.hrtime.bigint() - startedAt) / 1e6;
      httpDurationMsTotal += durationMs;
      httpDurationCount += 1;
      const method = /^[A-Z]{3,10}$/.test(req.method) ? req.method : 'OTHER';
      const key = `${method}:${statusClass(res.statusCode)}`;
      httpRequests.set(key, (httpRequests.get(key) || 0) + 1);
    };
    res.once('finish', record);
    res.once('close', record);
    next();
  }

  function recordMysqlAcquisition({ success, code }) {
    mysqlAcquisitions += 1;
    if (!success) mysqlAcquisitionFailures += 1;
    if (code === 'POOL_ACQUIRE_TIMEOUT') mysqlAcquisitionTimeouts += 1;
  }

  function recordReadiness(success) {
    if (success) mysqlReadinessSuccess += 1;
    else mysqlReadinessFailures += 1;
  }

  function render() {
    const lines = [
      '# HELP saas_http_requests_total Solicitudes HTTP terminadas.',
      '# TYPE saas_http_requests_total counter',
    ];
    for (const [key, value] of [...httpRequests.entries()].sort()) {
      const [method, responseClass] = key.split(':');
      lines.push(metricLine('saas_http_requests_total', value, {
        method,
        status_class: responseClass,
      }));
    }
    lines.push(
      '# TYPE saas_http_active_requests gauge',
      metricLine('saas_http_active_requests', httpActive),
      '# TYPE saas_http_duration_milliseconds_sum counter',
      metricLine('saas_http_duration_milliseconds_sum', httpDurationMsTotal.toFixed(3)),
      '# TYPE saas_http_duration_milliseconds_count counter',
      metricLine('saas_http_duration_milliseconds_count', httpDurationCount),
      '# TYPE saas_mysql_pool_open gauge',
      metricLine('saas_mysql_pool_open', mysqlPoolOpen),
      '# TYPE saas_mysql_acquisitions_total counter',
      metricLine('saas_mysql_acquisitions_total', mysqlAcquisitions),
      '# TYPE saas_mysql_acquisition_failures_total counter',
      metricLine('saas_mysql_acquisition_failures_total', mysqlAcquisitionFailures),
      '# TYPE saas_mysql_acquisition_timeouts_total counter',
      metricLine('saas_mysql_acquisition_timeouts_total', mysqlAcquisitionTimeouts),
      '# TYPE saas_mysql_session_errors_total counter',
      metricLine('saas_mysql_session_errors_total', mysqlSessionErrors),
      '# TYPE saas_mysql_readiness_success_total counter',
      metricLine('saas_mysql_readiness_success_total', mysqlReadinessSuccess),
      '# TYPE saas_mysql_readiness_failures_total counter',
      metricLine('saas_mysql_readiness_failures_total', mysqlReadinessFailures),
      '# TYPE saas_jobs_running gauge',
      metricLine('saas_jobs_running', jobsRunning),
    );
    return `${lines.join('\n')}\n`;
  }

  return Object.freeze({
    httpMiddleware,
    render,
    setMysqlPoolOpen: (open) => { mysqlPoolOpen = open ? 1 : 0; },
    recordMysqlAcquisition,
    recordMysqlSessionError: () => { mysqlSessionErrors += 1; },
    recordReadiness,
    setJobsRunning: (running) => { jobsRunning = running ? 1 : 0; },
  });
}

export const metricsRegistry = createMetricsRegistry();
