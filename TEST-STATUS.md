# Test status — 2026-10-20

## Latest CI validation — 2026-10-20

- GitHub Actions run [39443355591](https://github.com/Hassan-625/schoolpro-migration-api/actions/runs/39443355591) for commit `46e382524064d57ae046ee21cd5fb79efc07eeaf` completed the workflow's substantive steps: `npm ci`, lint, typecheck, build and unit tests. The test step reports 4 files and 26 tests passed; npm audit reports 0 vulnerabilities.
- Added `/v1/test/db-context`, staging-only and disabled by default. It validates server-side token verification, the operator-reviewed synthetic membership gate, fixed `SET LOCAL ROLE schoolpro_runtime`, transaction-local identity context, distinct session/runtime roles, `NOBYPASSRLS`, non-superuser/non-login runtime attributes, non-ownership of SchoolPro tables, rollback and pooled-client release.
- Unit tests cover hidden-by-default behavior, missing bearer token, and invalid-token rejection before acquiring a pooled database client. No successful live database-context request has been made.
- The Aiven PG Editor access attempt returned HTTP 403 because the configured IP filter blocked the tool egress. No transient IP was allowlisted. Aiven network/role integration and the 22-case tenant acceptance suite remain BLOCKED / NOT RUN.



## Completed checks

- TypeScript source/test syntax diagnostics: 7 of 7 files reported syntax OK using TypeScript transpile diagnostics before the latest readiness fix; the updated source/test files were rechecked after that fix.
- Source archive integrity: `unzip -t` passed.
- `git diff --check`: passed for the latest readiness fix before commit.

## Latest source review

- Fixed `/ready` so it cannot report ready without a configured server-side Supabase Auth verifier and a reviewed identity mapping; it now explicitly checks that mapping relation exists even when `REQUIRED_SCHEMA_TABLES` is empty.
- Identity mapping now also fails closed unless `IDENTITY_ACTIVE_COLUMN` is explicitly configured; the resolver always filters active memberships with `= TRUE`, preventing a lone historical/inactive row from being treated as current. This is still unverified against the actual source schema.
- Added a regression test for readiness when Auth verification is unavailable. This test is authored but not executed because Vitest dependencies are unavailable.
- Latest local-only commit: `a267011cf249bdb9027b97c5ea0358a7a52e33c4`.

## Runtime context endpoint checkpoint — 2026-10-20

- Added staging-only `/v1/test/db-context`: validates server-side Supabase token, reviewed synthetic membership, transaction-scoped `SET LOCAL ROLE schoolpro_runtime`, transaction-local context, `NOBYPASSRLS`, non-ownership, and rollback/release cleanup. It performs no tenant data operation.
- Added unit tests for hidden-by-default behavior, missing bearer token, and invalid-token rejection before pooled client acquisition. These tests are authored but require the CI run to execute them.
- This does not prove live Aiven connectivity or tenant policy behavior. The Aiven PG Editor read was blocked by IP filtering (HTTP 403 from tool egress); no transient IP was allowlisted.

## Blocked / not passed

- Dependency installation / lockfile: blocked. `npm install --package-lock-only --ignore-scripts --no-audit --no-fund` timed out while attempting to reach the npm registry. Prior attempts reported `EAI_AGAIN registry.npmjs.org`. There is no `package-lock.json` yet.
- Lint: not passed; ESLint is not installed in this environment.
- Typecheck/build: not passed; required Node/Vitest type definitions and packages are unavailable.
- Unit tests: not run successfully; Vitest is not installed.
- PostgreSQL/RLS integration tests: not implemented/run. There is no verified membership mapping, reviewed synthetic fixture set, verified runtime-role privilege snapshot, or proven staging network path.
- Render staging deployment: not created.

Syntax diagnostics and archive integrity are not substitutes for a package-aware typecheck, build, test run, or runtime security test. No test should be marked passed until it has run and its result is retained.

## Checkpoint — fail-closed active membership and mapping readiness

- Required `IDENTITY_ACTIVE_COLUMN`; no fallback that treats all membership rows as active.
- Mapping configuration requires two distinct synthetic school UUIDs and an explicit allowed-role list.
- `/ready` now verifies mapping relation existence, runtime SELECT privilege, and the configured user/school/role/active columns, using parameterized catalog queries.
- These are source-level hardening changes only. No runtime schema or production configuration was changed; unit/integration tests remain blocked by dependency installation.
