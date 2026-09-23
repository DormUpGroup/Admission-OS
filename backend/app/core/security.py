from collections.abc import Callable
from dataclasses import dataclass
from typing import Annotated, Literal

import jwt
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from app.core.config import Settings, get_settings

Role = Literal["ADMIN", "CURATOR", "STUDENT"]
security_scheme = HTTPBearer(auto_error=False)
TOKEN_AUDIENCE = "immigrome-python-api"
TOKEN_ISSUER = "immigrome-nextjs"
SERVICE_TOKEN_AUDIENCE = "immigrome-automation-api"
SERVICE_TOKEN_ISSUER = "immigrome-automation"


@dataclass(frozen=True)
class Actor:
    id: str
    email: str
    role: Role


@dataclass(frozen=True)
class ServiceActor:
    id: str
    scopes: frozenset[str]


def unauthorized(detail: str = "Authentication is required") -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail=detail,
        headers={"WWW-Authenticate": "Bearer"},
    )


def get_current_actor(
    credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(security_scheme)],
    settings: Annotated[Settings, Depends(get_settings)],
) -> Actor:
    if credentials is None or credentials.scheme.lower() != "bearer":
        raise unauthorized()
    if not settings.bridge_secret:
        # A deployment with no bridge secret must fail closed.
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Internal API authentication is not configured",
        )

    try:
        claims = jwt.decode(
            credentials.credentials,
            settings.bridge_secret,
            algorithms=["HS256"],
            audience=TOKEN_AUDIENCE,
            issuer=TOKEN_ISSUER,
            options={"require": ["sub", "email", "role", "exp"]},
        )
        role = claims["role"]
        if role not in {"ADMIN", "CURATOR", "STUDENT"}:
            raise unauthorized("Unknown user role")
        return Actor(id=str(claims["sub"]), email=str(claims["email"]), role=role)
    except jwt.PyJWTError as error:
        raise unauthorized("Invalid or expired internal token") from error


CurrentActor = Annotated[Actor, Depends(get_current_actor)]


def get_service_actor(
    credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(security_scheme)],
    settings: Annotated[Settings, Depends(get_settings)],
) -> ServiceActor:
    if credentials is None or credentials.scheme.lower() != "bearer":
        raise unauthorized()
    if not settings.automation_api_secret:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Automation authentication is not configured",
        )
    try:
        claims = jwt.decode(
            credentials.credentials,
            settings.automation_api_secret,
            algorithms=["HS256"],
            audience=SERVICE_TOKEN_AUDIENCE,
            issuer=SERVICE_TOKEN_ISSUER,
            options={"require": ["sub", "scopes", "exp"]},
        )
        raw_scopes = claims["scopes"]
        if not isinstance(raw_scopes, list) or not all(
            isinstance(scope, str) for scope in raw_scopes
        ):
            raise unauthorized("Invalid service scopes")
        return ServiceActor(id=str(claims["sub"]), scopes=frozenset(raw_scopes))
    except jwt.PyJWTError as error:
        raise unauthorized("Invalid or expired automation token") from error


CurrentServiceActor = Annotated[ServiceActor, Depends(get_service_actor)]


def require_service_scopes(*required: str) -> Callable[[CurrentServiceActor], ServiceActor]:
    def dependency(actor: CurrentServiceActor) -> ServiceActor:
        missing = set(required) - actor.scopes
        if missing:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Missing automation scopes: {', '.join(sorted(missing))}",
            )
        return actor

    return dependency


def require_staff(actor: CurrentActor) -> Actor:
    if actor.role not in {"ADMIN", "CURATOR"}:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Staff access required")
    return actor


StaffActor = Annotated[Actor, Depends(require_staff)]
