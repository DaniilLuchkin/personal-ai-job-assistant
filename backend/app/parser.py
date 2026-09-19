import hashlib
import re
from datetime import datetime, timezone
from typing import Any
from urllib.parse import parse_qsl, quote, urlencode, urlsplit, urlunsplit

import httpx
from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from .config import settings
from .db import Record


def _text(value: Any) -> str:
    return str(value).strip() if value is not None else ""


def _first(raw: dict[str, Any], *keys: str) -> Any:
    return next((raw[key] for key in keys if raw.get(key) not in (None, "")), "")


def _list(value: Any) -> list[str]:
    if isinstance(value, list):
        return [_text(item) for item in value if _text(item)]
    return [_text(value)] if _text(value) else []


def _canonical_url(value: str) -> str:
    if not value:
        return ""
    try:
        parts = urlsplit(value)
        tracking = {"utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term", "trk", "trackingId", "ref"}
        query = urlencode([(key, value) for key, value in parse_qsl(parts.query, keep_blank_values=True) if key not in tracking])
        return urlunsplit((parts.scheme.lower(), parts.netloc.lower().removeprefix("www."), parts.path.rstrip("/"), query, ""))
    except ValueError:
        return value.lower().strip()


def _key_text(value: str) -> str:
    return re.sub(r"[^a-z0-9]+", " ", value.lower()).strip()


def job_identity(job: dict[str, Any]) -> tuple[str, str, str]:
    return (
        _canonical_url(_text(job.get("sourceUrl"))),
        _key_text(_text(job.get("externalId"))),
        _key_text(f"{job.get('company', '')}|{job.get('title', '')}|{job.get('location', '')}"),
    )


def normalize_job(raw: dict[str, Any], stamp: str) -> dict[str, Any]:
    source_url = _text(_first(raw, "sourceUrl", "url", "link"))
    remote_value = _text(_first(raw, "remoteType", "remote", "workplaceType")).lower()
    remote_type = "hybrid" if "hybrid" in remote_value else "remote" if "remote" in remote_value else "on-site" if "on-site" in remote_value or "onsite" in remote_value else "unknown"
    source = _text(_first(raw, "source", "platform"))
    if not source and source_url:
        source = urlsplit(source_url).netloc or "parser"
    title = _text(_first(raw, "title", "jobTitle", "position")) or "Untitled role"
    company = _text(_first(raw, "company", "companyName", "employer")) or "Unknown company"
    job = {
        "title": title,
        "company": company,
        "location": _text(_first(raw, "location", "city")),
        "remoteType": remote_type,
        "employmentType": _text(_first(raw, "employmentType", "jobType")) or None,
        "salary": _text(_first(raw, "salary", "salaryRange")) or None,
        "description": _text(_first(raw, "description", "jobDescription")),
        "responsibilities": _list(raw.get("responsibilities")),
        "requirements": _list(_first(raw, "requirements", "qualifications")),
        "preferredQualifications": _list(_first(raw, "preferredQualifications", "preferred")),
        "skills": _list(_first(raw, "skills", "technologies")),
        "benefits": _list(raw.get("benefits")),
        "source": source or "parser",
        "sourceUrl": source_url,
        "applicationUrl": _text(_first(raw, "applicationUrl", "applyUrl")) or source_url or None,
        "externalId": _text(_first(raw, "externalId", "jobId", "id")) or None,
        "postedAt": _text(_first(raw, "postedAt", "datePosted")) or None,
        "discoveredAt": stamp,
        "lastSeenAt": stamp,
        "status": "Saved",
        "notes": "",
        "statusHistory": [],
        "lastActivityAt": stamp,
    }
    identity = next((part for part in job_identity(job) if part), f"{company}|{title}")
    job["id"] = f"job-server-{hashlib.sha256(identity.encode()).hexdigest()[:20]}"
    return job


