import { access } from 'node:fs/promises';
import path from 'node:path';

import dotenv from 'dotenv';

dotenv.config({ path: path.resolve('.env'), quiet: true });

if (process.env.NODE_ENV !== 'test' || process.env.ALLOW_DB_INTEGRATION !== 'true') {
  throw new Error('Se requieren NODE_ENV=test y ALLOW_DB_INTEGRATION=true.');
}

if (process.env.SAAS_TEST_CREDENTIALS_FILE) {
  const credentialsFile = path.resolve(process.env.SAAS_TEST_CREDENTIALS_FILE);
  await access(credentialsFile);
  dotenv.config({ path: credentialsFile, override: true, quiet: true });
}
process.env.NODE_ENV = 'test';
process.env.MYSQL_DB = 'saas_jps_test';
process.env.PROCESS_ROLE = process.env.SAAS_PROCESS_ROLE || 'api';
process.env.PORT = '2000';
process.env.CORS_ALLOWED_ORIGINS = 'http://localhost:3000,http://127.0.0.1:3000';
process.env.JWT_SECRET = 'stage10-ui-test-jwt-secret-at-least-32-bytes';
process.env.OBSERVABILITY_TOKEN = 'stage10-ui-test-observability-token-32-bytes';

await import('../index.js');
