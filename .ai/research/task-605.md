# Task 605 — Medical Certificate + Time Chit walk (normal clinic user)

Setup: worktree on `claude/task-589-pilot-walk` (PR #316) + `origin/dev` merge (already up to date), ONE `next dev --webpack -p 3210`
(heap 3072) against dev Medplum `:8113`, clinic "Klinik Bravo", fake data only, Playwright under `timeout`. User `doctor@ucc.local`;
`/api/auth/me` reports `isAdmin: false` (not superAdmin). Time Chit is always on (no toggle). MC and Time Chit share one template
renderer (`lib/document-render.ts`) and one Documents list (`referral-mc-section.tsx`).
Scripts: `task-605/walk605.spec.ts.txt` (full visit), `walk605b.spec.ts.txt` (MC reissue with opt-in diagnosis + Documents-tab race).
Screenshots: `task-605/*.png` (4 kept). Fake patients `Walk605 Fake <run>` remain in dev Medplum.

## Results

| # | Step | MC | Time Chit |
|---|------|----|-----------|
| 1 | Register, check-in + triage, start consult, note, diagnosis J02.9, Sign | PASS | (same visit) |
| 2 | Create in composer (dialog fields, live preview, no `{{token}}`/undefined/NaN) | PASS | PASS (1.5 h computed; out-before-in refused with "Time out must be after time in on the same day.") |
| 3 | Preview content: clinic, patient name/NRIC/DOB, doctor, MMC, dates | PASS (diagnosis hidden by default; shown only after "Show diagnosis on the MC"; 2 days → 18–19 Nov) | PASS (`TIME CHIT / SURAT MASA`, in/out/duration, "not a Medical Certificate" note) |
| 4 | Print from composer (`Print MC` / `Print Time Chit`) | PASS (hidden print iframe carries the rendered doc) | PASS |
| 5 | Edit before signing (reopen draft entry, values restored, change, complete) | PASS | PASS (10:30 → 11:00, duration updates to 2 h, saved) |
| 6 | Sign treatment → Procedure (category documents, `clinic` identifier); server-side hours | PASS | PASS (`tcHours` = 2 from 09:00–11:00) |
| 7 | Patient history: Documents tab lists both with date/status; preview; Print / Save PDF | PASS | PASS |
| 8 | PDF (Chromium `page.pdf`, A4, print CSS) of the rendered document | PASS, 1 page | PASS, 1 page |
| 9 | Edit a signed document via API (`PATCH /api/consultations`, changed notes) | 409 | 409 ("Signed documents cannot be edited…") |
| 10 | Void in Documents tab (reason) → row marked Voided, preview shows VOID banner, Print disabled | PASS | PASS |
| 11 | Reissue: add a new MC / Time Chit from the Treatment tab of the same consult, Sign → Documents shows voided + new, only the new one prints | PASS (2 days, MMC, diagnosis opt-in) | PASS (09:00–11:30 = 2.5 h) |

"Edit" of a signed MC/Time Chit is by design void + reissue (legal record); editing is only possible on drafts before signing.

## Bug found and fixed (shared MC / Time Chit / referral path)
**Documents tab printed a blank letterhead when a document was opened before the organization fetch finished.**
`ReferralMCSection` loads `/api/organization` in an effect and `buildDocumentHtml` read the (still `null`) state at click time, so the
preview and the Print / Save PDF output had no clinic name/address/phone/logo (seen: `Tel: TIME CHIT / SURAT MASA …`). The composer and
checkout previews recompute reactively and were not affected. Fix: `resolveOrganizationDetails(current, fetcher)` in `lib/org.ts`
(use loaded state, else fetch) used by `buildDocumentHtml` and `buildLegacyReferralHtml`. Unit test `tests/unit/org-resolve.test.ts`.
Re-walked: immediate open of the Time Chit now shows `Klinik Bravo`.

## Observations (not changed)
- MC dialog labels ("No of days", "Start date", "Doctor's name", "MMC registration no.", "Diagnosis") are not associated with their inputs
  (`<Label>` without `htmlFor`), so `getByLabel` does not work for the MC dialog while the Time Chit dialog is labelled correctly. a11y only.
- Clinics with no phone configured print an orphan `Tel:` line (template, `{{clinicPhone}}` empty).
- Consultation History rows do not list MC / Time Chit; the Documents tab is the history for them.
- Time Chit preview iframe is `sandbox=""`; Chromium logs "Blocked script execution in about:srcdoc" in the console (no script is needed, harmless).
- `GET /api/auth/me` and `/api/auth/medplum-session` 401 before login (expected).

## Checks
`tsc --noEmit -p tsconfig.lint.json` clean; eslint on changed files clean; `bun test tests/unit` 734 pass / 0 fail. Full `check-all.sh` not run
(change limited to an org-fetch fallback in the Documents tab). Dev server on :3210 stopped.
