-- PHASE 4/5 — CREATE THE RESTRICTED SECURITY-DEFINER MEMBERSHIP RESOLVER
-- Run only after phase 3 completed successfully. Run once only.
-- SQL-language body avoids procedural semicolons that the Aiven editor counts as queries.
-- Temporary avnadmin membership and function creation occur in one transaction.

BEGIN;

GRANT schoolpro_bootstrap_owner TO avnadmin WITH INHERIT FALSE, SET TRUE;
SET LOCAL ROLE schoolpro_bootstrap_owner;

CREATE FUNCTION private.resolve_schoolpro_test_membership(p_user_id uuid)
RETURNS TABLE (school_id uuid, role text)
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, private
AS $function$
  SELECT m.school_id, m.role::text
  FROM public.schoolpro_members AS m
  JOIN private.schoolpro_test_school_allowlist AS a
    ON a.school_id = m.school_id
   AND a.enabled = true
  WHERE m.user_id = p_user_id
    AND (
      SELECT count(*)
      FROM private.schoolpro_test_school_allowlist
      WHERE enabled = true
    ) = 2
    AND (
      SELECT count(*) FILTER (WHERE school_key = 'A')
      FROM private.schoolpro_test_school_allowlist
      WHERE enabled = true
    ) = 1
    AND (
      SELECT count(*) FILTER (WHERE school_key = 'B')
      FROM private.schoolpro_test_school_allowlist
      WHERE enabled = true
    ) = 1
  ORDER BY m.school_id
  LIMIT 2
$function$;

RESET ROLE;
REVOKE schoolpro_bootstrap_owner FROM avnadmin;
REVOKE CREATE ON SCHEMA private FROM schoolpro_bootstrap_owner;

COMMIT;

-- Do not grant EXECUTE to a login yet. The next phase grants it only to the NOLOGIN
-- group role schoolpro_api_access. If any statement errors, stop and inspect.
