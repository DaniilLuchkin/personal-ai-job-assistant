# Orbit API

FastAPI service for Oracle deployment. The API is intentionally small and single-user oriented:

- `GET /health`
- `POST /api/v1/sync/push`
- `GET /api/v1/sync/pull`
- `GET /api/v1/dashboard/jobs`
- `POST /api/v1/llm/chat`
- `POST /api/v1/resumes/{id}/file`

In production set `ORBIT_API_TOKEN`, a strong PostgreSQL password, provider keys and the real extension origin in `backend/.env`. The database is only reachable by the Compose network. Put Caddy or another HTTPS reverse proxy in front of port 8000; the supplied root `docker-compose.yml` does this with automatic Let's Encrypt certificates.
