# Task 140 — Time Chit implementation

Worktree: `/workspace/ucc-pr-time-chit`; branch: `ai/task-time-chit`; base: `origin/dev`.
Local Next port: 3214, heap cap 2560 MB. Medplum: localhost:8113, fake fixtures only.

## Milestone 1 — implementation in progress
- Created requested worktree and cherry-picked plan commits 7753143 and 5f228ef.
- Read plan, mockup and implementation code; official documentation links recorded in research.
- Added off-by-default module, catalog handling, attendance validation, clinical mutation gates,
  clinic identifiers/account stamps, composer form/preview, checkout PDF, historical HTML print/edit,
  and editable clinic template. No sidebar/navigation or POCT/X-ray feature edits.
- Initial lint/type verification in progress; focused e2e coverage next.
- User explicitly authorizes milestone pushes and draft PR, overriding AGENTS.md remote prohibition.
- User explicitly prohibits the full suite: do not run check-all.sh (it runs the full suite and build).
  Run lint, typecheck, relevant Time Chit + document/MC tests individually with outer timeouts.
- Milestone 1 checks: `bun run lint` passed (includes TypeScript lint config + clinic admin guard).
  Detached Next server started on 3214; `/login` returned HTTP 200. Standalone typecheck running.

## Milestone 2 — focused validation
- Standalone `npx tsc --noEmit` passed.
- Initial focused attempt found an incorrect test selector: composer search had no placeholder.
  Added an accessible name and updated the spec to use it.
- Evidence: `/workspace/iatrum-ucc-evidence/task-time-chit`.
- Composer generation and MC/referral forms passed; corrected the test's checkout transition:
  existing Sign saves and closes the panel (does not navigate). Test now waits for the clinical
  save, then explicitly opens the existing checkout route as staff would from Orders.
- Added boundary tests: 5 pass, 17 assertions (date/time/doctor validation, default off, escaping).
- Time Chit creation now fails before writes if clinic tenancy/account cannot be resolved.
- Focused run confirmed clinical persistence and charge override at checkout; narrowed the print
  selector to exact "Preview" (the previous regex clicked the separate bill preview).
- Print action generated a PDF but headless Chromium left the popup at about:blank (PDF download
  behavior). Replaced that browser-specific URL assertion with capture of the actual PDF Blob,
  `%PDF-` header/size assertions and an exported `time-chit-checkout.pdf` evidence artifact.
- Focused spec PASS (28.1s): custom catalog price flows through composer to checkout; direct
  consultation creation and later replacement both have account stamps; all API gates, invalid
  fields, historical print, admin switch persistence/default-off and cross-clinic reads verified.
- Actual checkout PDF captured, extracted text checked and rasterized for visual review; it has
  attendance wording/times/duration, patient details, signature/stamp and no diagnosis/unfitness text.
- Existing workflow has serial prerequisites and an early draft read before its document step.
  Added opt-in UCC_LOCAL_DOCUMENTS_ONLY=1 to stub draft storage from page creation. Will run only
  steps 01–04 (setup), 06 (MC/referral composer) and 08 (documents), not the full workflow/suite.

## Milestone 3 — local validation complete

All requested focused checks passed; no full suite or check-all.sh was run, per the task's explicit scope.

- `NODE_OPTIONS=--max-old-space-size=2560 bun run lint` — PASS (TypeScript lint + admin-client guard).
- `NODE_OPTIONS=--max-old-space-size=2560 npx tsc --noEmit` — PASS.
- `bun test tests/unit/module-settings.test.ts tests/unit/time-chit.test.ts` — 8 PASS, 27 assertions.
- From e2e, UCC_BASE_URL=http://localhost:3214, NODE_OPTIONS capped at 2560:
  `timeout 20m npx playwright test tests/time-chit.spec.ts --workers=1` — 1 PASS (28.1s).
  Covers default off/client hiding, POST/PATCH/DELETE rejection, module on form and validation,
  custom-catalog pricing, checkout PDF bytes, both creation/replacement account metadata,
  invalid data rejected without removing existing records, disabled-module historical print,
  re-enabled edits, admin switch save/reload, fresh clinic default off, second-clinic app/FHIR denial.
  MC/referral forms also exercised with toggle off and on.
- From e2e, UCC_LOCAL_DOCUMENTS_ONLY=1 and the same local URL/heap cap:
  `timeout 20m npx playwright test tests/workflow.spec.ts --workers=1 --grep '(01 login|02 register|03 check-in|04 start|06 composer|08 documents)'`
  — 6 PASS (3.0m). Only document-related serial workflow and its setup; no full workflow/suite.
- Test-development corrections were selector/flow/headless-browser assumptions, documented above;
  no failed attempt was blindly looped. An initial anchored grep matched no tests; corrected the
  grep to match Playwright's full test titles before running the six selected steps.
- Logs: `/workspace/ai-logs/task-time-chit/{lint.log,typecheck.log,unit.log,e2e-time-chit.log,e2e-mc-regression.log}`.
- Reports: `/workspace/ai-logs/task-time-chit/{reports,mc-reports}`.
- Screenshots/PDF: `/workspace/iatrum-ucc-evidence/task-time-chit/`:
  `time-chit-toggle-off.png`, `time-chit-admin-toggle.png`, `time-chit-composer-preview.png`,
  `time-chit-historical-print.png`, `time-chit-checkout-pdf.png`, `time-chit-checkout.pdf`,
  `time-chit-printed-slip.png`; MC/referral images in `mc-regression/`.
  Headless embedded PDF viewer appears blank; exported PDF was rasterized and visually reviewed,
  and its attendance/date/time/duration/doctor/disclaimer content checked with pdftotext.
- Self-review: `.ai/REVIEW-time-chit.md`. Plain-language changelog, D38 decision and STATE updated.
- No sidebar/nav, POCT/X-ray, Firebase Storage, production or real-patient-data changes.
- Stopped only this task's detached process group (Next --port 3214). Post-shutdown curl returned
  HTTP 000; reserved worktree/server were not touched.

## Delivery

- Draft PR: https://github.com/Iatrum/UCC/pull/233 (`ai/task-time-chit` → `dev`).
- Final notes push initially rejected because remote commit 1c7f645 had added the same validation
  notes. Rebased only the unpushed documentation commit onto that remote tip, preserving its notes.
  No application code changed; no merge or force-push performed.
- `gh pr view 233 -R Iatrum/UCC --json mergeable,mergeStateStatus` returned:
  `{"mergeStateStatus":"DIRTY","mergeable":"CONFLICTING"}`. PR remains draft; no merge attempted.
- Task server :3214 confirmed stopped (no listening socket). Local validation complete.
