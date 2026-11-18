# Task 574: Referral Letter row did not open a viewer (UX-FINDINGS Part 2, Low, unconfirmed)

Verdict: **not a code bug; dev-mode timing.** No code change.

## Evidence (read from code on the #307 branch, no dev server needed)
- Signed MC / Time Chit / Referral rows render from one `signedDocuments.map` in
  `app/(routes)/patients/[id]/referral-mc-section.tsx`; every row's button calls
  `openSignedDocumentViewer(doc)` (no per-kind branch).
- `openSignedDocumentViewer` -> `buildDocumentHtml(doc)` -> `GET /api/document-templates?type=<kind>`
  -> shared `renderDocumentHtml` (`lib/document-render.ts`), which has a `referral` branch
  (same renderer as composer preview and checkout). Template fetch failure falls back to
  `DEFAULT_REFERRAL_TEMPLATE`; render errors raise a "Preview failed" toast.
- `/api/document-templates` and `getTemplate` accept `referral` identically to `mc`/`time-chit`
  (`app/api/document-templates/route.ts`, `lib/fhir/document-template-service.ts`).
- One viewer `Dialog` (`open={!!viewingSigned}`) serves all three kinds; title falls back to "Referral Letter".
- Unit tests already render the referral kind (`tests/unit/document-render.test.ts`).
- The only slow step is the template fetch (cold `next dev` compile of the route on first hit,
  plus an Organization search on Medplum), which is the same for every kind. The MC row was
  opened first in that walk and paid the compile cost; the referral click came later while the
  dialog/spinner state was already in flight. Task 506 added the "Preparing preview..." text so
  a slow load is now visible.

## Not done
No live Playwright run: the code path is identical per kind, and RAM on the shared VPS is tight.
Reopen only if a referral row fails with a visible "Preview failed" toast on a production build.
