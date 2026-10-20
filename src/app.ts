import Fastify, { type FastifyInstance } from 'fastify';
import rateLimit from '@fastify/rate-limit';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { config, identityMappingConfigured, requiredTables } from './config.js';
import { pool } from './db.js';
import { IdentityMappingUnavailable, MembershipNotFound, AmbiguousMembership, UnauthorizedTestRole, resolveTestMembership } from './identity.js';

export type Dependencies = { db: typeof pool; supabase: SupabaseClient | null };
export type AppOptions = { appEnv?: string; enableTestEndpoints?: boolean };
export function buildApp(deps: Dependencies = {
  db: pool,
  supabase: config.SUPABASE_URL && config.SUPABASE_PUBLISHABLE_KEY
    ? createClient(config.SUPABASE_URL, config.SUPABASE_PUBLISHABLE_KEY, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } })
    : null
}, options: AppOptions = {}): FastifyInstance {
  const app = Fastify({ logger: { level: process.env.LOG_LEVEL ?? 'info', redact: ['req.headers.authorization', 'req.headers.cookie', 'DATABASE_URL', 'SUPABASE_PUBLISHABLE_KEY'] }, bodyLimit: 16_384, requestIdHeader: 'x-request-id', requestIdLogLabel: 'requestId' });
  void app.register(rateLimit, { max: 60, timeWindow: '1 minute', keyGenerator: (request) => request.ip });

  app.setErrorHandler((error, request, reply) => {
    request.log.warn({ errType: error.name, statusCode: error.statusCode ?? 500 }, 'request failed');
    const status = error.statusCode && error.statusCode >= 400 && error.statusCode < 500 ? error.statusCode : 500;
    return reply.code(status).send({ error: status === 500 ? 'internal_error' : 'request_rejected', requestId: request.id });
  });

  app.get('/health', async (_request, reply) => reply.code(200).send({ status: 'ok' }));

  app.get('/ready', async (_request, reply) => {
    if (!deps.db) return reply.code(503).send({ status: 'not_ready', reason: 'database_not_configured' });
    if (!deps.supabase) return reply.code(503).send({ status: 'not_ready', reason: 'identity_verification_unavailable' });
    if (!identityMappingConfigured()) return reply.code(503).send({ status: 'not_ready', reason: 'identity_mapping_unverified' });
    try {
      await deps.db.query('SELECT 1');
      // Check the reviewed identity source explicitly; an empty optional table list
      // must never let readiness pass without the mapping relation being present.
      const mappingName = `${config.IDENTITY_SCHEMA}.${config.IDENTITY_TABLE}`;
      const mapping = await deps.db.query(
        `SELECT to_regclass($1) IS NOT NULL AS present,
                CASE WHEN to_regclass($1) IS NULL THEN FALSE
                     ELSE has_table_privilege(current_user, to_regclass($1), 'SELECT') END AS can_select`,
        [mappingName]
      );
      if (mapping.rows[0]?.present !== true) return reply.code(503).send({ status: 'not_ready', reason: 'identity_mapping_relation_missing' });
      if (mapping.rows[0]?.can_select !== true) return reply.code(503).send({ status: 'not_ready', reason: 'identity_mapping_select_not_granted' });
      const mappingColumns = [config.IDENTITY_USER_ID_COLUMN, config.IDENTITY_SCHOOL_ID_COLUMN, config.IDENTITY_ROLE_COLUMN, config.IDENTITY_ACTIVE_COLUMN];
      for (const column of mappingColumns) {
        if (!column) return reply.code(503).send({ status: 'not_ready', reason: 'identity_mapping_columns_unconfigured' });
        const found = await deps.db.query(
          'SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = $1 AND table_name = $2 AND column_name = $3) AS present',
          [config.IDENTITY_SCHEMA, config.IDENTITY_TABLE, column]
        );
        if (found.rows[0]?.present !== true) return reply.code(503).send({ status: 'not_ready', reason: 'identity_mapping_column_missing' });
      }
      const tables = requiredTables();
      for (const table of tables) {
        const result = await deps.db.query('SELECT to_regclass($1) IS NOT NULL AS present', [`${table.schema}.${table.table}`]);
        if (result.rows[0]?.present !== true) return reply.code(503).send({ status: 'not_ready', reason: 'schema_prerequisite_missing' });
      }
      return reply.code(200).send({ status: 'ready' });
    } catch {
      return reply.code(503).send({ status: 'not_ready', reason: 'dependency_unavailable' });
    }
  });

  app.get('/v1/test/identity', async (request, reply) => {
    if ((options.appEnv ?? config.APP_ENV) !== 'staging' || !(options.enableTestEndpoints ?? config.ENABLE_TEST_ENDPOINTS)) {
      return reply.code(404).send({ error: 'not_found' });
    }
    const auth = request.headers.authorization;
    if (!auth || !/^Bearer\s+\S+$/i.test(auth)) return reply.code(401).send({ error: 'unauthorized' });
    if (!deps.supabase) return reply.code(503).send({ error: 'identity_verification_unavailable' });
    if (!deps.db) return reply.code(503).send({ error: 'identity_mapping_unavailable' });
    const token = auth.replace(/^Bearer\s+/i, '');
    let userId: string;
    try {
      // getUser(token) asks Supabase Auth to validate the bearer token server-side.
      const { data, error } = await deps.supabase.auth.getUser(token);
      if (error || !data.user?.id) return reply.code(401).send({ error: 'unauthorized' });
      userId = data.user.id;
    } catch {
      return reply.code(401).send({ error: 'unauthorized' });
    }
    try {
      const membership = await resolveTestMembership(deps.db, userId);
      return reply.code(200).send({ userId, membership });
    } catch (error) {
      if (error instanceof MembershipNotFound) return reply.code(403).send({ error: 'membership_not_found' });
      if (error instanceof AmbiguousMembership) return reply.code(409).send({ error: 'membership_ambiguous' });
      if (error instanceof UnauthorizedTestRole) return reply.code(403).send({ error: 'role_not_allowed_for_test' });
      if (error instanceof IdentityMappingUnavailable) return reply.code(503).send({ error: 'identity_mapping_unavailable' });
      request.log.warn({ errType: error instanceof Error ? error.name : 'unknown' }, 'membership lookup failed');
      return reply.code(503).send({ error: 'identity_mapping_unavailable' });
    }
  });

  app.addHook('onReady', async () => {
    // Destructive fixtures are not implemented in this initial tranche. This flag is
    // deliberately insufficient by itself to enable any fixture endpoint.
    if (config.ALLOW_DESTRUCTIVE_TEST_FIXTURES && (config.NODE_ENV === 'production' || config.APP_ENV === 'production')) {
      throw new Error('Destructive test fixtures cannot be enabled in production');
    }
  });
  return app;
}
