# Review of Task 746 (phone layout: Settings, Admin, Appointments, Analytics, Inventory) — Task 747

Verdict: **APPROVE after one fix** (pushed on the same branch).

## Scope checks
- Diff touches only class names in 9 files (`app/(admin)/admin/{clinics,organisation,settings,users}/page.tsx`, `app/(routes)/{inventory,settings}/page.tsx`, `components/analytics/analytics-dashboard.tsx`, `components/appointments/calendar-view.tsx`, `modules/appointments/pages/appointments-root.tsx`) plus notes/screenshots. No sidebar, nav, admin rail, layout shell, composer, Lab/POCT or X-ray file changed.
- No FHIR/Medplum/Next API touched, so no API research needed beyond the CSS notes in `.ai/research/task-746.md`.

## Desktop-unchanged review (class by class)
- `min-h-10 sm:min-h-0`: phones only (buttons are already h-11 below `md`, so this mostly guards the raw `<button>`s).
- `grid-cols-1` base, `min-w-0`, `flex-wrap`, `gap-*`: only act when content is too wide; on wide screens no wrapping occurs. `sm:truncate` keeps the old ellipsis from `sm` up.
- Analytics tab/range bars: `grid` below `sm`, `sm:inline-flex` restores the previous flex layout; `sm:px-3` equals the old padding.
- **Found and fixed:** admin Settings "Create Medplum client credentials" button had `h-auto min-h-9` at every width. The `sm` button is `md:h-8` (32px), so desktop grew to 36px. Now `h-auto min-h-11 whitespace-normal text-left md:min-h-0` (44px on phone, original 32px from `md`).

## Evidence (ONE dev server, :3747, `next dev --webpack`, heap 3072, killed after; dev Medplum :8113, fake data)
- Pixel comparison, base `737cbd8` vs this branch, full-page, doctor session, 1440x900 and 1024x768: `/settings`, `/analytics`, `/inventory` identical; `/appointments` identical at 1440 and 2 bytes apart at 1024 (probably a clock/"now" marker; not inspected further).
- Admin pages need the admin login, so they were reviewed by class (above), not by pixels; the one desktop regression was found this way.
- Phone 390x844 touch, PR code: page overflow 0 and no button/link/tab past the right edge on Settings, Appointments (calendar view), Inventory, Analytics.
- `e2e/tests/admin.spec.ts` (UCC_ADMIN_E2E=1): 10 rows BROKEN (create organisation/clinic/user, client-credentials validation and the rows that depend on them; `waitForResponse` timeouts on form submits). **The same 10 fail with the unchanged `origin/dev` UI files on the same server**, so not caused by this PR. module-toggle and dashboard-load-errors passed.
- Not run: full `check-all.sh` (build + whole suite): class-only change, RAM shared with production.

## Follow-ups (not blocking)
- Find why the admin create forms' POST never fires in this dev env (baseline fails too).
- Admin detail pages and Appointments detail were not walked in Task 746 either.
