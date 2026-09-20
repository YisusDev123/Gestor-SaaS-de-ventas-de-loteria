import crypto from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const FILE_PATTERN = /^(\d{3})_([a-z0-9_]+)\.sql$/;
const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
const migrationsDirectory = path.resolve(currentDirectory, '../database/migrations');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function run() {
  const entries = await readdir(migrationsDirectory, { withFileTypes: true });
  const files = entries
    .filter((entry) => entry.isFile() && FILE_PATTERN.test(entry.name))
    .map((entry) => entry.name)
    .sort();

  assert(files.length > 0, 'No se encontraron migraciones SQL.');

  const seenVersions = new Set();
  for (const [index, filename] of files.entries()) {
    const match = FILE_PATTERN.exec(filename);
    const version = Number(match[1]);
    assert(!seenVersions.has(version), `Versión duplicada: ${version}.`);
    assert(version === index + 1, `Se esperaba la versión ${index + 1} y se encontró ${version}.`);
    seenVersions.add(version);

    const sql = await readFile(path.join(migrationsDirectory, filename), 'utf8');
    assert(sql.trim().endsWith(';'), `${filename} debe terminar en punto y coma.`);
    assert(!/\b(DROP\s+DATABASE|DROP\s+TABLE|TRUNCATE\s+TABLE)\b/i.test(sql), `${filename} contiene DDL destructivo.`);

    const checksum = crypto.createHash('sha256').update(sql).digest('hex').slice(0, 12);
    console.log(`${filename}  sha256:${checksum}`);
  }

  const catalogSql = await readFile(
    path.join(migrationsDirectory, '002_catalog_and_tenant_settings.sql'),
    'utf8',
  );
  assert(
    catalogSql.includes('DEFAULT 10') && catalogSql.includes('BETWEEN 10 AND 20'),
    'La configuración de cierre debe usar default 10 y rango 10–20.',
  );

  const ticketsSql = await readFile(
    path.join(migrationsDirectory, '004_tickets_results_and_prizes.sql'),
    'utf8',
  );

  const tenantSettingsSql = await readFile(
    path.join(migrationsDirectory, '008_tenant_configuration_versions.sql'),
    'utf8',
  );
  const cashSql = await readFile(
    path.join(migrationsDirectory, '009_allow_zero_initial_cash.sql'),
    'utf8',
  );
  const pendingDrawsSql = await readFile(
    path.join(migrationsDirectory, '010_pending_draws_until_multiplier.sql'),
    'utf8',
  );
  assert(
    pendingDrawsSql.includes("status = 'PENDING' AND multiplier_snapshot IS NULL")
      && pendingDrawsSql.includes("'10000.00'")
      && pendingDrawsSql.includes('ds.default_close_minutes_before'),
    'El alta inicial debe conservar sorteos pendientes, límite 10000 y cierre del catálogo.',
  );
  assert(
    cashSql.includes("movement_type = 'INITIAL' AND amount >= 0")
      && cashSql.includes("movement_type <> 'INITIAL' AND amount > 0"),
    'La caja debe admitir saldo inicial cero sin admitir movimientos manuales de monto cero.',
  );
  assert(
    tenantSettingsSql.includes('tenant_business_settings')
      && tenantSettingsSql.includes('config_version')
      && tenantSettingsSql.includes('receipt_fields_snapshot'),
    'La configuración tenant debe conservar concurrencia y campos extensibles del comprobante.',
  );
  assert(
    ticketsSql.includes('public_code CHAR(16)') && ticketsSql.includes('uq_tickets_public_code'),
    'El código público de ticket debe tener 16 caracteres y unicidad global.',
  );

  const seedSql = await readFile(
    path.join(migrationsDirectory, '006_seed_initial_catalog.sql'),
    'utf8',
  );
  for (const requiredValue of [
    "'NICA'",
    "'TICA'",
    "'PRIMERA'",
    "'1800'",
    "'1000'",
    "'1700'",
  ]) {
    assert(seedSql.includes(requiredValue), `Falta el seed requerido ${requiredValue}.`);
  }

  console.log(`Validación estática completada: ${files.length} migraciones.`);
}

run().catch((error) => {
  console.error(`Validación fallida: ${error.message}`);
  process.exitCode = 1;
});
