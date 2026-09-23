# Live Prisma migrations

Production schema changes go through `prisma migrate deploy`. Do not run
`prisma db push` against the live Supabase database.

## Baseline on an existing production database

1. Take a schema-only backup of production.
2. Confirm `prisma/migrations/00000000000000_baseline/migration.sql` matches
   that backup. Do **not** execute the baseline SQL on production.
3. Mark the baseline as already applied:

```bash
npx prisma migrate resolve --applied 00000000000000_baseline
```

4. Deploy additive history:

```bash
npm run db:migrate:deploy
```

## Local and CI

Empty Postgres applies the baseline and then
`20260922130000_hermes_convergence`. `db:push:local` remains only for
disposable local databases.

## Rollback rehearsal

CI drops the additive Hermes objects, clears that migration row, and
re-applies `migrate deploy`. On a production clone, run the same rehearsal
against the schema-only backup before promoting a release:

```bash
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f scripts/rehearse-hermes-rollback.sql
psql "$DATABASE_URL" -c "DELETE FROM _prisma_migrations WHERE migration_name = '20260922130000_hermes_convergence'"
npm run db:migrate:deploy
```
