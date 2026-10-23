
import { describe, expect, it, vi, afterEach } from 'vitest';
import {
  validateTestMembership,
  IdentityMappingUnavailable,
  MembershipNotFound,
  ProfileInactive,
  AmbiguousMembership,
  UnauthorizedTestRole
} from '../src/identity.js';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe('identity mapping fails closed until reviewed', () => {
  it('uses only the fixed narrow bootstrap function and passes only the authenticated user ID', async () => {
    const query = vi.fn().mockResolvedValue({
      rows: [{
        school_id: '00000000-0000-4000-8000-00000000000a',
        role: 'exam_officer'
      }]
    });

    const { queryBootstrapMembership } = await import('../src/identity.js');
    const result = await queryBootstrapMembership(
      { query } as never,
      '00000000-0000-4000-8000-000000000001'
    );

    expect(result.rows).toHaveLength(1);
    expect(query).toHaveBeenCalledTimes(1);
    expect(query.mock.calls[0]?.[0]).toContain(
      'private.resolve_schoolpro_test_membership($1::uuid)'
    );
    expect(query.mock.calls[0]?.[0]).not.toContain(
      'FROM "public"."schoolpro_members"'
    );
    expect(query.mock.calls[0]?.[1]).toEqual([
      '00000000-0000-4000-8000-000000000001'
    ]);
  });

  it('does not query a guessed membership schema when the review gate is disabled', async () => {
    vi.stubEnv('IDENTITY_MAPPING_VERIFIED', 'false');
    vi.resetModules();

    const identity = await import('../src/identity.js');
    const db = { query: vi.fn() } as never;

    await expect(
      identity.resolveTestMembership(db, 'synthetic-user', 'active')
    ).rejects.toBeInstanceOf(identity.IdentityMappingUnavailable);

    expect(
      (db as { query: ReturnType<typeof vi.fn> }).query
    ).not.toHaveBeenCalled();
  });
});

describe('source-equivalent active-account and membership validation', () => {
  const schoolA = '00000000-0000-4000-8000-00000000000a';
  const schoolB = '00000000-0000-4000-8000-00000000000b';
  const roles = ['proprietor', 'exam_officer'];
  const row = { school_id: schoolA, role: 'exam_officer' };

  it.each([null, undefined, 'disabled', 'suspended', 'inactive'])(
    'rejects missing or inactive profile status: %s',
    (status) => {
      expect(() =>
        validateTestMembership([row], status, roles, [schoolA, schoolB])
      ).toThrow(ProfileInactive);
    }
  );

  it('rejects a missing membership', () => {
    expect(() =>
      validateTestMembership([], 'active', roles, [schoolA, schoolB])
    ).toThrow(MembershipNotFound);
  });

  it('rejects ambiguous memberships', () => {
    expect(() =>
      validateTestMembership(
        [row, { school_id: schoolB, role: 'proprietor' }],
        'active',
        roles,
        [schoolA, schoolB]
      )
    ).toThrow(AmbiguousMembership);
  });

  it('rejects unapproved roles', () => {
    expect(() =>
      validateTestMembership(
        [{ ...row, role: 'teacher' }],
        'active',
        roles,
        [schoolA, schoolB]
      )
    ).toThrow(UnauthorizedTestRole);
  });

  it('rejects a membership outside the two synthetic schools', () => {
    expect(() =>
      validateTestMembership(
        [{ ...row, school_id: '00000000-0000-4000-8000-00000000000c' }],
        'active',
        roles,
        [schoolA, schoolB]
      )
    ).toThrow(IdentityMappingUnavailable);
  });

  it('rejects a malformed synthetic school allowlist', () => {
    expect(() =>
      validateTestMembership([row], 'active', roles, [schoolA, schoolA])
    ).toThrow(IdentityMappingUnavailable);
  });

  it.each([
    [schoolA, 'exam_officer'],
    [schoolB, 'proprietor']
  ])('accepts the approved role in synthetic school %s', (schoolId, role) => {
    expect(
      validateTestMembership([{ school_id: schoolId, role }], 'active', roles, [
        schoolA,
        schoolB
      ])
    ).toEqual({ schoolId, role });
  });
});
