import type { Pool, PoolClient } from 'pg';
import type { SupabaseClient } from '@supabase/supabase-js';
import { config, assertSafeIdentifier, identityMappingConfigured, allowedTestRoles } from './config.js';

export type TestMembership = { schoolId: string; role: string };
export class IdentityMappingUnavailable extends Error {
  constructor(message = 'Identity mapping is unavailable or has not been reviewed') { super(message); this.name = 'IdentityMappingUnavailable'; }
}
export class MembershipNotFound extends Error {
  constructor(message = 'No active school membership') { super(message); this.name = 'MembershipNotFound'; }
}
export class AmbiguousMembership extends Error {
  constructor(message = 'More than one active school membership') { super(message); this.name = 'AmbiguousMembership'; }
}
export class UnauthorizedTestRole extends Error {
  constructor(message = 'Role is not approved for this test harness') { super(message); this.name = 'UnauthorizedTestRole'; }
}

/**
 * Identity boundary based on the live source contract:
 * - Supabase Auth validates the bearer token before this function is called.
 * - public.profiles.status remains authoritative in Supabase.
 * - schoolpro_members is the SchoolPro membership relation in PostgreSQL/Aiven.
 * - schoolpro_members has no active/status column; a membership is eligible only when
 *   its profile is active. Never invent an active column on the target.
 * - an optional school selector is not authorization by itself: it must be one of the
 *   two operator-configured synthetic tenants and a matching membership must exist.
 */
export async function resolveTestMembership(
  db: Pool | PoolClient,
  supabase: SupabaseClient,
  authUserId: string,
  selectedSchoolId?: string
): Promise<TestMembership> {
  if (!identityMappingConfigured()) throw new IdentityMappingUnavailable('Identity mapping has not been reviewed and enabled');

  const profileResult = await supabase.from('profiles').select('status').eq('id', authUserId).maybeSingle();
  if (profileResult.error) throw new IdentityMappingUnavailable('Could not verify authoritative profile status');
  if (!profileResult.data || profileResult.data.status !== 'active') {
    throw new MembershipNotFound('Profile is missing or inactive at the Supabase identity boundary');
  }

  const table = assertSafeIdentifier(config.IDENTITY_TABLE);
  const userColumn = assertSafeIdentifier(config.IDENTITY_USER_ID_COLUMN);
  const schoolColumn = assertSafeIdentifier(config.IDENTITY_SCHOOL_ID_COLUMN);
  const roleColumn = assertSafeIdentifier(config.IDENTITY_ROLE_COLUMN);
  const qualified = `"${config.IDENTITY_SCHEMA}"."${table}"`;
  const allowedSchools = [config.SYNTHETIC_SCHOOL_A_ID, config.SYNTHETIC_SCHOOL_B_ID];
  if (selectedSchoolId && !allowedSchools.includes(selectedSchoolId)) {
    throw new IdentityMappingUnavailable('Requested school is outside the operator-configured synthetic tenant allowlist');
  }
  const candidateSchools = selectedSchoolId ? [selectedSchoolId] : allowedSchools;
  const sql = `SELECT "${schoolColumn}"::text AS school_id, "${roleColumn}"::text AS role
    FROM ${qualified}
    WHERE "${userColumn}"::text = $1
      AND "${schoolColumn}"::text = ANY($2::text[])
    ORDER BY "${schoolColumn}"::text
    LIMIT 2`;
  const result = await db.query<{ school_id: string | null; role: string | null }>(sql, [authUserId, candidateSchools]);
  if (result.rows.length === 0) throw new MembershipNotFound('No membership for an allowed synthetic school');
  if (result.rows.length !== 1) throw new AmbiguousMembership('More than one synthetic school membership; select a school and prove membership');
  const row = result.rows[0];
  if (!row?.school_id || !row.role) throw new MembershipNotFound('Membership row is incomplete');
  if (!allowedTestRoles().includes(row.role)) throw new UnauthorizedTestRole('Role is not approved for this test harness');
  return { schoolId: row.school_id, role: row.role };
}
