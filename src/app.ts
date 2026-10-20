import Fastify, { type FastifyInstance } from 'fastify';
import rateLimit from '@fastify/rate-limit';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { config, identityMappingConfigured, requiredTables } from './config.js';
import { pool } from './db.js';
import type { PoolClient } from 'pg';
import { IdentityMappingUnavailable, MembershipNotFound, ProfileInactive, AmbiguousMembership, UnauthorizedTestRole, resolveTestMembership } from './identity.js';

export type Dependencies = { db: typeof pool; supabase: SupabaseClient | null };
export type AppOptions = { appEnv?: string; enableTestEndpoints?: boolean };

async function readActiveProfileStatus(token: string, userId: string): Promise<string | null> {
  if (!config.SUPABASE_URL || !config.SUPABASE_PUBLISHABLE_KEY) throw new Error('Supabase profile lookup is not configured');
  // Use the verified user's bearer token for RLS; the service's publishable-key client alone
  // does not establish auth.uid() and must not be used to read profile status as anon.
  const userScopedClient = createClient(config.SUPABASE_URL, config.SUPABASE_PUBLISHABLE_KEY, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
  });
  const { data, error } = await userScopedClient.from('profiles').select('status').eq('id', userId).maybeSingle();
  if (error) throw new Error('Supabase profile status lookup failed');
  return data?.status ?? null;
}

