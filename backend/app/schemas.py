from datetime import datetime
from typing import Any
from pydantic import BaseModel, Field


class SyncRecord(BaseModel):
    entity_type: str = Field(pattern=r"^[a-z_]{2,80}$")
    entity_id: str = Field(min_length=1, max_length=180)
    payload: dict[str, Any]
    updated_at: datetime | None = None


class SyncRequest(BaseModel):
    records: list[SyncRecord] = Field(min_length=1, max_length=100)


class SyncResponse(BaseModel):
    accepted: int
    server_time: datetime


class LLMRequest(BaseModel):
    system: str = Field(max_length=20000)
    user: str = Field(max_length=50000)
    temperature: float = Field(default=0.2, ge=0, le=2)
    max_tokens: int = Field(default=1800, ge=100, le=8000)


class LLMResponse(BaseModel):
    content: str
    model: str


class LoginRequest(BaseModel):
    email: str = Field(min_length=3, max_length=320)
    password: str = Field(min_length=8, max_length=200)


class LoginResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    expires_at: datetime
    email: str
