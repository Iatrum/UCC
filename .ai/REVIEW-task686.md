# Review of Task 686 (PR #338) — Task 687

Fresh worktree, production build (`next build --webpack`), dev Medplum, fake data, ~400 kbps / 400 ms RTT.

- Patient list (stalled search, offline blip), analytics (stalled tab, offline blip), appointments (stalled), settings template editor (load failure + Retry), MC viewer (stalled template, stalled organization) all reproduce the PR's "after" behaviour.
- **Found + fixed:** the MC viewer called `resolveOrganizationDetails` with the default fetcher, which swallows failures into `null`. If the organization load failed/timed out, the document rendered with a blank letterhead instead of error + Retry (the PR notes claimed Retry for the organization read). Viewer now passes a strict fetcher (15 s timeout, throws on non-OK); `null` from a successful response (clinic without organization) is still valid.
- Composer: offline save -> "Failed to save", item kept, Retry -> "Saved (server)", exactly 1 POST.
- Normal network (warm, median of 6): patients 553, analytics 464, settings 578 (noisy, runs 434-1297), documents tab 1093, appointments 458 ms; same range as before/after in the PR.
- tsc clean; `bun test tests/unit`: 1037 pass, 2 fail (both clinic-scoping tests, same as origin/dev per PR).
- Not changed (pre-existing, noted): a non-OK template response in the viewer still falls back to the default template; appointments shows the empty-state text beneath the timeout error.
