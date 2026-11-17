# Review: PR #272 (Task 418 UX audit), reviewed in Task 419

Head reviewed: `7a21a8e` (branch `ai/task-418-ux-audit`, base `dev` at `e6c8278`). Reviewer: Claude, 2026-11-17. Code only read, no dev server.

## Verdict: CHANGES REQUIRED (small, docs-only fixes)

## Checks
| Check | Result |
|---|---|
| Docs only | PASS. Only `.ai/BACKLOG.md` and `.ai/UX-FINDINGS.md` changed. |
| Secrets / real data / screenshots | PASS. No tokens, passwords, NRICs, emails or images in the diff. Screenshots are stated to be kept outside the repo. |
| No sidebar/nav changes | PASS. No code touched. Finding 2 and 19 only describe nav label/polish issues, and the file says it asks for no nav changes. |
| No new POCT features | PASS. Findings 12-14 are wording/loading-state fixes and explicitly keep "online only, no manual results". Lab/POCT results stay in the Lab tab. |
| Base claim (`origin/dev` = `e6c8278`, Task 358/402 not on dev) | PASS. `477056c` is not an ancestor of `origin/dev`. |
| Severities | Sensible. Findings 1-3 (money/clinical misread) as High are fair. Finding 3 could arguably be Med, since search still finds patients, but keep. |

## Spot-checked file pointers (11 checked)
- #1 `dashboard/page.tsx` `loadConsultations` swallows errors (console.error only); "No billable consultations found" at `billing-table.tsx:85`. ACCURATE (the audit says `:84`, now `:85`; the `98-108` range is about right).
- #3 `patients/page.tsx` `getAllPatients(200)`; `analytics/page.tsx:19` uses 300 and `:116` "Total patients". ACCURATE.
- #4 `billing-table.tsx` name is a `Link` with only `text-primary hover:underline`, rows are not clickable. ACCURATE.
- #5 `billing-table.tsx:25` "Meds & Bills". ACCURATE.
- #6 `patient-profile-workspace.tsx` empty state "No consultation history yet" plus Start consult button. ACCURATE (the line is about 953-957).
- #8 `patients/[id]/page.tsx:183` "Last completed visit". ACCURATE.
- #9 `inventory/page.tsx` low-stock alert joins all names with ", ". ACCURATE.
- #10 `new-patient-form.tsx` "Invalid phone number" and `gender` enum with no custom message. ACCURATE.
- #12 `poct-section.tsx:64-65` "No analyser" next to "Checking…". ACCURATE.
- #13 `poct/page.tsx:50` raw `order.status` shown uppercase. ACCURATE.
- #17 `checkout/[consultationId]/page.tsx` takes `patientId` only from `searchParams`. ACCURATE.
- #15 **INACCURATE**, see below.

## Findings
1. **Finding 15 is wrong about "Remove from Queue".** `components/queue-table.tsx:247-262` already shows an AlertDialog ("Are you sure you want to remove … This action cannot be undone."), and the menu item at `:365-372` only sets `pendingRemovePatient`. Reword to say only that "Mark as Complete" (`queue-table.tsx:362`, `handleCompleteConsultation` at `:140`) has no confirmation, or drop the finding if that is judged acceptable. Also name the file (`components/queue-table.tsx`) instead of "dashboard queue table".
2. **Vague pointers in #2, #18 and #7.** #2 says "nav auth label component (see `components/` sidebar)", #7 says "history table" and #18 gives no file. Add exact paths (for #18 the `app/api/consultations` route). This matters because the audit is meant to be actionable without redoing the search.
3. **Minor line drift.** #1 cites `billing-table.tsx:84` (now `:85`), and #6 cites `:954`. Harmless, but add "(approx.)" or re-pin to the reviewed commit.
4. **#16 and #18 are unverified by the author's own admission.** Keep them, but mark them "UNCONFIRMED" in the heading so they are not triaged as facts.

Non-blocking: BACKLOG line is long but fine; the "Working well" section is useful.

Once 1 and 2 are fixed this is an APPROVE.
