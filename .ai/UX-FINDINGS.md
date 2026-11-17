# UX findings: Task 418 audit (2026-11-17)

**How this was done.** `origin/dev` at `e6c8278`, one dev server (`next dev --webpack`, port 3418, killed afterwards), dev Medplum `:8113`, fake data only, logged in as the local test doctor. Playwright screenshots (kept outside the repo; none show secrets). Walked: login, patient list, registration (empty + filled), check-in, queue, start consult, notes, diagnosis, Sign, Treatment composer (observed only), Labs & Imaging, Billing list, checkout, Inventory, Settings, Catalogs, POCT, PACS, Analytics, Follow-up, Records, Tasks, `/admin`.

**Not covered (say so plainly):**
- *Dispensing auto-deduct at checkout:* the code (`MedicationDispense`, Task 358/402, commits `477056c`..`46488f8`) is **not on `origin/dev`**, so there was nothing to walk. Checkout shown here is the current dev one.
- *Purchases, MC/referral, `/admin` pages:* purchases list is empty on this DB (no PO to inspect); MC/referral not exercised end to end; `/admin` redirects the clinic doctor to `/login?error=admin_required` (correct), but my screenshot of it was blank (captured mid-load), so admin screens are unverified. Admin has its own Playwright spec (`UCC_ADMIN_E2E=1`).
- *Lab/POCT result display in the Lab tab:* no result arrived for the fresh fake patient, so only the empty state was seen.
- Timings are from `next dev` (first-hit compile) and overstate production slowness; they are not benchmarks.
- No code was changed. Sidebar/nav is untouched; nothing below asks for nav changes.

Severity: **High** = can mislead staff on money or clinical flow; **Med** = confusing/wrong-looking; **Low** = polish.

## High

1. **Dashboard "Billing" tab says "No billable consultations found" when one exists.** The Billing & Documents page (`/orders`) listed the just-signed fake patient, but the dashboard Billing tab was empty. The dashboard fetch (`/api/orders/billable`) swallows failures (`console.error` only, no error state), so a slow or failed load looks like "nothing to bill". Staff could think a patient was already billed. Fix: add loading and error states with a Retry button, same pattern as the queue, which already says "Queue is taking too long to load." Files: `app/(routes)/dashboard/page.tsx:98-108` (also `loadAppointments` at ~:82), empty text in `components/billing/billing-table.tsx:84`.
2. **Dashboard queue sits on "Loading queue..." and the nav shows "Login" instead of "Logout" at first.** Right after check-in the dashboard showed the success toast but the queue stayed on "Loading queue..." (first paint, dev mode). While the session resolves, the bottom of the nav reads "Login" for a signed-in user. Console showed `Failed to fetch` for queue, appointments and consultations when navigation interrupted them. Fix: keep the previous list while refetching, show the signed-in state (or a neutral placeholder) until the session is known. Files: `app/(routes)/dashboard/page.tsx:40-75`, nav auth label component (see `components/` sidebar).
3. **Patient list total is capped at 200, Analytics says 300.** Patients page: "Total Patients 200 / New Patients 200 this month". Analytics: "Total patients 300". Staff will not know which to trust, and patients beyond the first 200 may not be findable except by search. Fix: use a real count (or label "200+") and paginate or search server-side. Files: `app/(routes)/patients/page.tsx:52-70`, `app/(routes)/analytics/page.tsx:116`.

## Medium

