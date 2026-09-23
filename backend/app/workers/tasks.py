from app.orchestration.poller import poll_active_hermes_runs_sync
from app.orchestration.scanners import schedule_due_followups_sync
from app.services.ingestion.source import fetch_and_extract_source
from app.workers.celery_app import celery_app
from app.workers.outbox import dispatch_outbox_batch_sync


@celery_app.task(name="immigrome.system.ping")
def ping() -> dict[str, str]:
    """Minimal task used to verify worker/broker wiring before business jobs run."""
    return {"status": "ok"}


@celery_app.task(name="immigrome.ingestion.fetch_extract")
def fetch_extract_source(source_url: str) -> dict[str, str | bool]:
    """Fetch a public official source and return normalized text for persistence/QA."""
    return fetch_and_extract_source(source_url).to_dict()


@celery_app.task(name="immigrome.outbox.dispatch")
def dispatch_outbox(limit: int = 25) -> dict[str, int]:
    """Claim and dispatch durable Postgres outbox events."""
    return dispatch_outbox_batch_sync(limit)


@celery_app.task(name="immigrome.followups.scan")
def scan_followups() -> dict[str, int]:
    return {"created": schedule_due_followups_sync()}


@celery_app.task(name="immigrome.hermes.poll")
def poll_hermes_runs(limit: int = 25) -> dict[str, int]:
    return poll_active_hermes_runs_sync(limit)
