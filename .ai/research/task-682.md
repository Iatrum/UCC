# Task 682 — unit coverage round 6: MC / Time Chit template, referral, signed-document lock, follow-ups

Test-only. No dev server, no Playwright. `bun test tests/unit` + `tsc --noEmit`.
Docs consulted: FHIR R4 Communication / DocumentReference / Organization.extension; Medplum 5.2.8 `searchResources` / `updateResource` semantics (mocked client only).

## Method
Baseline `bun test tests/unit --coverage` showed these gaps:

| file | before (lines) | after |
|---|---|---|
| lib/document-templates.ts (`fillPreviewData`) | 12.5% | 100% |
| lib/fhir/document-template-service.ts | 0% (no test) | 100% |
| lib/fhir/document-service.ts | 60% | ~80% (create happy path left out: needs tenancy mocks) |
| lib/clinical-documents.ts | 98% | 100% |
| lib/fhir/task-reminder-service.ts | 0% | ~99% |
| lib/fhir/communication-service.ts | 0% direct | ~72% (Twilio paths left out: Task 680) |

Line coverage already showed 100% for `time-chit-guard.ts` / `signed-document-note.ts` / `time-chit.ts`, but branches (clinic scope on delete path, non-object JSON, overwrite of client `tcHours`, multi-chit validation, duplicate matching in lock) were untested.

## New files (tests/unit)
- `task682-signed-document-lock.test.ts` — Time Chit guard (403 without clinic when only an *existing* chit is touched, 409 on bad/null/array JSON, server-derived `tcHours`/`kind`), `signedDocumentMutationError` (key order, duplicates, void with/without reason, re-void, void+reissue, deletion), kind detection, `buildSignedDocumentNote`.
- `task682-document-templates.test.ts` — per-clinic template read/save (identifier search, fallbacks, other extensions preserved, missing org), preview data, referral body, MC diagnosis block / MMC / signature, DocumentReference update/delete/list clinic containment.
- `task682-follow-ups.test.ts` — follow-up update/open/delete 404 for foreign/untagged and 403 without clinic, status mapping, `getAllFollowUps` scoping, source-dedupe never crosses clinics, WhatsApp phone/url/message helpers, reminder-task mapping and sorting.

## Findings (no production code changed)
No real bug found that needs a fix. Observations:
1. `fillDocumentTemplate` substitutes sequentially, so a value containing `{{otherKey}}` is expanded by a later key (characterised in a test). Output stays HTML-escaped, and the hidden MC diagnosis is blanked before substitution so nothing leaks; `fillTimeChitTemplate` is single-pass. Cosmetic inconsistency, left alone.
2. `getPatientFollowUps` (communication-service) has no clinic filter. It currently has no callers, so no exposure; if it gains a caller it must be given a clinic filter.
3. `/api/follow-up/[id]` checks ownership via the clinic *extension* while the service layer checks the clinic *identifier*; both are required to match for the happy path, so it is safe (defence in depth), but they could drift.
4. Baseline has 2 pre-existing unit failures unrelated to this task (`clinic scoping on checkout and invoice reads … void/delete of another clinic's invoice`, `generateSlotsForSchedule … another clinic`). Same 2 fail on the base commit before my files were added.

Avoided: `app/api/follow-up/twilio/status` (Task 680) and anything under Tasks 674/676/678.
