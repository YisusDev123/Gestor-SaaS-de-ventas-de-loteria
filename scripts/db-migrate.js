import crypto from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import dotenv from 'dotenv';
import mysql from 'mysql2/promise';

dotenv.config({ quiet: true });

const MIGRATION_FILE_PATTERN = /^(\d{3})_([a-z0-9_]+)\.sql$/;
const MIGRATION_LOCK_NAME = 'saas_jps_schema_migrations';
const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
const migrationsDirectory = path.resolve(currentDirectory, '../database/migrations');

function requireText(name) {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Falta la variable requerida ${name}.`);
  }
  return value;
}

function readInteger(name, defaultValue, { min, max }) {
  const raw = process.env[name]?.trim();
  const value = raw ? Number(raw) : defaultValue;
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw new Error(`${name} debe ser un entero entre ${min} y ${max}.`);
  }
  return value;
}

function getDatabaseConfig() {
  if (process.env.ALLOW_DB_MIGRATION !== 'true') {
    throw new Error('La migración requiere ALLOW_DB_MIGRATION=true.');
  }

  return {
    host: requireText('MYSQL_HOST'),
    port: readInteger('MYSQL_PORT', 3306, { min: 1, max: 65535 }),
    user: requireText('MYSQL_USER'),
    password: requireText('MYSQL_PASSWORD'),
    database: requireText('MYSQL_DB'),
    connectTimeout: readInteger('MYSQL_ACQUIRE_TIMEOUT_MS', 10000, {
      min: 1000,
      max: 60000,
    }),
    multipleStatements: true,
    supportBigNumbers: true,
    bigNumberStrings: true,
    decimalNumbers: false,
    timezone: 'Z',
    charset: 'utf8mb4',
  };
}

async function discoverMigrations() {
  const entries = await readdir(migrationsDirectory, { withFileTypes: true });
  const migrations = [];

  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const match = MIGRATION_FILE_PATTERN.exec(entry.name);
    if (!match) continue;

    const sql = await readFile(path.join(migrationsDirectory, entry.name), 'utf8');
    migrations.push({
      version: Number(match[1]),
      name: match[2],
      filename: entry.name,
      sql,
      checksum: crypto.createHash('sha256').update(sql).digest('hex'),
    });
  }

  migrations.sort((left, right) => left.version - right.version);
  const versions = new Set();
  for (const migration of migrations) {
    if (versions.has(migration.version)) {
      throw new Error(`Versión de migración duplicada: ${migration.version}.`);
    }
    versions.add(migration.version);
  }
  return migrations;
}

async function ensureMigrationTable(connection) {
  await connection.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INT UNSIGNED NOT NULL,
      name VARCHAR(120) NOT NULL,
      checksum CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
      applied_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
      PRIMARY KEY (version),
      UNIQUE KEY uq_schema_migrations_name (name)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
  `);
}

async function acquireMigrationLock(connection) {
  const [rows] = await connection.execute(
    'SELECT GET_LOCK(?, 15) AS acquired',
    [MIGRATION_LOCK_NAME],
  );
  if (Number(rows[0]?.acquired) !== 1) {
    throw new Error('No fue posible obtener el lock exclusivo de migraciones.');
  }
}

async function run() {
  const connection = await mysql.createConnection(getDatabaseConfig());
  let lockAcquired = false;

  try {
    await connection.query("SET time_zone = '+00:00'");
    await connection.query(
      `SET SESSION innodb_lock_wait_timeout = ${readInteger(
        'MYSQL_LOCK_WAIT_TIMEOUT_SECONDS',
        5,
        { min: 1, max: 60 },
      )}`,
    );
    await acquireMigrationLock(connection);
    lockAcquired = true;
    await ensureMigrationTable(connection);

    const [appliedRows] = await connection.query(
      'SELECT version, name, checksum FROM schema_migrations ORDER BY version',
    );
    const applied = new Map(appliedRows.map((row) => [Number(row.version), row]));
    const migrations = await discoverMigrations();

    for (const migration of migrations) {
      const previous = applied.get(migration.version);
      if (previous) {
        if (previous.name !== migration.name || previous.checksum !== migration.checksum) {
          throw new Error(
            `La migración aplicada ${migration.version} no coincide con ${migration.filename}.`,
          );
        }
        console.log(`Omitida ${migration.filename}: ya aplicada.`);
        continue;
      }

      console.log(`Aplicando ${migration.filename}...`);
      await connection.query(migration.sql);
      await connection.execute(
        'INSERT INTO schema_migrations (version, name, checksum) VALUES (?, ?, ?)',
        [migration.version, migration.name, migration.checksum],
      );
      console.log(`Aplicada ${migration.filename}.`);
    }

    console.log('Migraciones completadas.');
  } finally {
    if (lockAcquired) {
      try {
        await connection.execute('SELECT RELEASE_LOCK(?)', [MIGRATION_LOCK_NAME]);
      } catch {
        // La conexión se cerrará inmediatamente; no se oculta el error principal.
      }
    }
    await connection.end();
  }
}

run().catch((error) => {
  console.error(`Migración fallida: ${error.message}`);
  process.exitCode = 1;
});
