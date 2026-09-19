# Architecture decision record

## Local-first boundary

The Oracle backend is the source of truth when Cloud sync is enabled. IndexedDB remains an offline-first cache so a server outage cannot discard user input. The service worker is a message bridge and lifecycle boundary, not a second database.

Each computer signs in through `POST /api/v1/auth/login`. The server creates a random, hashed, expiring bearer session. Passwords are never stored in the extension; only the session token is stored locally. The initial single-user account is seeded from `ORBIT_USER_EMAIL` and `ORBIT_USER_PASSWORD` at first backend startup.

## Message protocol

The side panel sends a typed command with `tabId` to the service worker. The worker routes the command to the content script in that tab and returns a typed response:

- `CAPTURE_PAGE_CONTEXT` → bounded `PageContext`
- `DETECT_FORM_FIELDS` → `FormField[]`
- `FILL_FORM_FIELDS` → number of successfully targeted elements
- `FILL_FILE_FIELD` → whether the selected resume was attached
- `CAPTURE_SCREENSHOT` → compressed screenshot data for the active page

The content script never calls an LLM and never submits a form.

Provider calls are server-side when the extension has a valid Cloud sync session. This keeps OpenRouter and Apify secrets on Oracle. If Cloud sync is off, the existing local OpenRouter/fallback path remains available for development and offline use.

## Data lifecycle

1. A resume file is parsed locally, the original `Blob` is retained, structured data is produced by the server OpenRouter gateway or fallback extraction, and the structured record plus original file are synced when enabled.
2. Analyze creates or updates one deduplicated `Job`, then creates a `JobSession`.
3. Analysis stores explainable `matches` on the Job and selects the top candidate without deleting any resume. Adaptation creates a new DOCX-backed `Resume` version linked by `parentId`.
4. Form fields are classified against global `FieldRule` records and remain editable. Filling and file attachment are explicit user actions. Corrections become persistent only when the user chooses to save them.
5. “Application submitted” creates an `ApplicationRecord`, closes the session and writes a status transition to `Applied`.
6. Apify parsing runs either in Chrome alarms or in the Oracle API scheduler. The explicit execution setting prevents duplicate paid Actor runs.

## Safety and failure handling

Provider requests have a 45-second timeout. Provider failure leaves page context and job/session data in IndexedDB. Missing API keys use the local fallback. Missing content scripts return a visible error instead of attempting unsafe page automation. Low-confidence fields remain visible for review. Password and demographic fields default to Ignore, and the extension never triggers the site Submit control.
