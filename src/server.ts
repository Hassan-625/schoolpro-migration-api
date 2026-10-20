import { buildApp } from './app.js';
import { config } from './config.js';
import { closePool } from './db.js';

const app = buildApp();
try {
  await app.listen({ host: config.HOST, port: config.PORT });
} catch (error) {
  app.log.error({ errType: error instanceof Error ? error.name : 'unknown' }, 'server startup failed');
  await closePool();
  process.exitCode = 1;
}

const shutdown = async () => {
  await app.close();
  await closePool();
};
process.on('SIGTERM', () => { void shutdown(); });
process.on('SIGINT', () => { void shutdown(); });
