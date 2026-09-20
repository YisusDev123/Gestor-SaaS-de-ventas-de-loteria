import bcrypt from 'bcrypt';
import dotenv from 'dotenv';
import mysql from 'mysql2/promise';

const TEST_DATABASE = 'saas_jps_test';

dotenv.config({ quiet: true });

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Falta ${name}.`);
  return value;
}

function requireGuard() {
  if (process.env.NODE_ENV !== 'test'
    || process.env.ALLOW_DB_INTEGRATION !== 'true'
    || process.env.ALLOW_SAAS_ADMIN_PROVISION !== 'true'
    || process.env.MYSQL_DB !== TEST_DATABASE) {
    throw new Error(
      'El aprovisionamiento exige entorno test, autorización explícita y saas_jps_test.',
    );
  }
}

async function main() {
  requireGuard();
  const email = required('SAAS_ADMIN_EMAIL').toLowerCase();
  const password = required('SAAS_ADMIN_PASSWORD');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) {
    throw new Error('El correo administrativo no es válido.');
  }
  if (password.length < 8 || password.length > 128) {
    throw new Error('La contraseña debe tener entre 8 y 128 caracteres.');
  }

  const pool = mysql.createPool({
    host: required('MYSQL_HOST'),
    port: Number(process.env.MYSQL_PORT || 3306),
    user: required('MYSQL_USER'),
    password: required('MYSQL_PASSWORD'),
    database: TEST_DATABASE,
    connectionLimit: 2,
    timezone: '+00:00',
    dateStrings: true,
  });
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [rows] = await connection.execute(
      `SELECT id, password_hash AS passwordHash, status
       FROM saas_admins WHERE email_normalized = ? LIMIT 1 FOR UPDATE`,
      [email],
    );
    const existing = rows[0];
    if (existing) {
      const samePassword = await bcrypt.compare(password, existing.passwordHash);
      if (!samePassword || existing.status !== 'ACTIVE') {
        throw new Error('La cuenta ya existe con otro estado o credenciales; no fue sobrescrita.');
      }
      await connection.rollback();
      console.log(JSON.stringify({ status: 'existing', email, active: true, passwordVerified: true }));
      return;
    }

    const passwordHash = await bcrypt.hash(password, 12);
    const [result] = await connection.execute(
      `INSERT INTO saas_admins (email_normalized, password_hash, status)
       VALUES (?, ?, 'ACTIVE')`,
      [email, passwordHash],
    );
    await connection.execute(
      `INSERT INTO audit_events
        (tenant_id, actor_scope, actor_id, event_type, entity_type, entity_id, metadata)
       VALUES (NULL, 'SYSTEM', NULL, 'SAAS_ADMIN_PROVISIONED', 'SAAS_ADMIN', ?, ?)`,
      [result.insertId, JSON.stringify({ source: 'LOCAL_TEST_PROVISIONING' })],
    );
    await connection.commit();

    const [[created]] = await pool.execute(
      `SELECT password_hash AS passwordHash, status
       FROM saas_admins WHERE id = ? AND email_normalized = ? LIMIT 1`,
      [result.insertId, email],
    );
    const passwordVerified = created?.status === 'ACTIVE'
      && await bcrypt.compare(password, created.passwordHash);
    if (!passwordVerified) throw new Error('No fue posible verificar la cuenta creada.');
    console.log(JSON.stringify({ status: 'created', email, active: true, passwordVerified: true }));
  } catch (error) {
    try { await connection.rollback(); } catch { connection.destroy(); }
    throw error;
  } finally {
    connection.release();
    await pool.end();
  }
}

main().catch((error) => {
  console.error(`Aprovisionamiento administrativo fallido: ${error.message}`);
  process.exitCode = 1;
});
