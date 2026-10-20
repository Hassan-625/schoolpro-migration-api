-- PHASE 4/5 — CREATE THE SECURITY-DEFINER RESOLVER UNDER A RESTRICTED NOLOGIN OWNER
-- Run only after phase 3 completed successfully. Maximum: 9 SQL statements.
-- The temporary avnadmin membership is granted and revoked within this transaction.

BEGIN;

DO $preflight$
BEGIN
  IF current_database() <> 'schoolpro_rehearsal_20261018' OR current_user <> 'avnadmin' THEN
    RAISE EXCEPTION 'Wrong database or operator';
  END IF;
  IF to_regclass('private.schoolpro_test_school_allowlist') IS NULL THEN
    RAISE EXCEPTION 'Allowlist table missing';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policy p JOIN pg_class c ON c.oid=p.polrelid JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relname='schoolpro_members' AND p.polname='schoolpro_bootstrap_allowlisted_members'
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_policy p JOIN pg_class c ON c.oid=p.polrelid JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relname='schoolpro_members' AND p.polname='schoolpro_bootstrap_allowlist_fence'
  ) THEN
    RAISE EXCEPTION 'Expected both allowlist RLS policies from phase 3';
  END IF;
  IF to_regprocedure('private.resolve_schoolpro_test_membership(uuid)') IS NOT NULL THEN
    RAISE EXCEPTION 'Resolver function already exists; stop and inspect';
  END IF;
  IF pg_has_role('avnadmin','schoolpro_bootstrap_owner','MEMBER') THEN
    RAISE EXCEPTION 'Temporary owner membership already exists; stop and inspect';
  END IF;
END
$preflight$;

GRANT schoolpro_bootstrap_owner TO avnadmin WITH INHERIT FALSE, SET TRUE;
SET LOCAL ROLE schoolpro_bootstrap_owner;

CREATE FUNCTION private.resolve_schoolpro_test_membership(p_user_id uuid)
RETURNS TABLE (school_id uuid, role text)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, private
AS $function$
BEGIN
  IF (
    SELECT count(*) FROM private.schoolpro_test_school_allowlist WHERE enabled=true
  ) <> 2 OR (
    SELECT array_agg(school_key ORDER BY school_key)
    FROM private.schoolpro_test_school_allowlist WHERE enabled=true
  ) IS DISTINCT FROM ARRAY['A','B']::text[] THEN
    RAISE EXCEPTION 'The two verified synthetic school allowlist entries are not enabled'
      USING ERRCODE = '55000';
  END IF;

  RETURN QUERY
    SELECT m.school_id, m.role::text
    FROM public.schoolpro_members AS m
    JOIN private.schoolpro_test_school_allowlist AS a
      ON a.school_id=m.school_id AND a.enabled=true
    WHERE m.user_id=p_user_id
    ORDER BY m.school_id
    LIMIT 2;
END
$function$;

RESET ROLE;
REVOKE schoolpro_bootstrap_owner FROM avnadmin;
REVOKE CREATE ON SCHEMA private FROM schoolpro_bootstrap_owner;

COMMIT;
