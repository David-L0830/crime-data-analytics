# CI/CD and Security Scanning

This project uses **GitHub Actions** for continuous integration and **Snyk**
for dependency vulnerability scanning. They live in two separate workflows:

| Workflow                         | Jobs                            | Purpose                       |
| -------------------------------- | ------------------------------- | ----------------------------- |
| `.github/workflows/ci.yml`       | `frontend`, `backend`           | Lint, test and build the app  |
| `.github/workflows/security.yml` | `snyk-frontend`, `snyk-backend` | Dependency vulnerability scan |

Both run on **every push to `main` and every pull request targeting `main`**.
Neither runs on pushes to other branches, so work on a feature branch is not
checked by CI until it is opened as a pull request against `main`.

## CI (`ci.yml`)

Two jobs, run in parallel.

### `frontend` — React + Vite

Node.js **22** with npm caching, then:

| Step    | Command         | What it actually runs           |
| ------- | --------------- | ------------------------------- |
| Install | `npm ci`        | —                               |
| Lint    | `npm run lint`  | `oxlint`                        |
| Test    | `npm test`      | `vitest run` (Node environment) |
| Build   | `npm run build` | `vite build`                    |

The test step pins its own timezone in `vitest.setup.js`, so assertions that
format dates behave identically on the runner's UTC clock and on a local
machine in Asia/Manila.

Nothing is uploaded as an artifact — the build step exists to prove the bundle
still compiles, not to publish it. Deployment is handled by Vercel and Render
from their own integrations, not by this workflow.

### `backend` — Laravel

PHP **8.3** with a cached Composer directory, then:

| Step        | Command                                            | Notes                                              |
| ----------- | -------------------------------------------------- | -------------------------------------------------- |
| Install     | `composer install --no-interaction …`              | —                                                  |
| Environment | `cp .env.example .env`, `php artisan key:generate` | No real secrets are needed                         |
| Code style  | `php ./vendor/bin/pint --test`                     | **`continue-on-error: true`** — see the note below |
| Tests       | `php artisan test`                                 | —                                                  |

**Tests run against an in-memory SQLite database**, configured directly in
`backend/phpunit.xml` along with a dummy `APP_KEY` and a test-only Supabase JWT
secret. **No Postgres service container, no Supabase project, and no repository
secrets are involved.** If a test ever needs real Postgres behaviour — the
analytics grouping uses `to_char()`, for example — the suite provides a SQLite
shim in `tests/TestCase.php` rather than standing up a database service.

**One check is deliberately non-blocking.** The Pint code-style step carries
`continue-on-error: true`, so a formatting violation is reported in the run log
but does **not** fail the job. There is currently pre-existing Pint debt in the
repository (mostly CRLF line endings on Windows-authored files), which is why
the step is advisory. Every other step is blocking: an install failure, a lint
error, a failing test, or a broken build fails CI.

## Security (`security.yml`)

Two independent jobs, so a vulnerability finding and a build failure are
reported separately rather than one masking the other.

| Job             | Scans                 | How                                                         |
| --------------- | --------------------- | ----------------------------------------------------------- |
| `snyk-frontend` | npm dependencies      | `snyk/actions/node@master` with `--severity-threshold=high` |
| `snyk-backend`  | Composer dependencies | `snyk test --severity-threshold=high --file=composer.lock`  |

**Severity threshold:** both jobs fail on **high or critical** findings only.
Lower-severity findings are reported but do not fail the build. The repository's
`.snyk` policy file records the accepted exceptions.

**Container images are not scanned.** `Dockerfile.frontend`, `backend/Dockerfile`
and `docker-compose.yml` exist and are used for local containers, but no
workflow builds or scans them. A broken Dockerfile would therefore not be caught
by CI.

### Required secret

| Secret       | Purpose                                                                                                                                        |
| ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `SNYK_TOKEN` | Snyk API token, from Snyk → Account Settings → API Token. Add it under **Settings → Secrets and variables → Actions → New repository secret**. |

Without `SNYK_TOKEN`, both `security.yml` jobs fail at the Snyk step. `ci.yml` is
unaffected — it needs no secrets at all.

The Supabase **service role key** (`SUPABASE_SERVICE_ROLE_KEY`) and the
**Metabase embedding secret** (`METABASE_EMBEDDING_SECRET_KEY`) are backend-only
values. Neither workflow reads them, and neither may ever be exposed to the
frontend or added as a `VITE_*` variable.

## Turborepo

`turbo.json` defines `dev`/`build`/`lint`/`test` tasks for the two workspaces
(`cdars-react` at the repository root and `@cdars/backend`). **CI does not use
it** — both jobs call `npm`, `composer` and `artisan` directly. Turborepo is
available for local use only; changing a task in `turbo.json` has no effect on
what CI runs, and vice versa.

## Deployment

There is **no deployment workflow in this repository.** Vercel (frontend) and
Render (backend) deploy from their own GitHub integrations, watching `main`.
Merging to `main` is therefore the deployment trigger — see the README's
Deployment Guide for the required order and environment variables.
