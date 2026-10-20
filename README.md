# SchoolPro Trusted Migration API (staging only)

This is an isolated TypeScript/Fastify service for the SchoolPro Supabase-to-Aiven migration audit. It is not the SchoolPro application and must never be pointed at production during the audit.

## Current safety posture

- `GET /health` is a process liveness response and does not disclose database details.
- `GET /ready` checks database connectivity, configured prerequisite tables, and the reviewed-mapping gate.
- `GET /v1/test/identity` is hidden unless `APP_ENV=staging` and `ENABLE_TEST_ENDPOINTS=true`. It verifies the bearer token with Supabase Auth `getUser(token)` and resolves membership from a server-configured table/column contract. It fails closed unless the mapping is explicitly reviewed, a single membership row is found, the role is allowlisted, and the school is one of the two operator-configured synthetic tenant UUIDs.
- No general CRUD, arbitrary SQL, destructive fixture, or general tenant-isolation endpoints are implemented in this tranche. A staging-only `/v1/test/db-context` diagnostic now validates a transaction-local `SET LOCAL ROLE schoolpro_runtime`, the role's `NOBYPASSRLS`/non-owner invariants, and tenant/user/role GUC setup for an operator-configured synthetic tenant; it rolls back without reading or writing tenant data. This is a role/context diagnostic, not a tenant-isolation acceptance pass.
- No migration/import/cutover is performed by this service.

## Local development

Requires Node.js 22+ and npm registry access.

1. Copy `.env.example` to `.env` and set only local/staging values. Never commit `.env`.
2. Install dependencies and create the lockfile: `npm install`.
3. Run checks: `npm run lint`, `npm run typecheck`, `npm run build`, `npm test`.
4. Start with `npm run dev`.

The reviewed identity mapping must remain disabled until the candidate schema, active-membership rule, role values, and synthetic tenant fixture IDs have been reviewed. A sample table name is not an approved mapping.

## Deployment

See [DEPLOYMENT.md](./DEPLOYMENT.md) and [SECURITY.md](./SECURITY.md). `render.yaml` is a blueprint only; it does not create a service unless explicitly applied. Test endpoints default off. Set `DATABASE_URL`, Supabase Auth URL/key, and any reviewed mapping variables only in the separate staging Render service's secret environment. Do not use the production SchoolPro Render service.

## Verification status

See [TEST-STATUS.md](./TEST-STATUS.md). Source syntax/archive checks have passed, but dependency-based lint/typecheck/build/unit tests and PostgreSQL/RLS integration tests are not yet verified. Do not treat this repository draft as deployment-approved.
