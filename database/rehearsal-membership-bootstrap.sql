-- Hardened rehearsal-only membership bootstrap for schoolpro-migration-api.
-- Execute only through the authorized Aiven SQL Editor after reviewing this file.
-- Does NOT seed school IDs, enable identity mapping, create a LOGIN credential, or
-- grant access to an unverified application login. Target is pinned to rehearsal DB.

BEGIN;

DO $preflight$
DECLARE
  v_members_owner text;
  v_schools_owner text;
BEGIN
  IF current_database() <> 'schoolpro_rehearsal_20261018' THEN
    RAISE EXCEPTION 'Wrong database: expected schoolpro_rehearsal_20261018, got %', current_database();
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_roles
    WHERE rolname = current_user AND rolcreaterole AND NOT rolsuper
  ) THEN
    RAISE EXCEPTION 'Operator must be a non-superuser with CREATEROLE';
  END IF;

  SELECT pg_get_userbyid(c.relowner) INTO v_members_owner
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relname = 'schoolpro_members' AND c.relkind = 'r';
  SELECT pg_get_userbyid(c.relowner) INTO v_schools_owner
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relname = 'schoolpro_schools' AND c.relkind = 'r';

  IF v_members_owner IS NULL OR v_schools_owner IS NULL THEN
    RAISE EXCEPTION 'Required rehearsal tables are missing or are not ordinary tables';
  END IF;
  IF v_members_owner <> current_user OR v_schools_owner <> current_user THEN
    RAISE EXCEPTION 'Operator must own both tenant tables (members owner=%, schools owner=%)',
      v_members_owner, v_schools_owner;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relname = 'schoolpro_members' AND c.relrowsecurity
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relname = 'schoolpro_schools' AND c.relrowsecurity
  ) THEN
    RAISE EXCEPTION 'RLS must be enabled on both SchoolPro tenant tables';
  END IF;

  IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'private')
     OR to_regclass('private.schoolpro_test_school_allowlist') IS NOT NULL THEN
    RAISE EXCEPTION 'private schema or allowlist already exists; inspect ownership/grants and reconcile manually';
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_policy p
    JOIN pg_class c ON c.oid = p.polrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relname = 'schoolpro_members'
      AND p.polname IN (
        'schoolpro_bootstrap_allowlisted_members',
        'schoolpro_bootstrap_allowlist_fence'
      )
  ) THEN
    RAISE EXCEPTION 'Bootstrap policy names already exist; inspect policy definitions before proceeding';
  END IF;
END
$preflight$;

DO $roles$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'schoolpro_bootstrap_owner') THEN
    CREATE ROLE schoolpro_bootstrap_owner
      NOLOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOINHERIT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'schoolpro_api_access') THEN
    CREATE ROLE schoolpro_api_access
      NOLOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOINHERIT;
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_roles
    WHERE rolname IN ('schoolpro_bootstrap_owner', 'schoolpro_api_access')
      AND (rolcanlogin OR rolsuper OR rolbypassrls OR rolcreatedb OR rolcreaterole OR rolinherit)
  ) THEN
    RAISE EXCEPTION 'Existing helper role attributes are unsafe; reconcile manually instead of silently altering them';
  END IF;

  IF pg_has_role(current_user, 'schoolpro_bootstrap_owner', 'MEMBER') THEN
    RAISE EXCEPTION 'Operator already belongs to schoolpro_bootstrap_owner; use a separately reviewed role path';
  END IF;
END
$roles$;

CREATE SCHEMA private;
REVOKE ALL ON SCHEMA private FROM PUBLIC;
GRANT USAGE ON SCHEMA private TO schoolpro_bootstrap_owner, schoolpro_api_access;
GRANT CREATE ON SCHEMA private TO schoolpro_bootstrap_owner;
GRANT USAGE ON SCHEMA public TO schoolpro_bootstrap_owner, schoolpro_runtime;

-- DBA owns the allowlist so the SECURITY DEFINER owner can read, but cannot edit it.
CREATE TABLE private.schoolpro_test_school_allowlist (
  school_key text PRIMARY KEY CHECK (school_key IN ('A', 'B')),
  school_id uuid NOT NULL UNIQUE,
  enabled boolean NOT NULL DEFAULT false
);
REVOKE ALL ON private.schoolpro_test_school_allowlist FROM PUBLIC;
REVOKE ALL ON private.schoolpro_test_school_allowlist FROM schoolpro_runtime, schoolpro_api_access;
GRANT SELECT ON private.schoolpro_test_school_allowlist TO schoolpro_bootstrap_owner;

GRANT SELECT (user_id, school_id, role)
  ON public.schoolpro_members TO schoolpro_bootstrap_owner;

-- The permissive policy allows rows in the allowlist. The restrictive fence ensures
-- other permissive policies (including PUBLIC policies) cannot widen that boundary.
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

CREATE POLICY schoolpro_bootstrap_allowlist_fence
  ON public.schoolpro_members
  AS RESTRICTIVE
  FOR SELECT
  TO schoolpro_bootstrap_owner
  USING (
    school_id IN (
      SELECT allowlist.school_id
      FROM private.schoolpro_test_school_allowlist AS allowlist
      WHERE allowlist.enabled = true
    )
  );

-- The operator's temporary membership is safe only if it did not exist beforehand.
-- The transaction rolls back all changes if grant, SET ROLE, creation, or cleanup fails.
GRANT schoolpro_bootstrap_owner TO current_user;
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
REVOKE schoolpro_bootstrap_owner FROM current_user;
REVOKE CREATE ON SCHEMA private FROM schoolpro_bootstrap_owner;

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

-- No LOGIN credential, allowlist rows, or membership fixtures are created here.
-- After verifying the actual Render login role, set its password securely and grant
-- schoolpro_api_access to that login with INHERIT FALSE, SET TRUE.
-- Never use avnadmin or a table-owner role as the API login.
-- Keep IDENTITY_MAPPING_VERIFIED=false until the live test suite passes.

COMMIT;
