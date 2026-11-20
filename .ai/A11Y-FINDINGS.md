# Accessibility findings (Task 771)

Scope: login, dashboard queue, patients list, patient profile, appointments. Dev, fake data only.
Method: axe-core and `@axe-core/playwright` are **not** in devDependencies, so this was a manual pass: code read
for labels, button names and contrast, plus one Playwright DOM audit (unlabelled inputs, nameless buttons/links)
against a single dev server on :3771. Composer, sidebar and nav were not touched.
The patient profile files are edited by other open PRs (#354, #359, #361), so they were reviewed but not changed.

## Fixed in this PR
| # | Where | Issue | Fix |
|---|-------|-------|-----|
| 1 | Patients list search box | Placeholder only, no accessible name | `aria-label="Search patients"`, search icon `aria-hidden` |
| 2 | Queue table row menu (`components/queue-table.tsx`) | Icon-only button had no name | `aria-label="Actions for <patient>"`, icons `aria-hidden` |
| 3 | Appointment detail status select | Select trigger had no name | `aria-label="Appointment status"` |
| 4 | Patients list load error | `text-red-500` on white is about 3.8:1 (below AA 4.5:1) | `text-red-700` |
| 5 | Login "not assigned to this clinic" banner and patients "Loading..." | Not announced to screen readers | `role="alert"` and `role="status"` |

## Verified OK
Login email/password have `<Label htmlFor>` and `autocomplete`. Patients pagination buttons have text.
Dashboard refresh button already has `aria-label`. `--muted-foreground` is about 4.8:1 on white.
Live DOM audit: no unlabelled form controls on login, dashboard, patients or appointments.
The live audit found no queue rows (empty fake queue), so fix 2 was checked by code review only.

## Deferred (not changed, with reason)
- Sidebar collapse chevron button (`h-14 ... justify-between` header) has no accessible name on every page. Sidebar/nav is out of scope; fix there with `aria-label`.
- `components/ui/table.tsx`, `calendar-view.tsx`, `upcoming-appointments-table.tsx`, patient profile workspace: other open PRs edit them. Re-check after those merge.
- Full keyboard focus-order and colour-contrast sweep of the patient profile tabs needs axe-core. Suggest adding `@axe-core/playwright` as a devDependency.
