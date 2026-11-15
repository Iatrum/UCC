# Task 160 self-review

Scope: unsigned note/diagnosis and composer draft persistence. No sidebar/nav layouts, Lab/POCT result placement, Firebase Storage or device-order gates changed.

- Clinical draft text remains on authenticated Medplum; no localStorage/sessionStorage writes. Attachment base64 is encoding, not encryption.
- Draft keys bind authenticated clinic/practitioner to patient/visit; reads verify explicit identifiers, author and subject. Every new draft has a clinic identifier. Acting-client writes preserve Phase 2 compartment enforcement; no privileged draft writes or policy deployment.
- Version preconditions protect updates and note cleanup from stale windows. Notes serialize in-flight edits; composer mutations queue and Sign waits for pending writes. An empty Tiptap paragraph is normalized to an empty note.
- Hydration/pending/failure/retry states remain explicit. Load failure cannot fabricate a server save. Pending/local-only work has unload and in-app link/back guards; closing a failed treatment panel requires confirmation. Successful sign resets stale guards.
- Successful note signing with failed cleanup has a separate status and cleanup retry, with Sign disabled. Signing and draft cleanup are separate requests, so an interrupted cleanup may require retry. Cleared drafts are superseded/emptied in the active version; FHIR audit history is preserved.
- Practitioner privacy is enforced by the application draft API; the existing Phase 2 direct-FHIR policy enforces clinic compartments, not private author-only access within a clinic. Historical Firestore drafts are not migrated in this local-only task; Firebase Storage remains unchanged.
- Verified before/after screenshots, 4 retention tests, 7 save-state tests, clinic-policy integration, 34 unit tests, lint and full tsc. Workflow has only baseline summary failure. Full-gate results will be appended to progress.
