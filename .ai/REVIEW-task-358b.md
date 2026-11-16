# Task 358b review

- Treatment Sign is the only issuance path. Existing composer fields remain the source for MC dates/days/optional diagnosis and referral recipient/clinical content; actual patient, doctor and clinic identity come from authenticated FHIR data.
- Draft Procedure records use preparation. New documents are current/final only in the same FHIR transaction that replaces Procedures. Invalid MC/referral fields fail before that transaction.
- Historical completed notes are not retrospectively issued. They remain visibly draft/legacy until a new draft is explicitly signed.
- Clinic identifier checks cover the Encounter, Patient and Organization before issuance. Artifact list and ID lookups query the clinic identifier, then verify it. Encounter and patient links are stored on each document.
- Stable conditional-create identifiers deduplicate retries. An Encounter version condition detects concurrent signing when the server supplies a version.
- Stored HTML uses base64 Attachment.data, with escaped patient/clinical content and print CSS. Viewing uses a sandboxed iframe. Reads are authenticated and no-store. Issued artifacts cannot be changed/deleted via the generic document mutation API.
- Reprinting reads the persisted snapshot, including its original patient details, issuing doctor, clinic and date. No regeneration from current templates or patient records.
- Firebase upload handling, navigation, lab/POCT behavior and the rest of the composer remain intact.

## Validation limits

The requested origin/main lacks the repository-wide e2e/scripts/check-all.sh harness. It cannot be truthfully reported as passing. The existing Python static suite has exactly the same three patient-document-dialog failures as origin/main; the composer assertions were updated for the deliberately changed draft labels.

The dev Medplum staff policy is newer than origin/main: baseline patient creation as the existing fake doctor returns Forbidden before this feature runs. Do not weaken or migrate shared policies. The real API/browser lifecycle uses the local fake-data admin fixture with explicit clinic scope; ordinary staff permissions remain an integration limitation for this base.
