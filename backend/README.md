# Orbit API

FastAPI service for Oracle deployment. The API is intentionally small and single-user oriented:

- `GET /health`
- `POST /api/v1/sync/push`
- `GET /api/v1/sync/pull`
- `GET /api/v1/dashboard/jobs`
- `POST /api/v1/llm/chat`
- `POST /api/v1/resumes/{id}/file`
- `POST /api/v1/parser/config`
- `POST /api/v1/parser/run`
- `GET /api/v1/parser/status`

Set `ORBIT_USER_EMAIL`, a strong `ORBIT_USER_PASSWORD`, provider keys and the extension origin in `backend/.env`. The database is only reachable by the Compose network. The temporary IP deployment uses Caddy on host port `8088` without TLS; use a domain and HTTPS before handling real application data. The extension receives a revocable 30-day bearer session after login.

For server-side scheduled discovery, set `APIFY_API_KEY` and optionally `APIFY_ACTOR`, then choose **Oracle server** under the extension's Job parser settings. The server stores non-secret parser filters and runs supported UTC cron schedules while Chrome is closed.
