import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Behavioural test of the real request() in api.js: a stubbed fetch, a mocked
// Supabase client, and a real EventTarget standing in for `window`.
vi.mock('../lib/supabaseClient', () => ({
  supabase: {
    auth: { getSession: async () => ({ data: { session: null } }) },
  },
  isSupabaseConfigured: false,
}));

const { api, ApiError, CREDENTIAL_STATE_EVENT } = await import('./api');

function respond(status, body) {
  globalThis.fetch = vi.fn().mockResolvedValue(
    new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    }),
  );
}

describe('credential-state refusals', () => {
  let events;
  let originalWindow;

  beforeEach(() => {
    originalWindow = globalThis.window;
    globalThis.window = new EventTarget();
    events = 0;
    globalThis.window.addEventListener(CREDENTIAL_STATE_EVENT, () => {
      events += 1;
    });
  });

  afterEach(() => {
    globalThis.window = originalWindow;
    vi.restoreAllMocks();
  });

  it('announces a 403 passwordChangeRequired and exposes only the boolean flags', async () => {
    respond(403, {
      message: 'Your temporary password must be changed before you can continue.',
      passwordChangeRequired: true,
      somethingElse: 'not copied',
    });

    const error = await api.get('/incidents').catch((e) => e);

    expect(error).toBeInstanceOf(ApiError);
    expect(error.status).toBe(403);
    expect(error.flags).toEqual({ passwordChangeRequired: true });
    expect(events).toBe(1);
  });

  it('announces a 403 reauthenticationRequired', async () => {
    respond(403, { message: 'Your password was changed.', reauthenticationRequired: true });
    await api.get('/users').catch(() => {});
    expect(events).toBe(1);
  });

  it('does not announce the change-password endpoint’s own refusals', async () => {
    respond(403, { message: 'Expired.', passwordChangeRequired: true, temporaryPasswordExpired: true });
    const error = await api.post('/me/password', {}).catch((e) => e);
    expect(error.flags).toEqual({ passwordChangeRequired: true, temporaryPasswordExpired: true });
    expect(events).toBe(0);
  });

  it('does not announce ordinary refusals', async () => {
    respond(403, { message: 'This action is unauthorized.' });
    await api.get('/audit-logs').catch(() => {});

    respond(401, { message: 'Unauthenticated.' });
    await api.get('/incidents').catch(() => {});

    respond(422, { message: 'Invalid.', errors: { temporaryPassword: ['Too short.'] } });
    await api.post('/users/5/temporary-password', {}).catch(() => {});

    expect(events).toBe(0);
  });

  it('never copies non-boolean or unknown values into flags', async () => {
    respond(503, { message: 'Pending.', temporaryPasswordPendingSync: 'true', passwordChangedPendingSync: true });
    const error = await api.post('/users/5/temporary-password', {}).catch((e) => e);
    expect(error.flags).toEqual({ passwordChangedPendingSync: true });
  });
});
