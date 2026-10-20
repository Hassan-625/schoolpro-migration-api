-- PHASE 2/5 — CREATE EMPTY, DBA-OWNED SCHOOL ALLOWLIST
-- Run only after phase 1 completed successfully. Run once only.
-- This creates no allowlist rows and no tenant fixtures.
-- Existing private schema is reused; schoolpro_academic_clock is preserved.

BEGIN;

CREATE TABLE private.schoolpro_test_school_allowlist (
  school_key text PRIMARY KEY CHECK (school_key IN ('A','B')),
  school_id uuid NOT NULL UNIQUE,
  enabled boolean NOT NULL DEFAULT false
);

REVOKE ALL ON private.schoolpro_test_school_allowlist FROM PUBLIC;
REVOKE ALL ON private.schoolpro_test_school_allowlist FROM schoolpro_runtime, schoolpro_api_access;
GRANT SELECT ON private.schoolpro_test_school_allowlist TO schoolpro_bootstrap_owner;

COMMIT;

-- If the table already exists or any statement fails, stop and inspect; do not rerun blindly.
