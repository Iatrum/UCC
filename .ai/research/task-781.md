# Task 781: X-ray phase 3, what is the next unfinished step?

Finding: **phase 3 is complete.** There is no unfinished implementation step, so nothing was built. Docs only.

Checked (read-only, on origin/dev 239510c, 2026-11-22):
- `.ai/PLAN-xray-phase3.md` (Task 357): ingest (Orthanc Lua -> `/api/pacs/orthanc/study`), accession matching, review list, single-use viewer launch, study-scoped read-only DICOMweb proxy, one Orthanc per clinic. Merged in #255, #256, #257.
- `.ai/research/task341f.md`: full low-memory gate on dev + dev PACS, 67/68 (only the known-bug summary probe fails, as on baseline), `xray-phase3` real DICOM -> Orthanc -> UCC -> OHIF passed.
- Follow-ups merged since: #263 (viewer session revoke when `pacs` is off), #273 (DICOM e2e), #266 (gate), #290 (Tasks 515/517/518: study card UX, accession-less orders rejected when X-ray is on, labs-imaging fails closed).
- `git branch` / `gh pr list --draft`: no open draft PR covers X-ray phase 3 (only #363, a backlog docs PR).
- `.ai/BACKLOG.md` has no open X-ray item.

What the plan still lists are **production decisions**, not phase 3 steps (PLAN-xray-phase3.md "Production notes", numbered 1 to 14). The ones that need an owner choice before a clinic uses real X-ray:
1. Storage size and retention (about 440 GB/year per clinic at 30 studies/day), external object storage, PostgreSQL index.
2. Where Orthanc runs (own host; the shared VPS has 74 GB free and tight RAM).
3. Network: DICOM port 4242 on clinic LAN/VPN only, register each modality AET.
4. Viewer on its own HTTPS hostname, no access logs on `/launch`.
5. Optional code, only if the clinic wants it: modality worklist (MWL) so the accession is not typed by hand (note 11), and an AuditEvent for viewer opens (note 13). Both are small, separate tasks and neither is needed for a pilot that keeps the X-ray toggle off.
6. Regulatory position of OHIF as a review viewer (note 14).

No code, test or config changed. No server started. Dev PACS not touched.
