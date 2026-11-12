# Task 100 — Phase 2 prerequisites

2026-11-11: In progress on ai-work. Read AGENTS, STATE, plan, prior self/independent review, progress, research, D33-D36 and backlog. Pre-existing STATE addition, bun.lockb edit, deleted gitlink and untracked notes retained. No migration/backfill or production access.

- Research: SDK/fhirtypes 5.1.13; local server 5.2.15. Official tagged docs/source inspected. Per-request headers supported via MedplumRequestOptions (RequestInit).
- Fix (a): implement policy write containment plus order-service ownership validation; verify with disposable fixtures only. Provenance target authorization must also be covered.
- Fix (b): scoped extended reads and propagation regression.
- Pending: focused e2e, self-review, final single full gate, two fix commits, dev-based worktree/cherry-pick, draft PR and live mergeability.

2026-11-12 resume: preserved WIP and unrelated files. Confirmed sole dev server serves this checkout, heap cap 3072 MB. Reviewed independent review and saved versioned sources. Fixed WIP FHIRPath union evaluation; focused regression still being completed before fix-(a) commit. Only disposable fixtures changed.

2026-11-12 user-requested checkpoint after box pause: removed temporary fetch/console diagnostic code. Committing Task 100 WIP before continuing. Fix (a) is NOT yet passing: Observation foreign-create denial and multi-clinic positive probes pass; same-clinic createLabOrder still returns 403. Fix (b) extended receive reads still pending. Focused attempts and local login-throttle failures preserved under /workspace/ai-logs/task-isolation-2-write-focused*. No full gate run yet.

2026-11-12 fix (a) milestone: focused write-final PASS 1/1 (5.2s); same-clinic raw/SDK lab+imaging creates, multi-clinic union, spoofing, mixed/unattached accounts, update/reparent denial, Provenance target checks and original Phase 1 regressions pass. Root cause of SDK-only 403 was extendedMode default true plus project-superAdmin accepting meta.profile as authoritative metadata. CREATE strips top-level meta; UPDATE preserves original meta and rejects changed Patient-reference sets. Research and D37 corrected. Policy not installed globally; future rollout must refresh old multi-clinic union parameters first. Committing this passing milestone now.

2026-11-12 fix (b) milestone: propagation-focused-r2 PASS 1/1 (4.8s test, 1.2m total including login cooldown), lint PASS. Three read-reuse sites now use explicit per-read extended/no-cache options. Disposable regression primes plain-read caches on an extendedMode:false client, receives lab/ImagingStudy/report from stamped orders for an unstamped fake Patient, verifies all result + Provenance accounts and staff visibility, and proves the Patient stays unstamped. Filled required audit actor from authenticated profile when automated callers supply none. No global client/header changes.

Integration note: origin/dev contains newer POCT/X-ray/module-toggle suites absent from ai-work. The SINGLE final full gate will run on the dev-based publication worktree after task-only cherry-picks, using the sole :3210 server there, to validate those current features. No full gate run yet.
