# Crime Data Analytics — Claude Code Instructions

## Project Stack

- Frontend: React + Vite
- Backend: Laravel 12 / PHP
- Database: Supabase PostgreSQL
- Analytics / dashboards: Metabase
- Authentication and API logic must remain compatible with the existing architecture.

## Token-Efficient Workflow

- Do not read the entire repository unless explicitly required.
- Before reading files, identify the minimum files needed for the task.
- Prefer targeted searches over scanning entire directories.
- Do not dump large files or logs when a targeted section is sufficient.
- Do not repeat information already established in the current task.
- Do not investigate unrelated parts of the project.
- Keep command output focused.
- Prefer focused tests over running the entire test suite when appropriate.

## Change Rules

- Inspect existing implementation before modifying it.
- Make the smallest change that correctly solves the problem.
- Do not modify unrelated files.
- Do not introduce mock data unless explicitly requested.
- Preserve existing API contracts unless the task requires changing them.
- Do not rewrite working architecture unnecessarily.

## Verification

After making changes:

1. Check the exact files changed.
2. Run the most relevant focused tests/checks.
3. Check for unintended changes.
4. Report what changed and what was verified.

## Git

- Do not commit unless explicitly asked.
- Do not push unless explicitly asked.
- Before committing, show the files changed and summarize the changes.