# CI/CD and Security Scanning

This project uses **GitHub Actions** for continuous integration and
**Snyk** for dependency/container vulnerability scanning. The workflow
lives at `.github/workflows/ci.yml` and runs on every push to `main` and
every pull request targeting `main`.

## CI/CD (GitHub Actions)

`ci.yml` has four jobs:

| Job        | What it does |
|------------|--------------|
| `frontend` | `npm ci`, then `npx turbo run lint build --filter=cdars-react` — runs the existing `oxlint` and `vite build` scripts from the root `package.json` through Turborepo. Uploads the built `dist/` as a workflow artifact. |
| `backend`  | Installs PHP 8.2 and Composer dependencies, copies `backend/.env.example` to `.env` and generates an app key, then runs `npx turbo run lint test --filter=@cdars/backend` — the existing `./vendor/bin/pint --test` and `php artisan test` scripts. Tests run against an **in-memory SQLite database** (already configured in `backend/phpunit.xml`), so no live Postgres/Supabase instance is needed in CI. |
| `docker`   | Builds `backend/Dockerfile` and `Dockerfile.frontend` with `docker/build-push-action` (`push: false`) to confirm both images still build. Nothing is pushed to a registry. |
| `snyk`     | See below. |

Any dependency install failure, build failure, failing test, or failing
lint check fails the job — nothing is suppressed with `|| true` or similar.

Turborepo (`turbo.json`) is used to invoke each workspace's own scripts
rather than duplicating commands in the workflow, so CI always runs
exactly what `npm run <task>` / `composer run <task>` would run locally.

## Security (Snyk)

The `snyk` job scans:

- **JavaScript dependencies** — `snyk test` against the root `package.json`/`package-lock.json`, honoring the repo's `.snyk` policy file.
- **PHP/Composer dependencies** — `snyk test --command=composer` against `backend/composer.lock`.
- **Both Docker images** — `snyk container test` against `backend/Dockerfile` and `Dockerfile.frontend` after building them locally in the runner.

Scanning happens on every push/PR to `main`, alongside the build/test job
(as a separate job, so a security finding and a code/test failure are
reported independently rather than one masking the other).

**Severity threshold:** the job fails on **high or critical** severity
findings (`--severity-threshold=high`). Lower-severity findings are
reported by Snyk but do not fail the build. Adjust the threshold in
`.github/workflows/ci.yml` if the project's risk tolerance changes.

Findings are visible in the Actions run log for the `snyk` job (and, once
the repo is connected in the Snyk dashboard, in Snyk's own UI/PR checks).

### Required secret

The workflow needs one repository secret:

| Secret | Purpose |
|--------|---------|
| `SNYK_TOKEN` | Your Snyk API token, from Snyk → Account Settings → API Token. Add it under **Settings → Secrets and variables → Actions → New repository secret**. |

Without `SNYK_TOKEN` configured, the `snyk` job will fail at the
"Authenticate Snyk" step — the rest of CI (frontend/backend/docker) is
unaffected, since Snyk runs as an independent job.

Two optional secrets let CI build the frontend with real public Supabase
values instead of the local-dev defaults (harmless either way, since only
the anon/public key ever belongs in frontend code):

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`

The Supabase **service role key** (`SUPABASE_SERVICE_ROLE_KEY`) is a
backend-only secret, is never read by this workflow, and must never be
added as a `VITE_*` value anywhere.

## Docker

`docker-compose.yml`, `Dockerfile.frontend`, and `backend/Dockerfile` were
already correctly configured and are unchanged. The `docker` CI job simply
builds both images on every push/PR (without pushing) so a broken
Dockerfile is caught in CI instead of at deploy time.

## Turborepo

`turbo.json` already defined `dev`/`build`/`lint`/`test` tasks for the two
workspaces (`cdars-react` at the repo root, `@cdars/backend`). No changes
were made to `turbo.json` — CI now simply invokes those existing tasks via
`npx turbo run ... --filter=<package>` instead of calling `npm`/`composer`
scripts directly, so local and CI runs stay in sync.
