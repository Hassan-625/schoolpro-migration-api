-- SINGLE-QUERY PREFLIGHT ONLY — no database changes.
-- Run this one SELECT by itself in Aiven SQL Editor connected to schoolpro_rehearsal_20261018.
-- Do not run bootstrap phases until the result confirms every prerequisite.

SELECT
  current_database() AS database_name,
  current_user AS operator_role,
  (SELECT rolcreaterole AND NOT rolsuper FROM pg_roles WHERE rolname=current_user) AS operator_is_non_superuser_with_createrole,
  (SELECT pg_get_userbyid(c.relowner) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname='schoolpro_members' AND c.relkind='r') AS members_owner,
  (SELECT pg_get_userbyid(c.relowner) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname='schoolpro_schools' AND c.relkind='r') AS schools_owner,
  (SELECT c.relrowsecurity FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname='schoolpro_members' AND c.relkind='r') AS members_rls_enabled,
  (SELECT c.relrowsecurity FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname='schoolpro_schools' AND c.relkind='r') AS schools_rls_enabled,
  EXISTS (SELECT 1 FROM pg_namespace WHERE nspname='private') AS private_schema_already_exists,
  EXISTS (SELECT 1 FROM pg_roles WHERE rolname='schoolpro_bootstrap_owner') AS bootstrap_owner_role_exists,
  EXISTS (SELECT 1 FROM pg_roles WHERE rolname='schoolpro_api_access') AS api_access_role_exists,
  EXISTS (SELECT 1 FROM pg_policy p JOIN pg_class c ON c.oid=p.polrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname='schoolpro_members' AND p.polname IN ('schoolpro_bootstrap_allowlisted_members','schoolpro_bootstrap_allowlist_fence')) AS bootstrap_policy_name_collision;
