import { describe, expect, it, vi, afterEach } from 'vitest';
import { resolveTestMembership, IdentityMappingUnavailable, MembershipNotFound, AmbiguousMembership, UnauthorizedTestRole } from '../src/identity.js';

afterEach(() => vi.restoreAllMocks());

describe('identity mapping fails closed until reviewed', () => {
  it('does not query a guessed membership schema by default', async () => {
    const db = { query: vi.fn() } as never;
    await expect(resolveTestMembership(db, {} as never, 'synthetic-user')).rejects.toBeInstanceOf(IdentityMappingUnavailable);
    expect((db as { query: ReturnType<typeof vi.fn> }).query).not.toHaveBeenCalled();
  });
});

describe('identity error classes', () => {
  it('distinguishes absent, ambiguous and unauthorized membership outcomes', () => {
    expect(new MembershipNotFound().message).toContain('membership');
    expect(new AmbiguousMembership().message).toContain('More than one');
    expect(new UnauthorizedTestRole().message).toContain('not approved');
  });
});
