# Outbox worker (Railway / local)

## What it is

Postgres transactional outbox + a Node poll worker (`npm run worker`).
No Redis, Celery, or FastAPI. Web (Admission-OS) and worker share `DATABASE_URL`.

## Railway setup

1. Keep the existing **web** service. Point Config-as-Code at [`railway.toml`](../../railway.toml) (or set start command to `npx prisma migrate deploy && npm start`).
2. Add a **worker** service from the same repo. Point Config-as-Code at [`railway.worker.toml`](../../railway.worker.toml), or set:
   - Build: `npx prisma generate`
   - Start: `npm run worker`
3. Worker env:
   - `DATABASE_URL` (same as web)
   - `AUTOMATION_ENABLED=true` to process `message.received`, bot welcome/help, and nudges (noop / `worker.log` / curator `telegram.send` always run)
   - Phase 1+: `TELEGRAM_BOT_TOKEN` (outbound send)
   - Hermes (worker only): `HERMES_API_URL`, `HERMES_API_KEY` (the Hermes service `API_SERVER_KEY`). See below.
4. Web env (Phase 1): `TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET`
   - Admin inbox replies deliver **inline** from the web process when
     `TELEGRAM_BOT_TOKEN` is set. They are not blocked by the automation
     kill-switch. The worker remains required for welcome/help, backlog retries,
     and calendar events.
5. Do **not** redeploy old api / beat / Celery workers.

## Telegram webhook

Point the bot webhook at `https://<web-host>/api/webhooks/telegram` with
`secret_token=<TELEGRAM_WEBHOOK_SECRET>` (Telegram sends `X-Telegram-Bot-Api-Secret-Token`).

BotFather profile copy (name, about, description, commands, avatar): see
[`docs/telegram-botfather.md`](../telegram-botfather.md).

Admin inbox: `/admin/inbox`. Appointments: `/admin/appointments`.
Automation ops (kill-switch + dead-letter replay): `/admin/automation`.

## Google Calendar (Phase 2)

Worker env:
- `GOOGLE_CALENDAR_ID`
- `GOOGLE_SERVICE_ACCOUNT_JSON` — **one line** of full service-account JSON in Railway
  (Dashboard → Variables). Multiline paste often truncates to `{` and breaks upserts.

Share the target calendar with the service account email (`client_email`) as editor.

Outbox `calendar.upsert` runs only after the client confirms (Telegram) or admin
manual confirm. Staff Telegram replies can complete without the worker; calendar
sync **requires the worker service** to be running.

```bash
npx prisma migrate deploy
npm run worker
```

## Hermes (private)

Hermes is a separate Railway service. Do not give it a public domain. The worker
calls it over Railway private networking.

Worker env (the web service does not call Hermes):

- `HERMES_API_URL` — private base URL, for example `http://hermes.railway.internal:8642`
- `HERMES_API_KEY` — same value as `API_SERVER_KEY` on the Hermes service. Sent as `Authorization: Bearer` on `POST /v1/runs`.

The body is `{ "input", "session_id", "instructions" }`. `instructions` carries the
capability `grant_id` and the three tool names. Hermes answers `202` with `run_id`.
The worker then polls `GET /v1/runs/{id}` (`hermes.poll_run`) until the run is
`completed` or `failed`. A still-running poll is deferred without burning attempts.
That does not send Telegram.

`HERMES_MCP_KEY`, `HERMES_MCP_URL`, and `HERMES_MCP_SCOPES` are deprecated and are
not read.

Web env (the MCP route runs in the web process, not the worker):

- `MCP_BOOTSTRAP_KEY` — same secret as on the Hermes service.

Hermes service config (not an Admission OS env var):

```yaml
mcp_servers:
  admission_os:
    url: http://<web>.railway.internal:<port>/api/mcp
    headers:
      Authorization: "Bearer ${MCP_BOOTSTRAP_KEY}"
```

Use the web private address, not a public domain. Do not put `TELEGRAM_BOT_TOKEN`
or `DATABASE_URL` on Hermes. Disable Hermes toolsets that can send Telegram or
arbitrary HTTP (`terminal`, messaging); otherwise the agent can leave this MCP route.

`message.received` enqueues `hermes.create_run`. The worker also sweeps `QUEUED`
intake runs that have no `hermesRunId`. A successful call sets
`AgentRun.status = RUNNING` and `hermesRunId`, and enqueues `hermes.poll_run`.
Poll sets `COMPLETED` or `FAILED` and revokes the grant. It does not send Telegram.

If `HERMES_API_URL` or `HERMES_API_KEY` is empty, the worker defers
`hermes.create_run` without burning attempts and without marking the run
`FAILED`.

## Kill-switch

Automation runs only when **both** are true:

1. Env `AUTOMATION_ENABLED=true` (hard floor — UI cannot override `false`)
2. DB `AutomationSetting` key `global_enabled` with `{ "enabled": true }`

Missing DB row = off (safe default after deploy). Toggle from `/admin/automation`
(ADMIN). When effective automation is off, the worker defers agent and
autonomous outbound event types (welcome, nudges) without burning attempts.
Curator replies (`telegram.send` with a staff sender) still deliver. Diagnostic
types `noop` and `worker.log` always run. Webhook ingest still persists to
Postgres. Dead-letter replay is on the same admin page.
