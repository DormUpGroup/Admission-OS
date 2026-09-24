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
   - `AUTOMATION_ENABLED=true` to process `message.received` / `telegram.send` (noop / `worker.log` always run)
   - Phase 1+: `TELEGRAM_BOT_TOKEN` (outbound send)
4. Web env (Phase 1): `TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET`
5. Do **not** redeploy old api / beat / Celery workers.

## Telegram webhook

Point the bot webhook at `https://<web-host>/api/webhooks/telegram` with
`secret_token=<TELEGRAM_WEBHOOK_SECRET>` (Telegram sends `X-Telegram-Bot-Api-Secret-Token`).

Admin inbox: `/admin/inbox`. Appointments: `/admin/appointments`.

## Google Calendar (Phase 2)

Worker env:
- `GOOGLE_CALENDAR_ID`
- `GOOGLE_SERVICE_ACCOUNT_JSON` (full service-account JSON as a single-line or escaped string)

Share the target calendar with the service account email (`client_email`) as editor.


```bash
npx prisma migrate deploy
npm run worker
```

## Kill-switch

When `AUTOMATION_ENABLED` is not true, the worker defers agent/outbound automation event types.
Diagnostic types `noop` and `worker.log` always run. Webhook ingest still persists to Postgres.
