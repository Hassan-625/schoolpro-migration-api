-- PHASE 1/5 — PREFLIGHT, HELPER ROLES, AND PRIVATE SCHEMA
-- Run this file ONCE in Aiven SQL Editor, connected to schoolpro_rehearsal_20261018 as avnadmin.
-- Maximum: 9 SQL statements including BEGIN/COMMIT.
-- Stop on ANY error. Do not continue to the next phase if this phase fails.

BEGIN;

DO $preflight$
DECLARE
  v_members_owner text;
  v_schools_owner text;
BEGIN
  IF current_database() <> 'schoolpro_rehearsal_20261018' THEN
    RAISE EXCEPTION 'Wrong database: expected schoolpro_rehearsal_20261018, got %', current_database();
  END IF;
  IF current_user <> 'avnadmin' THEN
    RAISE EXCEPTION 'Expected operator avnadmin, got %', current_user;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = current_user AND rolcreaterole AND NOT rolsuper) THEN
    RAISE EXCEPTION 'Operator must be a non-superuser with CREATEROLE';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'schoolpro_runtime') THEN
    RAISE EXCEPTION 'Required role schoolpro_runtime does not exist';
  END IF;
  SELECT pg_get_userbyid(c.relowner) INTO v_members_owner
  FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
  WHERE n.nspname='public' AND c.relname='schoolpro_members' AND c.relkind='r';
  SELECT pg_get_userbyid(c.relowner) INTO v_schools_owner
  FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
  WHERE n.nspname='public' AND c.relname='schoolpro_schools' AND c.relkind='r';
  IF v_members_owner IS DISTINCT FROM current_user OR v_schools_owner IS DISTINCT FROM current_user THEN
    RAISE EXCEPTION 'Expected avnadmin to own both required tenant tables; members owner=%, schools owner=%', v_members_owner, v_schools_owner;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname='schoolpro_members' AND c.relrowsecurity)
     OR NOT EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname='schoolpro_schools' AND c.relrowsecurity) THEN
    RAISE EXCEPTION 'RLS must be enabled on both tenant tables';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname='private')
     OR to_regclass('private.schoolpro_test_school_allowlist') IS NOT NULL THEN
    RAISE EXCEPTION 'private schema or allowlist already exists; stop and inspect before proceeding';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_policy p JOIN pg_class c ON c.oid=p.polrelid JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relname='schoolpro_members'
      AND p.polname IN ('schoolpro_bootstrap_allowlisted_members','schoolpro_bootstrap_allowlist_fence')
  ) THEN
    RAISE EXCEPTION 'Bootstrap policy name collision; stop and inspect';
  END IF;
END
$preflight$;

DO $roles$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='schoolpro_bootstrap_owner') THEN
    CREATE ROLE schoolpro_bootstrap_owner NOLOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOINHERIT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='schoolpro_api_access') THEN
    CREATE ROLE schoolpro_api_access NOLOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOINHERIT;
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_roles
    WHERE rolname IN ('schoolpro_bootstrap_owner','schoolpro_api_access')
      AND (rolcanlogin OR rolsuper OR rolbypassrls OR rolcreatedb OR rolcreaterole OR rolinherit)
  ) THEN
    RAISE EXCEPTION 'Existing helper role attributes are unsafe; stop and inspect instead of altering them';
  END IF;
  IF pg_has_role(current_user,'schoolpro_bootstrap_owner','MEMBER') THEN
    RAISE EXCEPTION 'avnadmin already belongs to schoolpro_bootstrap_owner; stop and inspect';
  END IF;
END
$roles$;

CREATE SCHEMA private;
REVOKE ALL ON SCHEMA private FROM PUBLIC;
GRANT USAGE ON SCHEMA private TO schoolpro_bootstrap_owner, schoolpro_api_access;
GRANT CREATE ON SCHEMA private TO schoolpro_bootstrap_owner;
GRANT USAGE ON SCHEMA public TO schoolpro_bootstrap_owner, schoolpro_runtime;

COMMIT;
