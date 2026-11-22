# Task 760: UX-FINDINGS re-verification (2026-11-20, origin/dev @ 51805cf)

Method: read `.ai/UX-FINDINGS.md`; checked each Medium/High item against current code and a live dev walk (one `next dev --webpack` on :3760, dev Medplum :8113, fake data, killed afterwards). Walked at 1440 and 390 px: dashboard, patients, patient profile, check-in, POCT, inventory, analytics, billing list, checkout, appointments, follow-up, settings, catalogs. Page-level horizontal overflow was 0 everywhere. No official-API research was needed: changes are display-only (React/Next conventions already used in the files).

## Result on the Medium/High items
All Part 1-4 Medium/High items already carry a FIXED/VERIFIED mark with file evidence (Tasks 504, 506, 510, 545, 576, 583, 595, 718). Re-checked live: Billing "Open checkout" + "Ready to bill" (`/orders`), checkout shows "Assigned on completion", "1 tablet · stock 471", disabled "Submit e-Invoice" with "not available yet", inventory banner shows 5 names + "and 24 more", history table scrolls, header says "Last consult"/"Total consults". None regressed.
Analytics is in Malay (Ringkasan/Klinikal/...). That is deliberate (Task 551), not a finding.

## New still-real items found (not in the doc)
1. **Patient profile "Medical alert: None" with a green dot when no allergy was ever recorded** (reads as "no allergies"). Same class as Part 2 High 4. FIXED: "Allergies not recorded" (grey); explicit NKDA shows green "No known allergies".
2. **Check-in page shows a red "Medical Alerts: Allergies: No known drug allergies" banner** for a patient with an explicit NKDA entry (alarm for a non-alert). FIXED: the banner only appears for real allergies.
3. **Appointments tiles vs list contradict**: tiles said "Total 8 / Active bookings 8" while the list said "No upcoming appointments yet" (tiles count past bookings, the list shows future ones only). FIXED wording in the list empty state only. Tile logic is in `appointments-root.tsx`, which open PR #354 edits, so it was not touched.

Shared helper: `lib/patients/allergy-status.ts` (`getAllergyStatus`), test `tests/unit/task760-allergy-status.test.ts`.

## Left open (Low)
Tables scroll sideways on phones with no hint (#33); dead purchasing panels; sidebar items (out of scope). Follow-up tab counts: the Sent tab shows no number when zero (by design).

## Overlap check
Open PRs #350-#357 touch none of the changed files.

## Checks
tsc (`tsconfig.lint.json`) clean; eslint clean on the 5 changed files; `bun test` allergy + profile-history: 7 pass. Playwright (single walk, wrapped in timeout): profile shows "Allergies not recorded", check-in has no alert banner, appointments shows the new text, overflow 0.
Before (1440): profile header showed green dot + "None". After: grey dot + "Allergies not recorded".
