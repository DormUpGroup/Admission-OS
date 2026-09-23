from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

from celery import Celery

from app.core.config import get_settings

settings = get_settings()


def celery_redis_url(redis_url: str | None) -> str:
    """Add Celery's explicit TLS policy required by Upstash rediss URLs."""
    if not redis_url:
        return "memory://"
    parsed = urlsplit(redis_url)
    if parsed.scheme != "rediss":
        return redis_url
    query = dict(parse_qsl(parsed.query, keep_blank_values=True))
    query.setdefault("ssl_cert_reqs", "CERT_REQUIRED")
    return urlunsplit(parsed._replace(query=urlencode(query)))


redis_url = celery_redis_url(settings.redis_url)

# `memory://` makes imports and unit tests safe. A worker must be started with
# REDIS_URL in any real environment; it is intentionally not a durable fallback.
celery_app = Celery(
    "immigrome",
    broker=redis_url,
    backend=redis_url if settings.redis_url else "cache+memory://",
    include=["app.workers.tasks"],
)
celery_app.conf.update(
    task_serializer="json",
    result_serializer="json",
    accept_content=["json"],
    task_track_started=True,
    timezone="Europe/Rome",
    task_routes={
        "immigrome.outbox.dispatch": {"queue": "maintenance"},
        "immigrome.followups.scan": {"queue": "maintenance"},
        "immigrome.hermes.poll": {"queue": "orchestration"},
        "immigrome.ingestion.fetch_extract": {"queue": "programs"},
    },
    beat_schedule={
        "dispatch-outbox-every-five-seconds": {
            "task": "immigrome.outbox.dispatch",
            "schedule": 5.0,
        },
        "scan-followups-every-fifteen-minutes": {
            "task": "immigrome.followups.scan",
            "schedule": 900.0,
        },
        "poll-hermes-runs-every-ten-seconds": {
            "task": "immigrome.hermes.poll",
            "schedule": 10.0,
        },
    },
)

# Register local tasks when the module is imported as well as when Celery starts
# a worker. This keeps task discovery deterministic for API-side dispatch.
from app.workers import tasks as _tasks  # noqa: E402, F401
