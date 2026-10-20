# Security and test status

## Current safety posture
- Separate Fastify API; no frontend or production service changes.
- Supabase Auth token is verified server-side with `auth.getUser(token)`.
- SQL identifiers are restricted to simple PostgreSQL identifiers; user ID is a bound parameter.
- No arbitrary SQL endpoint and no write/fixture endpoints are implemented.
- Test identity endpoint is disabled unless explicitly enabled and always hidden in production.
- The identity lookup deliberately fails closed unless the mapping is explicitly marked reviewed and configured. Even with mapping enabled, the response remains fail-closed unless both synthetic School A/B UUIDs are configured and the resolved membership belongs to one of those tenants.
- Destructive fixture flag cannot enable a fixture route; no fixture routes exist in this tranche.
- Pool size and statement/connection timeouts are bounded; TLS certificate verification remains enabled.

## Runtime context diagnostic added
- `/v1/test/db-context` is hidden unless `APP_ENV=staging` and `ENABLE_TEST_ENDPOINTS=true`.
- It verifies the bearer token server-side, resolves the existing reviewed synthetic membership contract, starts a transaction, uses the fixed SQL statement `SET LOCAL ROLE schoolpro_runtime`, sets transaction-local identity/tenant context from server-resolved values, checks the effective role is non-bypass and non-owner, and rolls back before releasing the connection.
- It is diagnostic-only: no tenant table is read or mutated, and it does not prove any policy allows/denies the right rows. It fails closed if the login role cannot assume `schoolpro_runtime` or any invariant fails.

## Blocking prerequisites
1. Review actual candidate Aiven schema and identify the authoritative user-to-school membership relation, active-membership semantics, role vocabulary, and handling of users with multiple school memberships.
2. Define and review synthetic School A/B IDs and ensure no production records are used.
3. Provision a dedicated `schoolpro_runtime` login role with only required privileges; verify it is not an owner and has no `BYPASSRLS`. Ensure RLS policies are actually applicable to this role.
4. Confirm Render-to-Aiven network connectivity without allowlisting transient agent IPs.
5. Add a disposable staging database and run real PostgreSQL integration tests as `schoolpro_runtime` before authorizing tenant-isolation test endpoints.

## Test coverage limits
The unit tests do not prove RLS. Cross-tenant read/write, destination-row mutation, transaction rollback, and pool-context reuse tests are not yet implemented because no reviewed test schema/identity contract or staging database credentials are available. Do not interpret CI unit tests as RLS acceptance.
