// Centralized HTTP client for the Laravel backend. Every service module in
// this directory goes through here — no raw fetch() calls in pages/components.
//
// Final auth migration — this is a stateless, Bearer-token-only API now
// (Supabase Auth is the only authentication system; see
// AUTH_MIGRATION_STATUS.md). There is no more Sanctum session cookie, no
// CSRF cookie/token, and no `credentials: 'include'`: a Bearer token is
// never sent by the browser automatically the way a cookie is, so it isn't
// forgeable by a third-party site the way cookie auth is, and doesn't need
// CSRF protection.
//
// Every request automatically carries the CURRENT Supabase access token, if
// one exists — callers don't need to look it up or thread it through
// themselves. This is what makes every existing service function (which
// already accepted an optional `token` param) actually work end-to-end: the
// param still exists for the one case that genuinely needs it (a caller
// that just obtained a brand-new token and can't wait for the Supabase
// client's in-memory session to catch up), but nothing else needs to pass
// it anymore.
import { supabase } from '../lib/supabaseClient';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000/api';

async function currentAccessToken() {
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token || null;
}

// `type` classifies *why* the request failed so callers (DataContext,
// MainLayout, ...) can show an accurate message instead of a generic one.
// This is purely additive — existing callers that only ever read
// `.status` / `.message` / `.errors` are unaffected.
//   'network'         — fetch() itself threw; the server was never reached.
//   'mfa_required'     — reached the server; a valid aal1 session exists but
//                        the route requires aal2 (see EnsureSupabaseAal2).
//   'unauthenticated' — reached the server; no/invalid/expired session.
//   'forbidden'        — reached the server; authenticated but not authorized.
//   'not_found' | 'validation' | 'server' | 'unknown'
export class ApiError extends Error {
  constructor(message, status, errors, type = 'unknown', mfaRequired = false) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.errors = errors || null;
    this.type = type;
    this.mfaRequired = Boolean(mfaRequired);
  }
}

async function request(path, { method = 'GET', body, token, ...rest } = {}) {
  // Checkpoint 25 — avatar upload needs a multipart/form-data body
  // (FormData), unlike every existing caller which sends JSON. Skip the
  // JSON.stringify/Content-Type: application/json path for it and let the
  // browser set its own multipart Content-Type (with boundary) instead —
  // setting that header manually breaks the boundary parsing.
  const isFormData =
    typeof FormData !== 'undefined' && body instanceof FormData;

  const accessToken = token || (await currentAccessToken());

  let response;
  try {
    response = await fetch(`${API_URL}${path}`, {
      method,
      headers: {
        Accept: 'application/json',
        ...(body && !isFormData ? { 'Content-Type': 'application/json' } : {}),
        ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      },
      body: body ? (isFormData ? body : JSON.stringify(body)) : undefined,
      ...rest,
    });
  } catch {
    // fetch() itself threw — DNS/connection failure, offline, CORS, etc.
    // The server was never reached, unlike every branch below.
    throw new ApiError(
      'Unable to reach the server. Check your connection and try again.',
      0,
      null,
      'network',
    );
  }

  if (response.status === 204) return null;

  const isJson = response.headers
    .get('content-type')
    ?.includes('application/json');
  const payload = isJson ? await response.json().catch(() => null) : null;

  if (!response.ok) {
    // A 401 with { mfaRequired: true } (see EnsureSupabaseAal2) means the
    // server WAS reached and the caller's session is valid at aal1 but
    // hasn't completed its second factor — a materially different case
    // from "not signed in at all", so it gets its own type and keeps the
    // backend's own explanatory message.
    const isMfaRequired =
      response.status === 401 && payload?.mfaRequired === true;

    const type = isMfaRequired
      ? 'mfa_required'
      : response.status === 401
        ? 'unauthenticated'
        : response.status === 403
          ? 'forbidden'
          : response.status === 404
            ? 'not_found'
            : response.status === 422
              ? 'validation'
              : response.status >= 500
                ? 'server'
                : 'unknown';

    const message =
      payload?.message ||
      (type === 'unauthenticated' &&
        'You are not signed in. Please log in again.') ||
      (type === 'forbidden' && 'You do not have permission to do that.') ||
      (type === 'not_found' && 'The requested record was not found.') ||
      (type === 'validation' && 'Please check the form for errors.') ||
      (type === 'server' &&
        'Something went wrong on the server. Please try again.') ||
      'Something went wrong.';
    throw new ApiError(
      message,
      response.status,
      payload?.errors,
      type,
      isMfaRequired,
    );
  }

  return payload;
}

// Unwraps Laravel API Resource collections/singles ({ data: ... }) into plain
// arrays/objects, since every existing page expects plain records.
function unwrap(payload) {
  if (payload && typeof payload === 'object' && 'data' in payload)
    return payload.data;
  return payload;
}

export const api = {
  get: (path, opts) => request(path, { method: 'GET', ...opts }).then(unwrap),
  post: (path, body, opts) =>
    request(path, { method: 'POST', body, ...opts }).then(unwrap),
  put: (path, body, opts) =>
    request(path, { method: 'PUT', body, ...opts }).then(unwrap),
  delete: (path, opts) =>
    request(path, { method: 'DELETE', ...opts }).then(unwrap),
};
