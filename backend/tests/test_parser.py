from datetime import datetime, timedelta, timezone

from app.parser import job_identity, normalize_job, schedule_due


def test_normalize_job_produces_stable_identity() -> None:
    first = normalize_job({"title": "Project Manager", "company": "Acme", "url": "https://example.com/job/1?utm_source=x"}, "2026-01-01T00:00:00+00:00")
    second = normalize_job({"jobTitle": "Project Manager", "companyName": "Acme", "link": "https://example.com/job/1"}, "2026-01-02T00:00:00+00:00")
    assert job_identity(first)[0] == job_identity(second)[0]
    assert first["id"] == second["id"]


def test_interval_schedule_due() -> None:
    now = datetime(2026, 1, 1, 12, 0, tzinfo=timezone.utc)
    assert schedule_due("*/15 * * * *", (now - timedelta(minutes=16)).isoformat(), now)
    assert not schedule_due("*/15 * * * *", (now - timedelta(minutes=5)).isoformat(), now)
