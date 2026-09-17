from fastapi import Header, HTTPException, status
from .config import settings


def require_api_token(x_orbit_token: str | None = Header(default=None)) -> None:
    if settings.environment == "development" and not settings.orbit_api_token:
        return
    if not settings.orbit_api_token or x_orbit_token != settings.orbit_api_token:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid Orbit API token")
