# Task 578: run the 385d rehearsal, prepare production allowlist runbook
Date 2026-11-18. Branch `ai/task-578` from PR #309 (`ai/task-556-staging-385d`); origin/dev had nothing newer. The Task 570/571 notes named in the brief do not exist in this branch or `.ai` (searched `.ai/research`, `.ai/reviews`, remote branches); only Task 556/557 notes were available.
Next unfinished step: 385d rehearsal (operator side). Did it from the dev account: loopback only, MemAvailable was 5.8 GB, staging + proxy torn down afterwards (`ucc-stg-*` gone; `medplum-*` / `root-traefik-1` never touched).
Verified by running: `traefik:v3.5.0` + `medplum-server:5.2.15`; `bun run staging:probe` = PROBE OK.
Code findings: UCC invite = `POST admin/projects/${projectId}/invite` (lib/fhir/admin-service.ts:909); deactivate = FHIR ProjectMembership; other Medplum calls are /auth, /oauth2, /fhir, /storage, /healthcheck. No websocket/subscription use found.
Bugs fixed: staging config unreadable (EACCES) by image uid 1000 -> run as operator uid, tmpfs binary storage; allowlist lacked the invite route; probe expectation for `//` (Traefik collapses it).
Docs used: Traefik v3 routing rules (`Method`, `PathRegexp`, priority) https://doc.traefik.io/traefik/reference/routing-configuration/http/routing/rules-and-priority/
Not done / needs Hidayat: production Traefik change (Part 3 of the plan), a real successful invite through the proxy (needs seeded staging), TLS/ufw/sshd/DOCKER-USER.
Checks: tsc clean, eslint clean on the test, `bun test tests/unit/staging-rehearsal.test.ts` 3 pass. Full check-all not run (no app code changed).
