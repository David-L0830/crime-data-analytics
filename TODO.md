# CDARS — Stack-Alignment Task (from Phase4-Feature6-checkpoint prompt)

## Done this session (additive, non-destructive, does not touch working auth)
- [x] Turborepo: `turbo.json` + root `package.json` workspace (`backend`) +
      thin `backend/package.json` wrapping `artisan` commands as npm scripts
      (Laravel itself is NOT converted to a Node app)
- [x] Docker: `Dockerfile.frontend` (nginx-served Vite build), `backend/Dockerfile`
      (php-fpm), `docker-compose.yml` (frontend+backend only — Supabase Cloud
      Postgres is used via env vars, not containerized), `.dockerignore` x2,
      `nginx.conf`
- [x] GitHub Actions: `.github/workflows/ci.yml` (frontend build/lint,
      backend `php artisan test` against a Postgres service container),
      `security.yml` (Snyk scan for npm + composer deps), `deploy.yml`
      (inert placeholder — no deploy target was specified)
- [x] `.snyk` policy file scaffold
- [x] `.env.example` — added commented-out `VITE_SUPABASE_URL` /
      `VITE_SUPABASE_ANON_KEY` placeholders, explicitly marked not wired up
- [x] Verified: `npm run build` still succeeds (only thing testable in this
      environment — no PHP/Composer available here, so backend/Docker/CI
      configs are written correctly per Laravel/Docker/GHA conventions but
      **unverified by actually running them**)

## Supabase Auth migration — in progress, checkpointed (see HANDOFF.md)

Current checkpoint: **Checkpoint 2 — Supabase client (COMPLETED, NOT VERIFIED)**

- [x] Checkpoint 1 — Audit. Documented existing Sanctum/TOTP/Socialite
      architecture; no code changed.
- [x] Checkpoint 2 — Supabase client added to the frontend, additive-only:
      - Added `@supabase/supabase-js` to `package.json` dependencies
        (IMPLEMENTED, NOT VERIFIED — no network access in this environment
        to actually `npm install` it or run `vite build`).
      - `src/lib/supabaseClient.js` — configured client + `isSupabaseConfigured`
        guard (IMPLEMENTED, syntax-checked with `node --check`, NOT VERIFIED
        against a real Supabase project).
      - `src/hooks/useSupabaseSession.js` — session listener for
        SIGNED_IN/SIGNED_OUT/TOKEN_REFRESHED/INITIAL_SESSION (IMPLEMENTED,
        syntax-checked, NOT VERIFIED — unit/integration tests not run).
      - `.env.example` updated to reflect these are now live-usable (still
        blank by default).
      - **Not touched:** `AuthContext.jsx`, `authService.js`, `Login.jsx`,
        `ProtectedRoute.jsx`, and all Laravel auth code — Sanctum is still
        the only mechanism the live app actually authenticates through.
- [x] Checkpoint 3 — Laravel Supabase JWT validation, additive-only
      (IMPLEMENTED, NOT VERIFIED — no PHP runtime in this environment, so
      nothing below has been executed; verified only by manual review +
      brace/paren balance checks):
      - `backend/composer.json` — added `firebase/php-jwt` dependency.
      - `backend/config/supabase.php` — new config (SUPABASE_URL,
        SUPABASE_PROJECT_ID, SUPABASE_JWT_SECRET, audience, JWKS cache TTL).
      - `backend/.env.example` — added the three Supabase server-side vars.
      - `backend/database/migrations/2025_01_05_000001_add_supabase_user_id_to_users_table.php`
        — new nullable, unique `supabase_user_id` column (mirrors how
        `google_id` links a Google identity). Additive migration, no data
        loss, does not touch any existing column.
      - `backend/app/Models/User.php` — added `supabase_user_id` to
        `$fillable` only (no other change).
      - `backend/app/Services/SupabaseTokenValidator.php` — new service:
        verifies a Supabase access token via JWKS (RS256/ES256, the current
        Supabase default) with a legacy HS256 shared-secret fallback,
        checks `aud`/`iss`, then maps claims to an existing local `User` —
        first by `supabase_user_id`, else by verified email (same
        link-by-verified-email pattern already used for Google OAuth).
        **Never creates a new user** — this app has no self-registration.
      - `backend/app/Providers/AppServiceProvider.php` — registers a
        stateless `'supabase'` guard via `Auth::viaRequest()`.
      - `backend/config/auth.php` — added the `'supabase'` guard entry.
        `'defaults'` unchanged (still `'web'`), so nothing currently
        authenticates through it.
      - **Not touched:** `routes/api.php` (no route uses `auth:supabase` or
        `auth:supabase,sanctum` yet — that route-level cutover is deferred
        to Checkpoint 4, alongside the actual login migration, so the app
        is never left with routes pointing at an auth path that has no
        working login yet), `AuthController`, `TwoFactorController`,
        `GoogleAuthController`, and everything in `src/` (frontend) except
        what Checkpoint 2 already added.
