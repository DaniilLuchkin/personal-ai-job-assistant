from datetime import datetime, timezone
from pathlib import Path
from fastapi import Depends, FastAPI, File, HTTPException, Query, Request, UploadFile
from fastapi.responses import FileResponse
import re
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import delete, select
from sqlalchemy.orm import Session
from .config import settings
from .db import AuthSession, Record, User, get_db, init_db
from .llm import openrouter_chat
from .schemas import LLMRequest, LLMResponse, LoginRequest, LoginResponse, SyncRequest, SyncResponse
from .security import get_current_user, issue_token, password_hash, password_matches
from .rate_limit import allow_request

app = FastAPI(title=settings.app_name, version="0.1.0")
app.add_middleware(CORSMiddleware, allow_origins=settings.cors_origin_list, allow_credentials=False, allow_methods=["GET", "POST", "PATCH", "DELETE", "OPTIONS"], allow_headers=["Content-Type", "Authorization", "X-Orbit-Token"])
ALLOWED_ENTITY_TYPES = {"job", "resume", "session", "knowledge", "profile", "application"}


@app.on_event("startup")
def startup() -> None:
    init_db()
    (Path(settings.data_dir) / "resumes").mkdir(parents=True, exist_ok=True)
    if settings.orbit_user_email and settings.orbit_user_password:
        with next(get_db()) as db:
            db.execute(delete(AuthSession).where(AuthSession.expires_at < datetime.now(timezone.utc)))
            if not db.scalar(select(User).where(User.email == settings.orbit_user_email.lower().strip())):
                db.add(User(id="default", email=settings.orbit_user_email.lower().strip(), password_hash=password_hash(settings.orbit_user_password)))
                db.commit()


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok", "service": settings.app_name}


@app.post("/api/v1/auth/login", response_model=LoginResponse)
def login(request: LoginRequest, http_request: Request, db: Session = Depends(get_db)) -> LoginResponse:
    client_host = http_request.client.host if http_request.client else "unknown"
    if not allow_request(f"login:{client_host}", limit=8, window_seconds=60):
        raise HTTPException(status_code=429, detail="Too many login attempts; try again later")
    user = db.scalar(select(User).where(User.email == request.email.lower().strip()))
    if not user or not password_matches(request.password, user.password_hash):
        raise HTTPException(status_code=401, detail="Invalid email or password")
    token, expires_at = issue_token(db, user)
    return LoginResponse(access_token=token, expires_at=expires_at, email=user.email)


@app.post("/api/v1/sync/push", response_model=SyncResponse)
def sync_push(request: SyncRequest, _user: User = Depends(get_current_user), db: Session = Depends(get_db)) -> SyncResponse:
    for item in request.records:
        if item.entity_type not in ALLOWED_ENTITY_TYPES:
            raise HTTPException(status_code=400, detail=f"Unsupported entity type: {item.entity_type}")
        key = f"{item.entity_type}:{item.entity_id}"
        record = db.get(Record, key) or Record(key=key, entity_type=item.entity_type, entity_id=item.entity_id, payload=item.payload)
        record.payload = item.payload
        db.add(record)
    db.commit()
    return SyncResponse(accepted=len(request.records), server_time=datetime.now(timezone.utc))


@app.get("/api/v1/sync/pull")
def sync_pull(entity_type: str | None = None, offset: int = Query(default=0, ge=0), limit: int = Query(default=500, ge=1, le=500), _user: User = Depends(get_current_user), db: Session = Depends(get_db)) -> list[dict]:
    query = select(Record).order_by(Record.updated_at.desc()).offset(offset).limit(limit)
    if entity_type:
        query = query.where(Record.entity_type == entity_type)
    return [{"entity_type": row.entity_type, "entity_id": row.entity_id, "payload": row.payload, "updated_at": row.updated_at} for row in db.scalars(query).all()]


@app.delete("/api/v1/sync/{entity_type}/{entity_id}")
def sync_delete(entity_type: str, entity_id: str, _user: User = Depends(get_current_user), db: Session = Depends(get_db)) -> dict[str, bool]:
    if entity_type not in ALLOWED_ENTITY_TYPES or not re.fullmatch(r"[A-Za-z0-9_-]{1,180}", entity_id):
        raise HTTPException(status_code=400, detail="Invalid sync record")
    record = db.get(Record, f"{entity_type}:{entity_id}")
    if record:
        db.delete(record)
        db.commit()
    if entity_type == "resume":
        directory = Path(settings.data_dir) / "resumes"
        for path in directory.glob(f"{entity_id}.*"):
            if path.suffix in {".pdf", ".docx"}:
                path.unlink(missing_ok=True)
    return {"deleted": bool(record)}


@app.get("/api/v1/dashboard/jobs")
def dashboard_jobs(_user: User = Depends(get_current_user), db: Session = Depends(get_db)) -> list[dict]:
    rows = db.scalars(select(Record).where(Record.entity_type == "job").order_by(Record.updated_at.desc())).all()
    return [row.payload for row in rows]


@app.post("/api/v1/llm/chat", response_model=LLMResponse)
async def llm_chat(request: LLMRequest, http_request: Request, _user: User = Depends(get_current_user)) -> LLMResponse:
    if not allow_request(f"llm:{_user.id}:{http_request.client.host if http_request.client else 'unknown'}", limit=30, window_seconds=60):
        raise HTTPException(status_code=429, detail="LLM request rate limit exceeded; try again later")
    content, model = await openrouter_chat(request)
    return LLMResponse(content=content, model=model)


@app.post("/api/v1/resumes/{resume_id}/file")
async def upload_resume_file(resume_id: str, file: UploadFile = File(...), _user: User = Depends(get_current_user)) -> dict[str, str]:
    if not re.fullmatch(r"[A-Za-z0-9_-]{1,180}", resume_id):
        raise HTTPException(status_code=400, detail="Invalid resume id")
    if file.content_type not in {"application/pdf", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"}:
        raise HTTPException(status_code=415, detail="Only PDF and DOCX resumes are accepted")
    content = await file.read()
    if len(content) > 10 * 1024 * 1024:
        raise HTTPException(status_code=413, detail="Resume file is too large")
    if (file.content_type == "application/pdf" and not content.startswith(b"%PDF-")) or (file.content_type.endswith("wordprocessingml.document") and not content.startswith(b"PK")):
        raise HTTPException(status_code=415, detail="Uploaded file content does not match its type")
    suffix = ".pdf" if file.content_type == "application/pdf" else ".docx"
    path = Path(settings.data_dir) / "resumes" / f"{resume_id}{suffix}"
    path.write_bytes(content)
    return {"resume_id": resume_id, "stored": str(path)}


@app.get("/api/v1/resumes/{resume_id}/file")
def download_resume_file(resume_id: str, _user: User = Depends(get_current_user)) -> FileResponse:
    if not re.fullmatch(r"[A-Za-z0-9_-]{1,180}", resume_id):
        raise HTTPException(status_code=400, detail="Invalid resume id")
    directory = Path(settings.data_dir) / "resumes"
    matches = list(directory.glob(f"{resume_id}.pdf")) + list(directory.glob(f"{resume_id}.docx"))
    if not matches:
        raise HTTPException(status_code=404, detail="Resume file not found")
    path = matches[0]
    return FileResponse(path, filename=path.name)
