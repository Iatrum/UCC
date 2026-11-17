# Review: Task 532 (PR #295, Tasks 527 + 531)

Reviewed head: e719b9435 (5c12953 Task 527 + e719b Task 531). No dev server started; fake data only.

## Verdict: APPROVE

- **No remaining module gate.** `time-chit` is gone from `KNOWN_BRANCH_MODULE_IDS`, `modules/time-chit/` is deleted, and no `timeChitEnabled` prop or `isModuleEnabledForClinic("time-chit")` call is left in app/lib/components/modules. The composer's fetch, submit check, edit dialog and documents list are ungated, and the workspace's `letter-time-chit` fallback entry is unconditional.
- **Guard still enforces isolation/auth.** `assertTimeChitMutationAllowed` still throws Forbidden without a `clinicId`, still validates details and recomputes `tcHours` server-side. All 4 call sites (`app/api/orders/route.ts:72`, `consultation-service.ts` create/update/delete) still pass the scoped clinic id. Route auth/clinic scoping is untouched. Unit test covers null clinic, bad times and the happy path.
- **Legacy orgs** listing `"time-chit"`: dropped by `normalizeEnabledModuleIds` (unit-tested).
- **e2e recorded.** Task 531 comment on #295: `e2e/tests/time-chit.spec.ts` 1 passed after the spec-only fix (e719b: fill the required "Referral to:" field; label verified at `order-composer.tsx:1238`). It covers no-module and legacy-id clinics, validation, checkout, historical print and clinic scope. I did not re-run the e2e (no dev server, per the task).
- **Checks run here:** `bun test tests/unit` 634 pass / 0 fail; `tsc --noEmit` clean; eslint on the changed e2e spec clean.
- **Scope:** no sidebar/nav, lab/POCT or X-ray changes; composer behaviour otherwise unchanged.

## Non-blocking notes
- The e2e no longer asserts that spoofed or unscoped requests are rejected (the old 403 cases tested the module gate). The unit test covers the null-clinic path, so nothing is needed.
- Vercel status is red only because of the free-tier deployment rate limit, unrelated to the code.
- CI `lint-and-build` was still in progress at review time.
