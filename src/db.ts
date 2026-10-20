import pg from 'pg';
import { config } from './config.js';
const { Pool } = pg;

export const pool = config.DATABASE_URL ? new Pool({
  connectionString: config.DATABASE_URL,
  // Aiven/Render TLS must validate the server certificate; never disable verification.
  ssl: { rejectUnauthorized: true },
  max: 5,
  idleTimeoutMillis: 10_000,
  connectionTimeoutMillis: 5_000,
  statement_timeout: 5_000,
  application_name: 'schoolpro-trusted-migration-api-staging'
}) : null;

export async function closePool(): Promise<void> {
  if (pool) await pool.end();
}
