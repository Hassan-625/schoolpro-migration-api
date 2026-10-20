import { describe, expect, it, vi, afterEach } from 'vitest';
import {
  resolveTestMembership, validateTestMembership, IdentityMappingUnavailable, MembershipNotFound,
  ProfileInactive, AmbiguousMembership, UnauthorizedTestRole
} from '../src/identity.js';

afterEach(() => vi.restoreAllMocks());

describe('identity mapping fails closed until reviewed', () => {
  it('does not query a guessed membership schema by default', async () => {
    const db = { query: vi.fn() } as never;
    await expect(resolveTestMembership(db, 'synthetic-user', 'active')).rejects.toBeInstanceOf(IdentityMappingUnavailable);
    expect((db as { query: ReturnType<typeof vi.fn> }).query).not.toHaveBeenCalled();
  });
});

describe('source-equivalent active-account and membership validation', () => {
  const schoolA = '00000000-0000-4000-8000-00000000000a';
  const schoolB = '00000000-0000-4000-8000-00000000000b';
  const roles = ['proprietor', 'exam_officer'];
  const row = { school_id: schoolA, role: 'exam_officer' };

  it.each([null, undefined, 'disabled', 'suspended', 'inactive'])('rejects missing or inactive profile status: %s', (status) => {
    expect(() => validateTestMembership([row], status, roles, [schoolA, schoolB])).toThrow(ProfileInactive);
  });
  it('rejects a missing membership', () => {
    expect(() => validateTestMembership([], 'active', roles, [schoolA, schoolB])).toThrow(MembershipNotFound);
  });
  it('rejects ambiguous memberships', () => {
    expect(() => validateTestMembership([row, { school_id: schoolB, role: 'proprietor' }], 'active', roles, [schoolA, schoolB])).toThrow(AmbiguousMembership);
  });
  it('rejects unapproved roles', () => {
    expect(() => validateTestMembership([{ ...row, role: 'teacher' }], 'active', roles, [schoolA, schoolB])).toThrow(UnauthorizedTestRole);
  });
  it('rejects a membership outside the two synthetic schools', () => {
    expect(() => validateTestMembership([{ ...row, school_id: '00000000-0000-4000-8000-00000000000c' }], 'active', roles, [schoolA, schoolB])).toThrow(IdentityMappingUnavailable);
  });
  it('rejects a malformed synthetic school allowlist', () => {
    expect(() => validateTestMembership([row], 'active', roles, [schoolA, schoolA])).toThrow(IdentityMappingUnavailable);
  });
  it('accepts only an active profile, one allowlisted school membership and an approved role', () => {
    expect(validateTestMembership([row], 'active', roles, [schoolA, schoolB])).toEqual({ schoolId: schoolA, role: 'exam_officer' });
  });
});
