# Task 820: admin + staff-membership e2e failures on origin/dev

Verdict: both are stale-test / environment problems, not app bugs. No app code changed.

1. `admin.spec.ts` "create organisation" timed out. The dev-server log shows `GET /admin/organisation/new?`, a native GET form submit. The test fills and clicks after `domcontentloaded`, before React hydrates `org-form.tsx`, so `handleSubmit` never runs and no `/api/admin/organisation` request fires. Every later step failed because it depended on `orgId`. Fix: `visit()` waits for the form's `__reactProps` (hydration) first.
2. `staff-membership.spec.ts:115`: `UCC_MEMBERSHIP_BACKUP_DIR` was unset and `/workspace` does not exist on this host. `applyOne` `mkdirSync` threw a non-`SafeError`, which prints the generic "Stopped; inspect locally..." line before the "No active PractitionerRole" check is reached. `check-all.sh` sets the variable. Fix: the spec defaults it to a private `mkdtemp` dir.

Re-run on dev Medplum with fake data, one dev server on :3822 (killed afterwards): admin.spec.ts PASS (1.4 min), staff-membership.spec.ts PASS (4.0 min).
