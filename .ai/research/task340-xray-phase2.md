# Task 340: POCT X-ray phase 2 (depends on #240, #241)

Done: per-clinic PACS viewer host allowlist + safe viewer link in Labs & Imaging.
- Storage: Organization extension `https://ucc.emr/organization-pacs-viewer-hosts` (JSON string list), same pattern as the module toggle. Admin edits it in /admin/clinics/[id] (shown only when `pacs` is enabled); PATCH validates and returns 400 on any bad entry. Platform-admin only.
- Validation (`lib/fhir/pacs-allowlist.ts`): DNS names only, optional :port, https implied; rejects schemes, paths, userinfo, wildcards, IP literals (v4/v6, so no loopback/private/link-local/metadata), single-label and internal suffixes (.local, .internal, ...); max 20. Entries are re-validated on read. Missing/corrupt => empty => default deny.
- Enforcement: `/api/imaging/results` keeps an X-ray study's `pacsUrl` only if the study modality is DX/CR/RG, the URL is https, credential-free and its exact host[:port] is on the caller clinic's list. Series `endpoint` of X-ray studies gets the same check. Everything else is dropped server-side.
- No open redirect / SSRF: the server never fetches or redirects to the URL; the UI renders a plain `<a target=_blank rel="noopener noreferrer nofollow" referrerPolicy=no-referrer>`. Generic (non-X-ray) imaging unchanged except `noopener` on the series open.
- Result link stays Lab-tab only, behind the default-off `pacs` toggle; ordering still requires an online device; no manual entry.
Not done: iframe/DICOM-web embedding (would need CSP frame-src per clinic, left as a link on purpose), report entry.
Docs: FHIR ImagingStudy https://hl7.org/fhir/R4/imagingstudy.html; WHATWG URL parsing (backslash = slash, userinfo/host split) https://url.spec.whatwg.org/.
Validation: bun unit 82 pass; tsc clean; e2e xray.spec 7/7 + xray-phase2.spec 1/1 on own dev server :3340 (now stopped). Not run: full check-all.sh, admin form e2e (needs the opt-in Medplum admin login; covered by unit tests of the validator only).
Screenshots: .ai/ux-shots/task340/{before-default-deny,after-allowlisted-link}.png
