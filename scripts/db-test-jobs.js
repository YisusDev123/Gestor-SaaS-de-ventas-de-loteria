import { access } from 'node:fs/promises';
import path from 'node:path';

import dotenv from 'dotenv';
import mysql from 'mysql2/promise';

import { iniciarJobsService } from '../src/modules/jobs/jobs-services.js';
import { iniciarBaseDeDatosJobs } from '../src/shared/database/jobs-sql.js';
import { createPublicId } from '../src/shared/utils/public-id.js';

const TEST_DATABASE = 'saas_jps_test';

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Falta la variable requerida ${name}.`);
  return value;
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function requireGuard() {
  if (process.env.NODE_ENV !== 'test' || process.env.ALLOW_DB_INTEGRATION !== 'true') {
    throw new Error('Se requieren NODE_ENV=test y ALLOW_DB_INTEGRATION=true.');
  }
}

async function createTenant(pool, suffix) {
  const [tenantResult] = await pool.execute(
    `INSERT INTO tenants (public_id, display_name, status)
     VALUES (?, ?, 'ACTIVE')`,
    [createPublicId(), `Puesto Jobs ${suffix}`],
  );
  const tenantId = String(tenantResult.insertId);
  const [userResult] = await pool.execute(
    `INSERT INTO users (public_id, email_normalized, password_hash, status)
     VALUES (?, ?, 'integration-not-a-login-password', 'ACTIVE')`,
    [createPublicId(), `jobs-${suffix}@example.test`],
  );
  const userId = String(userResult.insertId);
  await pool.execute(
    `INSERT INTO tenant_memberships (tenant_id, user_id, role, status)
     VALUES (?, ?, 'OWNER', 'ACTIVE')`,
    [tenantId, userId],
  );
  const [[plan]] = await pool.execute(
    "SELECT id FROM subscription_plans WHERE code = 'MONTHLY_BASE' LIMIT 1",
  );
  await pool.execute(
    `INSERT INTO subscriptions
      (tenant_id, plan_id, status, access_ends_at)
     VALUES (?, ?, 'ACTIVE', '2099-01-01 00:00:00')`,
    [tenantId, plan.id],
  );
  return { tenantId, userId };
}

async function configureOffer(pool, fixture) {
  const [lotteries] = await pool.execute(
    "SELECT id, code FROM lotteries WHERE code IN ('NICA', 'PRIMERA')",
  );
  for (const lottery of lotteries) {
    await pool.execute(
      `INSERT INTO tenant_lotteries
        (tenant_id, lottery_id, is_enabled, config_version)
       VALUES (?, ?, TRUE, 1)`,
      [fixture.tenantId, lottery.id],
    );
  }
  const [modalities] = await pool.execute(
    `SELECT lm.id
     FROM lottery_modalities lm JOIN lotteries l ON l.id = lm.lottery_id
     WHERE l.code IN ('NICA', 'PRIMERA') AND lm.code = 'NORMAL'`,
  );
  for (const modality of modalities) {
    await pool.execute(
      `INSERT INTO tenant_modalities
        (tenant_id, lottery_modality_id, is_enabled, multiplier,
         config_version, updated_by_user_id)
       VALUES (?, ?, TRUE, '80.00', 1, ?)`,
      [fixture.tenantId, modality.id, fixture.userId],
    );
  }
  const [schedules] = await pool.execute(
    `SELECT ds.id, ds.code
     FROM draw_schedules ds
     JOIN lottery_modalities lm ON lm.id = ds.lottery_modality_id
     JOIN lotteries l ON l.id = lm.lottery_id
     WHERE l.code IN ('NICA', 'PRIMERA') AND lm.code = 'NORMAL'`,
  );
  for (const schedule of schedules) {
    await pool.execute(
      `INSERT INTO tenant_schedules
        (tenant_id, draw_schedule_id, is_enabled, close_minutes_before,
         config_version, updated_by_user_id)
       VALUES (?, ?, TRUE, ?, 1, ?)`,
      [fixture.tenantId, schedule.id, schedule.code === '1800' ? 12 : 10, fixture.userId],
    );
  }
  await pool.execute(
    `INSERT INTO tenant_limit_settings
      (tenant_id, general_number_limit, config_version, updated_by_user_id)
     VALUES (?, '10000.00', 1, ?)`,
    [fixture.tenantId, fixture.userId],
  );
}

async function cleanup(pool, fixture) {
  if (!fixture?.tenantId) return;
  await pool.execute('DELETE FROM audit_events WHERE tenant_id = ?', [fixture.tenantId]);
  await pool.execute(
    `DELETE FROM job_run_items WHERE tenant_id = ?`, [fixture.tenantId],
  );
  await pool.execute(
    `DELETE dnp FROM draw_number_positions dnp
     JOIN draws d ON d.id = dnp.draw_id WHERE d.tenant_id = ?`,
    [fixture.tenantId],
  );
  await pool.execute('DELETE FROM draws WHERE tenant_id = ?', [fixture.tenantId]);
  await pool.execute('DELETE FROM tenant_schedules WHERE tenant_id = ?', [fixture.tenantId]);
  await pool.execute('DELETE FROM tenant_modalities WHERE tenant_id = ?', [fixture.tenantId]);
  await pool.execute('DELETE FROM tenant_lotteries WHERE tenant_id = ?', [fixture.tenantId]);
  await pool.execute('DELETE FROM tenant_limit_settings WHERE tenant_id = ?', [fixture.tenantId]);
  await pool.execute('DELETE FROM subscriptions WHERE tenant_id = ?', [fixture.tenantId]);
  await pool.execute('DELETE FROM tenant_memberships WHERE tenant_id = ?', [fixture.tenantId]);
  await pool.execute('DELETE FROM users WHERE id = ?', [fixture.userId]);
  await pool.execute('DELETE FROM tenants WHERE id = ?', [fixture.tenantId]);
}

async function main() {
  requireGuard();
  const credentialsFile = path.resolve(required('SAAS_TEST_CREDENTIALS_FILE'));
  await access(credentialsFile);
  dotenv.config({ path: credentialsFile, override: true, quiet: true });
  const pool = mysql.createPool({
    host: required('MYSQL_HOST'), port: Number(process.env.MYSQL_PORT || 3306),
    user: required('MYSQL_USER'), password: required('MYSQL_PASSWORD'), database: TEST_DATABASE,
    connectionLimit: 6, timezone: '+00:00', dateStrings: true,
    supportBigNumbers: true, bigNumberStrings: true, decimalNumbers: false,
  });
  const jobs = iniciarJobsService(iniciarBaseDeDatosJobs(pool));
  let configured;
  let incomplete;
  let jobRunBaseline = '0';
  try {
    const [[baseline]] = await pool.execute('SELECT COALESCE(MAX(id), 0) AS id FROM job_runs');
    jobRunBaseline = String(baseline.id);
    const suffix = String(Date.now());
    configured = await createTenant(pool, `${suffix}-configured`);
    incomplete = await createTenant(pool, `${suffix}-incomplete`);
    await configureOffer(pool, configured);
    const [[nica]] = await pool.execute("SELECT id FROM lotteries WHERE code = 'NICA'");
    await pool.execute(
      `INSERT INTO tenant_lotteries (tenant_id, lottery_id, is_enabled, config_version)
       VALUES (?, ?, TRUE, 1)`,
      [incomplete.tenantId, nica.id],
    );

    await jobs.generarSorteosDelDia({
      now: new Date('2026-09-07T12:00:00.000Z'), trigger: 'INTEGRATION_BEFORE_ACTIVATION',
    });
    const [[beforeActivation]] = await pool.execute(
      "SELECT COUNT(*) AS total FROM draws WHERE tenant_id = ? AND business_date = '2026-09-07'",
      [configured.tenantId],
    );
    assert(Number(beforeActivation.total) === 0, 'Se creó historial anterior a la activación.');
    await pool.execute(
      "UPDATE tenants SET created_at = '2026-09-01 12:00:00' WHERE id = ?",
      [configured.tenantId],
    );
    await pool.execute(
      "UPDATE tenants SET created_at = '2026-09-01 12:00:00' WHERE id = ?",
      [incomplete.tenantId],
    );
    await jobs.generarSorteosParaTenant(configured.tenantId, {
      now: new Date('2026-09-07T12:00:00.000Z'), trigger: 'INTEGRATION_MONDAY',
    });
    const [[monday]] = await pool.execute(
      `SELECT COUNT(*) AS total,
              SUM(lottery_code_snapshot = 'PRIMERA') AS primera,
              SUM(lottery_code_snapshot = 'NICA' AND local_time_snapshot = '18:00:00') AS nica1800
       FROM draws WHERE tenant_id = ? AND business_date = '2026-09-07'`,
      [configured.tenantId],
    );
    assert(Number(monday.total) === 5, 'El lunes debe generar tres NICA y dos PRIMERA.');
    assert(Number(monday.primera) === 2, 'PRIMERA no se generó dos veces al día.');
    assert(Number(monday.nica1800) === 0, 'NICA 18:00 se generó fuera de martes, sábado o domingo.');

    const now = new Date('2026-09-08T12:00:00.000Z');
    await Promise.all([
      jobs.generarSorteosDelDia({ now, trigger: 'INTEGRATION_WORKER_A' }),
      jobs.generarSorteosDelDia({ now, trigger: 'INTEGRATION_WORKER_B' }),
    ]);
    const [draws] = await pool.execute(
      `SELECT d.id, d.status, d.lottery_code_snapshot AS lotteryCode,
              d.local_time_snapshot AS localTimeValue,
              d.close_minutes_before_snapshot AS closeMinutes,
              d.multiplier_snapshot AS multiplier, d.general_limit_snapshot AS generalLimit
       FROM draws d WHERE d.tenant_id = ? AND d.business_date = '2026-09-08'
       ORDER BY d.id`,
      [configured.tenantId],
    );
    assert(draws.length === 6, 'Martes debe generar cuatro NICA y dos PRIMERA exactamente.');
    assert(draws.every((draw) => draw.status === 'OPEN'), 'Los sorteos no nacieron OPEN.');
    const nica1800 = draws.find((draw) => draw.lotteryCode === 'NICA'
      && String(draw.localTimeValue).startsWith('18:00'));
    assert(Number(nica1800.closeMinutes) === 12, 'NICA 18:00 no conservó el cierre personalizado.');
    assert(nica1800.multiplier === '80.00' && nica1800.generalLimit === '10000.00', 'Los snapshots financieros no coinciden.');

    await pool.execute(
      `UPDATE tenant_lotteries tl
       JOIN lotteries l ON l.id = tl.lottery_id
       SET tl.is_enabled = FALSE, tl.config_version = tl.config_version + 1
       WHERE tl.tenant_id = ? AND l.code = 'NICA'`,
      [configured.tenantId],
    );
    await jobs.generarSorteosParaTenant(configured.tenantId, {
      now, trigger: 'INTEGRATION_DISABLED_CONFIGURATION',
    });
    const [[preserved]] = await pool.execute(
      `SELECT COUNT(*) AS total, SUM(status = 'OPEN') AS openTotal
       FROM draws WHERE tenant_id = ? AND business_date = '2026-09-08'`,
      [configured.tenantId],
    );
    assert(Number(preserved.total) === 6 && Number(preserved.openTotal) === 6, 'Deshabilitar configuración alteró sorteos ya creados.');

    const [[positions]] = await pool.execute(
      `SELECT COUNT(*) AS total FROM draw_number_positions dnp
       JOIN draws d ON d.id = dnp.draw_id
       WHERE d.tenant_id = ? AND d.business_date = '2026-09-08'`,
      [configured.tenantId],
    );
    assert(Number(positions.total) === 600, 'No se crearon exactamente 100 posiciones por sorteo.');
    const [[incompleteDraws]] = await pool.execute(
      'SELECT COUNT(*) AS total FROM draws WHERE tenant_id = ?', [incomplete.tenantId],
    );
    assert(Number(incompleteDraws.total) === 0, 'Se creó un sorteo con reglas incompletas.');

    await pool.execute(
      `UPDATE draws
       SET scheduled_at_utc = DATE_ADD(UTC_TIMESTAMP(6), INTERVAL 2 HOUR),
           closes_at_utc = DATE_ADD(UTC_TIMESTAMP(6), INTERVAL 1 HOUR)
       WHERE tenant_id = ?`,
      [configured.tenantId],
    );
    await pool.execute(
      `UPDATE draws
       SET scheduled_at_utc = DATE_ADD(UTC_TIMESTAMP(6), INTERVAL 1 HOUR),
           closes_at_utc = DATE_SUB(UTC_TIMESTAMP(6), INTERVAL 1 SECOND)
       WHERE tenant_id = ? AND id = ?`,
      [configured.tenantId, draws[0].id],
    );
    await jobs.cerrarSorteosVencidos({ trigger: 'INTEGRATION_CLOSE' });
    const [[closed]] = await pool.execute(
      "SELECT COUNT(*) AS total FROM draws WHERE tenant_id = ? AND status = 'CLOSED'",
      [configured.tenantId],
    );
    assert(Number(closed.total) === 1, 'El cierre automático no fue exacto ni idempotente.');
    const [abandonedRun] = await pool.execute(
      `INSERT INTO job_runs (job_name, run_key, status, started_at)
       VALUES ('GENERATE_DRAWS', ?, 'RUNNING', DATE_SUB(UTC_TIMESTAMP(6), INTERVAL 6 MINUTE))`,
      [`stage12-worker-crash:${Date.now()}`],
    );
    await pool.execute(
      `INSERT INTO job_run_items
        (job_run_id, tenant_id, item_key, status, attempt_count)
       VALUES (?, ?, ?, 'PENDING', 1)`,
      [abandonedRun.insertId, configured.tenantId, `stage12-crash-item:${configured.tenantId}`],
    );
    const recoveredCrash = await jobs.recuperarEjecucionesAbandonadas();
    assert(recoveredCrash.runs === 1 && recoveredCrash.items === 1,
      'El reinicio del worker no recuperó la ejecución abandonada.');
    const [[crashState]] = await pool.execute(
      `SELECT jr.status AS runStatus, jr.error_code AS runError,
              jri.status AS itemStatus, jri.error_code AS itemError
       FROM job_runs jr JOIN job_run_items jri ON jri.job_run_id = jr.id
       WHERE jr.id = ?`,
      [abandonedRun.insertId],
    );
    assert(crashState.runStatus === 'FAILED' && crashState.itemStatus === 'FAILED'
      && crashState.runError === 'WORKER_INTERRUPTED'
      && crashState.itemError === 'WORKER_INTERRUPTED',
    'La caída del worker no dejó un estado durable y conciliable.');
    const [[durableState]] = await pool.execute(
      `SELECT
         (SELECT COUNT(*) FROM job_runs WHERE id > ? AND status = 'RUNNING') AS runningRuns,
         (SELECT COUNT(*) FROM job_run_items
           WHERE tenant_id = ? AND status = 'SKIPPED'
             AND error_code = 'TENANT_DRAW_CONFIGURATION_INCOMPLETE') AS incompleteItems,
         (SELECT COUNT(*) FROM audit_events
           WHERE tenant_id = ? AND event_type = 'DRAW_CLOSED') AS closeAudits`,
      [jobRunBaseline, incomplete.tenantId, configured.tenantId],
    );
    assert(Number(durableState.runningRuns) === 0, 'Quedaron ejecuciones durablemente abiertas.');
    assert(Number(durableState.incompleteItems) >= 1, 'No quedó estado durable de la configuración incompleta.');
    assert(Number(durableState.closeAudits) === 1, 'El cierre no conservó auditoría durable.');
    console.log('Integración jobs aprobada: concurrencia, snapshots, cierre y recuperación de worker interrumpido.');
  } finally {
    await cleanup(pool, configured);
    await cleanup(pool, incomplete);
    await pool.execute('DELETE FROM job_runs WHERE id > ?', [jobRunBaseline]);
    await pool.end();
  }
}

main().catch((error) => {
  console.error(`Integración jobs fallida: ${error.message}`);
  process.exitCode = 1;
});
