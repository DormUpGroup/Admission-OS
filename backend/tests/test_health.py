from datetime import UTC, datetime, timedelta

import jwt
from fastapi.testclient import TestClient

from app.core.config import get_settings
from app.main import app


def test_health_is_available_without_database_configuration() -> None:
    with TestClient(app) as client:
        response = client.get("/v1/health")

    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


def test_identity_requires_a_valid_internal_token(monkeypatch) -> None:
    secret = "test-secret-that-is-longer-than-thirty-two-bytes"
    monkeypatch.setenv("INTERNAL_API_SECRET", secret)
    get_settings.cache_clear()
    token = jwt.encode(
        {
            "sub": "user_1",
            "email": "curator@example.test",
            "role": "CURATOR",
            "iss": "immigrome-nextjs",
            "aud": "immigrome-python-api",
            "exp": datetime.now(UTC) + timedelta(minutes=1),
        },
        secret,
        algorithm="HS256",
    )

    with TestClient(app) as client:
        denied = client.get("/v1/me")
        allowed = client.get("/v1/me", headers={"Authorization": f"Bearer {token}"})

    assert denied.status_code == 401
    assert allowed.status_code == 200
    assert allowed.json() == {
        "id": "user_1",
        "email": "curator@example.test",
        "role": "CURATOR",
    }
    get_settings.cache_clear()
