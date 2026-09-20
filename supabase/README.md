# Database

This directory owns Thinkink's database configuration independently of the frontend and backend. It follows the directory layout generated and consumed by the Supabase CLI.

- `config.toml`: reproducible local service settings, including authentication configuration.
- `migrations/`: versioned SQL schema changes, indexes, database functions, grants and RLS policies.
- `tests/`: SQL/pgTAP tests for constraints, permissions and RLS behavior.
- `.temp/` and `.branches/`: generated local metadata, excluded from Git.

`20260920180000_user_profiles.sql` creates the profile table and atomic Auth trigger. RLS and column grants allow authenticated users to read and update only their own profile, without changing ownership. Email and credential storage remain in `auth.users`. The second migration adds the curated avatar catalogue, restricts profile changes to avatar selection, and adds topic/comment tables whose account references are cleared on deletion. SQL tests cover those boundaries and removal of linked Auth audit data. Seed loading is disabled; browser tests create and clean up their own synthetic accounts. Do not commit database dumps, backups, credentials or real user data. Local database contents live in Docker volumes, outside this repository.

From the repository root:

```sh
npm run db:start
npm run db:migrate
npm run db:configure
npm run db:test
npm run db:status
npm run db:stop
```

The CLI dependency belongs to the repository tooling, not to either application's runtime. Backend persistence adapters belong in `apps/backend/src/`; they use this schema but do not own a second copy of it. The frontend consumes public API responses rather than raw database row types.

Create each schema change with `npx supabase migration new descriptive_name`. Once applied to a shared environment, a migration is immutable: add a new corrective migration instead of rewriting history. Verify rebuilds, grants and RLS against a disposable local database before deploying schema changes. Resetting a database deletes its local data, so it is not part of the default development command.

Read [Supabase's migration guide](https://supabase.com/docs/guides/local-development/database-migrations) and [environment workflow](https://supabase.com/docs/guides/deployment/managing-environments). Local, staging and production must use separate databases and credentials.
