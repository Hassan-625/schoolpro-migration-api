import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../src/app.js';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Pool } from 'pg';

const fakeSupabase = (getUser: ReturnType<typeof vi.fn>) => ({
  auth: { getUser }
}) as unknown as SupabaseClient;
const fakeDb = { query: vi.fn() } as unknown as Pool;
afterEach(() => vi.restoreAllMocks());

describe('health and readiness', () => {
  it('health reveals no database or environment details', async () => {
    const app = buildApp({ db: null, supabase: null });
    const response = await app.inject({ method: 'GET', url: '/health' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: 'ok' });
    await app.close();
  });

  it('readiness is unavailable without a database', async () => {
    const app = buildApp({ db: null, supabase: null });
    const response = await app.inject({ method: 'GET', url: '/ready' });
    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({ status: 'not_ready', reason: 'database_not_configured' });
    await app.close();
  });

  it('readiness does not report ready when server-side Supabase Auth verification is unavailable', async () => {
    const db = { query: vi.fn().mockResolvedValue({ rows: [{ present: true }] }) } as unknown as Pool;
    const app = buildApp({ db, supabase: null });
    const response = await app.inject({ method: 'GET', url: '/ready' });
    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({ status: 'not_ready', reason: 'identity_verification_unavailable' });
    expect(db.query).not.toHaveBeenCalled();
    await app.close();
  });
});

describe('staging identity endpoint', () => {
  it('is hidden unless APP_ENV is staging and the explicit flag is enabled', async () => {
    const app = buildApp({ db: fakeDb, supabase: fakeSupabase(vi.fn()) }, { appEnv: 'production', enableTestEndpoints: true });
    const response = await app.inject({ method: 'GET', url: '/v1/test/identity' });
    expect(response.statusCode).toBe(404);
    await app.close();
  });

  it('rejects a missing bearer token', async () => {
    const app = buildApp({ db: fakeDb, supabase: fakeSupabase(vi.fn()) }, { appEnv: 'staging', enableTestEndpoints: true });
    const response = await app.inject({ method: 'GET', url: '/v1/test/identity' });
    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({ error: 'unauthorized' });
    await app.close();
  });

  it.each(['invalid', 'expired'])('rejects %s bearer tokens after server-side Auth verification', async (tokenKind) => {
    const getUser = vi.fn().mockResolvedValue({ data: { user: null }, error: new Error(tokenKind) });
    const app = buildApp({ db: fakeDb, supabase: fakeSupabase(getUser) }, { appEnv: 'staging', enableTestEndpoints: true });
    const response = await app.inject({ method: 'GET', url: '/v1/test/identity', headers: { authorization: 'Bearer test-token' } });
    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({ error: 'unauthorized' });
    expect(getUser).toHaveBeenCalledWith('test-token');
    expect(fakeDb.query).not.toHaveBeenCalled();
    await app.close();
  });

  it('fails closed when the identity mapping is not reviewed', async () => {
    const getUser = vi.fn().mockResolvedValue({ data: { user: { id: '00000000-0000-4000-8000-000000000001' } }, error: null });
    const db = { query: vi.fn() } as unknown as Pool;
    const app = buildApp({ db, supabase: fakeSupabase(getUser) }, { appEnv: 'staging', enableTestEndpoints: true });
    const response = await app.inject({ method: 'GET', url: '/v1/test/identity', headers: { authorization: 'Bearer valid-token' } });
    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({ error: 'identity_mapping_unavailable' });
    expect(db.query).not.toHaveBeenCalled();
    await app.close();
  });
});
