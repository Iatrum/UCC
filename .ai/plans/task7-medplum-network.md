# Task 7 — Medplum network lockdown plan

1 November 2026. **PLAN ONLY. No configuration, firewall, DNS, credentials or production data changed. All deployment actions below are USER ACTIONS.** Independent documentation PR; applying it requires the receiver/auth and isolation prerequisites below, including any unmerged application fixes. Sources and critique: [research](../research/task7-medplum-network.md).

## Intended boundary

Only the HTTPS reverse proxy should face the Internet. UCC browsers still require an authenticated Medplum API route today; this plan does not promise server-only Medplum. A later BFF migration needs its own workflow inventory and review. Network restrictions supplement AccessPolicy; they cannot repair D20 or cross-clinic clinical grants.

| Service / route | Intended reachability and conditions |
| --- | --- |
| UCC HTTPS, clinic hostnames | Public 443, TLS, known Host allowlist; retain server auth/clinic checks. HTTP 80 only for HTTPS redirect/validated certificate challenge when needed. |
| Next listener (local 3210; production port unknown) | Proxy/private network only. Never expose a development server publicly. |
| Medplum HTTP listener (local 8113; upstream default 8103) | Private container network or loopback, accessible only by approved proxy/UCC/operator. Verify actual listener/mapping, do not guess production port. |
| PostgreSQL 5432, Redis 6379 | Private application network only; no public port publication. Authenticate internal connections and restrict service identities. |
| Medplum App (often development 3000; deployment unknown) | Private VPN/operator gateway; do not equate hiding the App with securing its API. |
| Medplum `/admin/*`, operational health/metrics/debug, project/user/policy administration | Private operator gateway plus backend authorization. Health for private probes only. UCC server-side admin operations need an approved internal path. |
| Required Medplum `/auth/*`, `/oauth2/*`, `/.well-known/*`, `/fhir/R4/*` | Public TLS gateway only for observed supported login/SDK flows, bearer authorization and non-superAdmin projects. Inventory exact methods/paths before allowlisting; no anonymous FHIR clinical data. Do not broadly allow registration, invites, password reset or privileged operations merely because login is required. |
| Binary/storage/presigned URLs, WebSocket subscriptions, DICOM, SCIM, FHIRcast, MCP, email/CDS/webhooks | Default closed until an actual dependency is documented and tested; allow only the necessary service/method through its proper authenticated or signed channel. Upload/download flows must work before rollout. Firebase Storage stays. |
| Medplum Bot execution (`Bot/{id}/$execute` and other execution routes) | Private trusted callers only by default, least-privilege bot membership, explicit approved bot IDs/operations; never expose a generic anonymous bot relay. Inventory all route variants on the pinned server. |
| UCC `/api/labs/receive`, `/api/imaging/receive` | Separate device ingress allowlist/VPN where available plus **verified fail-closed `x-api-key` authentication as a deployment prerequisite** (Task 4 exists on ai-work but is absent from this origin/dev-based documentation branch); POST only, payload/rate limits and TLS. Shared keys do NOT prove clinic ownership. Per-device key + order-clinic validation is a separate prerequisite for wider rollout. No manual results or bypass of analyser-online ordering. |
| SSH/operator tools, Docker API, dashboards | Operator network only; never public unauthenticated Docker or database consoles. |

## Reverse proxy policy to design and test

USER ACTIONS: inventory actual domains, listeners, pinned image digest, public IPv4/IPv6 and container NAT rules first. Record a redacted traffic dependency map with login/refresh/logout, profile, clinic resolution, invitations, composer draft/signing, labs/device ingress and Firebase upload/download. No authorization headers, cookies, query values, request bodies or patient identifiers in evidence.

Use a default-deny virtual host for unknown hosts, a dedicated public UCC host, a controlled browser Medplum API host and a separate private operator host. Set Host and forwarded scheme/host from validated proxy state; strip client-supplied forwarding/clinic identity headers where applicable. Do not derive authorization from X-Forwarded-For supplied by the browser. Trust only known upstream proxies for client IP. Preserve required Authorization/content headers; apply request size/time/rate limits that have been measured against legitimate uploads/device retries. Do not cache authenticated FHIR/session responses. Keep TLS verification on for remote upstreams. Exact limits and hostnames remain deployment prerequisites, not guessed constants.

The v5.2.8 API router is mounted at `/`, `/api/`, `/projects/:projectId/` and `/api/projects/:projectId/`. Choose one public canonical API namespace and reject unused aliases, or apply equivalent restrictions to every supported alias after normalization. Earlier Binary/storage mounts also require explicit review. Test percent-encoding, duplicate slashes, dot segments, trailing slashes, method variants and proxy_pass slash behavior. Fail closed on ambiguous paths. A regex denying only `/admin` is insufficient.

Privileged FHIR resources and operations can also be reached through ordinary FHIR URLs, batch/transaction entries, operation Parameters or bot execution. Path filtering is not an authorization engine: use restrictive memberships/AccessPolicy, validate transaction entries on the server and restrict public executable operations until tested. Never route a public browser endpoint to an unrestricted admin client. Deny unneeded introspection/OpenAPI routes publicly; retain necessary OAuth discovery/JWKS. Enable WebSocket upgrades only on verified paths when used. CORS is a browser control, not a network boundary.

## Staged rollout and acceptance — USER ACTIONS

1. Inventory and attest versions/digests; snapshot redacted current configuration and secure rollback copies. Check non-superAdmin clinical projects (D20). Confirm an out-of-band operator session before firewall changes. Do not copy patient data into staging.
2. Rehearse on fake-data staging (Task 8). Test HTTPS browser workflows and private service calls, Firebase, device retries, auth refresh and failed/expired login. Validate config syntax before reload. No paid resource creation is authorized here.
3. Independently probe from outside and inside the intended boundary, on IPv4 and IPv6: raw Medplum/Next/database/cache/admin listeners inaccessible externally; public login and valid clinical reads work; anonymous/unauthorized reads and private route aliases denied; legitimate internal admin flows still work. Check Docker publication/NAT rather than relying on ufw alone.
4. Verify cross-clinic negative probes, direct reads, search/count, history/vread, include/revinclude, batch/transaction and Bot paths. Network success is not clinical-isolation sign-off. Existing clinical grants require the separate isolation plan.
5. Canary a fake-data clinic and agreed maintenance window. User reviews sanitized error counts/latency and device delivery acknowledgements. Confirm no pending results are lost; downstream writes must be idempotent before enabling automatic retries.
6. Roll out one boundary at a time: private backing services, private operator access, controlled API proxy, device ingress. Do not change baseUrl/issuer/public SDK build configuration and firewall rules simultaneously without a tested dependency sequence. Build-time NEXT_PUBLIC values require a new build if changed.

## Rollback — USER ACTIONS

Trigger rollback for reproducible login/refresh failure, composer hydration/save/sign failure, uploads unavailable, legitimate devices rejected or missing results, or blocked operator recovery. Stop widening rollout. Restore the last known-good **reviewed** proxy config and approved private connectivity; validate syntax then reload. Restore prior canonical API/baseUrl/CORS and matching browser build only if those changed. Preserve database and Firebase contents and queued device payloads; do not restore old clinical data over current writes. Do not reopen public database/cache/admin ports or re-enable anonymous receivers as a shortcut. If the former topology was insecure, use the operator tunnel/maintenance mode until safe access returns. Retest the failing workflow and negative probes, record times and sanitized counts. No production step was executed in this round.
