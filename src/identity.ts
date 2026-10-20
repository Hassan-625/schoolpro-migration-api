import type { Pool, PoolClient } from 'pg';
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

export async function resolveTestMembership(db: Pool | PoolClient, authUserId: string): Promise<TestMembership> {
  if (!identityMappingConfigured()) throw new IdentityMappingUnavailable('Identity mapping has not been reviewed and enabled');
  const table = assertSafeIdentifier(config.IDENTITY_TABLE!);
  const userColumn = assertSafeIdentifier(config.IDENTITY_USER_ID_COLUMN!);
  const schoolColumn = assertSafeIdentifier(config.IDENTITY_SCHOOL_ID_COLUMN!);
  const roleColumn = assertSafeIdentifier(config.IDENTITY_ROLE_COLUMN!);
  // Active-membership semantics are mandatory; never treat a historical/inactive row as current.
  const activeColumn = assertSafeIdentifier(config.IDENTITY_ACTIVE_COLUMN!);
  const qualified = `"${config.IDENTITY_SCHEMA}"."${table}"`;
  const activeClause = ` AND "${activeColumn}" = TRUE`;
  const sql = `SELECT "${schoolColumn}"::text AS school_id, "${roleColumn}"::text AS role FROM ${qualified} WHERE "${userColumn}"::text = $1${activeClause} LIMIT 2`;
  const result = await db.query<{ school_id: string | null; role: string | null }>(sql, [authUserId]);
  if (result.rows.length === 0) throw new MembershipNotFound('No active school membership');
  if (result.rows.length !== 1) throw new AmbiguousMembership('More than one membership; a reviewed test-school selection contract is required');
  const row = result.rows[0];
  if (!row?.school_id || !row.role) throw new MembershipNotFound('Membership row is incomplete');
  if (!allowedTestRoles().includes(row.role)) throw new UnauthorizedTestRole('Role is not approved for this test harness');
  // Only operator-provisioned synthetic tenants may be returned. Never accept a tenant ID from the request.
  const allowedSchools = [config.SYNTHETIC_SCHOOL_A_ID, config.SYNTHETIC_SCHOOL_B_ID].filter((id): id is string => Boolean(id));
  if (allowedSchools.length !== 2 || !allowedSchools.includes(row.school_id)) {
    throw new IdentityMappingUnavailable('Synthetic School A/B allowlist is missing or membership is outside it');
  }
  return { schoolId: row.school_id, role: row.role };
}
