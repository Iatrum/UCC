# Task 810 — dependency audit refresh (origin/dev @ eba7551)

Date: 2026-11-23. Lockfile: `bun.lockb` → `bun audit` (resolved: next 16.4.5, react 19.2.6, @medplum/core 5.1.13 as installed from the lockfile, firebase 12.14.0, firebase-admin 13.9.0).
Note: AGENTS.md mentions Medplum 5.2.8 (server); the client packages resolved in the lockfile are 5.1.13. Not changed.

## Core packages vs OSV (api.osv.dev/v1/query, exact installed versions)
next 16.4.5, react 19.2.6, @medplum/core 5.1.13, firebase 12.14.0, firebase-admin 13.9.0: **no known advisories**.

## `bun audit` findings (4: 1 high, 2 moderate, 1 low)
| Package (version) | Path | Severity | Advisory | Reachable in our usage? |
|---|---|---|---|---|
| @grpc/grpc-js 1.9.16 (<1.13.6) | firebase > @firebase/firestore | high | https://github.com/advisories/GHSA-m9gg-hp2v-232j (getAuthContext may treat unauthorized certs as authorized) | No. Affects gRPC **servers** using mTLS. We only use it as a Firestore client. |
| @grpc/grpc-js 1.9.16 | same | low | https://github.com/advisories/GHSA-f596-whhp-79r4 (server leaks handler error messages) | No. Server-side only. |
| minimatch 10.2.5 (>=7 <11.0.1) | eslint tooling > @typescript-eslint/typescript-estree | moderate | https://github.com/advisories/GHSA-g3hv-75wg-m249 (DoS, globparts amplification) | No. Dev/lint only, never in the runtime bundle, no attacker-controlled globs. |
| uuid 8.3.2, 9.0.1 (<11.1.1) | firebase-admin > @google-cloud/storage, gaxios, google-gax, teeny-request | moderate | https://github.com/advisories/GHSA-w5hq-g745-h8pq (missing bounds check in v3/v5/v6 when `buf` is passed) | No. Our code does not import uuid. Google libs use v4 without `buf`. |

grpc-js 1.14.5 (via firebase-admin) is already patched. minimatch 3.1.5 and uuid 11.1.1 are not affected.

## Fix assessment
`bun audit fix` → "Fixed 0 of 4". Every remaining fix is blocked by a dependent's range:
- grpc-js: the override `@firebase/firestore>@grpc/grpc-js: ~1.9.16` (Task 599) mirrors firebase's own `~1.9.0` pin. Fixing it means 1.9 → ≥1.13.6, a minor jump of the Firestore client transport. It is not a patch-level change, and the risk is not worth it for an unreachable server-side issue. Revisit when firebase ships a release depending on grpc-js ≥1.13.6.
- minimatch: needs ^11 (major) but typescript-estree requires ^10.2.2. Wait for upstream typescript-eslint.
- uuid: needs 11.x (major) but @google-cloud/* require ^8/^9. Wait for upstream google-cloud releases.

## Decision
No safe patch-level fix exists, so no dependency changes (package.json and bun.lockb untouched). Docs-only PR. Re-audit when firebase / firebase-admin / typescript-eslint publish new releases.
Tests (tsc, lint, unit, build) were not re-run because no code or dependency changed.
