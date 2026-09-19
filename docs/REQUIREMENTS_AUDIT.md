# Original workflow audit

This document maps the original 12-point product request to the current implementation.

| Requirement | Implementation |
| --- | --- |
| Resume pool and application dashboard | Resumes preserve original files and extracted data; Dashboard tracks job metadata, selected resume/version, match, notes, dates, status and history. |
| Manual and scheduled job parser with deduplication | Apify runs manually or by UTC schedule in Chrome or continuously on Oracle. Canonical URL, external ID and company/title/location identities prevent duplicates while refreshing changed data. |
| Reusable contact/professional data from resumes | PDF/DOCX text extraction, OCR fallback and LLM/heuristic structuring merge verified values into User Profile. |
| One-click job session from any normal tab | The extension action opens the Side Panel; Analyze captures and persists a tab-linked session. Existing jobs can reopen an application session without being re-parsed as a new job. |
| Page, document and visual context | Bounded HTML, visible text, Schema.org job metadata, PDF links and a compressed screenshot are stored. Directly opened PDFs are parsed as text. Screenshots are sent only for sparse pages, with a text-only retry for non-vision models. |
| Job/resume comparison | Every resume gets an explainable 0–100 result with strengths, missing requirements, matching skills, concerns and recommendation. |
| Resume adaptation and pool versioning | OpenRouter creates a truthful draft; the user reviews original/adapted text and saves a separate DOCX version linked to the base resume and job. |
| Resume attachment, autofill and learning | Accessible top-level/iframe fields are detected; the selected CV can be attached to resume file inputs; fixed/reusable values are previewed and filled. Corrections are persisted only after an explicit Save answer/value/preference action. |
| Per-field generation and lock/type control | Fixed, Reusable, LLM Generated and Ignore are switchable during the application. Each field has Generate/Regenerate, custom prompt, instructions, source and confidence. |
| Session closing | Explicit Close Session, Application submitted and linked-tab close all persist the final session state. The extension never clicks the site Submit button. |
| Dashboard application record | Submission stores URLs, selected resume version, final answers, field provenance and application date. Status remains manually editable through Offer/Rejected/etc. |
| Parser, model and field settings | Settings expose Apify filters/schedule/execution, dynamic OpenRouter model IDs, User Profile, editable global field rules, Cloud sync, backup/import/reset and safe debug logging. |

## Deliberate constraints

- Browser security or an ATS implementation can reject programmatic file assignment; the field remains visible for manual upload in that case.
- Closed shadow DOM and cross-origin frames that Chrome refuses to inject into cannot be automated. Low-confidence and inaccessible fields remain a user review step.
- Generated DOCX versions preserve truthful content and hierarchy, not the original resume's exact visual design.
- Linked PDFs are recorded in the session. A PDF opened directly in the active tab is parsed; arbitrary linked documents are not downloaded automatically to avoid sending unrelated documents or increasing LLM cost.
- Local heuristic generation is a continuity fallback. High-quality adaptation and nuanced application answers require OpenRouter through the browser or Oracle gateway.
