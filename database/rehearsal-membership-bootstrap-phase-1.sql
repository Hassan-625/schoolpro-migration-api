-- PHASE 1/5 — CREATE ONLY THE MISSING RESTRICTED HELPER ROLES
-- Target: schoolpro_rehearsal_20261018 as avnadmin.
-- IMPORTANT: private schema already exists and contains private.schoolpro_academic_clock.
-- Preserve that schema, table, policy, owner, and ACL. Do not CREATE/DROP the schema.
-- Run once only; if any statement errors, stop and inspect before retrying.

BEGIN;

CREATE ROLE schoolpro_bootstrap_owner
  NOLOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOINHERIT;

CREATE ROLE schoolpro_api_access
  NOLOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOINHERIT;

GRANT USAGE ON SCHEMA private TO schoolpro_bootstrap_owner, schoolpro_api_access;
GRANT CREATE ON SCHEMA private TO schoolpro_bootstrap_owner;
GRANT USAGE ON SCHEMA public TO schoolpro_bootstrap_owner, schoolpro_runtime;

COMMIT;

-- This file intentionally contains no DO blocks because the Aiven SQL Editor counts
-- semicolons inside procedural blocks against its query limit.
-- Preflight already confirmed both helper roles are absent. If rerunning, do not do so
-- blindly: CREATE ROLE will fail if an earlier attempt partially committed.
