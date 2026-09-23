# Railway deployment: IMMIGROME automation

Use one Railway project and one production environment. Supabase remains the
external data platform; all compute runs in this Railway project.

## Services

1. `web`
   - Source: repository root
   - Config: `/railway.toml`
   - Public domain: the IMMIGROME application domain
2. `api`
   - Source root: `/backend`
   - Config: `/backend/railway.toml`
   - Public domain is required only for Telegram webhook and Next.js bridge.
   - `/mcp` is protected by its own key and should be reachable only through
     Railway private networking where the platform permits.
3. `worker`
   - Same source/image as `api`
   - Config: `/backend/railway.worker.toml`
   - No public domain
4. `beat`
   - Same source/image as `api`
   - Config: `/backend/railway.beat.toml`
   - Exactly one replica; no public domain
5. `hermes`
   - Deploy the official Hermes Agent Run API image.
   - Pin an immutable release tag and image digest in Railway; do not use
     `latest`.
   - Add a persistent volume at `HERMES_HOME`.
   - No public domain. Expose only Railway private networking.
   - Set `API_SERVER_KEY`, model provider credentials, bounded run timeout,
     max iterations, and child concurrency.
   - Configure only the IMMIGROME MCP endpoint and `HERMES_MCP_KEY`; disable
     shell, filesystem, browser, direct messaging, memory writes, cron, and
     unrestricted HTTP tools.
6. `redis`
   - Railway Redis plugin
   - Used by Celery as transport only; Postgres outbox remains authoritative.

The Hermes image digest is intentionally not hard-coded in this repository:
the chosen upstream release and digest must be verified against the official
release during deployment and recorded in Railway deployment metadata.

## Shared variables

`api`, `worker`, and `beat`:

- `DATABASE_URL`
- `REDIS_URL`
- `INTERNAL_API_SECRET`
- `AUTOMATION_API_SECRET`
- `HERMES_API_URL=http://hermes.railway.internal:<port>`
- `HERMES_API_KEY`
- `HERMES_MCP_KEY`
- `TELEGRAM_BOT_TOKEN`
- `TELEGRAM_WEBHOOK_SECRET`
- `GOOGLE_CALENDAR_ID`
- `GOOGLE_SERVICE_ACCOUNT_JSON`
- `AUTOMATION_ENABLED=true`

`web`:

- existing Auth.js and Supabase variables
- `INTERNAL_API_URL=https://<api-public-domain>`
- the same `INTERNAL_API_SECRET` as `api`
- start with `BACKEND_CAPABILITIES=automation`; add capabilities after their
  canary checks pass

## Database rollout

1. Back up Supabase.
2. Apply Prisma migrations with `npm run db:migrate:deploy` (includes additive
   `leaseToken` / `leaseExpiresAt` / `IntakeCohort.version`).
3. Apply `prisma/sql/hermes-constraints.sql` if not already present.
4. Apply `prisma/sql/enable-rls.sql`.
5. Verify that `anon` and `authenticated` have no grants on internal tables.

Do not run schema mutation concurrently from more than one service.

## Outbox lease worker rollout

1. Apply the additive outbox lease migration (nullable `leaseToken`,
   `leaseExpiresAt`).
2. Deploy API and workers that tolerate null lease fields.
3. Stop old worker replicas (hostname-only claim identity).
4. Start new workers (`WORKER_ID = hostname:pid:token`, fenced finalize).
5. Enable metrics and alerts (below).
6. Only then scale worker replicas.

## Observability alerts

Wire log metrics (`immigrome.metrics`) or export counters for:

- `stale_lease_claims`
- `lost_lease_finalizations`
- `command_replay` / `command_conflict`
- `unknown_delivery` (Telegram)
- MCP command failures (Hermes tool errors)
- outbox age and dead-letter count (`OutboxEvent` status DEAD / pending age)

## Safe activation

1. Deploy all services with `AUTOMATION_ENABLED=false`.
2. Configure Telegram webhook with
   `X-Telegram-Bot-Api-Secret-Token=TELEGRAM_WEBHOOK_SECRET`.
3. Verify that inbound messages appear in the admin UI while no outbound
   message is sent.
4. Set the database global switch to enabled from `/admin/automation`.
5. Keep intake drafts approval-only until sandbox and red-team checks pass.
6. Enable one agent at a time. The global switch and per-conversation pause are
   independent rollback controls.

## Rollback

Turn off the database global switch first. Do not disable the API or Telegram
webhook: inbound messages must continue to be persisted. Workers may continue
to drain internal audit events, while Hermes-bound events become
`SKIPPED_DISABLED`. Resolve or replay dead-letter events only after the cause
is fixed.
