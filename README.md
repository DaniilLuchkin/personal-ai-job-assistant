# Orbit — Personal AI Job Assistant

A local-first Manifest V3 Chrome Extension for the real MVP workflow:

`Upload Resume → Open Job → Analyze → Match Resume → Detect Form → Review/Fill → Generate Answers → Mark Applied → Dashboard`

## What is implemented

- React + TypeScript + Vite Chrome extension with a Side Panel UI.
- IndexedDB persistence behind repositories for resumes, jobs, sessions, fields, knowledge, profile, settings and applications.
- PDF and DOCX text extraction. Original files are preserved as `Blob`s.
- Local OCR fallback for scanned PDFs using bundled Tesseract.js `eng` + `rus` models; document images are not sent to the server.
- Resume structured-data extraction through OpenRouter when configured, with a local heuristic fallback.
- Client-side page context extraction (URL, visible text, bounded HTML snapshot and basic metadata).
- Schema.org/JSON-LD job metadata extraction, screenshot capture for sparse pages, linked-PDF discovery and direct PDF-page text analysis.
- OpenRouter provider abstraction plus local fallback; prompts live under `src/services/llm/prompts`.
- Explainable job analysis and resume matching (0–100 score, strengths, missing requirements and recommendation).
- Typed service-worker/content-script messaging.
- Multi-level form detection across accessible frames using semantics, labels, ARIA, placeholders and known patterns, with confidence scores, stable selectors, selects, checkbox/radio and resume file-upload support.
- Fixed/reusable/LLM/ignore field categories, global field rules, per-field prompts, explicit learning from corrections, generate/regenerate one answer at a time, and explicit “Application submitted” save action. Password and demographic fields are ignored by default. The extension never clicks Submit.
- Truthful LLM resume adaptation with side-by-side review. Saving creates a separate downloadable DOCX version linked to the source resume and job.
- Dashboard statuses: Saved, Analyzing, Applied, Interview, Rejected, Offer, Withdrawn, Archived; search and manual status changes with history.
- Apify discovery can run manually or on a schedule either in Chrome or continuously on Oracle (`*/N * * * *` or daily `M H * * *`, UTC).
- Optional Oracle backend: FastAPI + PostgreSQL + Caddy, token-protected sync API, server-side OpenRouter gateway and resume file storage endpoint.
- Settings data management for local JSON backup/restore (including resume files, excluding secrets) and explicit local/server data deletion.

Import/export, richer document-layout preservation and additional LLM/job-source providers remain later extensions after the working core workflow.

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

The server stores structured entities in PostgreSQL and uploaded resume files in the `orbit_data` Docker volume. Create encrypted backups of both volumes. The server-side LLM gateway means provider keys do not need to be placed in the extension. Sync pulls are paginated and resume deletion removes the corresponding remote record and file.

## Provider setup

Open **Settings → LLM provider**, enter an OpenRouter API key and a model ID (for example, any current `openai/...`, `anthropic/...`, `google/...` or `deepseek/...` model available to your account). The model is intentionally free text so it is not coupled to a stale hardcoded list. The OpenRouter request is sent only when the user invokes analysis or generation. Without a key, the local heuristic provider keeps the MVP usable.

Open **Settings → Job parser** to configure the actor, schedule, titles and locations. Choose **This browser** to use the API key stored in IndexedDB, or **Oracle server** to use `APIFY_API_KEY` from `backend/.env` even while Chrome is closed. Click **Save settings**, then use **Run parser now** for an immediate import. Supported UTC schedule forms are `*/N * * * *` and daily `M H * * *`. Imported jobs are normalized and deduplicated before entering the dashboard.

## Architecture

See also [`docs/REQUIREMENTS_AUDIT.md`](docs/REQUIREMENTS_AUDIT.md) for a point-by-point mapping to the original product workflow and explicit browser constraints.

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

Analyze captures the current tab’s bounded HTML snapshot, visible text, structured metadata, URL, a compressed screenshot and PDF links, normalizes it into `Job`, deduplicates by external ID/canonical URL/company-title-location, persists a `JobSession`, and then runs analysis. Screenshots are sent to the selected LLM only when page text is sparse; a text-only retry keeps non-vision models usable. Failure of optional context does not discard the session. Active sessions and detected fields are autosaved locally and restored when the side panel reopens; closing the linked tab closes the session. Application-page context, final answers and the exact resume version are persisted with the session and an `ApplicationRecord`.

### Privacy

Data is local by default in IndexedDB. API keys are not placed in source or build-time environment variables. No browsing history is collected. Only bounded, relevant job/resume/profile context is included in provider prompts. Do not enable a provider unless you accept sending the selected context to it.

Exported backups contain sensitive resume and application data even though API keys and session tokens are removed. Store backup files in encrypted storage. **Clear all data** requires confirmation and deletes synchronized records and resume files from the connected Oracle server as well as this browser.

## Extending providers

Implement `LLMProvider` in `src/services/llm`, or `JobSourceProvider` in `src/services/parser`, then update the factory/settings selector. Prompts remain independent files so providers can share the same domain contract.

## Tests

Unit coverage includes normalization, URL/title/location deduplication, resume fallback extraction, safe field classification, global field rules, bounded field context, local matching and backend parser normalization/scheduling. Run `npm test` for the extension suite. Backend tests run with `pytest` inside the API image.
