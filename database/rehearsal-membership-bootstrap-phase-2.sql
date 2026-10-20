-- PHASE 2/5 — CREATE EMPTY, DBA-OWNED SCHOOL ALLOWLIST
-- Run only after phase 1 completed successfully. Maximum: 8 SQL statements.
-- This phase creates no allowlist rows and no tenant fixtures.

BEGIN;

DO $preflight$
BEGIN
  IF current_database() <> 'schoolpro_rehearsal_20261018' OR current_user <> 'avnadmin' THEN
    RAISE EXCEPTION 'Wrong database or operator';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname='private' AND nspowner=(SELECT oid FROM pg_roles WHERE rolname='avnadmin')) THEN
    RAISE EXCEPTION 'Expected private schema owned by avnadmin; phase 1 may not have completed correctly';
  END IF;
  IF to_regclass('private.schoolpro_test_school_allowlist') IS NOT NULL THEN
    RAISE EXCEPTION 'Allowlist already exists; stop and inspect rather than rerunning this phase';
  END IF;
END
$preflight$;

CREATE TABLE private.schoolpro_test_school_allowlist (
  school_key text PRIMARY KEY CHECK (school_key IN ('A','B')),
  school_id uuid NOT NULL UNIQUE,
  enabled boolean NOT NULL DEFAULT false
);
REVOKE ALL ON private.schoolpro_test_school_allowlist FROM PUBLIC;
REVOKE ALL ON private.schoolpro_test_school_allowlist FROM schoolpro_runtime, schoolpro_api_access;
GRANT SELECT ON private.schoolpro_test_school_allowlist TO schoolpro_bootstrap_owner;

COMMIT;
