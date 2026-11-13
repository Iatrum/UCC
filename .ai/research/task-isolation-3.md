# Task 130 research — 2026-11-13

Sources read before implementation:
- Installed SDK `node_modules/@medplum/core` and saved installed client source `/workspace/ai-logs/task-isolation-2-research/installed-client.ts` (5.1.13); local server bundle `server.js` and `server-package.json` (5.2.15) in that research directory. Server policy builder adds legacy wildcard when both access/accessPolicy are absent, substitutes reference/string parameters, and injects profile/patient. Write evaluator binds `%before` and `%after` as runtime FHIRPath variables. These two tokens are NOT membership parameters.
- [Versioned policy builder](https://github.com/medplum/medplum/blob/v5.1.13/packages/server/src/fhir/accesspolicy.ts), [server repository](https://github.com/medplum/medplum/blob/v5.2.15/packages/server/src/fhir/repo.ts), [SDK](https://github.com/medplum/medplum/blob/v5.1.13/packages/core/src/client.ts), [Medplum policy docs](https://www.medplum.com/docs/access/access-policies).
- [FHIR R4 security](https://hl7.org/fhir/R4/security.html): authorization belongs to the implementation; FHIR alone does not isolate clinics. [FHIR R4 optimistic locking](https://hl7.org/fhir/R4/http.html#concurrency): pin membership PUT to the read version using If-Match.
- [OWASP A01](https://owasp.org/Top10/A01_2021-Broken_Access_Control/) and [authorization cheat sheet](https://cheatsheetseries.owasp.org/cheatsheets/Authorization_Cheat_Sheet.html): deny by default, check object access server-side, exercise direct reads/searches/writes with authenticated users.
- [Next route handlers](https://nextjs.org/docs/app/api-reference/file-conventions/route), [React reference](https://react.dev/reference/react): no UI changes required.

Merged code inspected: `lib/fhir/clinic-access-policy.ts`, `admin-service.ts` (withClinicMembershipAccess), setup-access-policies, Lab subscription handler, POCT fixture/tests, Phase 1 regression, backfill script, and Phase 2 draft.

Findings before edits:
- Lab subscription accepts POCT OR PACS (shared DiagnosticReport channel); the POCT test disables only POCT before expecting 403. Another notification test assumes both modules off. Preserve shared channel semantics and make fixture module assumptions explicit. Baseline running before changes.
- Draft migration scans every %token and would reject merged policy `%before`/`%after`. Recognize these runtime variables separately; require merged write-containment parameter/rules rather than migrating onto an old read-only policy.
- Draft regex escaping uses backslashes inside string parameter substitution (server JSON replace); mirror merged helper's `[.]` escape and deduplicated sorted union exactly.
- Draft dry-run with an explicit already migrated membership reports failure instead of a verifiable already-migrated outcome.
- Backups/lock and membership version guard exist; retain them. Rollback must remain available if live policy changes. Do not normalize untrusted pagination origins into local paths. Avoid printing Practitioner names.

Validation will use local fake disposable memberships first, one per script invocation, original-grant backups outside the repository, real password logins, direct FHIR negative probes and own-clinic workflows. Production migration remains a manual user step and is not performed.

Baseline completed: 31/38; subscription failure at poct.spec.ts:483, 403 vs 503. Notifications passed. Composer failure at workflow.spec.ts:132; captured fake-only screenshot shows other order lines present, but helper recorded para/full-blood counts zero before debounce. Its immediate count is a fixture race; seeded matches must be awaited. Lint/build/clinic check all pass.

Resume verification: re-read installed-client snapshot (`startLogin`, `processCode`, `setAccessToken`), versioned server access-policy substitution/default wildcard and repository write evaluator; re-opened official Medplum access-policy, FHIR R4 HTTP concurrency and OWASP A01 references. `processCode` obtains PKCE verifier from SDK storage, so the Node fixture exchanges its explicit S256 verifier at `/oauth2/token` then calls the verified `setAccessToken` API. Live local clinic policy comparison reports 57/57 rules and no refresh required. Legacy account-backfill dry-run found only 23 unresolved orphan Provenance records; do not invent clinics for those audits.
