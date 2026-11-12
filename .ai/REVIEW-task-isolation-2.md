# Task 100 — Phase 2 prerequisites: self security review

Scope: the two MAJOR findings deferred by Task 090 and independently confirmed in Task 091. Codex self-review only; no independent reviewer was invoked. No Phase 2 migration, backfill apply, policy deployment, project topology change or production access.

## Findings and disposition

1. **Write-side foreign-patient creation: fixed in the revised policy and server order paths.** A criteria-only rule is insufficient on this installed server. Patient-compartment creates require nonempty server-generated accounts, all within the assigned-clinic union. Every compound access entry carries the same server-derived anchored pattern, avoiding first-rule-only multi-clinic denial. Legacy single-clinic parameters retain an exact-account fallback. Patient references cannot be changed on update while retaining old accounts; existing-resource update/delete checks use the version-verified resource-level compartment. Live tests deny the original foreign Observation POST with 403, forged accounts/compartments/identifiers, mixed-patient compartments, unattached forged creates, foreign adoption and reparenting. Same-clinic plain/extended creates and updates, second-clinic union, revocation and zero grants pass.

2. **Read/reuse of hidden accounts: explicit scoped reads and persisted receive regression added.** The three lab/imaging reuse reads request X-Medplum: extended with cache:no-cache. No global/singleton headers change. A deliberately non-extended SDK client with primed plain-read caches receives lab Observations/reports, ImagingStudy and imaging report from stamped orders whose fake Patient remains unstamped. Every result and persisted Provenance gets the correct account and is readable by authorized staff. FHIR R4-required audit actors are supplied from the authenticated profile when automated callers omit them.

## Important research corrections

- Official SDK v5.1.13 client.ts exactly matches the installed source map. It supports extendedMode, default true. Prior notes saying this option did not exist or that plain admin SDK reads must always hide accounts were inaccurate. Explicit per-request headers/cache controls remain valuable and work when extendedMode:false; the regression exercises that case.
- In the local superAdmin:true PROJECT, even ordinary memberships have repository superAdmin capabilities for extended metadata. Nested readonly account fields alone are insufficient: meta.profile can suppress inheritance. CREATE therefore strips the whole input meta; UPDATE restores stored meta. Direct staff metadata creates are intentionally limited.
- POCT/X-ray tags must survive this limitation. The order-only wrapper first uses the ACTING client's create/conditional-create. Only after success and a fresh authorized acting-client read does an admin restore app-generated profile/tag fields. It reads the full stored record to avoid losing hidden fields and uses FHIR If-Match against the authorized version. Input accounts/project/compartments/security labels and clinical fields are never substituted. Conditional replay keeps the original order ID. Both dev device-order branches retain online/module guards and idempotency.

## Authorization boundaries checked

- Lab/imaging order validation occurs before the first create, with the acting client and selected clinic; extended accounts take precedence over mutable identifiers. Patient/Encounter IDs are local FHIR IDs; mismatched Encounter subject is denied. A legacy unstamped record uses the existing identifier check until Phase 2 backfill. Test covers unrestricted service client as well as staff with multiple clinics.
- Direct staff Provenance create is denied. The server helper freshly authorizes every local target with the acting client before obtaining its privileged writer; target denial has no admin-read fallback. Accounts are derived from authorized targets, supplied accounts cannot redirect a stamped target's audit, and raw external/history target references are rejected.
- Only fake disposable clinics/patients/orders/policy/membership are used by isolation e2e; cleanup includes child results and audits. Existing clinic policy/memberships remain unchanged. No secrets are staged or printed.
- Final dev integration retains existing POCT/X-ray receive handling, routing identifiers, route error mapping, module toggles, device checks and billing. No sidebar/nav/composer UI/Firebase changes. No manual result entry or composer critical-result warning.

## Rollout limits (not executed by this task)

- Refresh old MULTI-clinic access parameters with the complete union before deploying the revised policy. Installing this policy alone over old multi-clinic grants can reject a second-clinic create. Real membership changes remain Phase 2 work, not this task.
- New policy protects only memberships using it and properly stamped Patient compartments. Legacy missing-policy/missing-account rollout remains Phase 2. Arbitrary unrelated custom policy grants are still additive by Medplum design.
- Task has no Patient compartment in FHIR R4; standalone configuration/Task grants and Patient bootstrap behavior retain their prior behavior. This is not a claim of whole-project write isolation. Shared device-key tenant restrictions remain a separate backlog item.
- Resource-level compartment is deprecated but verified in SDK/server versions used here; revalidate before upgrade. Non-order raw clinical creates lose client-declared metadata; normal order routing/profile metadata is preserved through the reviewed wrapper. Whole-policy/migrated-user workflows remain Phase 2 validation.

## Validation

- ai-work focused write containment: PASS 1/1; propagation regression: PASS 1/1; lint PASS.
- Dev-based integration isolation/metadata/conditional-replay/receive regression: PASS 1/1 (dev-focused-r2, 6.4s); dev lint PASS.
- Additional relevant device/module e2e and the single final check-all gate: results will be appended below.

Verdict: the two prerequisite fixes are ready for draft review, subject to final gate evidence below and the explicit rollout limitations above. Independent review remains the next separate task.

### Single final gate and recovery

`check-all.sh task-isolation-2` ran once on the dev-based worktree: **OVERALL FAIL** (lint/build 0, e2e 11/38 with 10 skipped, clinics 1). Local Medplum exited during the run (exit 1, OOMKilled false, ECONNRESET in crash tail); :8113 was absent and later tests/clinic inventory could not connect. Next also restarted. This does not establish a clean no-new-failures gate. Evidence remains under /workspace/ai-logs/task-isolation-2 and task-isolation-2-e2e.

Earlier relevant run was 10/15: the POCT notification test assumed PACS off but the fake clinic had PACS on; later X-ray failures reported Unauthorized/expired sessions. Fresh X-ray-only replay passed 5/5. A targeted notification replay with PACS temporarily off was externally interrupted (143), not counted as passing. Original fake clinic module settings were restored after the gate. Local Medplum recovered in the foreground; an unchanged-code core recovery replay is in progress. Never overwrite original gate evidence with replay/composite results.

### Confirmed unchanged-code recovery results

- All 12 API tests and the expanded isolation test pass in core-recovery. That combined replay then hit the local 5/min login limit in workflow registration; no app fix was made.
- Separate workflow-recovery: **10/11**; only the expected known-bug summary fails. Registration, triage, consultation signing, both composer paths, lab ingest, documents, billing and all smoke pages pass.
- Fresh X-ray replay **5/5**. Recovered clinic inventory exit 0.
- Notification replay with its assumed PACS-off fixture precondition is running last, with an EXIT trap to restore the original module extension. Original gate and all replays remain separate; no second full gate.

### Final recovery verdict

Notification replay PASS 1/1 (1.8m), including live refresh, dropped-socket polling and unmount cleanup, with the pre-existing test's PACS-off precondition. Automatic restore confirmed original fake demo PACS=true/POCT=false. Combined focused evidence: **37/38**, zero skipped, only baseline known-bug summary fails; comparator exit 0. `/workspace/ai-logs/task-isolation-2/recovery-composite-results.json` is clearly marked COMPOSITE and does not replace the original failed gate. No application changes were made during recovery. The draft is ready for independent review; a clean single full gate remains unproven and should be captured before leaving draft.
