import type { Pool, PoolClient } from 'pg';
import { config, assertSafeIdentifier, identityMappingConfigured, allowedTestRoles } from './config.js';

export type TestMembership = { schoolId: string; role: string };
export class IdentityMappingUnavailable extends Error {
  constructor(message = 'Identity mapping is unavailable or has not been reviewed') { super(message); this.name = 'IdentityMappingUnavailable'; }
}
export class MembershipNotFound extends Error {
  constructor(message = 'No active school membership') { super(message); this.name = 'MembershipNotFound'; }
}
export class ProfileInactive extends Error {
  constructor(message = 'The Supabase profile is missing or inactive') { super(message); this.name = 'ProfileInactive'; }
}
export class AmbiguousMembership extends Error {
  constructor(message = 'More than one active school membership') { super(message); this.name = 'AmbiguousMembership'; }
}
export class UnauthorizedTestRole extends Error {
  constructor(message = 'Role is not approved for this test harness') { super(message); this.name = 'UnauthorizedTestRole'; }
}

type MembershipRow = { school_id: string | null; role: string | null };

/** Pure fail-closed validation shared by the DB resolver and adversarial unit tests. */
export function validateTestMembership(
  rows: MembershipRow[],
  profileStatus: string | null | undefined,
  approvedRoles: string[],
  allowedSchools: string[]
): TestMembership {
  if (profileStatus !== 'active') throw new ProfileInactive();
  if (rows.length === 0) throw new MembershipNotFound();
  if (rows.length !== 1) throw new AmbiguousMembership('More than one membership; a reviewed test-school selection contract is required');
  const row = rows[0];
  if (!row?.school_id || !row.role) throw new MembershipNotFound('Membership row is incomplete');
  if (!approvedRoles.includes(row.role)) throw new UnauthorizedTestRole();
  if (allowedSchools.length !== 2 || allowedSchools[0] === allowedSchools[1] || !allowedSchools.includes(row.school_id)) {
    throw new IdentityMappingUnavailable('Synthetic School A/B allowlist is missing or membership is outside it');
  }
  return { schoolId: row.school_id, role: row.role };
}

export async function resolveTestMembership(
  db: Pool | PoolClient,
  authUserId: string,
  profileStatus: string | null | undefined
): Promise<TestMembership> {
  if (!identityMappingConfigured()) throw new IdentityMappingUnavailable('Identity mapping has not been reviewed and enabled');
  // Source semantics: profiles.status is checked separately through Supabase Auth/Data API.
  // Never query schoolpro_members directly from the API login. Its RLS policy requires a
  // tenant GUC, but no tenant can be trusted until this bootstrap lookup completes.
  // The SECURITY DEFINER function is narrowly scoped by a DBA-maintained two-row allowlist.
  // It accepts only the server-validated Supabase user ID; callers cannot supply tenant IDs.
  // The API login needs EXECUTE on this function, not SELECT on the membership table.
  const result = await db.query<MembershipRow>(
    'SELECT school_id::text AS school_id, role::text AS role FROM private.resolve_schoolpro_test_membership($1::uuid)',
    [authUserId]
  );
  return validateTestMembership(
    result.rows,
    profileStatus,
    allowedTestRoles(),
    [config.SYNTHETIC_SCHOOL_A_ID, config.SYNTHETIC_SCHOOL_B_ID].filter((id): id is string => Boolean(id))
  );
}
