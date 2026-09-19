from datetime import datetime, timezone
from pathlib import Path
from threading import Event, Lock, Thread
from contextlib import asynccontextmanager
from fastapi import Depends, FastAPI, File, HTTPException, Query, Request, UploadFile
from fastapi.responses import FileResponse
import re
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import delete, select
from sqlalchemy.orm import Session
from .config import settings
from .db import AuthSession, Record, SessionLocal, User, get_db, init_db
from .llm import openrouter_chat
from .parser import run_apify_parser, schedule_due
from .schemas import LLMRequest, LLMResponse, LoginRequest, LoginResponse, ParserConfig, SyncRequest, SyncResponse
from .security import get_current_user, issue_token, password_hash, password_matches
from .rate_limit import allow_request

ALLOWED_ENTITY_TYPES = {"job", "resume", "session", "knowledge", "field_rule", "parser_settings", "profile", "application"}
parser_stop = Event()
parser_thread: Thread | None = None
parser_lock = Lock()


def _save_parser_result(db: Session, record: Record, result: dict | None = None, error: str | None = None) -> None:
    payload = dict(record.payload)
    payload["lastRunAt"] = datetime.now(timezone.utc).isoformat()
    payload["lastError"] = error
    if result is not None:
        payload["lastResult"] = result
    record.payload = payload
    db.add(record)
    db.commit()


def _parser_loop() -> None:
    while not parser_stop.wait(30):
        with SessionLocal() as db:
            record = db.get(Record, "parser_settings:default")
            if not record or not record.payload.get("enabled") or not schedule_due(str(record.payload.get("schedule", "")), record.payload.get("lastRunAt")):
                continue
            try:
                if not parser_lock.acquire(blocking=False):
                    continue
                try:
                    result = run_apify_parser(db, record.payload)
                finally:
                    parser_lock.release()
                _save_parser_result(db, record, result)
            except HTTPException as error:
                _save_parser_result(db, record, error=str(error.detail))
            except Exception:
                _save_parser_result(db, record, error="Unexpected parser failure")


@asynccontextmanager
async def lifespan(_app: FastAPI):
    global parser_thread
    init_db()
    (Path(settings.data_dir) / "resumes").mkdir(parents=True, exist_ok=True)
    if settings.orbit_user_email and settings.orbit_user_password:
        with next(get_db()) as db:
            db.execute(delete(AuthSession).where(AuthSession.expires_at < datetime.now(timezone.utc)))
            if not db.scalar(select(User).where(User.email == settings.orbit_user_email.lower().strip())):
                db.add(User(id="default", email=settings.orbit_user_email.lower().strip(), password_hash=password_hash(settings.orbit_user_password)))
                db.commit()
    if parser_thread is None or not parser_thread.is_alive():
        parser_stop.clear()
        parser_thread = Thread(target=_parser_loop, name="orbit-parser", daemon=True)
        parser_thread.start()
    try:
        yield
    finally:
        parser_stop.set()
        if parser_thread and parser_thread.is_alive():
            parser_thread.join(timeout=2)


app = FastAPI(title=settings.app_name, version="0.2.0", lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_origins=settings.cors_origin_list, allow_credentials=False, allow_methods=["GET", "POST", "PATCH", "DELETE", "OPTIONS"], allow_headers=["Content-Type", "Authorization", "X-Orbit-Token"])


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
        payload = item.payload
        if item.entity_type == "session" and record.payload and payload.get("screenshots"):
            previous = {entry.get("id"): entry for entry in record.payload.get("screenshots", []) if isinstance(entry, dict)}
            payload = {**payload, "screenshots": [{**entry, "dataUrl": entry.get("dataUrl") or previous.get(entry.get("id"), {}).get("dataUrl", "")} if isinstance(entry, dict) else entry for entry in payload["screenshots"]]}
        if item.entity_type == "session" and record.payload:
            previous_page = record.payload.get("pageContext", {}) if isinstance(record.payload.get("pageContext"), dict) else {}
            previous_application = record.payload.get("applicationPageContext", {}) if isinstance(record.payload.get("applicationPageContext"), dict) else {}
            if isinstance(payload.get("pageContext"), dict) and not payload["pageContext"].get("htmlSnapshot"):
                payload["pageContext"]["htmlSnapshot"] = previous_page.get("htmlSnapshot")
            if isinstance(payload.get("applicationPageContext"), dict) and not payload["applicationPageContext"].get("htmlSnapshot"):
                payload["applicationPageContext"]["htmlSnapshot"] = previous_application.get("htmlSnapshot")
        record.payload = payload
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


@app.delete("/api/v1/data")
def clear_all_data(_user: User = Depends(get_current_user), db: Session = Depends(get_db)) -> dict[str, int]:
    deleted = len(db.scalars(select(Record)).all())
    db.execute(delete(Record))
    db.commit()
    directory = Path(settings.data_dir) / "resumes"
    for path in directory.glob("*"):
        if path.is_file() and path.suffix in {".pdf", ".docx"}:
            path.unlink(missing_ok=True)
    return {"deleted": deleted}


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


@app.post("/api/v1/parser/config")
def parser_config(config: ParserConfig, _user: User = Depends(get_current_user), db: Session = Depends(get_db)) -> dict:
    key = "parser_settings:default"
    record = db.get(Record, key)
    previous = record.payload if record else {}
    payload = {**config.model_dump(), "lastRunAt": previous.get("lastRunAt"), "lastResult": previous.get("lastResult"), "lastError": previous.get("lastError")}
    record = record or Record(key=key, entity_type="parser_settings", entity_id="default", payload=payload)
    record.payload = payload
    db.add(record)
    db.commit()
    return {"saved": True, "server_configured": bool(settings.apify_api_key and (config.actor or settings.apify_actor)), "status": payload}


@app.get("/api/v1/parser/status")
def parser_status(_user: User = Depends(get_current_user), db: Session = Depends(get_db)) -> dict:
    record = db.get(Record, "parser_settings:default")
    return {"server_configured": bool(settings.apify_api_key and (record and (record.payload.get("actor") or settings.apify_actor))), "status": record.payload if record else None}


@app.post("/api/v1/parser/run")
def parser_run(_user: User = Depends(get_current_user), db: Session = Depends(get_db)) -> dict:
    record = db.get(Record, "parser_settings:default")
    if not record:
        raise HTTPException(status_code=400, detail="Save parser settings before running the server parser")
    if not parser_lock.acquire(blocking=False):
        raise HTTPException(status_code=409, detail="The parser is already running")
    try:
        result = run_apify_parser(db, record.payload)
        _save_parser_result(db, record, result=result)
        return result
    except HTTPException as error:
        _save_parser_result(db, record, error=str(error.detail))
        raise
    finally:
        parser_lock.release()


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
