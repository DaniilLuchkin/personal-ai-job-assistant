# Architecture decision record

## Local-first boundary

The extension has no backend, auth or account system. IndexedDB is the source of truth in the browser. The service worker is a message bridge and lifecycle boundary, not a second database.

## Message protocol

The side panel sends a typed command with `tabId` to the service worker. The worker routes the command to the content script in that tab and returns a typed response:

- `CAPTURE_PAGE_CONTEXT` → bounded `PageContext`
- `DETECT_FORM_FIELDS` → `FormField[]`
- `FILL_FORM_FIELDS` → number of successfully targeted elements

The content script never calls an LLM and never submits a form.

## Data lifecycle

1. A resume file is parsed locally, the original `Blob` is retained, and structured data is produced by OpenRouter or fallback extraction.
2. Analyze creates or updates one deduplicated `Job`, then creates a `JobSession`.
3. Analysis stores explainable `matches` on the Job and selects the top candidate without deleting any resume.
4. Form fields are classified and remain editable. Filling is an explicit user action.
5. “Application submitted” creates an `ApplicationRecord`, closes the session and writes a status transition to `Applied`.

## Safety and failure handling

Provider requests have a 45-second timeout. Provider failure leaves page context and job/session data in IndexedDB. Missing API keys use the local fallback. Missing content scripts return a visible error instead of attempting unsafe page automation. Low-confidence fields remain visible for review.
