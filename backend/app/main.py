from datetime import datetime, timezone
from pathlib import Path
from fastapi import Depends, FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import select
from sqlalchemy.orm import Session
from .config import settings
from .db import Record, get_db, init_db
from .llm import openrouter_chat
from .schemas import LLMRequest, LLMResponse, SyncRequest, SyncResponse
from .security import require_api_token

app = FastAPI(title=settings.app_name, version="0.1.0")
app.add_middleware(CORSMiddleware, allow_origins=settings.cors_origin_list, allow_credentials=False, allow_methods=["GET", "POST", "PATCH", "OPTIONS"], allow_headers=["Content-Type", "X-Orbit-Token"])


@app.on_event("startup")
def startup() -> None:
    init_db()
    (Path(settings.data_dir) / "resumes").mkdir(parents=True, exist_ok=True)


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok", "service": settings.app_name}


@app.post("/api/v1/sync/push", response_model=SyncResponse, dependencies=[Depends(require_api_token)])
def sync_push(request: SyncRequest, db: Session = Depends(get_db)) -> SyncResponse:
    for item in request.records:
        key = f"{item.entity_type}:{item.entity_id}"
        record = db.get(Record, key) or Record(key=key, entity_type=item.entity_type, entity_id=item.entity_id, payload=item.payload)
        record.payload = item.payload
        db.add(record)
    db.commit()
    return SyncResponse(accepted=len(request.records), server_time=datetime.now(timezone.utc))


@app.get("/api/v1/sync/pull", dependencies=[Depends(require_api_token)])
def sync_pull(entity_type: str | None = None, db: Session = Depends(get_db)) -> list[dict]:
    query = select(Record).order_by(Record.updated_at.desc()).limit(500)
    if entity_type:
        query = query.where(Record.entity_type == entity_type)
    return [{"entity_type": row.entity_type, "entity_id": row.entity_id, "payload": row.payload, "updated_at": row.updated_at} for row in db.scalars(query).all()]


@app.get("/api/v1/dashboard/jobs", dependencies=[Depends(require_api_token)])
def dashboard_jobs(db: Session = Depends(get_db)) -> list[dict]:
    rows = db.scalars(select(Record).where(Record.entity_type == "job").order_by(Record.updated_at.desc())).all()
    return [row.payload for row in rows]


@app.post("/api/v1/llm/chat", response_model=LLMResponse, dependencies=[Depends(require_api_token)])
async def llm_chat(request: LLMRequest) -> LLMResponse:
    content, model = await openrouter_chat(request)
    return LLMResponse(content=content, model=model)


@app.post("/api/v1/resumes/{resume_id}/file", dependencies=[Depends(require_api_token)])
async def upload_resume_file(resume_id: str, file: UploadFile = File(...)) -> dict[str, str]:
    if file.content_type not in {"application/pdf", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"}:
        raise HTTPException(status_code=415, detail="Only PDF and DOCX resumes are accepted")
    content = await file.read()
    if len(content) > 10 * 1024 * 1024:
        raise HTTPException(status_code=413, detail="Resume file is too large")
    suffix = ".pdf" if file.content_type == "application/pdf" else ".docx"
    path = Path(settings.data_dir) / "resumes" / f"{resume_id}{suffix}"
    path.write_bytes(content)
    return {"resume_id": resume_id, "stored": str(path)}
