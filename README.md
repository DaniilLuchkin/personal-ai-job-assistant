# Orbit — Personal AI Job Assistant

A local-first Manifest V3 Chrome Extension for the real MVP workflow:

`Upload Resume → Open Job → Analyze → Match Resume → Detect Form → Review/Fill → Generate Answers → Mark Applied → Dashboard`

## What is implemented

- React + TypeScript + Vite Chrome extension with a Side Panel UI.
- IndexedDB persistence behind repositories for resumes, jobs, sessions, fields, knowledge, profile, settings and applications.
- PDF and DOCX text extraction. Original files are preserved as `Blob`s.
- Resume structured-data extraction through OpenRouter when configured, with a local heuristic fallback.
- Client-side page context extraction (URL, visible text, bounded HTML snapshot and basic metadata).
- OpenRouter provider abstraction plus local fallback; prompts live under `src/services/llm/prompts`.
- Explainable job analysis and resume matching (0–100 score, strengths, missing requirements and recommendation).
- Typed service-worker/content-script messaging.
- Multi-level form detection using semantics, labels, ARIA, placeholders and known patterns, with confidence scores.
- Fixed/reusable/LLM/ignore field categories, preview/editing, generate/regenerate one answer at a time, and explicit “Application submitted” save action. The extension never clicks Submit.
- Dashboard statuses: Saved, Analyzing, Applied, Interview, Rejected, Offer, Withdrawn, Archived; search and manual status changes with history.
- Apify provider interface and parser settings are included for Phase 2 scheduling/discovery.
- Optional Oracle backend: FastAPI + PostgreSQL + Caddy, token-protected sync API, server-side OpenRouter gateway and resume file storage endpoint.

Resume adaptation/versioning, advanced screenshot/PDF understanding, scheduled Apify execution, import/export and multi-provider additions are intentionally Phase 2/3 extensions after the core workflow.

## Development

```bash
npm install
npm run typecheck
npm test
npm run build
```

Load the extension in Chrome:

1. Open `chrome://extensions` and enable Developer mode.
2. Click **Load unpacked** and select the generated `dist` directory.
3. Pin Orbit. Open a job page, click the extension action, and use **Analyze this job** in the Side Panel.

## Oracle backend deployment

The extension works without the backend. To enable sync, deploy the included Compose stack on the Oracle VM:

```bash
cp backend/.env.example backend/.env
cp .env.example .env
# set ORBIT_DB_PASSWORD and ORBIT_HTTP_PORT in .env
# set ORBIT_USER_EMAIL, ORBIT_USER_PASSWORD, provider keys and CORS_ORIGINS in backend/.env
docker compose up -d --build
docker compose logs -f api
```

For temporary IP mode, allow TCP `ORBIT_HTTP_PORT` (default `8088`) in the Oracle Cloud security list and VM firewall. Use `http://PUBLIC_IP:8088` in the extension. This mode is intentionally temporary and has no transport encryption; use a domain and HTTPS before handling real application data. Do not expose port 5432 or 8000. In the extension, enable **Settings → Cloud sync**, enter the API URL, and sign in with the configured account. Data is written locally first; sync failures do not lose the local record.

The server stores structured entities in PostgreSQL and uploaded resume files in the `orbit_data` Docker volume. Create encrypted backups of both volumes. The server-side LLM gateway means provider keys do not need to be placed in the extension.

## Provider setup

Open **Settings → LLM provider**, enter an OpenRouter API key and a model ID (for example, any current `openai/...`, `anthropic/...`, `google/...` or `deepseek/...` model available to your account). The model is intentionally free text so it is not coupled to a stale hardcoded list. The OpenRouter request is sent only when the user invokes analysis or generation. Without a key, the local heuristic provider keeps the MVP usable.

Open **Settings → Job parser** to configure Apify API key, actor, schedule, titles and locations. `ApifyProvider` implements the provider boundary; scheduling/actor-specific result mapping is the next phase.

## Architecture

```text
Side Panel (React)
  ├─ repositories → IndexedDB (local persistence)
  ├─ services/llm → LLMProvider → OpenRouterProvider | HeuristicProvider
  ├─ services/parser → JobSourceProvider → ApifyProvider
  └─ typed runtime message → Service Worker → Content Script
                                      ├─ page context extraction
                                      ├─ form detection
                                      └─ DOM filling after user confirmation
```

- `src/types`: domain models and message protocol.
- `src/repositories`: the only UI-facing persistence boundary.
- `src/services`: parsing, normalization, deduplication, context building and providers.
- `src/content`: least-privilege DOM reading/filling logic.
- `src/background`: MV3 service-worker message bridge.
- `src/sidepanel`: product UI and workflow orchestration.

### Job Session behavior

Analyze captures the current tab’s bounded HTML snapshot, visible text, URL and metadata, normalizes it into `Job`, deduplicates by external ID/canonical URL/company-title-location, persists a `JobSession`, and then runs analysis. A screenshot is not required for Phase 1; failure of any optional context element does not discard the session. Application answers are persisted with the session and an `ApplicationRecord`.

### Privacy

Data is local by default in IndexedDB. API keys are not placed in source or build-time environment variables. No browsing history is collected. Only bounded, relevant job/resume/profile context is included in provider prompts. Do not enable a provider unless you accept sending the selected context to it.

## Extending providers

Implement `LLMProvider` in `src/services/llm`, or `JobSourceProvider` in `src/services/parser`, then update the factory/settings selector. Prompts remain independent files so providers can share the same domain contract.

## Tests

Unit coverage includes normalization, URL/title/location deduplication, resume fallback extraction, field classification, bounded field context and local matching. Run `npm test` for the current suite.
