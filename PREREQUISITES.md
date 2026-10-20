# Trusted API staging prerequisites and unresolved questions

Status as of 2026-10-20: **BLOCKED / NOT APPROVED FOR DEPLOYMENT**.

## 1. Candidate schema and membership contract

Before setting `IDENTITY_MAPPING_VERIFIED=true`, document and independently review:

- The exact schema-qualified membership table and columns for Supabase Auth user UUID, school UUID, role, and (if applicable) active membership state.
- Whether membership rows are unique per user or users may belong to multiple schools. This initial endpoint intentionally returns conflict for multiple matching active rows; it does not accept a school ID from the caller to resolve ambiguity.
- The exact active-membership semantics (boolean column assumption must not be used unless verified).
- The exact permitted test roles and whether those roles are allowed to use this audit harness.
- That the two configured school UUIDs belong only to synthetic School A and School B fixtures and contain no production records.
- Which tables are required for `/ready` and why. Configure `REQUIRED_SCHEMA_TABLES` only after the candidate schema inventory is approved.

If any item is unknown, keep the mapping flag false. Do not infer from table names or old Supabase application code without reconciling the live catalog and actual policy behavior.

## 2. Database privilege and RLS contract

- Provision a dedicated runtime login role with no table ownership and no `BYPASSRLS`.
- Grant only the catalog/schema/table privileges needed for health/readiness and the reviewed identity query.
- Do not use `avnadmin`, a database owner, or a role with `BYPASSRLS` for runtime acceptance tests.
- Capture `rolsuper`, `rolbypassrls`, ownership, effective grants, RLS enabled/forced state, and policy behavior as evidence.
- Tenant-isolation endpoints are not authorized until their SQL contract uses transaction-local tenant context, explicit rollback and client release in `finally`, plus negative tests for cross-tenant reads/writes and connection-pool reuse.

## 3. Network and secret prerequisites

- Create a separate staging Render service, not a modification of production SchoolPro.
- Configure its Aiven connection URI and Supabase public/publishable Auth key as server-side environment values. Never commit or send secret values in chat.
- Confirm outbound network access from the Render service to the Aiven endpoint, with TLS certificate validation enabled. Do not add transient agent IP addresses to allowlists.
- Use a disposable staging database and synthetic fixtures only.

## 4. Build and test prerequisites

- Generate and commit `package-lock.json` from a network-enabled environment.
- Run lint, typecheck, build and unit tests under Node 22; retain CI run URL and commit SHA.
- Add PostgreSQL integration tests against the actual runtime role for missing/ambiguous membership, unauthorized role, forged tenant/parent identifiers, cross-tenant reads/writes, destination-row mutation, rollback, and connection-pool context leakage.
- No RLS acceptance claim is valid until those integration tests run against PostgreSQL as the actual runtime role and raw evidence is retained.


The implementation now requires `IDENTITY_ACTIVE_COLUMN` to be set and always applies the active-row predicate. This is mandatory; do not enable the mapping until the field and its semantics are verified against the actual source schema.
