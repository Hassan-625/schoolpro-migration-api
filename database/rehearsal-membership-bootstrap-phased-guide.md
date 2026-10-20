# Aiven rehearsal membership bootstrap — phased execution guide

Target database: `schoolpro_rehearsal_20261018`  
Expected SQL Editor role: `avnadmin`  
Branch: `fix/narrow-membership-bootstrap-20261020`

The Aiven SQL Editor limits each execution to 10 queries. The former single-file bootstrap is therefore **not** the execution artifact. Use the five phase files in numeric order; each phase is an independent transaction and contains no more than 10 SQL statements including `BEGIN` and `COMMIT`.

## Run order

1. `rehearsal-membership-bootstrap-phase-1.sql` — read-only preflight plus helper roles and private schema.
2. `rehearsal-membership-bootstrap-phase-2.sql` — create the empty, DBA-owned allowlist.
3. `rehearsal-membership-bootstrap-phase-3.sql` — narrow column grant and allowlist-fenced RLS policies.
4. `rehearsal-membership-bootstrap-phase-4.sql` — create resolver function owned by the restricted NOLOGIN role; temporary membership is revoked in the same transaction.
5. `rehearsal-membership-bootstrap-phase-5.sql` — grant resolver execution and minimum identity-column reads to the runtime role.

## Mandatory operating rules

- Run **one phase per SQL Editor execution**. Do not paste the old all-in-one file.
- Check that the execution completed successfully before moving to the next phase.
- If any phase errors, stop. Do not blindly rerun that phase or continue to later phases. Return the exact error and the phase number so the resulting database state can be inspected before recovery.
- These are five committed phases, not one cross-phase transaction. A later failure does not roll back earlier successful phases; the phase preflights intentionally fail on unexpected pre-existing objects instead of silently adopting them.
- No school IDs are inserted into the allowlist, no synthetic membership fixtures are created, no LOGIN/API credential is created, and no Render environment variable is changed by these scripts.
- Never use `avnadmin` or a table-owner role as the API login. Do not grant access to an application LOGIN until its actual role and connection configuration are verified.
- Keep `IDENTITY_MAPPING_VERIFIED=false` until all acceptance tests pass.

## After phase 5

Do not improvise fixture inserts. First verify role attributes, resolver owner/security properties, RLS policies, table and column privileges, and the absence of any lingering `avnadmin` membership in `schoolpro_bootstrap_owner`. Then prepare a separate reviewed fixture script for the two authorized synthetic tenants and a separate restricted LOGIN provisioning step. Run positive and negative API authorization tests before any staging identity-mapping enablement.

The original `rehearsal-membership-bootstrap.sql` remains a review artifact; do not execute it as a whole in the limited SQL Editor.
