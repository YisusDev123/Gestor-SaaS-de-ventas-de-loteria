import dotenv from 'dotenv';

dotenv.config({ quiet: true });

if (process.env.NODE_ENV !== 'test' || process.env.ALLOW_DB_INTEGRATION !== 'true') {
  throw new Error('La recuperación requiere NODE_ENV=test y ALLOW_DB_INTEGRATION=true.');
}
if (process.env.MYSQL_DB !== 'saas_jps_test') {
  throw new Error('La recuperación sólo puede ejecutarse en saas_jps_test.');
}

const [{ database, pool }, { jobsContainer }] = await Promise.all([
  import('../src/config/pool.js'),
  import('../src/container/jobs-container.js'),
]);

try {
  await database.initialize();
  const execution = await jobsContainer.jobsService.generarSorteosDelDia({
    trigger: 'MANUAL_TEST_RECOVERY',
  });
  if (!execution.acquired) throw new Error('Otro generador posee el lock; inténtalo nuevamente.');
  const result = execution.result;
  const [statusRows] = await pool.execute(
    `SELECT status, COUNT(*) AS total
     FROM draws
     WHERE business_date = ?
     GROUP BY status
     ORDER BY status`,
    [result.businessDate],
  );
  console.log(JSON.stringify({
    status: result.status,
    businessDate: result.businessDate,
    tenants: result.tenants,
    created: result.created,
    existing: result.existing,
    pastClosing: result.pastClosing,
    failed: result.failed,
    drawsByStatus: Object.fromEntries(
      statusRows.map((row) => [row.status, Number(row.total)]),
    ),
  }));
} finally {
  await database.close();
}
