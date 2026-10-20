# Staging deployment procedure

1. Review the membership mapping and schema blockers in `SECURITY.md`; do not set `IDENTITY_MAPPING_VERIFIED=true` until approved by the migration/security reviewer.
2. Create a separate Render Web Service from this repository and branch. Do not attach the production SchoolPro service.
3. Set `APP_ENV=staging`, `NODE_ENV=production`, `ENABLE_TEST_ENDPOINTS=true`, `ALLOW_DESTRUCTIVE_TEST_FIXTURES=false`, and `IDENTITY_MAPPING_VERIFIED=false` initially.
4. Add `DATABASE_URL` for a disposable Aiven PostgreSQL rehearsal database and `SUPABASE_URL` plus `SUPABASE_PUBLISHABLE_KEY` in Render environment settings. Configure `SYNTHETIC_SCHOOL_A_ID` and `SYNTHETIC_SCHOOL_B_ID` only with reviewed synthetic UUIDs. Never commit values or paste them into issues/chat.
5. Confirm the database role is a dedicated least-privilege runtime role, not table owner and not `BYPASSRLS`. Do not use `avnadmin` or another owner/bypass role for acceptance tests.
6. Use build command `npm ci && npm run lint && npm run typecheck && npm run build && npm test`, start command `npm start`, health check `/health`.
7. Verify `/health` returns only `{ "status": "ok" }`. Verify `/ready` remains 503 until schema and mapping prerequisites are reviewed/configured. Do not enable tenant-isolation endpoints until the test contract and integration suite exist.
8. Run integration tests against synthetic School A/B fixtures as the actual runtime role, including invalid/expired tokens, missing membership, role denials, cross-tenant reads/writes, destination-row mutation, rollback and connection-pool reuse. Capture logs with secrets redacted.
9. No production deploy, production data import, schema migration, or cutover is authorized by this procedure.


## Explicit test-endpoint activation

The Render blueprint defaults `ENABLE_TEST_ENDPOINTS=false`. Keep it false until the staging API has been reviewed. For a controlled staging identity check only, set `APP_ENV=staging` and explicitly enable `ENABLE_TEST_ENDPOINTS=true`; `NODE_ENV=production` may remain set for Node production-mode behavior. The endpoint is hidden unless the application environment is exactly staging. Do not set `APP_ENV=production` for this test harness.

The identity route remains unavailable until the exact source membership table/columns and active-membership semantics have been verified, `IDENTITY_MAPPING_VERIFIED=true` is deliberately set after review, both synthetic school IDs are configured, and `TEST_ALLOWED_ROLES` contains the reviewed test role values. Never copy real production school IDs into these settings.
