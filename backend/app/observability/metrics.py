import logging
from collections import defaultdict
from threading import Lock

logger = logging.getLogger("immigrome.metrics")

_counts: dict[str, int] = defaultdict(int)
_lock = Lock()


def incr(name: str, *, amount: int = 1, **labels: str) -> None:
    if labels:
        label_part = "|".join(f"{k}={v}" for k, v in sorted(labels.items()))
        key = f"{name}|{label_part}"
    else:
        key = name
    with _lock:
        _counts[key] += amount
        value = _counts[key]
    logger.info("metric %s=%s", key, value)


def get_counts() -> dict[str, int]:
    with _lock:
        return dict(_counts)


def reset_counts() -> None:
    with _lock:
        _counts.clear()
