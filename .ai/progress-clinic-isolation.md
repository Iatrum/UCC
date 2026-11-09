# Progress — Task 090 clinic clinical isolation (Phase 0 + Phase 1)

Status: started 2026-11-09. Resume from here if interrupted.

## Plan
See `.ai/PLAN-clinic-isolation.md` phases 0-1, `.ai/research/clinic-isolation.md`, DECISIONS D33-D35.

## Checklist
- [x] Phase 0: disposable-identity script answering both questions (e2e evidence + research doc + decision) — PASS both, verdict D36: proceed to Phase 1. New write-side containment finding logged (BACKLOG, out of scope for Phase 1).
- [ ] Phase 1.1: Provenance added to UCC Clinic Staff Policy (setup-access-policies.ts)
- [ ] Phase 1.2: createProvenanceForResource optional clinicTenant param + ~9 call sites
- [ ] Phase 1.3: triage-service.ts 3 update paths stamp meta.accounts
- [ ] Phase 1.4: backfill-clinic-accounts.mjs (dry-run only, not applied)
- [ ] Phase 1.5: updatePractitionerFromMedplum re-derives access[]
- [ ] e2e: clinic-check.ts extended + clinic-isolation.spec.ts (phase-1-applicable parts)
- [ ] Gate task-isolation-1 (baseline 22/23+)
- [ ] REVIEW-task-isolation-1.md (self security review)
- [ ] CHANGELOG + STATE + commit on ai-work
- [ ] worktree /workspace/ucc-pr-isolation-1, draft PR ai/task-isolation-1 -> dev

## Notes / findings log
- 2026-11-10: Resumed after two dead sessions (API connection errors, almost nothing committed). Confirmed env: Medplum :8113 up, dev :3210 up, only uncommitted WIP was a partial `lib/fhir/provenance-service.ts` edit (optional `accounts` param on `createProvenance`/`createProvenanceForResource`, not yet wired to any call site or policy entry — safe, inert, additive).
- Phase 0 script written: `scripts/access-policy/test-clinic-policy-superadmin.mjs`. Had to run `bun scripts/setup-access-policies.ts` first — the real "UCC Clinic Staff Policy" was missing from this project (local Medplum restore on 8 Nov predates/lost it); idempotent upsert, same as every environment's setup, not a data change.
- Phase 0 PASSED both questions (full writeup in research doc + D36). Bonus finding: write-side cross-clinic containment gap (staffA could POST an Observation onto another clinic's patient, 201 not 403) — documented, NOT fixed here (out of phase-1 scope), logged in BACKLOG + will go in REVIEW-task-isolation-1.md as a MAJOR.
- Next: finish Phase 1.2 (provenance-service.ts call sites — lab/imaging/consultation/patient-service.ts have clinicTenant/accountRefs in scope already; fhir-helpers.ts's two helpers are dead code, no callers, just thread the param through), then 1.1 (policy entry), 1.3 (triage-service.ts), 1.4 (backfill script, dry-run), 1.5 (admin-service.ts access[] re-derive). Commit after each phase-1 sub-step, not one giant commit.
