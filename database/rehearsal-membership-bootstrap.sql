-- Reviewed rehearsal-only membership bootstrap for schoolpro-migration-api.
-- Run manually as the authorized Aiven DBA after reviewing this file.
-- This migration intentionally DOES NOT seed synthetic school IDs, enable identity mapping,
-- create a LOGIN role/password, or grant access to an unknown application login.
-- Keep the allowlist empty until both synthetic school IDs are verified in rehearsal.

BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'schoolpro_bootstrap_owner') THEN
    CREATE ROLE schoolpro_bootstrap_owner
      NOLOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOINHERIT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'schoolpro_api_access') THEN
    CREATE ROLE schoolpro_api_access
      NOLOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOINHERIT;
  END IF;
END
$$;

ALTER ROLE schoolpro_bootstrap_owner
  NOLOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOINHERIT;
ALTER ROLE schoolpro_api_access
  NOLOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOINHERIT;

CREATE SCHEMA IF NOT EXISTS private;
REVOKE CREATE ON SCHEMA private FROM PUBLIC;
GRANT USAGE ON SCHEMA private TO schoolpro_bootstrap_owner, schoolpro_api_access;

CREATE TABLE IF NOT EXISTS private.schoolpro_test_school_allowlist (
  school_key text PRIMARY KEY CHECK (school_key IN ('A', 'B')),
  school_id uuid NOT NULL UNIQUE,
  enabled boolean NOT NULL DEFAULT false
);

REVOKE ALL ON private.schoolpro_test_school_allowlist FROM PUBLIC;
REVOKE ALL ON private.schoolpro_test_school_allowlist FROM schoolpro_runtime, schoolpro_api_access;
GRANT SELECT ON private.schoolpro_test_school_allowlist TO schoolpro_bootstrap_owner;

-- Function owner is not the membership table owner and cannot bypass RLS.
GRANT USAGE ON SCHEMA public TO schoolpro_bootstrap_owner;
GRANT SELECT (user_id, school_id, role)
  ON public.schoolpro_members TO schoolpro_bootstrap_owner;
GRANT CREATE ON SCHEMA private TO schoolpro_bootstrap_owner;

DROP POLICY IF EXISTS schoolpro_bootstrap_allowlisted_members ON public.schoolpro_members;
CREATE POLICY schoolpro_bootstrap_allowlisted_members
  ON public.schoolpro_members
  AS PERMISSIVE
  FOR SELECT
  TO schoolpro_bootstrap_owner
  USING (
    school_id IN (
      SELECT allowlist.school_id
      FROM private.schoolpro_test_school_allowlist AS allowlist
      WHERE allowlist.enabled = true
    )
  );

-- Function takes only the server-validated Supabase auth user UUID. It never accepts
-- a caller-supplied school ID. Exactly two explicitly enabled A/B entries are mandatory.
SET LOCAL ROLE schoolpro_bootstrap_owner;
CREATE OR REPLACE FUNCTION private.resolve_schoolpro_test_membership(p_user_id uuid)
RETURNS TABLE (school_id uuid, role text)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, private
AS $function$
BEGIN
  IF (
    SELECT count(*)
    FROM private.schoolpro_test_school_allowlist
    WHERE enabled = true
  ) <> 2 OR (
    SELECT array_agg(school_key ORDER BY school_key)
    FROM private.schoolpro_test_school_allowlist
    WHERE enabled = true
  ) IS DISTINCT FROM ARRAY['A', 'B']::text[] THEN
    RAISE EXCEPTION 'The two verified synthetic school allowlist entries are not enabled'
      USING ERRCODE = '55000';
  END IF;

  RETURN QUERY
    SELECT membership.school_id, membership.role::text
    FROM public.schoolpro_members AS membership
    JOIN private.schoolpro_test_school_allowlist AS allowlist
      ON allowlist.school_id = membership.school_id
     AND allowlist.enabled = true
    WHERE membership.user_id = p_user_id
    ORDER BY membership.school_id
    LIMIT 2;
END
$function$;
RESET ROLE;

REVOKE CREATE ON SCHEMA private FROM schoolpro_bootstrap_owner;
REVOKE ALL ON FUNCTION private.resolve_schoolpro_test_membership(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION private.resolve_schoolpro_test_membership(uuid)
  TO schoolpro_api_access;
GRANT USAGE ON SCHEMA private TO schoolpro_api_access;

-- Narrow runtime SELECT grants; row visibility remains governed by RLS.
GRANT SELECT (user_id, school_id, role)
  ON public.schoolpro_members TO schoolpro_runtime;
GRANT SELECT (id, owner_id)
  ON public.schoolpro_schools TO schoolpro_runtime;
GRANT USAGE ON SCHEMA public TO schoolpro_runtime;

-- Deliberately not granted here because the actual application LOGIN role is not yet
-- verified. After provisioning a dedicated non-owner, non-superuser LOGIN, the DBA must:
--   GRANT schoolpro_api_access TO <verified_api_login> WITH INHERIT TRUE, SET TRUE;
--   GRANT schoolpro_runtime TO <verified_api_login> WITH INHERIT FALSE, SET TRUE;
-- Never use avnadmin or a table-owner role as the API login.
-- Do not insert/update allowlist rows until synthetic school A/B IDs are verified.

COMMIT;
