from datetime import datetime, timezone
from pathlib import Path
from fastapi import Depends, FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import select
from sqlalchemy.orm import Session
from .config import settings
from .db import Record, User, get_db, init_db
from .llm import openrouter_chat
from .schemas import LLMRequest, LLMResponse, LoginRequest, LoginResponse, SyncRequest, SyncResponse
from .security import get_current_user, issue_token, password_hash, password_matches

app = FastAPI(title=settings.app_name, version="0.1.0")
app.add_middleware(CORSMiddleware, allow_origins=settings.cors_origin_list, allow_credentials=False, allow_methods=["GET", "POST", "PATCH", "OPTIONS"], allow_headers=["Content-Type", "Authorization", "X-Orbit-Token"])


@app.on_event("startup")
def startup() -> None:
    init_db()
    (Path(settings.data_dir) / "resumes").mkdir(parents=True, exist_ok=True)
    if settings.orbit_user_email and settings.orbit_user_password:
        with next(get_db()) as db:
            if not db.scalar(select(User).where(User.email == settings.orbit_user_email.lower().strip())):
                db.add(User(id="default", email=settings.orbit_user_email.lower().strip(), password_hash=password_hash(settings.orbit_user_password)))
                db.commit()


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok", "service": settings.app_name}


@app.post("/api/v1/auth/login", response_model=LoginResponse)
def login(request: LoginRequest, db: Session = Depends(get_db)) -> LoginResponse:
    user = db.scalar(select(User).where(User.email == request.email.lower().strip()))
    if not user or not password_matches(request.password, user.password_hash):
        raise HTTPException(status_code=401, detail="Invalid email or password")
    token, expires_at = issue_token(db, user)
    return LoginResponse(access_token=token, expires_at=expires_at, email=user.email)


@app.post("/api/v1/sync/push", response_model=SyncResponse)
def sync_push(request: SyncRequest, _user: User = Depends(get_current_user), db: Session = Depends(get_db)) -> SyncResponse:
    for item in request.records:
        key = f"{item.entity_type}:{item.entity_id}"
        record = db.get(Record, key) or Record(key=key, entity_type=item.entity_type, entity_id=item.entity_id, payload=item.payload)
        record.payload = item.payload
        db.add(record)
    db.commit()
    return SyncResponse(accepted=len(request.records), server_time=datetime.now(timezone.utc))


@app.get("/api/v1/sync/pull")
def sync_pull(entity_type: str | None = None, _user: User = Depends(get_current_user), db: Session = Depends(get_db)) -> list[dict]:
    query = select(Record).order_by(Record.updated_at.desc()).limit(500)
    if entity_type:
        query = query.where(Record.entity_type == entity_type)
    return [{"entity_type": row.entity_type, "entity_id": row.entity_id, "payload": row.payload, "updated_at": row.updated_at} for row in db.scalars(query).all()]


@app.get("/api/v1/dashboard/jobs")
def dashboard_jobs(_user: User = Depends(get_current_user), db: Session = Depends(get_db)) -> list[dict]:
    rows = db.scalars(select(Record).where(Record.entity_type == "job").order_by(Record.updated_at.desc())).all()
    return [row.payload for row in rows]


@app.post("/api/v1/llm/chat", response_model=LLMResponse)
async def llm_chat(request: LLMRequest, _user: User = Depends(get_current_user)) -> LLMResponse:
    content, model = await openrouter_chat(request)
    return LLMResponse(content=content, model=model)


@app.post("/api/v1/resumes/{resume_id}/file")
async def upload_resume_file(resume_id: str, file: UploadFile = File(...), _user: User = Depends(get_current_user)) -> dict[str, str]:
    if file.content_type not in {"application/pdf", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"}:
        raise HTTPException(status_code=415, detail="Only PDF and DOCX resumes are accepted")
    content = await file.read()
    if len(content) > 10 * 1024 * 1024:
        raise HTTPException(status_code=413, detail="Resume file is too large")
    suffix = ".pdf" if file.content_type == "application/pdf" else ".docx"
    path = Path(settings.data_dir) / "resumes" / f"{resume_id}{suffix}"
    path.write_bytes(content)
    return {"resume_id": resume_id, "stored": str(path)}
