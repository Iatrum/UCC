# X-ray phase 3: real DICOM storage + viewer (Task 357)

Status: implementation merged in #255; clinic/logging corrections merged in #256; final review/validation in #257. Previously built and tested on the VPS **dev** stack only, behind the existing default-off `pacs` clinic toggle. Synthetic DICOM only. Nothing here touches production containers (`medplum-*`, `root-traefik-1`), `/opt/medplum` or `/root`.

## What it does

```
X-ray device --C-STORE/STOW--> Orthanc (stores pixels)
   Orthanc Lua OnStableStudy --POST {orthancStudyId} + per-device key--> UCC /api/pacs/orthanc/study  (202)
   UCC (after the response) reads the study back from Orthanc, matches AccessionNumber
      -> exactly one open X-ray order of the device's clinic: create/update ImagingStudy, complete the order
      -> anything else: review list (FHIR Task), never attached automatically
Staff, Labs & Imaging tab: "Open images" --POST /api/pacs/viewer/link--> 60 s single-use launch URL
   viewer origin /launch -> UCC sets a 15 min HttpOnly cookie for that one study -> OHIF
   OHIF /dicom-web/* -> UCC /api/pacs/dicomweb/* (study-scoped, read-only) -> Orthanc (credentials added server-side)
```

- **Join key.** A new X-ray order gets an accession identifier (`https://ucc.emr/xray/accession`, `UX` + 12 characters, fits DICOM SH 16). It is shown in the Lab tab's "Pending X-ray" card ("Accession #" column). The radiographer (or, later, a modality worklist) puts it on the study. Orders created before this change have no accession number: their studies land in the review list.
- **Clinic scope.** The clinic always comes from the authenticated Device key (#236). The order search carries both the clinic and the accession identifier and is re-checked on the result, so the same accession on another clinic's order never matches. `receiveImagingStudy` then re-asserts the order's clinic and accounts.
- **Review list.** PACS page (`/pacs`) shows "Studies needing review" only when there are entries. Staff can attach an entry to an open X-ray order of their own clinic (the study is re-read from Orthanc first) or dismiss it. Dismiss does not delete the images from Orthanc.
- **Viewer link.** Minted only for a signed-in user of the study's clinic with `pacs` on (foreign clinic 403, anonymous 401). The launch token is HMAC-signed, bound to clinic + StudyInstanceUID, valid 60 s, single use. The session cookie is HttpOnly, `SameSite=Strict`, `Path=/dicom-web`, one per study, 15 min. The proxy refuses any path outside that study, forces study searches to it, allows GET only, and returns only the body and content type from Orthanc.
- **No Orthanc credentials or address reach a browser.** The OHIF container holds no secret; Orthanc listens on 127.0.0.1 only and refuses anonymous requests.
- **Rules kept.** Results and the viewer button are in the Lab tab only; no composer change, no critical-result warning, no manual result entry, no sidebar/nav change, Firebase Storage untouched.

## Dev setup (VPS dev or a laptop)

Compose project `ucc-pacs-dev` in `infra/pacs-dev/`:

| Service | Image (pinned) | Limits | Listens on |
|---|---|---|---|
| `ucc-pacs-orthanc` | `orthancteam/orthanc:26.11.0` (DICOMweb plugin 1.24) | 384 MB | 127.0.0.1:8042 (REST/DICOMweb, basic auth), 127.0.0.1:4242 (DICOM) |
| `ucc-pacs-ohif` | `ohif/app:v3.13.14` (nginx, host network) | 128 MB | 127.0.0.1:3320 (viewer), 172.31.57.1:3321 (webhook relay, docker bridge only) |

Measured idle: Orthanc about 27 MB, OHIF about 4 MB.

```bash
cd infra/pacs-dev
./up.sh                                   # first run creates .env.local, viewer-secret, secrets/ (all git-ignored)
PACS_ORTHANC_CLINICS=demo ./up.sh ucc-env >> ../../.env.local       # PACS_* server env for UCC (refuses to print to a terminal)
# issue an X-ray Device key in UCC for the clinic, then put it (one line) in secrets/device-key
UCC_UPSTREAM=127.0.0.1:3357 ./up.sh       # only if UCC is not on :3210
./gen-synthetic.sh /tmp/dcm UXTEST123456 2   # synthetic DX images (pydicom in a throw-away container)
./resync.sh http://127.0.0.1:3210         # re-send every Orthanc study to UCC (idempotent)
./up.sh down                              # stop; the orthanc-db volume is kept
```

UCC server env (all six required, otherwise the PACS routes answer 503 and no viewer button works):
`PACS_ORTHANC_URL`, `PACS_ORTHANC_USER`, `PACS_ORTHANC_PASSWORD`, `PACS_VIEWER_ORIGIN`, `PACS_VIEWER_SECRET` (32+ characters), `PACS_ORTHANC_CLINICS` (exactly one clinic id owning this archive; unset or multiple ids fail closed).

## Tests

- Unit (`bun test tests/unit`): `pacs-viewer-token.test.ts` (tokens, cookie handling, DICOMweb scoping, accession, Orthanc mapping) and `pacs-ingest-viewer.test.ts` (ingress auth, matching, review list, link/launch/proxy with a fake Medplum and fake Orthanc).
- E2E (`e2e/tests/xray-phase3.spec.ts`, skipped when the dev PACS is absent): generates synthetic DICOM, stores it in Orthanc, waits for the Lua webhook to produce the ImagingStudy, checks unmatched and foreign-clinic cases, the viewer link and proxy scoping, and opens the study in OHIF from the Lab tab. Screenshots: `.ai/ux-shots/task357/`.

## Production notes (not done; needs a decision before any production rollout)

1. **Storage sizing.** Plan 10 to 30 MB per X-ray image (uncompressed DX/CR), usually 1 to 3 images per study. Example: 30 studies/day x 2 images x 20 MB is about 1.2 GB/day, about 440 GB/year per clinic. The VPS disk (96 GB, 74 GB free today) is not enough beyond a short pilot. Options: lossless transcoding on ingest (Orthanc `IngestTranscoding` to JPEG-LS/JPEG 2000 lossless, measure the storage reduction with representative synthetic images; needs a viewer check), a retention policy, and external storage.
2. **External storage.** Move pixels to object storage with the Orthanc object-storage plugin (S3-compatible, also Azure/GCS) and the index to PostgreSQL (Orthanc PostgreSQL plugin) instead of the default SQLite. Both are bundled in the `orthancteam/orthanc` image but are not enabled or tested here. Encrypt the bucket, keep it private, and back up the index together with the bucket.
3. **Memory.** Orthanc is capped at 384 MB. DICOMweb plugin 1.24 in this image buffers STOW and WADO chunked transfers in RAM (it logs a performance warning), so a very large multi-frame study could hit the cap. Plain DX images are fine. Keep 2.5 GB free on the shared VPS; better, run the PACS on its own host.
4. **One Orthanc per clinic is enforced.** `PACS_ORTHANC_CLINICS` must contain exactly one clinic id. A foreign clinic device is rejected before reading Orthanc; staff attachment, launch and proxy access check the same binding. A shared archive requires authoritative per-study ownership and is outside this implementation. Never repoint an archive containing one clinic's images at another clinic.
5. **Network.** The X-ray device must reach Orthanc's DICOM port (4242) over the clinic LAN or a VPN, never the public internet. Register each modality AET (`DicomModalities`); `DicomAlwaysAllowStore` stays false. DICOM TLS is available in Orthanc and not configured here.
6. **Viewer origin.** Serve OHIF on its own HTTPS hostname (for example `viewer.<domain>`) behind the existing reverse proxy, set `PACS_VIEWER_ORIGIN` to it (the cookie then gets `Secure`). Only `/launch` and `/dicom-web/` are forwarded to UCC. Disable query/access logging for `/launch` at every proxy (it carries the bearer launch token); the supplied nginx template and Next dev config already suppress it. The webhook relay must stay on a private interface.
7. **Launch tokens are single-use per app process.** The used-token list is in memory. With more than one UCC instance a launch URL could be redeemed once per instance within its 60 s life. Use a shared store (or one instance) before scaling out.
8. **Webhook delivery.** UCC answers 202 and ingests after the response, retrying for about 20 s if Orthanc is unreachable. If UCC is down when a study arrives, the notification is lost: run `resync.sh` (or schedule it). Orthanc must not be called back synchronously from inside its Lua callback: it deadlocks (documented by Orthanc, reproduced here).
9. **Access after the toggle is switched off.** New links stop at once; an already-open viewer session lasts up to 15 minutes.
10. **Orthanc upgrade.** DICOMweb plugin 1.25+ wants `DicomWeb.AllowedHosts` (or `Host`) set to the viewer host before it trusts the `Forwarded` header UCC sends; set it when moving past 26.11.0 and re-run the e2e (it checks that no Orthanc address appears in metadata).
11. **Worklist.** Typing the accession number by hand is error-prone. Orthanc's worklist plugin can serve the open orders to the modality (MWL) so the accession is filled automatically. Not built.
12. **Retention and deletion.** Dismissed or wrong studies stay in Orthanc until deleted there. Decide the retention period and who may delete.
13. **Audit.** ImagingStudy creation writes a Provenance record as before. Viewer opens are not audited yet (the link route knows clinic, user and study; add an AuditEvent if required).
14. **Clinical use.** OHIF is not a cleared diagnostic device; treat it as a review viewer unless the clinic's regulatory position says otherwise.
