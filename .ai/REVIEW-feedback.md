# Self-review: Task 210 in-app Feedback

## What shipped
- `feedback` clinic module (default off; `KNOWN_BRANCH_MODULE_IDS`, toggle-only `modules/feedback/module.config.ts`, no nav entry, sidebar untouched).
- Slim bar above `{children}` in `app/(routes)/layout.tsx`, rendered only when the module is on. Off = original markup, so the composer is untouched by default.
- `components/feedback/feedback-control.tsx`: Bug vs Feature request, optional screenshot, auto page/browser/viewport/last error (`lib/feedback/last-error.ts`).
- `POST /api/feedback`: session + clinic auth, module gate (404 when off), 5/min rate limit, server-side sanitisation, clinic taken from the session (never the client).
- Bugs -> GitHub issue on `Iatrum/UCC` (`GITHUB_FEEDBACK_TOKEN`, optional `GITHUB_FEEDBACK_REPO`), labels `bug` + `from-feedback-form`, body tells triage to reproduce with fake data only, else `needs-info`. No token / GitHub error -> sanitized `Basic` record with status `queued`.
- Feature requests -> `Basic` per (clinic, normalized title key) with a `requester` extension per distinct staff member (hashed) = requester count.

## PDPA decisions
- Free text: regex redaction of IC, email, phone, 6+ digit runs, ID-like tokens, UUIDs, labelled names ("patient name: ..."), honorific names, bin/binti names. Page is reduced to a route shape (`/patients/:id`), UA to "Chrome 126 / Linux", error to <=6 lines. Best effort: an unlabelled, un-honorified name in prose can slip through, hence the dialog warning.
- Screenshots cannot be scrubbed. They are never sent to GitHub, require an explicit "no patient information" confirmation, are validated (PNG/JPEG magic bytes, <=1 MB) and kept as a Binary on the clinic-scoped record only.
- Requester identity stored as sha256(clinic:profile) prefix, not a profile id.

## Limits / follow-ups
- Dedupe is per clinic (clinic data stays separate) and exact on normalized tokens, not semantic. The weekly report must aggregate across clinics with the admin client, or accept per-clinic counts; not built here.
- `GITHUB_FEEDBACK_TOKEN` must be set on the deployment (fine-grained, issues:write on Iatrum/UCC only). Not set anywhere in this branch.
- Queued bugs have no retry job yet.
- Screenshots use Medplum Binary, not Firebase Storage (Firebase untouched).
- In-memory rate limit is per process.
- Last-error capture starts when the control mounts, so errors before the first load are missed.

## Gate results (dev server :3218, fresh worktree, fake data)
- `bun run lint`: pass. `bun test tests/unit`: 49 pass. `build:ci` (Node 22): pass.
- `e2e/tests/feedback.spec.ts`: 3/3 pass (toggle off = no control + API 404; feature request stored once, repeat not double counted, PII scrubbed; bug queued sanitized, screenshot confirmation enforced).
- Full e2e (`--workers=1`): 35 passed, 11 failed, 8 not run. No `/workspace` baseline exists on this box, so compared with the previous gate on `dev` (~/ai-logs/u1b-lab-gate): the same 10 specs failed there (clinic-isolation, staff-membership, draft-retention, poct:100, save-state x5, time-chit), the save-state ones partly on hardcoded `/workspace/...` screenshot paths. New vs that gate: `workflow 03 check-in -> queue` (and the 8 dependents did not run). It fails identically with `app/(routes)/layout.tsx` reverted to `origin/dev`, so it is not caused by the layout change; cause not found (blank page, dashboard row never appears). Treat as unresolved until re-run on a clean `dev` baseline.
- Composer: default-off clinics render the original markup. With the module ON the bar takes ~33px of height above `<main>`; not visually verified against the composer.
