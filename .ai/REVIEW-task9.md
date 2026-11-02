# Task 9 review

Reviewed PR #223 (`ai/task-9` → `dev`, 6ce3e79, draft, MERGEABLE). Read-only review: full diff
(`.ai/CHANGELOG.md`, `.ai/DECISIONS.md`, composer/order/billing code, `lib/fhir/{lab-service,poct-device,
investigation-billing}.ts`, `e2e/tests/poct.spec.ts`), plus the surrounding code the diff touches
(`lib/module-registry.ts`, `lib/module-settings.ts`, the pre-existing standalone `/poct` module, and
every other caller of `/api/labs/order`). No edits, no gate re-run, no push/merge.

The implementation itself is solid: clinic isolation is checked on every new code path (patient,
encounter, device all re-verified against `clinic|<id>`), the online-analyser check is re-run at
Sign time (not just on add), POCT/lab lines are kept out of completed `Procedure`s per the AGENTS.md
rule, retries are idempotent via `createResourceIfNoneExist` keyed on a clinic+encounter+entry
identifier, and error codes match what the e2e spec expects (403 module-disabled, 409
offline/invalid). The new `e2e/tests/poct.spec.ts` is adversarial in the right ways (foreign-clinic
device rejected, anonymous 401, offline block even mid-Sign, disabled-module hides UI *and* blocks
the API directly). The Encounter `investigation-billing` extension read-then-merge in
`app/api/orders/route.ts` is safe against the later `updateConsultationInMedplum` call because that
function re-reads the Encounter itself (`consultation-service.ts:730`) rather than reusing a stale
snapshot, so there's no lost-update race between the two writes.

## MAJOR — enabling the "poct" module also re-opens the pre-existing, ungated `/poct/new` order form

**File:** `app/(routes)/poct/new/page.tsx` (not touched by this PR, but newly reachable because of it)

This PR correctly gates the *new* composer POCT path behind `isModuleEnabledForClinic('poct',
clinicId)`, both in the UI and server-side (`GET /api/poct/analysers` → 404,
`createLabOrder`'s POCT branch → 403, both in `lib/fhir/lab-service.ts`). But `poct` is also the
module id of an older, already-shipped standalone module (`modules/poct/module.config.ts`, routed
at `/poct` and `/poct/new`, gated only by `app/(routes)/poct/layout.tsx` →
`loadEnabledModulePage("poct")` → the *same* `isModuleEnabledForClinic` flag). That legacy
`/poct/new` page lets staff pick any test from `POCT_TEST_DEFINITIONS` (`blood_glucose`,
`urinalysis`, `pregnancy`, `strep_throat`, …) and POSTs straight to `/api/labs/order` **without**
ever setting the `poct:` field:

```ts
// app/(routes)/poct/new/page.tsx
body: JSON.stringify({ patientId: patientSearch, tests: [testType], priority: urgency, clinicalNotes: notes })
```

Because `createLabOrder`'s new analyser/online/Device-performer logic is entirely inside
`if (order.poct) { ... }` (`lib/fhir/lab-service.ts`), this request takes the *plain lab order*
path: no `isModuleEnabledForClinic` re-check for the order itself (only for loading the page), no
device, no online check, and — since none of `blood_glucose`/`urinalysis`/etc. exist in `LAB_TESTS`
— `resolveLabTest`'s string fallback (`lib/fhir/lab-service.ts:57-60`) happily creates a
`ServiceRequest` with `code: 'blood_glucose'` mislabeled under `system: 'http://loinc.org'`.

**Failure scenario:** an admin turns "poct" on for a clinic so doctors can use the new, correctly
gated composer section (which is the whole point of this PR). That same flag unlocks `/poct` → "+
New Test Order" for every clinic user. Anyone who knows (or guesses/copies from a patient-profile
URL) a `Patient` id can order an arbitrary "POCT" test with **no analyser required and no online
check at all** — a direct violation of the AGENTS.md rule "POCT can be ordered only when the
analyser is online. No manual result entry," and it bypasses the Device/performer/billing-extension
model this PR just built. The `.ai/research/task9-poct-composer.md` and `.ai/DECISIONS.md` entries
for this task don't mention this page, so it looks like it wasn't considered in scope — but it
becomes live specifically because of this PR's module-flag choice.

**Suggested fix (follow-up, not necessarily blocking this PR):** either retire/redirect
`app/(routes)/poct/new/page.tsx` now that the composer is the real POCT entry point, or route its
submit through the same `poct:` contract (`analyserId` + online check) before any clinic turns the
module on for real use.

## MINOR — gate script's default heap cap silently dropped below the documented value

**File:** `e2e/scripts/check-all.sh`

```diff
-export NODE_OPTIONS=--max-old-space-size=3072
+export NODE_OPTIONS=${NODE_OPTIONS:---max-old-space-size=1536}
```

AGENTS.md documents the standard cap as `NODE_OPTIONS=--max-old-space-size=3072`. This change makes
`1536` the new fallback for every future `check-all.sh` run that doesn't explicitly set
`NODE_OPTIONS` — it's a real fix for this box's OOM/dev-server-restart problem seen in this round's
logs, but it's a shared-script default change, not a per-run opt-in, so it now silently diverges
from the written policy for any other task/agent that runs the gate without overriding the env var.
Worth a one-line AGENTS.md update (or reverting the default and keeping the override) so the two
don't drift.

## Nit (no action needed)
`app/(routes)/api/labs/order/route.ts` now has two separate `import { ... } from
'@/lib/server/medplum-auth'` statements (`getCurrentProfile` and `requireClinicAuth`) — cosmetic
only.

## Not re-verified
Did not re-run lint/build/e2e for this review (read-only review task); relying on the PR's own
stated gate evidence (`/workspace/ai-logs/task9-final/`, lint 0 / build 0 / e2e 25/26, baseline-only
known-bug failure).