- [x] Checkpoint 4 — Migrate email/password login to Supabase, test against
      protected API (IMPLEMENTED, NOT VERIFIED — see
      HANDOFF_CHECKPOINT_4.md / CHECKPOINT_STATUS.md for the exact
      breakdown of what could and couldn't be checked in this environment).
      - `backend/routes/api.php` — GET /user moved to the `auth:supabase,sanctum`
        multi-guard middleware; every other route is unchanged (`auth:sanctum` only).
      - `src/services/api.js` — request() accepts an optional `token` to send
        `Authorization: Bearer <token>` alongside the existing cookie-based flow.
      - `src/services/authService.js` — added `currentUserViaSupabaseToken()`.
      - `src/context/AuthContext.jsx` — added `loginWithEmail()` (Supabase
        sign-in -> resolve local user via the new guard, never auto-creates
        an account) and an `authProvider` flag; `logout()` now also ends any
        Supabase session and tolerates a missing Sanctum session.
      - `src/pages/Login.jsx` — additive "Sign in with email instead" option
        (only shown when Supabase is configured); existing username form and
        Google OAuth button untouched.
      - **Not touched:** Sanctum, TOTP 2FA, Google OAuth, and every other
        API route — all still exactly as before.
- [x] Checkpoint 5 — Google OAuth via Supabase (IMPLEMENTED, NOT VERIFIED —
      see HANDOFF_CHECKPOINT_5.md / CHECKPOINT_STATUS.md):
      - `src/context/AuthContext.jsx` — added `loginWithGoogle()` (starts
        `supabase.auth.signInWithOAuth({ provider: 'google' })`) and a new
        `onAuthStateChange` listener that finishes the login on redirect
        return, gated on `session.user.app_metadata.provider === 'google'`
        so it never double-handles the email/password `SIGNED_IN` event.
        Resolves to the existing local Laravel `User` via the same
        `'supabase'` guard from Checkpoint 3/4 — **no backend changes
        needed**, since that guard verifies a Supabase token the same way
        regardless of upstream provider. Never auto-creates an account;
        rejects and signs the dangling Supabase session back out via a new
        `authInitError` value if no local user matches.
      - `src/pages/Login.jsx` — additive second "Continue with Google"
        button on the Checkpoint 4 email/password (Supabase) screen,
        distinct from the legacy Google button on the username screen.
      - **Not touched:** `GoogleAuthController`/Socialite (legacy Google,
        fully intact), `SupabaseTokenValidator`, `routes/api.php`,
        `authService.js`, `api.js`, Sanctum, TOTP 2FA, and Checkpoint 4's
        email/password Supabase path.
- [x] Checkpoint 6 — TOTP/MFA migration or coexistence.
      IMPLEMENTED / NOT VERIFIED (no PHP/Supabase runtime available in the
      implementation environment — static review + hand-built-JWT unit
      tests only). Additive Supabase MFA (TOTP) coexisting with the
      existing Laravel/Sanctum TOTP system — the two remain fully
      independent. See HANDOFF_CHECKPOINT_6.md for the full architecture,
      what was and wasn't built (self-service enrollment UI is NOT built
      yet — deliberately deferred, see handoff), and known limitations.
- [x] Checkpoint 7 — Remove legacy Sanctum/Socialite once verified.
      AUDITED / IMPLEMENTATION BLOCKED — see HANDOFF_CHECKPOINT_7.md /
      CHECKPOINT_STATUS.md. Full dependency audit found Sanctum still the
      sole guard on ~24 of 26 protected routes and Laravel TOTP/Socialite
      still the default paths for most users; multiple explicit STOP
      conditions were triggered, so nothing legacy was removed. Route-by-
      route migration of the remaining ~24 routes and a real Laravel-TOTP
      -> Supabase MFA user migration mechanism are needed before a future
      checkpoint can safely resume removal.
- [x] Checkpoint 7A — Incremental Supabase auth migration, Group A.
      IMPLEMENTED / NOT VERIFIED — see HANDOFF_CHECKPOINT_7A.md /
      AUTH_MIGRATION_STATUS.md. Migrated the 4 read-only, admin-only
      /analytics* routes onto auth:supabase,sanctum + supabase.mfa (same
      pattern as GET /dashboard from 6B) — verified they have zero live
      frontend callers, so zero live behavior changed. Sanctum, Socialite,
      Laravel TOTP, and Laravel password auth all fully preserved. ~15
      routes remain PENDING across Groups B-E for future checkpoints; 9
      routes are INTENTIONALLY LEGACY pending Step 11/16/17 policy work.

## NOT done — needs a dedicated session with a real PHP + Docker environment
- [ ] Verify `docker-compose.yml` actually builds/runs (needs Docker, not
      available in this environment)
- [ ] Verify GitHub Actions workflows actually pass (needs a real GH Actions
      run against a repo with `SNYK_TOKEN` secret set)