export function buildApp(deps: Dependencies = {
  db: pool,
  supabase: config.SUPABASE_URL && config.SUPABASE_PUBLISHABLE_KEY
    ? createClient(config.SUPABASE_URL, config.SUPABASE_PUBLISHABLE_KEY, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } })
    : null
}, options: AppOptions = {}): FastifyInstance {
  const app = Fastify({ logger: { level: process.env.LOG_LEVEL ?? 'info', redact: ['req.headers.authorization', 'req.headers.cookie', 'DATABASE_URL', 'SUPABASE_PUBLISHABLE_KEY'] }, bodyLimit: 16_384, requestIdHeader: 'x-request-id', requestIdLogLabel: 'requestId' });
  void app.register(rateLimit, { max: 60, timeWindow: '1 minute', keyGenerator: (request) => request.ip });

  app.setErrorHandler((error, request, reply) => {
    const normalizedError = error instanceof Error ? error : new Error(String(error));
    const candidateStatus = typeof error === 'object' && error !== null && 'statusCode' in error
      && typeof error.statusCode === 'number' ? error.statusCode : 500;
    request.log.warn({ errType: normalizedError.name, statusCode: candidateStatus }, 'request failed');
    const status = candidateStatus >= 400 && candidateStatus < 500 ? candidateStatus : 500;
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
                     ELSE has_table_privilege(current_user, to_regclass($1), 'SELECT') END AS can_select,
                EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'schoolpro_runtime') AS runtime_role_present,
                CASE WHEN to_regclass($1) IS NULL OR NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'schoolpro_runtime') THEN FALSE
                     ELSE has_table_privilege('schoolpro_runtime', to_regclass($1), 'SELECT') END AS runtime_can_select`,
        [mappingName]
      );
      if (mapping.rows[0]?.present !== true) return reply.code(503).send({ status: 'not_ready', reason: 'identity_mapping_relation_missing' });
      if (mapping.rows[0]?.can_select !== true || mapping.rows[0]?.runtime_role_present !== true || mapping.rows[0]?.runtime_can_select !== true) {
        return reply.code(503).send({ status: 'not_ready', reason: 'identity_mapping_select_not_granted' });
      }
      const mappingColumns = [config.IDENTITY_USER_ID_COLUMN, config.IDENTITY_SCHOOL_ID_COLUMN, config.IDENTITY_ROLE_COLUMN];
      for (const column of mappingColumns) {
        if (!column) return reply.code(503).send({ status: 'not_ready', reason: 'identity_mapping_columns_unconfigured' });
        const found = await deps.db.query(
          `SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = $1 AND table_name = $2 AND column_name = $3) AS present,
                  CASE WHEN to_regclass($4) IS NULL THEN FALSE
                       ELSE has_column_privilege('schoolpro_runtime', to_regclass($4), $3, 'SELECT') END AS runtime_can_select`,
          [config.IDENTITY_SCHEMA, config.IDENTITY_TABLE, column, mappingName]
        );
        if (found.rows[0]?.present !== true) return reply.code(503).send({ status: 'not_ready', reason: 'identity_mapping_column_missing' });
        if (found.rows[0]?.runtime_can_select !== true) return reply.code(503).send({ status: 'not_ready', reason: 'identity_mapping_select_not_granted' });
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
      let profileStatus: string | null;
      try { profileStatus = await readActiveProfileStatus(token, userId); }
      catch { return reply.code(503).send({ error: 'identity_mapping_unavailable' }); }
      if (profileStatus !== 'active') return reply.code(403).send({ error: 'profile_inactive' });
      const membership = await resolveTestMembership(deps.db, userId, profileStatus);
      return reply.code(200).send({ userId, membership });
    } catch (error) {
      if (error instanceof ProfileInactive) return reply.code(403).send({ error: 'profile_inactive' });
      if (error instanceof ProfileInactive) return reply.code(403).send({ error: 'profile_inactive' });
      if (error instanceof MembershipNotFound) return reply.code(403).send({ error: 'membership_not_found' });
      if (error instanceof AmbiguousMembership) return reply.code(409).send({ error: 'membership_ambiguous' });
      if (error instanceof UnauthorizedTestRole) return reply.code(403).send({ error: 'role_not_allowed_for_test' });
      if (error instanceof IdentityMappingUnavailable) return reply.code(503).send({ error: 'identity_mapping_unavailable' });
      request.log.warn({ errType: error instanceof Error ? error.name : 'unknown' }, 'membership lookup failed');
      return reply.code(503).send({ error: 'identity_mapping_unavailable' });
    }
  });

  app.get('/v1/test/db-context', async (request, reply) => {
    if ((options.appEnv ?? config.APP_ENV) !== 'staging' || !(options.enableTestEndpoints ?? config.ENABLE_TEST_ENDPOINTS)) {
      return reply.code(404).send({ error: 'not_found' });
    }
    const auth = request.headers.authorization;
    if (!auth || !/^Bearer\s+\S+$/i.test(auth)) return reply.code(401).send({ error: 'unauthorized' });
    if (!deps.supabase) return reply.code(503).send({ error: 'identity_verification_unavailable' });
    if (!deps.db) return reply.code(503).send({ error: 'database_unavailable' });
    const token = auth.replace(/^Bearer\s+/i, '');
    let userId: string;
    try {
      const { data, error } = await deps.supabase.auth.getUser(token);
      if (error || !data.user?.id) return reply.code(401).send({ error: 'unauthorized' });
      userId = data.user.id;
    } catch {
      return reply.code(401).send({ error: 'unauthorized' });
    }

    let client: PoolClient | null = null;
    let inTransaction = false;
    try {
      const profileStatus = await readActiveProfileStatus(token, userId);
      if (profileStatus !== 'active') throw new ProfileInactive('Active Supabase profile could not be verified');
      const membership = await resolveTestMembership(deps.db, userId, profileStatus);
      client = await deps.db.connect();
      await client.query('BEGIN');
      inTransaction = true;
      // Fixed role name only; no request-controlled SQL identifiers. The login role must
      // be explicitly granted membership in this non-owner, NOBYPASSRLS role.
      await client.query('SET LOCAL ROLE schoolpro_runtime');
      await client.query(
        "SELECT set_config('app.school_id', $1, true), set_config('app.user_id', $2, true), set_config('app.role', $3, true)",
        [membership.schoolId, userId, membership.role]
      );
      const check = await client.query<{
        current_role: string;
        session_role: string;
        bypass_rls: boolean;
        superuser: boolean;
        can_login: boolean;
        can_create_db: boolean;
        can_create_role: boolean;
        owns_schoolpro_tables: boolean;
        tenant_context: string | null;
        user_context: string | null;
        role_context: string | null;
      }>(`
        SELECT current_user AS current_role,
               session_user AS session_role,
               COALESCE(r.rolbypassrls, TRUE) AS bypass_rls,
               COALESCE(r.rolsuper, TRUE) AS superuser,
               COALESCE(r.rolcanlogin, TRUE) AS can_login,
               COALESCE(r.rolcreatedb, TRUE) AS can_create_db,
               COALESCE(r.rolcreaterole, TRUE) AS can_create_role,
               EXISTS (
                 SELECT 1 FROM pg_class c
                 JOIN pg_namespace n ON n.oid = c.relnamespace
                 WHERE n.nspname IN ('public', 'private')
                   AND c.relname LIKE 'schoolpro!_%' ESCAPE '!'
                   AND c.relowner = (SELECT oid FROM pg_roles WHERE rolname = current_user)
               ) AS owns_schoolpro_tables,
               current_setting('app.school_id', true) AS tenant_context,
               current_setting('app.user_id', true) AS user_context,
               current_setting('app.role', true) AS role_context
        FROM pg_roles r WHERE r.rolname = current_user
      `);
      const row = check.rows[0];
      if (!row || row.current_role !== 'schoolpro_runtime' || row.session_role === row.current_role
        || row.bypass_rls || row.superuser || row.can_login || row.can_create_db || row.can_create_role || row.owns_schoolpro_tables
        || row.tenant_context !== membership.schoolId || row.user_context !== userId || row.role_context !== membership.role) {
        await client.query('ROLLBACK');
        inTransaction = false;
        return reply.code(503).send({ error: 'runtime_role_invariant_failed' });
      }
      await client.query('ROLLBACK');
      inTransaction = false;
      return reply.code(200).send({
        status: 'runtime_context_verified',
        runtimeRole: row.current_role,
        sessionRoleIsSeparate: row.session_role !== row.current_role,
        bypassRls: row.bypass_rls,
        ownsSchoolProTables: row.owns_schoolpro_tables,
        tenantContextSetLocally: row.tenant_context === membership.schoolId,
        transactionRolledBack: true
      });
    } catch (error) {
      if (client && inTransaction) {
        try { await client.query('ROLLBACK'); } catch { /* connection cleanup below */ }
      }
      if (error instanceof ProfileInactive) return reply.code(403).send({ error: 'profile_inactive' });
      if (error instanceof MembershipNotFound) return reply.code(403).send({ error: 'membership_not_found' });
      if (error instanceof AmbiguousMembership) return reply.code(409).send({ error: 'membership_ambiguous' });
      if (error instanceof UnauthorizedTestRole) return reply.code(403).send({ error: 'role_not_allowed_for_test' });
      request.log.warn({ errType: error instanceof Error ? error.name : 'unknown' }, 'runtime context verification failed');
      return reply.code(503).send({ error: 'runtime_context_unavailable' });
    } finally {
      client?.release();
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
