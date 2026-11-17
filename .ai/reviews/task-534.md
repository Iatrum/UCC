# Review: Task 533 (PR #297) — verdict APPROVE (after one nit fixed)

Scope: baseline identity fails closed; seed bootstrap only on allowlisted staging; no secrets.

## Baseline identity (e2e/scripts/lib/baseline.mjs, compare.mjs, check-all.sh, check-staging.sh)
- Missing path/file, non-JSON, no suites, missing/garbled identity, wrong schema, wrong target, hash mismatch, invalid target name: all return problems -> exit 1. Verified by unit tests and by running check-staging.sh with no/absent baseline (preflight fails first; baseline arg is mandatory, no default).
- Strict whenever target != local. Local stays lenient (intended).
- Nit (not changed): check-all.sh compares `UCC_GATE_TARGET != local` literally, compare.mjs normalizes (trim/lowercase). `" "`/`LOCAL` is lenient in compare but needs an identity in check-all's pre-check. Errs on the stricter side, harmless.
- Limitation: the sidecar is integrity/labelling, not authentication; anyone can write one. Acceptable for a gate against accidents.
- Fixed: the "record one with" hint pointed at `scripts/lib/baseline.mjs`; correct path is `e2e/scripts/lib/baseline.mjs` (test updated).

## Bootstrap (scripts/staging/bootstrap.ts, seed.ts)
- seed.ts runs stagingPreflight (positive allowlist, 127.0.0.1/localhost:8123) before any login; rejects dev admin defaults; `--dry-run` contacts nothing.
- bootstrapDemo re-checks the client's own base-URL origin against STAGING_MEDPLUM_ORIGINS (exact origin match; 8113, 8103, remote hosts, garbage and `8123.evil.com` rejected, nothing written — tested).
- Idempotent, refuses ambiguous state (duplicate org/doctor, clinic identifier mismatch), fake data only, clinic identifier carried on the org.

## Secrets
- Diff grep: only reads of MEDPLUM_ADMIN_* from env; no literals, no .env/e2e/.secrets files.

## Checks
- bun test tests/unit: 640 pass, 0 fail. tsc --noEmit clean. eslint on changed dirs clean.
- Not run: anything against a real staging stack (none started). No sidebar/nav, composer, Lab/POCT or X-ray changes.
