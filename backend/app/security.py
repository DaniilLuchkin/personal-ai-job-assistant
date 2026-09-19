import hashlib
import hmac
import secrets
from datetime import datetime, timedelta, timezone
from fastapi import Depends, Header, HTTPException, status
from sqlalchemy.orm import Session
from .config import settings
from .db import AuthSession, User, get_db


def password_hash(password: str, salt: bytes | None = None) -> str:
    salt = salt or secrets.token_bytes(16)
    derived = hashlib.scrypt(password.encode(), salt=salt, n=2**14, r=8, p=1)
    return f"scrypt${salt.hex()}${derived.hex()}"


def password_matches(password: str, encoded: str) -> bool:
    try:
        _, salt, expected = encoded.split("$", 2)
        actual = hashlib.scrypt(password.encode(), salt=bytes.fromhex(salt), n=2**14, r=8, p=1).hex()
        return hmac.compare_digest(actual, expected)
    except (ValueError, TypeError):
        return False


def issue_token(db: Session, user: User) -> tuple[str, datetime]:
    raw = secrets.token_urlsafe(48)
    expires = datetime.now(timezone.utc) + timedelta(days=settings.session_days)
    db.add(AuthSession(token_hash=hashlib.sha256(raw.encode()).hexdigest(), user_id=user.id, expires_at=expires))
    db.commit()
    return raw, expires


def get_current_user(authorization: str | None = Header(default=None), x_orbit_token: str | None = Header(default=None), db: Session = Depends(get_db)) -> User:
    token = authorization[7:].strip() if authorization and authorization.lower().startswith("bearer ") else x_orbit_token
    if not token:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Authentication required")
    if settings.orbit_api_token and hmac.compare_digest(token, settings.orbit_api_token):
        user = db.get(User, "default")
        if user:
            return user
    session = db.get(AuthSession, hashlib.sha256(token.encode()).hexdigest())
    if not session or session.expires_at < datetime.now(timezone.utc):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid or expired session")
    user = db.get(User, session.user_id)
    if not user:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="User not found")
    return user
