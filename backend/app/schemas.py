from datetime import datetime
from typing import Any
from pydantic import BaseModel, Field, field_validator
import re


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
    images: list[str] = Field(default_factory=list, max_length=2)
    model: str | None = Field(default=None, max_length=200)
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


class ParserConfig(BaseModel):
    enabled: bool = False
    actor: str = Field(default="", max_length=300)
    schedule: str = Field(default="0 9 * * *", min_length=9, max_length=100)
    jobTitles: list[str] = Field(default_factory=list, max_length=100)
    keywords: list[str] = Field(default_factory=list, max_length=100)
    locations: list[str] = Field(default_factory=list, max_length=100)
    remoteTypes: list[str] = Field(default_factory=list, max_length=20)
    platforms: list[str] = Field(default_factory=list, max_length=50)
    excludeKeywords: list[str] = Field(default_factory=list, max_length=100)
    minimumSalary: float | None = Field(default=None, ge=0)

    @field_validator("schedule")
    @classmethod
    def valid_schedule(cls, value: str) -> str:
        if not (re.fullmatch(r"\*/[1-9]\d*\s+\*\s+\*\s+\*\s+\*", value.strip()) or re.fullmatch(r"(?:[0-5]?\d)\s+(?:[01]?\d|2[0-3])\s+\*\s+\*\s+\*", value.strip())):
            raise ValueError("schedule must be */N * * * * or M H * * *")
        return value.strip()
