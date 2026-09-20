import { spawn } from 'node:child_process';
import { access } from 'node:fs/promises';
import path from 'node:path';

import dotenv from 'dotenv';
import mysql from 'mysql2/promise';

const TEST_DATABASE = 'saas_jps_test';
const EXPECTED_MIGRATIONS = 11;
const REQUIRED_TABLES = [
  'admin_sessions',
  'audit_events',
  'cash_accounts',
  'cash_movements',
  'draw_number_positions',
  'draw_result_versions',
  'draw_schedule_weekdays',
  'draw_schedules',
  'draws',
  'job_run_items',
  'job_runs',
  'lotteries',
  'lottery_modalities',
  'operation_requests',
  'password_reset_tokens',
  'prize_payments',
  'saas_admins',
  'schema_migrations',
  'subscription_payments',
  'subscription_periods',
  'subscription_plans',
  'subscriptions',
  'tenant_daily_lottery_availability',
  'tenant_daily_summaries',
  'tenant_business_settings',
  'tenant_limit_settings',
  'tenant_lotteries',
  'tenant_memberships',
  'tenant_modalities',
  'tenant_schedules',
  'tenants',
  'ticket_cancellations',
  'ticket_items',
  'ticket_prize_evaluations',
  'ticket_replacements',
  'tickets',
  'user_sessions',
  'users',
];

function requireGuard() {
  if (process.env.NODE_ENV !== 'test' || process.env.ALLOW_DB_TEST_BOOTSTRAP !== 'true') {
    throw new Error('Se requieren NODE_ENV=test y ALLOW_DB_TEST_BOOTSTRAP=true.');
  }
}

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Falta la variable requerida ${name}.`);
  return value;
}

function runMigrations(environment) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['scripts/db-migrate.js'], {
      cwd: path.resolve('.'),
      env: environment,
      stdio: 'inherit',
      windowsHide: true,
    });
    child.once('error', reject);
    child.once('exit', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`El runner de migraciones terminó con código ${code}.`));
    });
  });
}

async function verifySchema(config) {
  const connection = await mysql.createConnection({
    ...config,
    database: TEST_DATABASE,
    timezone: 'Z',
    dateStrings: true,
    supportBigNumbers: true,
    bigNumberStrings: true,
    decimalNumbers: false,
  });
  try {
    await connection.query("SET time_zone = '+00:00'");
    const [tableRows] = await connection.execute(
      `SELECT TABLE_NAME AS tableName
       FROM information_schema.TABLES
       WHERE TABLE_SCHEMA = ?`,
      [TEST_DATABASE],
    );
    const tables = new Set(tableRows.map((row) => row.tableName));
    const missing = REQUIRED_TABLES.filter((table) => !tables.has(table));
    if (missing.length) throw new Error(`Faltan tablas requeridas: ${missing.join(', ')}.`);

    const [[migrationCount]] = await connection.query(
      'SELECT COUNT(*) AS total FROM schema_migrations',
    );
    if (Number(migrationCount.total) !== EXPECTED_MIGRATIONS) {
      throw new Error(`No se aplicaron exactamente ${EXPECTED_MIGRATIONS} migraciones.`);
    }

    const [lotteries] = await connection.query(
      'SELECT code FROM lotteries ORDER BY sort_order, code',
    );
    if (lotteries.map((row) => row.code).join(',') !== 'NICA,TICA,PRIMERA') {
      throw new Error('El catálogo inicial de loterías no coincide con lo esperado.');
    }

    const [[scheduleSummary]] = await connection.query(
      `SELECT COUNT(*) AS total,
              SUM(default_close_minutes_before = 10) AS defaultTen
       FROM draw_schedules`,
    );
    if (Number(scheduleSummary.total) !== 12
      || Number(scheduleSummary.defaultTen) !== 12) {
      throw new Error('Los horarios o su cierre predeterminado no coinciden con el catálogo.');
    }

    const [[nicaEvening]] = await connection.query(
      `SELECT GROUP_CONCAT(dsw.iso_weekday ORDER BY dsw.iso_weekday) AS weekdays
       FROM draw_schedules ds
       JOIN lottery_modalities lm ON lm.id = ds.lottery_modality_id
       JOIN lotteries l ON l.id = lm.lottery_id
       JOIN draw_schedule_weekdays dsw ON dsw.draw_schedule_id = ds.id
       WHERE l.code = 'NICA' AND lm.code = 'NORMAL' AND ds.code = '1800'`,
    );
    if (nicaEvening.weekdays !== '2,6,7') {
      throw new Error('NICA 18:00 no posee exactamente martes, sábado y domingo.');
    }

    const [primeraSchedules] = await connection.query(
      `SELECT TIME_FORMAT(ds.local_time, '%H:%i') AS local_time_value
       FROM draw_schedules ds
       JOIN lottery_modalities lm ON lm.id = ds.lottery_modality_id
       JOIN lotteries l ON l.id = lm.lottery_id
       WHERE l.code = 'PRIMERA'
       ORDER BY ds.local_time`,
    );
    if (primeraSchedules.map((row) => row.local_time_value).join(',') !== '10:00,17:00') {
      throw new Error('Los horarios de PRIMERA no coinciden con 10:00 y 17:00.');
    }

    const [[modality]] = await connection.query(
      'SELECT id FROM lottery_modalities ORDER BY id LIMIT 1',
    );
    let invalidCloseRejected = false;
    try {
      await connection.execute(
        `INSERT INTO draw_schedules
          (lottery_modality_id, code, local_time, default_close_minutes_before, is_active)
         VALUES (?, 'INVALID_CLOSE_TEST', '23:59:00', 9, TRUE)`,
        [modality.id],
      );
    } catch (error) {
      invalidCloseRejected = error?.code === 'ER_CHECK_CONSTRAINT_VIOLATED';
    }
    if (!invalidCloseRejected) {
      await connection.query("DELETE FROM draw_schedules WHERE code = 'INVALID_CLOSE_TEST'");
      throw new Error('MySQL no rechazó un cierre menor de 10 minutos.');
    }

    console.log(`Base ${TEST_DATABASE} verificada: ${tables.size} tablas y 12 horarios.`);
  } finally {
    await connection.end();
  }
}

async function main() {
  requireGuard();
  const credentialsFile = path.resolve(required('SAAS_TEST_CREDENTIALS_FILE'));
  await access(credentialsFile);
  dotenv.config({ path: credentialsFile, override: true, quiet: true });

  const config = {
    host: required('MYSQL_HOST'),
    port: Number(process.env.MYSQL_PORT || 3306),
    user: required('MYSQL_USER'),
    password: required('MYSQL_PASSWORD'),
    connectTimeout: 10000,
  };
  const bootstrapConnection = await mysql.createConnection(config);
  try {
    await bootstrapConnection.query(
      `CREATE DATABASE IF NOT EXISTS ${TEST_DATABASE}
       CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci`,
    );
  } finally {
    await bootstrapConnection.end();
  }

  const migrationEnvironment = {
    ...process.env,
    NODE_ENV: 'test',
    MYSQL_DB: TEST_DATABASE,
    ALLOW_DB_MIGRATION: 'true',
  };
  await runMigrations(migrationEnvironment);
  await runMigrations(migrationEnvironment);
  await verifySchema(config);
}

main().catch((error) => {
  console.error(`Bootstrap de prueba fallido: ${error.message}`);
  process.exitCode = 1;
});
