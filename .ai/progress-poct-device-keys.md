# Task 180 — POCT per-clinic device keys (progress)

Branch `ai/task-poct-device-keys` (worktree `/home/dev/ucc-pr-poct-device-keys`, based on origin/dev). Dev server :3215, dev Medplum :8113, fake data only.

## Design
- Key = `ucc_dk_<32 random bytes b64url>`; only SHA-256 stored as `Device.identifier` (system `https://ucc.emr/device/api-key-sha256`) — identifiers survive heartbeat updates (which rewrite `Device.property`) and are searchable. Plaintext shown once (issue-key writes a 0600 file outside git).
- `lib/fhir/device-keys.ts`: issue/revoke/authenticate. Key via `Authorization: Bearer`, `X-Device-Key`, or legacy body `apiKey`. Fail closed (401) on missing/unknown/revoked/inactive/wrong-type device; 403 when the clinic's `poct`/`pacs` module is off.
- Clinic comes from the authenticated Device (exactly one `clinic` identifier), never from the request. `receiveLabResults` / `receiveImagingStudy` now REQUIRE `deviceClinicId` and call `assertOrderInDeviceClinic` (identifier + `meta.accounts` vs tenant account) before writing. Bots re-check before any read-through.
- `POCT_API_KEY` / `PACS_API_KEY` removed from the four receive routes (JSON routes no longer fail open). `/api/imaging/report` still uses `PACS_API_KEY` (radiologist report, not device ingress) — out of scope, logged in BACKLOG.

## Milestones
- [x] lib + service + bot + route changes, sims (`issue-key`, Bearer send)
- [x] e2e: poct/xray/workflow specs moved to per-device keys; new cross-clinic tests
- [ ] relevant specs green
- [ ] full gate, BACKLOG/CHANGELOG/DECISIONS, REVIEW, draft PR