4. **Billing list: patient name does not look clickable.** The only way into checkout is the name link, but it is styled like plain text, and the subtitle says "Select a patient". Clicking the row did nothing in the test. Fix: make the whole row clickable and/or add an "Open checkout" button. File: `components/billing/billing-table.tsx:70-77`.
5. **Status badge "Meds & Bills".** Not self-explanatory; it means "waiting to be billed". Suggest "Ready to bill". File: `components/billing/billing-table.tsx:25`.
6. **Consultation history is stale right after Sign.** After signing, the history panel still said "No consultation history yet. Start consult" and kept the Start consult button; the row only appeared after the workspace closed or the page reloaded. Also the panel shows a Start consult button while the consult drawer is already open. Fix: refresh history when Sign succeeds; hide the empty-state button while a draft is open. File: `app/(routes)/patients/[id]/patient-profile-workspace.tsx:954` (read only; composer code was not touched).
7. **Consultation history table is cut off on the right.** When the drawer is closed the Actions column ("A…") and its second button are clipped, with no horizontal scroll. Fix: allow `overflow-x-auto` or reduce column widths. File: same workspace file, history table.
8. **"Last completed visit" and "Total visits 1" change at Sign, before checkout.** A signed but unbilled consult counts as a completed visit. Fix: label "Last consult" or count only completed visitations.
9. **Inventory low-stock banner is a wall of text.** 29 item names in one paragraph. The tiles also double count: "Out of stock 29" and "Order soon 29" are the same items (out of stock ⊂ at or below threshold). Fix: show the first 5 names plus "and 24 more" (link to the Order soon filter), and make "Order soon" exclude out-of-stock. "3 inventories / 29 inventories" would read better as "3 items". File: `app/(routes)/inventory/page.tsx:165`.
10. **Registration validation wording.** Empty submit shows "Invalid input" under Gender and "Invalid phone number" for an empty phone. "Date of Birth" shows an error but has no asterisk, though NRIC auto-fills it. Fix: "Select a gender", "Enter a contact number", and mark DOB optional (or required). Files: `app/(routes)/patients/new/new-patient-form.tsx:24` (and the `new-v1` copy).
11. **Analytics is slow and clips a label.** About 27 s on first load in dev, and the age bar label "30…" is cut at the card edge. Fix: skeleton while loading, more right padding on the chart. File: `app/(routes)/analytics/page.tsx`.

## Low

12. **POCT rows in the composer can show "No analyser" next to "Checking…".** While analyser status is loading, an unmatched test reads as both. The Add button is correctly disabled, and "Only online, connected analysers can be ordered. No manual results." is clear. Fix: hide the device name until loading ends. File: `components/orders/poct-section.tsx:64-65`. No new POCT features suggested. **Addressed in Task 486 (wording only).**
13. **POCT page lists pending tests as "ACTIVE" and some rows have a blank date ("—").** Staff expect "Pending"/"Waiting for analyser". File: `app/(routes)/poct/page.tsx:50`. **Addressed in Task 486 (wording only).**
14. **Labs & Imaging: `/api/labs/subscription` returned 503** (live results feed unavailable in dev). The page works but there is no "live updates off" hint; staff must press Refresh. Files: `app/(routes)/api/labs/subscription/route.ts`, `lib/poct/live-results.ts`.
    **DONE (Task 476):** quiet "Live updates off – press Refresh" hint in the Lab tab status line.
15. **Queue row menu has "Mark as Complete" and "Remove from Queue" next to "Start Consultation" with no confirmation seen.** Easy to hit by mistake. Fix: confirm dialog for Remove. File: dashboard queue table.
    **DONE (Task 476):** Remove already had a confirm on dev; added one for Mark as Complete.
16. **Checkout with no items.** An empty invoice (RM 0.00) still shows "Submit e-Invoice" and "Complete visitation". Not confirmed whether they are enabled. Check whether Complete should warn "no billable items". File: `app/(routes)/orders/checkout/[consultationId]` client.
17. **Checkout needs `?patientId=` in the URL.** Opening `/orders/checkout/<id>` alone shows "Missing checkout patient or consultation reference." (bookmarks and shared links break). Fix: look the patient up from the consultation. File: `app/(routes)/orders/checkout/[consultationId]/page.tsx:15-20`.
18. **`/api/consultations?recent=` returns rows with empty `patientId`, `chiefComplaint` and `diagnosis`.** Probably thin summaries or old fake consultations, so check before any UI relies on it.
    **DONE (Task 476):** two real mapping bugs fixed (patientId fallback to subject; child searches truncated at 20). See `.ai/research/task-476.md`.
19. **Sidebar polish.** "Appointments" label touches the collapse arrow, and the dev-only Next badge overlaps "Logout" (dev only, ignore). "Tasks" and "Records" show "not enabled for this clinic yet" with a Back button, which is fine.

## Working well
- Registration: NRIC fills date of birth and age; duplicates are rejected; the post-register jump to check-in is smooth.
- Check-in form is clear (priority, vitals optional, complaint required). The toast "Check-in complete" is reassuring.
- Queue shows number, complaint, visit context and status; row actions are logical.
- Composer: "Draft saved (server) — unsigned" is visible; Treatment tab shows POCT/X-ray rows with analyser state, price and the "no manual results" note; Lab/POCT results stay on the Lab tab with an empty state ("No laboratory tests have been ordered...").
- Checkout layout is clean (patient, items tabs, totals, preview, payment).
