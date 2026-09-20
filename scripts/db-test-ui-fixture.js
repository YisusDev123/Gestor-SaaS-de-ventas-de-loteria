import { randomBytes } from 'node:crypto';
import { access } from 'node:fs/promises';
import path from 'node:path';

import bcrypt from 'bcrypt';
import dotenv from 'dotenv';
import mysql from 'mysql2/promise';

const TEST_DATABASE = 'saas_jps_test';

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Falta la variable requerida ${name}.`);
  return value;
}

function requireGuard() {
  if (process.env.NODE_ENV !== 'test' || process.env.ALLOW_DB_INTEGRATION !== 'true') {
    throw new Error('Se requieren NODE_ENV=test y ALLOW_DB_INTEGRATION=true.');
  }
}

async function connect() {
  const credentialsFile = path.resolve(required('SAAS_TEST_CREDENTIALS_FILE'));
  await access(credentialsFile);
  dotenv.config({ path: credentialsFile, override: true, quiet: true });
  return mysql.createConnection({
    host: required('MYSQL_HOST'),
    port: Number(process.env.MYSQL_PORT || 3306),
    user: required('MYSQL_USER'),
    password: required('MYSQL_PASSWORD'),
    database: TEST_DATABASE,
    timezone: '+00:00',
    dateStrings: true,
    supportBigNumbers: true,
    bigNumberStrings: true,
    decimalNumbers: false,
  });
}

async function seed(connection) {
  const suffix = `${Date.now()}-${randomBytes(3).toString('hex')}`;
  const adminEmail = `stage10-admin-${suffix}@example.test`;
  const ownerEmail = `stage10-owner-${suffix}@example.test`;
  const adminPassword = `Stage10-${randomBytes(12).toString('base64url')}`;
  const passwordHash = await bcrypt.hash(adminPassword, 4);
  await connection.execute(
    "INSERT INTO saas_admins (email_normalized, password_hash, status) VALUES (?, ?, 'ACTIVE')",
    [adminEmail, passwordHash],
  );
  console.log(JSON.stringify({ adminEmail, adminPassword, ownerEmail }));
}

async function cleanup(connection, adminEmail, ownerEmail) {
  if (!adminEmail?.startsWith('stage10-admin-') || !ownerEmail?.startsWith('stage10-owner-')) {
    throw new Error('La limpieza sólo admite fixtures stage10 explícitos.');
  }
  let [[tenant]] = await connection.execute(
    `SELECT t.id AS tenantId, u.id AS userId
     FROM users u
     LEFT JOIN tenant_memberships tm ON tm.user_id = u.id AND tm.role = 'OWNER'
     LEFT JOIN tenants t ON t.id = tm.tenant_id
     WHERE u.email_normalized = ? LIMIT 1`,
    [ownerEmail],
  );
  if (!tenant?.tenantId) {
    [[tenant]] = await connection.execute(
      `SELECT t.id AS tenantId, NULL AS userId
       FROM tenants t
       WHERE t.display_name = 'Puesto visual Etapa 10'
         AND t.created_at >= DATE_SUB(UTC_TIMESTAMP(6), INTERVAL 1 DAY)
         AND NOT EXISTS (SELECT 1 FROM tenant_memberships tm WHERE tm.tenant_id = t.id)
       ORDER BY t.id DESC LIMIT 1`,
    );
  }
  if (tenant?.tenantId) {
    await connection.execute('DELETE FROM audit_events WHERE tenant_id = ?', [tenant.tenantId]);
    const [jobItems] = await connection.execute('SELECT DISTINCT job_run_id AS jobRunId FROM job_run_items WHERE tenant_id = ?', [tenant.tenantId]);
    await connection.execute('DELETE FROM job_run_items WHERE tenant_id = ?', [tenant.tenantId]);
    for (const item of jobItems) {
      await connection.execute('DELETE FROM job_runs WHERE id = ? AND NOT EXISTS (SELECT 1 FROM job_run_items WHERE job_run_id = ?)', [item.jobRunId, item.jobRunId]);
    }
    await connection.execute('DELETE FROM prize_payments WHERE tenant_id = ?', [tenant.tenantId]);
    await connection.execute('DELETE FROM ticket_prize_evaluations WHERE tenant_id = ?', [tenant.tenantId]);
    await connection.execute(
      'UPDATE draws SET current_result_version_id = NULL WHERE tenant_id = ?',
      [tenant.tenantId],
    );
    await connection.execute('DELETE FROM draw_result_versions WHERE tenant_id = ?', [tenant.tenantId]);
    await connection.execute('DELETE FROM ticket_replacements WHERE tenant_id = ?', [tenant.tenantId]);
    await connection.execute('DELETE FROM ticket_cancellations WHERE tenant_id = ?', [tenant.tenantId]);
    await connection.execute('DELETE FROM ticket_items WHERE tenant_id = ?', [tenant.tenantId]);
    await connection.execute('DELETE FROM cash_movements WHERE tenant_id = ?', [tenant.tenantId]);
    await connection.execute('DELETE FROM tickets WHERE tenant_id = ?', [tenant.tenantId]);
    await connection.execute(
      `DELETE FROM draw_number_positions WHERE draw_id IN (
         SELECT id FROM draws WHERE tenant_id = ?
       )`,
      [tenant.tenantId],
    );
    await connection.execute('DELETE FROM draws WHERE tenant_id = ?', [tenant.tenantId]);
    await connection.execute('DELETE FROM tenant_daily_summaries WHERE tenant_id = ?', [tenant.tenantId]);
    await connection.execute('DELETE FROM cash_accounts WHERE tenant_id = ?', [tenant.tenantId]);
    await connection.execute(
      `DELETE FROM subscription_payments WHERE subscription_period_id IN (
         SELECT sp.id FROM subscription_periods sp
         JOIN subscriptions s ON s.id = sp.subscription_id WHERE s.tenant_id = ?
       )`,
      [tenant.tenantId],
    );
    await connection.execute('DELETE FROM operation_requests WHERE tenant_id = ?', [tenant.tenantId]);
    await connection.execute(
      'DELETE FROM subscription_periods WHERE subscription_id IN (SELECT id FROM subscriptions WHERE tenant_id = ?)',
      [tenant.tenantId],
    );
    await connection.execute('DELETE FROM subscriptions WHERE tenant_id = ?', [tenant.tenantId]);
    await connection.execute('DELETE FROM tenant_daily_lottery_availability WHERE tenant_id = ?', [tenant.tenantId]);
    await connection.execute('DELETE FROM tenant_schedules WHERE tenant_id = ?', [tenant.tenantId]);
    await connection.execute('DELETE FROM tenant_modalities WHERE tenant_id = ?', [tenant.tenantId]);
    await connection.execute('DELETE FROM tenant_lotteries WHERE tenant_id = ?', [tenant.tenantId]);
    await connection.execute('DELETE FROM tenant_limit_settings WHERE tenant_id = ?', [tenant.tenantId]);
    await connection.execute('DELETE FROM tenant_business_settings WHERE tenant_id = ?', [tenant.tenantId]);
  }
  if (tenant?.userId) {
    await connection.execute('UPDATE user_sessions SET replaced_by_session_id = NULL WHERE user_id = ?', [tenant.userId]);
    await connection.execute('DELETE FROM user_sessions WHERE user_id = ?', [tenant.userId]);
    await connection.execute("DELETE FROM password_reset_tokens WHERE actor_scope = 'USER' AND actor_id = ?", [tenant.userId]);
  }
  if (tenant?.tenantId) await connection.execute('DELETE FROM tenant_memberships WHERE tenant_id = ?', [tenant.tenantId]);
  if (tenant?.userId) await connection.execute('DELETE FROM users WHERE id = ?', [tenant.userId]);
  if (tenant?.tenantId) await connection.execute('DELETE FROM tenants WHERE id = ?', [tenant.tenantId]);
  let [[admin]] = await connection.execute('SELECT id AS adminId FROM saas_admins WHERE email_normalized = ? LIMIT 1', [adminEmail]);
  if (!admin?.adminId) {
    [[admin]] = await connection.execute(
      `SELECT id AS adminId FROM saas_admins
       WHERE email_normalized LIKE 'stage10-admin-%@example.test'
         AND created_at >= DATE_SUB(UTC_TIMESTAMP(6), INTERVAL 1 DAY)
       ORDER BY id DESC LIMIT 1`,
    );
  }
  if (admin?.adminId) {
    await connection.execute('UPDATE admin_sessions SET replaced_by_session_id = NULL WHERE admin_id = ?', [admin.adminId]);
    await connection.execute('DELETE FROM admin_sessions WHERE admin_id = ?', [admin.adminId]);
    await connection.execute('DELETE FROM audit_events WHERE actor_scope = \'ADMIN\' AND actor_id = ?', [admin.adminId]);
    await connection.execute('DELETE FROM saas_admins WHERE id = ?', [admin.adminId]);
  }
  console.log('Fixture visual de Etapa 10 eliminado.');
}

async function main() {
  requireGuard();
  const connection = await connect();
  try {
    const [action, adminEmail, ownerEmail] = process.argv.slice(2);
    if (action === 'seed') await seed(connection);
    else if (action === 'cleanup') await cleanup(connection, adminEmail, ownerEmail);
    else throw new Error('Usa seed o cleanup.');
  } finally {
    await connection.end();
  }
}

main().catch((error) => {
  console.error(`Fixture visual fallido: ${error.message}`);
  process.exitCode = 1;
});
