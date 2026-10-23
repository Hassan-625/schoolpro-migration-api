import pg from 'pg';
import { config } from './config.js';
const { Pool } = pg;

function databasePoolOptions() {
  if (!config.DATABASE_URL) return null;

  // pg's connection-string SSL options can override the explicit ssl object.
  // Remove URL-provided SSL mode/root-certificate options and configure TLS here.
  const connectionUrl = new URL(config.DATABASE_URL);
  connectionUrl.searchParams.delete('sslmode');
  connectionUrl.searchParams.delete('sslrootcert');
  connectionUrl.searchParams.delete('sslcert');
  connectionUrl.searchParams.delete('sslkey');

  return {
    connectionString: connectionUrl.toString(),
    // Keep certificate verification enabled; trust the supplied Aiven CA when configured.
    ssl: {
      rejectUnauthorized: true,
      ...(config.AIVEN_CA_CERT ? { ca: config.AIVEN_CA_CERT } : {})
    },
    max: 5,
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 5_000,
    statement_timeout: 5_000,
    application_name: 'schoolpro-trusted-migration-api-staging'
  };
}

const poolOptions = databasePoolOptions();
export const pool = poolOptions ? new Pool(poolOptions) : null;

export async function closePool(): Promise<void> {
  if (pool) await pool.end();
}
