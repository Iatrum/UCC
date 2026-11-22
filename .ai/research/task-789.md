# Task 789: UX audit (dispensing, documents, lab result, /admin) + 3 small fixes

- Baseline: `origin/dev` @ `239510c`. Own worktree `/home/dev/ucc-task-789`, one `next dev --webpack -p 3789` (NODE_OPTIONS 3072 MB), killed by process group afterwards. Dev Medplum :8113, fake data only (`Audit789 ... Fake`, fake analyser Device deleted after use).
- Open PRs checked with `gh pr list --state open --json files`: they edit `inventory/page.tsx`, `admin/clinics|organisation|settings|users`, `patients/[id]/patient-profile-workspace.tsx`, `referral-mc-section.tsx`, `components/ui/table.tsx`, `patients/page.tsx`, `settings/page.tsx`. Those files were NOT changed; findings on them are document-only.
- Changed: `components/labs/lab-results-view.tsx` (min-w-0 root, empty-state wording), `checkout-client.tsx` `TreatmentRows` (phone column widths). No composer, sidebar/nav, POCT, X-ray toggle files.
- CSS reference: a grid item's automatic minimum size is its min-content width, so a one-column implicit grid grows with a wide table unless the item has `min-width: 0` (CSS Grid Layout Module Level 1, "Automatic Minimum Size of Grid Items"; Tailwind `min-w-0`).
- Checks: `tsc --noEmit -p tsconfig.lint.json` clean; eslint on both changed files clean; unit tests for checkout/labs 59 pass, `task458-checkout.test.ts` fails with and without the change (`withSignLock` export missing from `lib/fhir/consultation-service.ts`, pre-existing on dev); e2e `lab-results-state.spec.ts` + `dispense-checkout-ui.spec.ts`: 10 passed, 1 skipped.
- Screenshots: `.ai/ux-shots/task789/`.
