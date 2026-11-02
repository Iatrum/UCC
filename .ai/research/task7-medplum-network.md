# Task 7 research — 1 November 2026

Plan only. Read UCC `lib/auth-medplum.tsx`, `lib/server/medplum-auth.ts`, `lib/server/medplum-admin.ts`, `proxy.ts`, both result receivers, `scripts/validate-env.ts` and local Compose image/port declarations without reading credentials.

## Verified sources
- [Medplum v5.2.8 app routing](https://github.com/medplum/medplum/blob/v5.2.8/packages/server/src/app.ts), downloaded and read: API router has FOUR mount prefixes (`/`, `/api/`, `/projects/:projectId/`, `/api/projects/:projectId/`). Binary/storage have earlier mounts. This defeats a block on just `/admin/` at the root.
- [v5.2.8 config types](https://github.com/medplum/medplum/blob/v5.2.8/packages/server/src/config/types.ts), downloaded and read; [server configuration](https://www.medplum.com/docs/self-hosting/server-config): distinguish listener port, canonical API baseUrl, appBaseUrl/CORS and OAuth issuer. Current docs can drift; pin deployed version first.
- [Docker firewall guidance](https://docs.docker.com/engine/network/packet-filtering-firewalls/): publishing may bypass ufw expectations; host rules alone are insufficient evidence of private containers.
- [NGINX proxy module](https://nginx.org/en/docs/http/ngx_http_proxy_module.html): proxy headers and upstream path handling must be explicit. No ready-to-run proxy snippet is claimed safe for an unknown production topology.
- [OWASP API8](https://owasp.org/API-Security/editions/2023/en/0xa8-security-misconfiguration/): inventory exposed services, restrict administration and avoid permissive configuration.

UCC browser provider builds a MedplumClient from NEXT_PUBLIC_MEDPLUM_BASE_URL and obtains a token via the session endpoint. Server-only lockdown would break supported browser paths. Read `/workspace/ucc-medplum/docker-compose.yml` and its override (outside this repo); local Compose declares medplum-server:latest and host port 8113; source version 5.2.8 is not runtime attestation. Default upstream listener is usually 8103, not necessarily the local mapping. No Hostinger inspection occurred.

## Short plan and self-critique
Inventory dependencies; private listener/database/cache; public HTTPS gateway only for necessary browser API paths; privileged operations via private operator path; test aliases, batches and devices; stage, canary, rollback. A tempting blanket deny of public FHIR/admin or a guessed NGINX allowlist could break login, binary upload or invite flows and still miss aliases/batch operations. Safer: inventory-driven gateway policy, backend authorization at every operation, and staging acceptance before any user rollout. No Next/React APIs change, so no version-specific application API assumption is introduced.

## Fresh review correction
The reviewer correctly found that this origin/dev-based branch lacks Task 4. Fail-closed header-key authentication is observed on ai-work, not on origin/dev. Deployment must first verify missing/wrong/unconfigured key denial in the actual target build; this documentation does not remediate receivers. No matching reverse-proxy GitHub issue was verified by the web search, so no issue-specific workaround is asserted.
