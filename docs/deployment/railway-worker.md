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
   - Hermes (worker only): `HERMES_API_URL` and one key per profile (`HERMES_API_KEY_INTAKE`, `HERMES_API_KEY_SCHEDULING`, `HERMES_API_KEY_ONBOARDING`). See below.
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

A guest booking enqueues `scheduling.requested`. `calendar.upsert` follows from the scheduling tool, or from the worker if that Hermes run ends without the tool, including a terminal HTTP or model failure. The AgentRun stays FAILED in that case. A missing profile key defers the run and does not write the calendar yet. Staff create and confirm still enqueue `calendar.upsert` directly. Calendar sync **requires the worker service** to be running.

```bash
npx prisma migrate deploy
npm run worker
```

## Hermes (private)

Hermes is a separate Railway service. Do not give it a public domain. The worker
calls it over Railway private networking.

Worker env (the web service does not call Hermes):

- `HERMES_API_URL` — private base URL, for example `http://hermes.railway.internal:8642`. Use `http`. Private networking is already encrypted, and `https` never finishes a TLS handshake, so the worker logs `fetch failed`.
- On the **Hermes** service (not the worker): `API_SERVER_ENABLED=true`, `API_SERVER_HOST=::`, `API_SERVER_PORT=8642`, and `API_SERVER_KEY`. Hermes defaults to `127.0.0.1`. Private networking then cannot open port 8642 on either the `10.x` or the `fd12::` address, and the worker logs `Connect Timeout Error` for both. After changing the variables, redeploy Hermes and confirm its log says the API server is listening on `::` port `8642`. `API_SERVER_HOST` in this repo's `.env` is not read by the worker.
- `HERMES_API_KEY_INTAKE`, `HERMES_API_KEY_SCHEDULING`, `HERMES_API_KEY_ONBOARDING` — each profile's `API_SERVER_KEY`. Sent as `Authorization: Bearer` on `POST /p/<profile>/v1/runs` and the matching GET. The default gateway key is not used for these calls.

The body is `{ "input", "session_id", "instructions" }`. `instructions` carries the
capability `grant_id` and that profile's tools. Hermes answers `202` with `run_id`.
The worker then polls `GET /p/<profile>/v1/runs/{id}` (`hermes.poll_run`) until the run is
`completed` or `failed`. A still-running poll is deferred without burning attempts.
Intake still sends the Telegram reply. Scheduling and onboarding do not.

`HERMES_MCP_KEY`, `HERMES_MCP_URL`, and `HERMES_MCP_SCOPES` are deprecated and are
not read.

Web env (the MCP route runs in the web process, not the worker):

- `MCP_BOOTSTRAP_KEY` — same secret as on the Hermes service.

Hermes service config (not an Admission OS env var):

```yaml
mcp_servers:
  admission_os:
    url: http://<web>.railway.internal:<port>/api/mcp?profile=intake
    headers:
      Authorization: "Bearer ${MCP_BOOTSTRAP_KEY}"
      x-admission-profile: intake
```

Use `profile=scheduling` or `profile=onboarding` on that profile's MCP entry. Each profile has its own `API_SERVER_KEY`.

Use the web private address, not a public domain. Do not put `TELEGRAM_BOT_TOKEN`
or `DATABASE_URL` on Hermes. Disable Hermes toolsets that can send Telegram or
arbitrary HTTP (`terminal`, messaging); otherwise the agent can leave this MCP route.

`message.received` enqueues `hermes.create_run`. The worker also sweeps `QUEUED`
intake runs that have no `hermesRunId`. A successful call sets
`AgentRun.status = RUNNING` and `hermesRunId`, and enqueues `hermes.poll_run`.
Poll sets `COMPLETED` or `FAILED` and revokes the grant. Intake sends its Telegram reply from the run. Scheduling and onboarding do not.

If `HERMES_API_URL` or the profile key for that run is empty, the worker defers
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
