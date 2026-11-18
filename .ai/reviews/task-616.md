# Review Task 616 (PR #309, head a6b660f)

Verdict: **APPROVE**, no changes needed.

Note: the brief said "Task 615"; the branch has no Task 615 commit or note. Reviewed the whole PR as it stands (Tasks 556, 570, 578, 597, 607 and their reviews 557/571/579/598/608). `origin/dev` merged: already an ancestor.

- **Safety:** loopback-only publish, pinned Traefik tag (`latest` refused), file provider, no Docker socket, API off; probe refuses non-staging bases. Nothing touches medplum-*, root-traefik-1, /opt/medplum, /root, Vercel, DNS. No app code changed, so composer, Lab/POCT, clinic separation and Firebase are untouched. No secret values in the added lines.
- **Owner decisions:** Vercel stays, SSH tunnel only (no Tailscale; checklist says so), self-registration off, console + snapshot before production: all reflected in plan Part 3 and `.ai/PILOT-READINESS.md`.
- **Plan claim verified:** `lib/fhir/admin-service.ts:909` POSTs `admin/projects/<id>/invite`, so the single anchored POST route is needed; no other `/admin`, `/ws`, `/scim`, `/email` use in lib/app.
- **Checklist accuracy:** every referenced file/test exists; probe counts match probe.sh; D46/D47 now unique; AGENTS.md says server 5.2.15 / SDK ^5.1.13 (matches Task 608's docker inspect). Items "not run on a real server" are stated as such.
- **385c exception list (Task 607):** strict target fails closed on any non-passed test not an exact title in `e2e/staging-exceptions.json` (empty); bad list fails; local behaviour unchanged. Covered by tests.
- **Checks:** tsc clean; eslint clean on changed JS/TS; `bun test tests/unit/staging*` 19 pass, 0 fail; compose audit OK.
- Not run: anything against a real staging stack or production.
