import { afterEach, describe, expect, it, vi } from 'vitest';

// L-5 — request() must not wait indefinitely for a stalled request or a
// Render cold start with no feedback. It now bounds every request with an
// AbortController timeout (REQUEST_TIMEOUT_MS in api.js) and surfaces a
// distinct, identifiable error when that timeout fires.
vi.mock('../lib/supabaseClient', () => ({
  supabase: {
    auth: { getSession: async () => ({ data: { session: null } }) },
  },
  isSupabaseConfigured: false,
}));

const { api, ApiError } = await import('./api');

// Matches REQUEST_TIMEOUT_MS in api.js. Not imported directly: that constant
// is intentionally not exported, so the test advances fake time by the same
// documented value instead of reaching into the module's internals.
const REQUEST_TIMEOUT_MS = 60_000;

describe('request timeout', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('still resolves a normal, fast request normally', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ data: { id: 1 } }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );

    const result = await api.get('/incidents/1');

    expect(result).toEqual({ id: 1 });
  });

  it('aborts and rejects a request that never settles once the timeout elapses', async () => {
    vi.useFakeTimers();

    // Stands in for real fetch()'s own behaviour: it never resolves on its
    // own, but rejects with an AbortError the moment its signal is aborted —
    // exactly what the timeout in request() triggers.
    globalThis.fetch = vi.fn(
      (_url, options) =>
        new Promise((_resolve, reject) => {
          options.signal.addEventListener('abort', () => {
            const abortError = new Error('The operation was aborted.');
            abortError.name = 'AbortError';
            reject(abortError);
          });
        }),
    );

    const pending = api.get('/incidents').catch((e) => e);

    await vi.advanceTimersByTimeAsync(REQUEST_TIMEOUT_MS);
    const error = await pending;

    expect(error).toBeInstanceOf(ApiError);
    expect(error.status).toBe(0);
  });

  it('identifies the timeout as its own error type, distinct from an ordinary network failure', async () => {
    vi.useFakeTimers();

    globalThis.fetch = vi.fn(
      (_url, options) =>
        new Promise((_resolve, reject) => {
          options.signal.addEventListener('abort', () => {
            const abortError = new Error('The operation was aborted.');
            abortError.name = 'AbortError';
            reject(abortError);
          });
        }),
    );

    const pending = api.get('/incidents').catch((e) => e);
    await vi.advanceTimersByTimeAsync(REQUEST_TIMEOUT_MS);
    const error = await pending;

    expect(error.type).toBe('timeout');
    expect(error.type).not.toBe('network');
    expect(error.message).toMatch(/took too long/i);
  });

  it('still reports an ordinary connection failure as a network error, not a timeout', async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));

    const error = await api.get('/incidents').catch((e) => e);

    expect(error).toBeInstanceOf(ApiError);
    expect(error.type).toBe('network');
  });
});
