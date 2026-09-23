# IMMIGROME Python backend

This service is being introduced beside the existing Next.js application. It
must not be exposed directly to browsers: Next.js preserves the current
Auth.js session and calls protected API endpoints on the user's behalf.

## Local start

From `backend`:

```powershell
py -3.13 -m venv .venv
.\.venv\Scripts\python -m pip install -e ".[dev]"
.\.venv\Scripts\python -m uvicorn app.main:app --reload --port 8000
```

Then open `http://127.0.0.1:8000/v1/health`.

`/v1/health/ready` also verifies the existing `DATABASE_URL` connection. It
returns 503 rather than leaking connection details when no database is set.

## Background worker

Set `REDIS_URL`, then run this in a second terminal:

```powershell
.\.venv\Scripts\celery -A app.workers.celery_app worker --pool=solo --loglevel=INFO
```

Run Celery Beat in one additional terminal so the outbox dispatcher and
follow-up scanner are scheduled:

```powershell
.\.venv\Scripts\celery -A app.workers.celery_app beat --loglevel=INFO
```

Redis transports tasks, while durable work is recorded in Postgres
`OutboxEvent`.

## Production deploy

Deploy Next.js, FastAPI, worker, beat, Hermes, and Redis in one Railway
project. Supabase remains the shared Postgres/Storage data platform. The full
service topology, variables, activation sequence, and rollback steps are in
[`docs/deployment/railway-hermes.md`](../docs/deployment/railway-hermes.md).

Human bridge tokens use `INTERNAL_API_SECRET`. Machine credentials use the
separate `AUTOMATION_API_SECRET` or private `HERMES_MCP_KEY`; there is no
fallback to `AUTH_SECRET`.

Local API Docker equivalent (from `backend/`):

```powershell
docker build -t immigrome-api .
docker run --rm -p 8000:8000 `
  -e APP_ENV=production `
  -e DATABASE_URL="postgresql://..." `
  -e INTERNAL_API_SECRET="..." `
  immigrome-api
```

## Python-owned operations

The internal API now owns the transactional actions for documents, applications,
tasks, automation, Telegram ingestion, messages, and approval state. Next.js
continues to authenticate the browser session and acts as the human control
plane. Enable migrated surfaces independently with `BACKEND_CAPABILITIES`.

Useful read endpoints are `GET /v1/deadlines`, `GET /v1/notifications`,
`GET /v1/dashboard/overview`, and `GET /v1/portal/overview`.  They are all
protected by the short-lived bridge token; they are not browser-facing APIs.
