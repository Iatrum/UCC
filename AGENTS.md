# UCC agent rules (Codex, Claude Code, Dev)

Stack: Next.js 16 (App Router), React 19, Medplum 5.2.8 (FHIR R4), Bun, Firebase Storage. PR base is `dev`, but agents NEVER push, touch the remote or open PRs.

## Rules
- Research and verify first: read the code and official docs (Medplum, Next.js 16, React 19, FHIR R4). Never guess an API. Notes go in `.ai/research/<task>.md` with links.
- Never break existing features, especially the consultation composer.
- Lab/POCT results show only in the Lab tab. No critical-result warning in the composer.
- POCT can be ordered only when the analyser is online. No manual result entry.
- Clinic data stays separate (every clinical resource carries its `clinic` identifier; never read across clinics).
- Firebase Storage stays (do not replace it).
- One Next dev server at a time (`:3210`, Medplum `:8113`), memory capped: `NODE_OPTIONS=--max-old-space-size=3072`.
- Never echo, log or commit secrets or real patient data. Fake data only. Test password lives in `e2e/.secrets/` (git-ignored).
- Small tasks, one commit each. Done = `e2e/scripts/check-all.sh <label>` shows no new failures.

## Shared memory
`.ai/STATE.md` (status, usage), `.ai/BACKLOG.md`, `.ai/DECISIONS.md`, `.ai/CHANGELOG.md`, `.ai/UX-FINDINGS.md`, `.ai/REVIEW-<task>.md`, `.ai/research/`.
