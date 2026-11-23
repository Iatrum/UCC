# Task 816 - dependency update research and results

Branch `ai/task-816` from `origin/dev` (c73aa40). Node 22.23 / Bun 1.4.4 on the VPS. Lockfile is `bun.lockb` (updated with `bun install`).

## Sources
- TypeScript 7: https://devblogs.microsoft.com/typescript/announcing-typescript-7.0/ (native/Go compiler; no programmatic JS compiler API)
- ESLint 10: https://eslint.org/docs/head/use/migrate-to-10.0.0 (Node ^20.19 || ^22.13 || >=24; eslintrc removed; we already use flat config `eslint.config.mjs`)
- firebase-admin 14: https://github.com/firebase/firebase-admin-node/releases (drops Node 18/20, removes Instance ID + legacy messaging types; npm engines `>=22`)
- firebase JS SDK 13: https://github.com/firebase/firebase-js-sdk/releases (breaking changes only in `@firebase/ai`: VertexAIBackend removed, `Part` union)
- @hookform/resolvers 7: https://github.com/react-hook-form/resolvers/releases (only the typebox resolver changed; peer `zod ^3.25 || ^4`)
- pako 3: https://github.com/nodeca/pako/blob/master/CHANGELOG.md (default export removed, `to:'string'` -> `toText`)
- Next.js 16.4.x / React 19.3 / Medplum 5.2: patch/minor releases, no migration steps. Checked via npm registry; build + tests are the proof.

## Usage check in this repo
- No imports of `firebase/ai`, Instance ID, messaging, typebox, or `pako` anywhere in source (pako is an unused direct dependency; consider removing it later).
- firebase-admin used only via `app`, `auth`, `firestore`, `storage`. firebase client in `lib/firebase.ts`, `lib/fhir/firestore.ts`.
- `@hookform/resolvers` used only as `zodResolver` (4 forms).

## Results (each gate: tsc lint, unit 1364, eslint, build:ci)
| Change | Result |
|---|---|
| Step 1: ~45 minor/patch bumps (medplum 5.2.18, next 16.4.6, react 19.3.1, playwright 1.65.1, radix, tiptap, tailwind 4.3.5, react-pdf 4.9, ...) | KEPT |
| typescript 6 -> 7.0.2 | REVERTED. tsc and `next build` pass, but ESLint crashes (`typescript-eslint` needs the JS compiler API: `Cannot read properties of undefined (reading 'Cjs')`). Retry when typescript-eslint supports TS 7. |
| eslint 9 -> 10.15 | KEPT. Same 2 errors / 7 warnings as before (pre-existing composer draft hook, left untouched). |
| firebase 12 -> 13.4 | KEPT |
| firebase-admin 13 -> 14.5.1 | KEPT. Needs Node >= 22 (VPS is 22; deploy runtime must be 22+). |
| @hookform/resolvers 5 -> 7.0.8 | KEPT |
| pako 2 -> 3.0.3 | KEPT (unused in code, nothing to migrate) |
| @types/node 20 -> 22 | KEPT (matches Node 22 on VPS) |

## Operational findings
- Playwright 1.65 needs a new browser build: `npx playwright install chromium-headless-shell`.
- `next dev` 16.4.6 rewrites the checked-in `AGENTS.md` ("Generated AGENTS.md for AI agents"). Reverted each time; `agentRules: false` in next config would stop it (not changed here).
- e2e needs `UCC_EVIDENCE`, `UCC_SAVE_SHOTS`, `UCC_MEMBERSHIP_BACKUP_DIR`, `UCC_REPORTS` pointed at writable dirs (the defaults are under `/workspace`).
- Node 24 LTS: ESLint 10 and firebase-admin 14 both support it; recommend moving the runtime to 24 later (PR note only, runtime unchanged).
