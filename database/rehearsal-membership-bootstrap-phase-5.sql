-- PHASE 5/5 — GRANT RESOLVER EXECUTION AND MINIMUM TENANT COLUMN READS
-- Run only after phase 4 completed successfully. Run once only.
-- This does NOT create a LOGIN role or grant access to any API credential.

BEGIN;

REVOKE ALL ON FUNCTION private.resolve_schoolpro_test_membership(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION private.resolve_schoolpro_test_membership(uuid)
  TO schoolpro_api_access;
GRANT USAGE ON SCHEMA private TO schoolpro_api_access;

GRANT schoolpro_runtime TO schoolpro_api_access WITH INHERIT FALSE, SET TRUE;

GRANT SELECT (user_id, school_id, role)
  ON public.schoolpro_members TO schoolpro_runtime;
GRANT SELECT (id, owner_id)
  ON public.schoolpro_schools TO schoolpro_runtime;
GRANT USAGE ON SCHEMA public TO schoolpro_runtime;

COMMIT;

-- Do not insert allowlist rows or membership fixtures yet.
-- Do not create or grant to a LOGIN/API role yet.
-- Keep Render IDENTITY_MAPPING_VERIFIED=false until resolver, grants, restricted login,
-- both-tenant tests, negative auth cases, and pool-context cleanup are verified.