def schedule_due(schedule: str, last_run: str | None, moment: datetime | None = None) -> bool:
    now = moment or datetime.now(timezone.utc)
    previous = datetime.fromisoformat(last_run.replace("Z", "+00:00")) if last_run else None
    every = re.fullmatch(r"\*/(\d+)\s+\*\s+\*\s+\*\s+\*", schedule.strip())
    if every:
        minutes = max(1, int(every.group(1)))
        return previous is None or (now - previous).total_seconds() >= minutes * 60
    daily = re.fullmatch(r"(\d{1,2})\s+(\d{1,2})\s+\*\s+\*\s+\*", schedule.strip())
    if not daily:
        return False
    minute, hour = int(daily.group(1)), int(daily.group(2))
    if minute > 59 or hour > 23:
        return False
    scheduled = now.replace(hour=hour, minute=minute, second=0, microsecond=0)
    return now >= scheduled and (previous is None or previous < scheduled)


def run_apify_parser(db: Session, config: dict[str, Any]) -> dict[str, int]:
    actor = _text(config.get("actor") or settings.apify_actor).replace("/", "~")
    if not settings.apify_api_key or not actor:
        raise HTTPException(status_code=503, detail="APIFY_API_KEY and actor must be configured on the server")
    actor_input = {
        "jobTitles": config.get("jobTitles", []),
        "keywords": config.get("keywords", []),
        "locations": config.get("locations", []),
        "remoteTypes": config.get("remoteTypes", []),
        "platforms": config.get("platforms", []),
        "excludeKeywords": config.get("excludeKeywords", []),
        "minimumSalary": config.get("minimumSalary"),
    }
    try:
        with httpx.Client(timeout=httpx.Timeout(130.0, connect=10.0)) as client:
            response = client.post(f"https://api.apify.com/v2/acts/{quote(actor, safe='~')}/runs", params={"token": settings.apify_api_key, "waitForFinish": 120}, json=actor_input)
            response.raise_for_status()
            dataset_id = response.json().get("data", {}).get("defaultDatasetId")
            if not dataset_id:
                return {"added": 0, "updated": 0, "received": 0}
            dataset = client.get(f"https://api.apify.com/v2/datasets/{quote(dataset_id)}/items", params={"token": settings.apify_api_key, "clean": "true"})
            dataset.raise_for_status()
            items = dataset.json()
    except httpx.TimeoutException as error:
        raise HTTPException(status_code=504, detail="Apify parser timed out") from error
    except (httpx.HTTPError, ValueError) as error:
        raise HTTPException(status_code=502, detail="Apify parser request failed") from error

    if not isinstance(items, list):
        raise HTTPException(status_code=502, detail="Apify dataset did not return a list")
    existing_records = db.scalars(select(Record).where(Record.entity_type == "job")).all()
    existing = [(record, job_identity(record.payload)) for record in existing_records]
    stamp = datetime.now(timezone.utc).isoformat()
    added = updated = 0
    exclude = [_text(value).lower() for value in config.get("excludeKeywords", []) if _text(value)]
    for raw in items:
        if not isinstance(raw, dict):
            continue
        candidate = normalize_job(raw, stamp)
        searchable = f"{candidate['title']} {candidate['company']} {candidate['description']}".lower()
        if any(term in searchable for term in exclude):
            continue
        candidate_identity = job_identity(candidate)
        match = next((entry for entry in existing if any(left and right and left == right for left, right in zip(candidate_identity, entry[1]))), None)
        if match:
            record = match[0]
            old = record.payload
            candidate.update({"id": old.get("id", candidate["id"]), "discoveredAt": old.get("discoveredAt", stamp), "status": old.get("status", "Saved"), "notes": old.get("notes", ""), "statusHistory": old.get("statusHistory", []), "resumeId": old.get("resumeId"), "resumeVersionId": old.get("resumeVersionId"), "matchScore": old.get("matchScore"), "analysis": old.get("analysis"), "matches": old.get("matches"), "appliedAt": old.get("appliedAt")})
            record.payload = candidate
            updated += 1
        else:
            record = Record(key=f"job:{candidate['id']}", entity_type="job", entity_id=candidate["id"], payload=candidate)
            existing.append((record, candidate_identity))
            added += 1
        db.add(record)
    db.commit()
    return {"added": added, "updated": updated, "received": len(items)}
