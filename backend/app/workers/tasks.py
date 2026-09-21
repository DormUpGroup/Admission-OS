from app.services.ingestion.source import fetch_and_extract_source
from app.workers.celery_app import celery_app


@celery_app.task(name="immigrome.system.ping")
def ping() -> dict[str, str]:
    """Minimal task used to verify worker/broker wiring before business jobs run."""
    return {"status": "ok"}


@celery_app.task(name="immigrome.ingestion.fetch_extract")
def fetch_extract_source(source_url: str) -> dict[str, str | bool]:
    """Fetch a public official source and return normalized text for persistence/QA."""
    return fetch_and_extract_source(source_url).to_dict()
