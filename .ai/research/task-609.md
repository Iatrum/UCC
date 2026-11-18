# Task 609 — time-chit.spec.ts:128 returned 409 instead of 200

## Finding
Baseline failure: reproduced on plain `origin/dev` (51b9a58) with one dev server — same failure at the same line.
Not an app bug; the spec was stale.

## Root cause (server log, not guessed)
`[PATCH /api/consultations] Conflict: Signed documents cannot be edited or deleted. Void the document and issue a new one.`
Path: `PATCH /api/consultations` -> `updateConsultationInMedplum` (lib/fhir/consultation-service.ts) ->
`signedDocumentMutationError` (lib/clinical-documents.ts, added by Task 549) -> `ConflictError` -> 409 (`handleRouteError`).
Not a version/ETag conflict, not a stale encounter, not the clinic check (clinic scope and `assertTimeChitMutationAllowed` passed).

At line 128 the spec had already signed the Time Chit through the composer, then PATCHed the encounter with the
unsigned template `line()` (`tcHours: '999'` etc.). That differs from the stored signed note, so it is an edit of a signed
legal record, which Task 549 intentionally refuses (only unchanged keep, reissue, or void transition are allowed).
The line predates Task 549 and tested "a stale legacy `time-chit` module id no longer blocks writes".

## Fix (spec only; no app or clinic-isolation change)
- Re-send the saved procedures unchanged (GET then PATCH) -> 200: still proves the legacy module id does not block writes.
- PATCH with the edited `line()` -> 409: documents the signed-document immutability.
- PATCH replaces Procedure rows (new ids), so the old `readResource(resource.id)` check was replaced by a search asserting
  exactly one unchanged signed Time Chit remains.
No new unit test: app behaviour is unchanged (the rule is already covered by unit tests of lib/clinical-documents).

## Env note
Worktrees symlink node_modules, so Turbopack refuses to start; use `next dev --webpack`.
