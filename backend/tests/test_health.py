from datetime import UTC, datetime, timedelta

import jwt
from fastapi import Depends
from fastapi.testclient import TestClient

from app.core.config import get_settings
from app.core.security import (
    SERVICE_TOKEN_AUDIENCE,
    SERVICE_TOKEN_ISSUER,
    require_service_scopes,
)
from app.main import app


@app.get("/_test/service-scope")
def _service_scope_test(
    actor=Depends(require_service_scopes("cases:read", "tasks:create")),
):
    return {"id": actor.id, "scopes": sorted(actor.scopes)}


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


def test_service_identity_uses_separate_secret_and_scopes(monkeypatch) -> None:
    automation_secret = "automation-secret-that-is-longer-than-thirty-two-bytes"
    monkeypatch.setenv("AUTOMATION_API_SECRET", automation_secret)
    monkeypatch.setenv("INTERNAL_API_SECRET", "different-human-bridge-secret-value")
    get_settings.cache_clear()

    allowed = jwt.encode(
        {
            "sub": "hermes-mcp",
            "scopes": ["cases:read", "tasks:create"],
            "iss": SERVICE_TOKEN_ISSUER,
            "aud": SERVICE_TOKEN_AUDIENCE,
            "exp": datetime.now(UTC) + timedelta(minutes=1),
        },
        automation_secret,
        algorithm="HS256",
    )
    denied = jwt.encode(
        {
            "sub": "hermes-readonly",
            "scopes": ["cases:read"],
            "iss": SERVICE_TOKEN_ISSUER,
            "aud": SERVICE_TOKEN_AUDIENCE,
            "exp": datetime.now(UTC) + timedelta(minutes=1),
        },
        automation_secret,
        algorithm="HS256",
    )

    with TestClient(app) as client:
        allowed_response = client.get(
            "/_test/service-scope", headers={"Authorization": f"Bearer {allowed}"}
        )
        denied_response = client.get(
            "/_test/service-scope", headers={"Authorization": f"Bearer {denied}"}
        )

    assert allowed_response.status_code == 200
    assert allowed_response.json()["id"] == "hermes-mcp"
    assert denied_response.status_code == 403
    get_settings.cache_clear()
