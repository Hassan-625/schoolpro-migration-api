-- PHASE 3/5 — COLUMN GRANT AND RLS POLICIES FOR THE NON-LOGIN RESOLVER OWNER
-- Run only after phase 2 completed successfully. Maximum: 7 SQL statements.

BEGIN;

DO $preflight$
BEGIN
  IF current_database() <> 'schoolpro_rehearsal_20261018' OR current_user <> 'avnadmin' THEN
    RAISE EXCEPTION 'Wrong database or operator';
  END IF;
  IF to_regclass('private.schoolpro_test_school_allowlist') IS NULL THEN
    RAISE EXCEPTION 'Allowlist table missing; phase 2 must complete first';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_policy p JOIN pg_class c ON c.oid=p.polrelid JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relname='schoolpro_members'
      AND p.polname IN ('schoolpro_bootstrap_allowlisted_members','schoolpro_bootstrap_allowlist_fence')
  ) THEN
    RAISE EXCEPTION 'Bootstrap policies already exist; stop and inspect';
  END IF;
END
$preflight$;

GRANT SELECT (user_id, school_id, role) ON public.schoolpro_members TO schoolpro_bootstrap_owner;

CREATE POLICY schoolpro_bootstrap_allowlisted_members
  ON public.schoolpro_members AS PERMISSIVE FOR SELECT TO schoolpro_bootstrap_owner
  USING (school_id IN (
    SELECT a.school_id FROM private.schoolpro_test_school_allowlist AS a WHERE a.enabled=true
  ));

CREATE POLICY schoolpro_bootstrap_allowlist_fence
  ON public.schoolpro_members AS RESTRICTIVE FOR SELECT TO schoolpro_bootstrap_owner
  USING (school_id IN (
    SELECT a.school_id FROM private.schoolpro_test_school_allowlist AS a WHERE a.enabled=true
  ));

COMMIT;
