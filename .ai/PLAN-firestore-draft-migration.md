# Plan: legacy Firestore consultation-draft migration (Task 365)

Prerequisite for the production rollout of PR #235 (U1b, retain unsigned drafts). The Task 170 review
(`.ai/REVIEW-u1b-draft.md`) approved #235 but left this as the open deployment gate.

Operator steps: `.ai/RUNBOOK-firestore-draft-migration.md`. Code: `scripts/firestore-draft-migration/`.
Tests: `tests/unit/firestore-draft-migration.test.ts`. Research notes: `.ai/research/task-365-firestore-draft-migration.md`.

No AI agent has connected to real Firebase, Supabase or production Medplum for this task. Everything below
about the *content* of the production collection is therefore unknown until Hidayat runs the read-only export.

## 1. What legacy drafts exist

Before #235, only one kind of unsigned work was stored on a server: the **treatment plan draft** of the order
composer (items, services, packages, documents). Notes and diagnoses lived in React state only and were lost on
reload, so there is nothing of theirs to migrate.

| | Legacy (before #235) | New (after #235) |
|---|---|---|
| Store | Firestore collection `consultation_treatment_plans` | Medplum `DocumentReference`, `docStatus: preliminary` |
| Document id / key | the `draftId` sent by the browser | sha256 of `[clinic, practitioner, patient, consultation or '', draftId]` |
| Fields | `draftId`, `clinicId?`, `patientId`, `consultationId?`, `entries[]`, `summary`, `createdAt`, `updatedAt` | base64 JSON of `entries[]` in `content[0].attachment.data` |
| Owner | none (any clinic user with the id) | exactly one `author` Practitioner |
| Clinic | optional `clinicId` field | `clinic` identifier plus the patient's `meta.accounts` |
| Cleared state | document deleted | `status: superseded`, content `{}` |

The only draft id the current UI reads back is `profile-treatment-<patientId>-<consultationId|pending>`
(`patient-profile-workspace.tsx:275`, `checkout-client.tsx:487`). The old route could also invent
`consultation-<id>` and `patient-<id>` ids; no current screen asks for those.

The collection may well be **empty or near-empty**: the old route had a "persistence unavailable" fallback
because Firestore credentials were often missing. The export prints the count; if it is zero the migration is
finished at step 1 of the runbook.

## 2. Mapping

For each exported document that passes every check in section 3:

- `subject` = `Patient/<patientId>`; `context.encounter` = the consultation (omitted for `pending`).
- `author` = the owning Practitioner (section 4).
- identifiers: `clinic|<clinicId>`, `urn:ucc:consultation-draft|<key>` (same derivation as the app, pinned by a
  parity test), and a provenance marker `urn:ucc:consultation-draft:legacy-firestore|<sha256 of the Firestore path>`.
- `date` = the legacy `updatedAt`.
- content = the entries reduced to the known `TreatmentPlanEntry` fields. `lineTotal` is always recomputed from
  quantity x unit price, as the app does, so a corrupt stored total cannot reach billing. The legacy `summary`
  is dropped (the app recomputes it on every read).

The provenance marker is how the script recognises its own writes. The app rewrites the identifier list on every
save, so the marker disappears the moment a clinician edits the draft. From then on the document is the
clinician's and neither migrate nor rollback will touch it.

## 3. Edge cases and what the script does

Every refusal is a named skip reason in the summary; nothing is silently dropped.

| Case | Outcome |
|---|---|
| No entries | `skip:empty` |
| Draft id is not `profile-treatment-<patient>-<consultation or pending>` | `skip:unreachable-draft-id` (the UI could never show it) |
| `draftId` field differs from document id; `consultationId` differs from the id suffix | `skip:inconsistent-draft-id` / `inconsistent-consultation` |
| `clinicId` names another clinic | `skip:other-clinic` |
| No `clinicId` (older documents) | clinic taken from the Patient's `clinic` identifier; `other-clinic` if it is not this run's clinic |
| Patient deleted, or in a different clinic than the draft claims | `skip:patient-missing` / `patient-clinic-mismatch` |
| Encounter deleted, belongs to another patient or clinic | `skip:encounter-missing` / `encounter-patient-mismatch` / `encounter-clinic-mismatch` |
| Any malformed entry (bad tab, negative or non-numeric amounts, duplicate ids, non-string fields) | `skip:invalid-entries` (whole draft refused, never partially imported) |
| Owner cannot be derived, or several practitioners on the encounter | `skip:owner-unresolved` / `owner-ambiguous` (section 4) |
| Owner practitioner deleted or inactive | `skip:owner-missing-or-inactive` |
| Clinician already saved a new draft in the same slot after rollout | `skip:target-has-newer-draft` (newer work always wins) |
| Clinician already cleared the slot (signed/submitted or Clear all) | `skip:target-cleared-by-user` (never resurrected) |
| Clinician saves between the script's plan and its write | conditional create returns their document; `skip:target-has-newer-draft` |
| Same key, different author/patient/clinic | `skip:target-conflict` |
| Already migrated | `skip:already-migrated` (idempotent; a second apply writes nothing) |
| Same document twice in the export | `skip:duplicate-in-export` |
| Server does not put the new draft in the patient's clinic account | that one draft is undone and the **whole run aborts** (exit 3) |
| `--since` given and draft is older or undated | `skip:older-than-since` / `no-timestamp` |

**Stale drafts are the main clinical risk.** Treatment drafts are normally cleared when the doctor submits the
plan, so anything left in Firestore is by definition unfinished or abandoned. A migrated draft for a visit
reappears in that visit's composer and is also loaded by checkout (`draftEntries`). Importing a months-old
abandoned draft could therefore put unexpected lines in front of a doctor or cashier. Mitigation: the private
report lists each draft's `updatedAt`, and the runbook asks for `--since` (suggested: 7 days before cutover)
unless Hidayat reviews the older ones individually.

**Pending drafts** (`...-pending`, patient with no consultation yet) have no encounter, so no owner can be
derived. They also become invisible to the UI as soon as that patient has a consultation, because the draft id
then switches to the consultation id. They migrate only with an explicit owners-file entry.

## 4. Owner resolution

The new store is per-practitioner; the legacy one had no owner. The key includes the practitioner, so a draft
attached to the wrong practitioner is invisible to the right one. Order of precedence:

1. `--owners <file>`: `{ "<legacy document id>": "<Practitioner id>" }`, reviewed by the operator.
2. The single `Practitioner` in `Encounter.participant`.
3. Only with `--owner-from-encounter-author`: the Practitioner who last wrote the Encounter (`meta.author`).

Without (3) the candidate from `meta.author` is still written to the private report as `candidateOwner`, so it
can be reviewed and copied into the owners file.

Finding on dev Medplum (fake data): none of the eight most recent encounters carried a practitioner
participant; all had a Practitioner `meta.author`. Expect the same in production, i.e. most drafts will need (1)
or (3). `meta.author` is the last writer, usually the signing doctor but possibly a nurse or cashier who touched
the visit later, which is why it is opt-in and why the report shows the candidate first.

Note, not caused by this migration: because drafts are per-practitioner in #235, a cashier at checkout no longer
sees the doctor's draft entries. That is existing #235 behaviour and applies to migrated drafts too.

## 5. Safety properties

- Dry-run is the default. `--apply` is required to write; rollback is also dry-run without `--apply`.
- One clinic per run (`--clinic`), every resource checked for that clinic's identifier. No cross-clinic reads
  are used to make decisions.
- Refuses any Medplum other than `localhost:8113` unless `--allow-remote-host <exact https hostname>` is given.
- Creates use `If-None-Exist`, updates use `If-Match`. The script never updates or deletes a document the
  application wrote.
- Firestore is only ever read (`collection.get()`), by a separate export script. Nothing is deleted there, so
  the legacy data stays as the source of truth until Hidayat removes it.
- Console output carries counts and hashed source ids only. Export, report and manifest must live outside the
  repository, are created `0600`, and are never overwritten.

## 6. Rollback

- **Of the migration:** `--rollback --manifest <file>` undoes exactly what one apply run wrote. Each draft is put
  in the application's own cleared state (`superseded`, content `{}`), pinned to the version the script wrote.
  A draft a clinician has since edited or cleared is kept (`changed-by-clinician-kept`). Rollback is repeatable,
  and re-running `--apply` afterwards restores the drafts.
- **Of the #235 deploy:** redeploying the previous build makes the app read Firestore again. Firestore was never
  modified, so legacy drafts are exactly as they were. Drafts created in Medplum during the window stay there,
  unused by the old build.
- **Not undone:** as with any cleared draft, earlier versions remain in FHIR history under existing retention
  (Task 170 MINOR 2). No hard delete is performed.

## 7. Verification done

- 36 unit tests with fake fixtures and an in-memory FHIR fake, including a test that reads a migrated draft back
  through the real `lib/fhir/consultation-draft.ts`.
- `tsc --noEmit` clean.
- One end-to-end trial against **dev** Medplum (`localhost:8113`, fake data, hand-written fake export):
  dry-run, apply, second apply (no-op), rollback dry-run, rollback, second rollback (no-op), re-apply (restore),
  final rollback. All behaved as designed, including clinic-account inheritance for a client-credential write.
- Not done: the Firestore export script has never been executed (no Firebase access by design); no browser
  check that a migrated draft renders in the composer (no dev server allowed in this session).

## 8. Open decisions for Hidayat

1. `--since` cutoff, or review old drafts one by one.
2. Owners: reviewed owners file, or accept `--owner-from-encounter-author`.
3. When to delete the Firestore collection (suggested: not before two weeks of stable production).
