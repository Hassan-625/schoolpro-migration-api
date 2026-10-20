# Aiven rehearsal membership bootstrap — phased execution guide

Target database: `schoolpro_rehearsal_20261018`  
Expected SQL Editor role: `avnadmin`  
Branch: `fix/narrow-membership-bootstrap-20261020`

## Confirmed existing state

- `public.schoolpro_members` and `public.schoolpro_schools` are owned by `avnadmin`; RLS is enabled on both.
- `private` already exists, owned by `avnadmin`.
- Preserve `private.schoolpro_academic_clock`, its primary key, and its existing `schoolpro_tenant_scope` policy.
- The `schoolpro_runtime` role has schema USAGE on `private`; the observed schema ACL does **not** grant it CREATE.
- `schoolpro_bootstrap_owner` and `schoolpro_api_access` were absent at preflight.
- The allowlist and resolver were not present at preflight.
- The authorized Supabase staging users are `8315be04-5b24-46b2-9376-5236d2265dc2` and `fa7464e2-fd14-43d6-b51e-6f2be657fa8b`; no memberships for those users were present in Supabase at the last check. Do not fabricate school IDs or membership rows.

## Run order

Run one phase per Aiven SQL Editor execution, connected to the rehearsal database. The scripts avoid procedural `DO` blocks because the editor may count semicolons inside them toward its query limit.

1. `rehearsal-membership-bootstrap-phase-1.sql` — create the two missing NOLOGIN helper roles and grant narrowly scoped schema permissions. It reuses `private`; it does not create or revoke permissions on the existing academic-clock object.
2. `rehearsal-membership-bootstrap-phase-2.sql` — create the empty DBA-owned allowlist.
3. `rehearsal-membership-bootstrap-phase-3.sql` — grant only identity columns to the resolver owner and add allowlist-fenced SELECT policies.
4. `rehearsal-membership-bootstrap-phase-4.sql` — create the SQL-language SECURITY DEFINER resolver owned by `schoolpro_bootstrap_owner`; temporary `avnadmin` role membership is in the same transaction.
5. `rehearsal-membership-bootstrap-phase-5.sql` — grant resolver execution to the NOLOGIN group role and minimum tenant-column reads to `schoolpro_runtime`.

Each phase is a transaction, but phases are not one cross-phase transaction. If any phase errors, stop and inspect before retrying or continuing. Do not run the original all-in-one `rehearsal-membership-bootstrap.sql`; it assumes `private` does not exist.

## Important identity constraints

- The resolver returns rows only when exactly one enabled A entry and one enabled B entry exist. The allowlist must be populated later using independently verified synthetic school UUIDs; do not guess these UUIDs.
- The API login must be a dedicated restricted LOGIN, separate from `avnadmin` and `schoolpro_runtime`. The group role `schoolpro_api_access` is NOLOGIN and only provides EXECUTE on the resolver plus permission to SET ROLE to `schoolpro_runtime`.
- The scripts do not create a LOGIN credential, insert allowlist rows, create synthetic schools or memberships, change Render settings, deploy, merge, or enable identity mapping.
- Keep Render `IDENTITY_MAPPING_VERIFIED=false` until the restricted login, allowlist, resolver privileges, positive tenant A/B tests, cross-tenant denial, inactive/missing/ambiguous membership tests, unapproved-role test, invalid bearer test, resolver-failure test, role-switch test, and transaction-pool context cleanup all pass.

## After phase 5

Inspect the role attributes, function owner and ACL, policy definitions, effective table/column privileges, and temporary role-membership cleanup. Then separately prepare and review:
1. A fixture script using the verified synthetic school UUIDs and exact schema constraints.
2. A restricted LOGIN provisioning step, with secret set only through the approved secure credential mechanism.
3. A test matrix run against the staging API and the real Aiven database.

Do not enable identity mapping or deploy the feature branch until these gates pass.
