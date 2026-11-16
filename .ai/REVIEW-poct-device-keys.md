# Task 180 self-review — per-device keys

Scope: key issuance/authentication, four device-ingress routes, receive services, device bots, simulators, e2e. No sidebar/nav, composer, Lab-tab placement, Firebase Storage or module-toggle changes.

- **Auth**: only a SHA-256 hash is stored (Device identifier); plaintext is shown once and never logged. 256-bit random keys make an indexed hash lookup safe (no timing comparison surface). Missing/unknown/revoked key, non-`active` Device, wrong device type for the route → 401; disabled `poct`/`pacs` module for the device's clinic → 403. No env fallback anywhere, so the JSON routes no longer fail open (BACKLOG tonight item 4 closed).
- **Clinic isolation**: the clinic comes from the Device (exactly one `clinic` identifier), never the request. `receiveLabResults`/`receiveImagingStudy` now require it and call `assertOrderInDeviceClinic` (order identifier + `meta.accounts` vs tenant account) before any write; bots re-check before reading further. The check runs before result creation, so a clinic-A key leaves clinic-B orders untouched (asserted: no report/study, order still active). Imaging studies now also carry the clinic identifier.
- **BACKLOG Phase 1.4**: receive paths already used `X-Medplum: extended`; clinic now derives from the Device, and `clinic-isolation.spec.ts` confirms account propagation. Closed with the caveat that new read-then-reuse paths must pass the header per request.
- **Residual risks**: (1) a leaked key is valid until rotated/revoked — rotation is `issueDeviceKey`, but there is no admin UI/API yet (CLI/lib only; no nav changes allowed). (2) Legacy body `apiKey` is still accepted alongside headers. (3) A 403 for a foreign order vs 400/500 for a missing one lets a key holder probe whether an order id exists. (4) No rate limiting on key guesses (256-bit keys). (5) `/api/imaging/report` still fails open (logged as BACKLOG 5). (6) Bad JSON bodies return an error before auth is evaluated.
- **Not changed deliberately**: POCT lab and X-ray stay behind `poct`/`pacs`; offline analysers can still deliver results for an already-signed order (ordering gate is unchanged).

## Verification (dev Medplum :8113, own dev server :3215, fake data)
- `bun run lint` (tsc + clinic-admin check) and `build:ci` pass.
- Relevant specs: poct (8/8, incl. new cross-clinic test), xray (7/7 incl. new; one first-run UI timing flake passed on rerun), workflow (07 uses a per-device key; only the expected known-bug summary fails), clinic-isolation passes (the spec hard-codes `:3210`, so it was run with that base; it calls services in-process).
- Full Playwright run (without the `:3210`-hardcoded clinic-isolation test): 42 passed, 10 failed — none from this change: 5× save-state + 1× draft-retention write screenshots under `/workspace` (absent here), time-chit and staff-membership assert `BASE === :3210`, workflow 11 is the documented known-bug summary, and poct 101 aborted a `/poct` navigation once and passed on rerun. `check-all.sh` itself could not run as written (needs `/workspace`), so its steps were run by hand; the baseline comparison was not possible. clinic-check ran (inventory mode).

## Task 181 — independent (non-author) review

Scope: `git diff origin/dev...HEAD` (origin/dev already merged; PR #236 open). `tsc --noEmit` clean. E2E not re-run (no code change by reviewer).

Checked:
- **Per-device hashed keys**: SHA-256 hash stored as a Device identifier; plaintext returned once by `issueDeviceKey`, not persisted/logged; no `ucc_dk_` literal or secret in the diff.
- **Auth on all four routes** (`/api/labs/receive`, `/message`, `/api/imaging/receive`, `/message`): `authenticateDeviceKey` runs first; no key / unknown / revoked / inactive Device / wrong device type → 401, not bound to exactly one clinic or module off → 403. No env-key fallback remains → fails closed.
- **Clinic match**: clinic comes from the Device, never the request. `assertOrderInDeviceClinic` (identifier + `meta.accounts`, read with `X-Medplum: extended`) runs before any write in `receiveLabResults`/`receiveImagingStudy`; bots additionally compare before further reads. Both service functions now require `deviceClinicId`; no other callers exist.
- **Toggles**: `poct`/`pacs` checked per Device clinic; preserved.
- **Phase 1.4 gap**: honestly documented as resolved for receive paths, with the caveat that `getAdminMedplum()` still sets no global extended header.
- **Composer / Lab-tab-only / nav**: no composer, sidebar/nav or results-placement files touched.

Findings:
- MINOR: `/api/imaging/report` still fails open without `PACS_API_KEY` and does no clinic check (already logged as BACKLOG 5; not device ingress).
- MINOR: legacy body `apiKey` still accepted; 403 vs 400/500 lets a key holder probe order existence; no rate limiting or admin UI for rotation (author-listed residuals).

**Verdict: APPROVE** (no MAJOR; MINORs above are tracked).
