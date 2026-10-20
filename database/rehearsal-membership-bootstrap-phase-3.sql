-- PHASE 3/5 — COLUMN GRANT AND ALLOWLIST-FENCED RLS POLICIES
-- Run only after phase 2 completed successfully. Run once only.

BEGIN;

GRANT SELECT (user_id, school_id, role)
  ON public.schoolpro_members TO schoolpro_bootstrap_owner;

CREATE POLICY schoolpro_bootstrap_allowlisted_members
  ON public.schoolpro_members
  AS PERMISSIVE
  FOR SELECT
  TO schoolpro_bootstrap_owner
  USING (
    school_id IN (
      SELECT a.school_id
      FROM private.schoolpro_test_school_allowlist AS a
      WHERE a.enabled = true
    )
  );

CREATE POLICY schoolpro_bootstrap_allowlist_fence
  ON public.schoolpro_members
  AS RESTRICTIVE
  FOR SELECT
  TO schoolpro_bootstrap_owner
  USING (
    school_id IN (
      SELECT a.school_id
      FROM private.schoolpro_test_school_allowlist AS a
      WHERE a.enabled = true
    )
  );

COMMIT;

-- If either policy already exists or any statement fails, stop and inspect; do not rerun.