- [ ] `deploy.yml` is an inert placeholder — needs a real deploy target
      (host/registry/platform) filled in
- [ ] Feature #4 (TOTP 2FA) / #5 (Login Dark Mode) / #6 (integration+security
      testing) from the original Phase 4 plan — still pending per prior
      session notes, unrelated to this stack-alignment pass
- [x] Checkpoint 14 — Fresh audit of the badac_readonly role / Header /
      Dashboard / sidebar changeset (STATICALLY VERIFIED — see
      HANDOFF_CHECKPOINT_14.md). No code changes; audit found the
      changeset genuinely implemented and backend-enforced. One inaccurate
      code comment noted (constants.js references a non-existent
      backend/app/Policies dir — enforcement actually lives in
      routes/api.php's role: middleware, which is correct). Runtime
      verification (php artisan test, npm build/lint, browser) still
      pending a capable environment.
- [x] Checkpoint 15 — Runtime verification pass (PARTIAL — see
      HANDOFF_CHECKPOINT_15.md). Environment now has PHP/Composer/Node
      installable: `npm install` + `npm run build` + `npm run lint`
      actually RUNTIME VERIFIED (build passed clean; lint's 86 errors are
      all pre-existing node_modules noise, 0 in project src). Headless
      Chromium confirmed the production build boots and renders the login
      screen with no crash, and the compiled dist/ bundle was grepped to
      confirm WEEK IMPORTED/SYNC STATUS/alert-badge are genuinely absent
      from the built output. Backend `composer install` still fails
      (packagist.org not reachable from this environment, no
      composer.lock to hand-resolve from) — `php artisan test`,
      authenticated Badac browser checks, and DB/seeder verification
      remain VERIFICATION PENDING. All backend PHP files re-confirmed
      syntactically valid (php -l, 0 errors) and BadacReadonlyTest.php
      re-confirmed at 25 tests. No code changes made; no defects found.
- [x] Checkpoint 16 — Backend dependency retry (STILL BLOCKED — see
      HANDOFF_CHECKPOINT_16.md). Re-installed PHP 8.3.6/Composer 2.7.1 with
      all required extensions and re-ran `composer install`: still fails
      with the identical `repo.packagist.org` HTTP 403 as Checkpoint 15
      (confirmed this session's network allowlist has no Packagist domain).
      Checked all documented fallback options (Composer cache, private
      mirror config, an existing `vendor/` elsewhere, any provided
      dependency artifact) — none exist; did not hand-resolve the
      dependency tree without a resolver/lockfile per the anti-fabrication
      rule. Re-confirmed 0 PHP syntax errors and 25 BadacReadonlyTest.php
      tests. No code changed. `php artisan test`, authenticated Badac
      runtime checks, DB/seeder verification, and post-login browser
      checks all remain VERIFICATION PENDING pending Packagist access, a
      mirror, or a pre-vendored checkpoint.
- [x] Checkpoint 17 — Icons registry bugfix (RUNTIME VERIFIED — see
      HANDOFF_CHECKPOINT_17.md). User reported a live console crash
      ("Element type is invalid ... Check the render method of `Table`")
      from their local dev server. Root cause: `Icons.ClipboardList` was
      used in `Table.jsx`'s empty state but never added to the exported
      `Icons` object (only present in `NAV_ICONS`) — fixed by adding it.
      Full sweep of every `Icons.<Key>` usage found a second, related bug:
      `Icons.FileText` (undefined; only `Icons.Report` exists) still used
      directly in Dashboard.jsx/Analytics.jsx/IncidentModal.jsx Export
      buttons — fixed by switching to `Icons.Report`, matching the
      existing convention. Verified with a real `npm install` + `vite
      build` + compiled-bundle grep confirming both icons resolve
      correctly in the built output. Backend untouched, status unchanged
      from Checkpoint 16.
- [x] Checkpoint 18 — Badac dashboard zeros, corrected fix (RUNTIME
      VERIFIED build — see HANDOFF_CHECKPOINT_18.md). An earlier same-
      session attempt wrongly loosened GET /settings to badac_readonly;
      reverted, since Badac having no Settings access is intentional
      (matches ROLES.badac_readonly.modules and the GET /sync-logs
      comment) and /sync-logs is admin-only too, so that fix wouldn't
      even have worked. Real root cause: src/context/DataContext.jsx's
      initial load used Promise.all across 8 endpoints, so Badac's two
      expected 403s (settings, sync-logs) failed the ENTIRE batch,
      zeroing out every KPI including ones from data Badac can actually
      read. Fixed by switching to Promise.allSettled: each resource now
      loads independently, a role-restricted 403 falls back to its
      empty/default value instead of blanking everything else, and the
      error banner only fires for a genuine (non-403) failure. No backend
      permissions changed. Verified with a clean npm run build; full
      authenticated browser verification still pending the same
      Composer/backend blocker as Checkpoints 15-17.
