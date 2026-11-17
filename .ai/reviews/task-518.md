# Task 518 — review of PR #290 (Task 517 changes, head c1b7ef6)

Verdict: **APPROVE** after one fix pushed to the branch (fast-forward).

## Findings
1. **FIXED — "fail closed" was not real.** `isModuleEnabledForClinic` -> `getEnabledModuleIdsForClinic` swallows Medplum errors and returns defaults (pacs NOT in defaults = off). So on a Medplum outage the /api/imaging/order guard saw "pacs off" and allowed accession-less orders, and labs-imaging showed the old form. Task 517's tests mocked a throwing lookup that the real function never produces. Fix: new `isModuleEnabledForClinicStrict` (module-registry) throws on Medplum failure; guard (409 -> 5xx via handleRouteError) and labs-imaging (-> treatment-panel pointer) use it. Tests now also exercise the REAL lenient vs strict lookups against a faked Medplum client (fail, pacs-on, missing org).
2. **Accession guard, module on vs off** (route.ts): on + no `xray` + no `encounterId` -> 409, nothing created; on + `xray` -> reaches service (practitioner stamped); on + encounter-linked generic imaging (composer) -> unchanged; off -> unchanged. Behaviour tests call the real POST handler. OK.
3. **Non-blocking caveats (follow-up, not changed):**
   - The guard keys on `encounterId` presence; a caller can send any encounterId to bypass it, and the composer's generic imaging path still creates accession-less orders (accession is minted only for `xray`). It is a UX guard against the stale form, not an integrity control.
   - `/pacs/new` (module page, linked from /pacs) posts without xray/encounter, so with pacs on it now shows the 409 message in its error toast (a dead end, with accurate text). Consider pointing it at the Treatment panel later.
4. **Tests**: 517's tests are behavioural (real route handler, mocks restored in afterAll, delegate flag to limit bun mock leakage). Full `bun test tests/unit`: 622 pass, 0 fail. tsc clean for touched files.
5. **X-ray toggle gating**: composer submit still gated by `pacsEnabled` (untouched); e2e xray.spec expectations (409 on offline device) unaffected.
6. **Nav**: no nav/sidebar/layout changes. **Composer**: `patient-profile-workspace.tsx` untouched.
7. Study card change is CSS-only.
