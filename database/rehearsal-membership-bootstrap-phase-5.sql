-- PHASE 5/5 — GRANT ONLY THE REHEARSAL RESOLVER AND REQUIRED IDENTITY COLUMNS
-- Run only after phase 4 completed successfully. Maximum: 10 SQL statements.
-- This does NOT create a LOGIN role or grant any API credential access.

BEGIN;

DO $preflight$
BEGIN
  IF current_database() <> 'schoolpro_rehearsal_20261018' OR current_user <> 'avnadmin' THEN
    RAISE EXCEPTION 'Wrong database or operator';
  END IF;
  IF to_regprocedure('private.resolve_schoolpro_test_membership(uuid)') IS NULL THEN
    RAISE EXCEPTION 'Resolver function missing; phase 4 must complete first';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='private' AND p.proname='resolve_schoolpro_test_membership'
      AND pg_get_userbyid(p.proowner)='schoolpro_bootstrap_owner'
      AND p.prosecdef=true
  ) THEN
    RAISE EXCEPTION 'Resolver ownership or SECURITY DEFINER property is unsafe';
  END IF;
END
$preflight$;

REVOKE ALL ON FUNCTION private.resolve_schoolpro_test_membership(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION private.resolve_schoolpro_test_membership(uuid) TO schoolpro_api_access;
GRANT USAGE ON SCHEMA private TO schoolpro_api_access;
GRANT schoolpro_runtime TO schoolpro_api_access WITH INHERIT FALSE, SET TRUE;
GRANT SELECT (user_id, school_id, role) ON public.schoolpro_members TO schoolpro_runtime;
GRANT SELECT (id, owner_id) ON public.schoolpro_schools TO schoolpro_runtime;
GRANT USAGE ON SCHEMA public TO schoolpro_runtime;

COMMIT;

-- Do not insert allowlist rows or membership fixtures yet.
-- Do not create or grant to a LOGIN/API role yet.
-- Keep Render IDENTITY_MAPPING_VERIFIED=false until the resolver, grants, real API login,
-- both-tenant tests, negative auth cases, and pool-context cleanup are independently verified.
