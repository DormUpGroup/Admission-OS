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

The first task is a non-destructive worker ping. Programme imports, matching,
document OCR and monitoring will be added as separate idempotent jobs.

## Python-owned operations

The internal API now owns the transactional actions for documents, applications,
deadlines, portal task completion, messages and notification read state.  Next.js
continues to authenticate the browser session and, for uploads, writes the file
to the configured storage before passing its trusted storage URL to the API.

Useful read endpoints are `GET /v1/deadlines`, `GET /v1/notifications`,
`GET /v1/dashboard/overview`, and `GET /v1/portal/overview`.  They are all
protected by the short-lived bridge token; they are not browser-facing APIs.
