# Runbook: migrate legacy Firestore treatment drafts (Task 365)

For Hidayat, to run on production himself. Background and reasoning: `.ai/PLAN-firestore-draft-migration.md`.
Nothing here has been run against production by an AI agent. The export script has never been executed at all;
the migrate/rollback script has been run end to end against dev Medplum with fake data.

Time needed: about 20 minutes per clinic. Do it outside clinic hours.

## What you need

- A checkout of `dev` containing this task, with `bun install` done.
- Production env values, in a private env file **outside the repository** (for example `~/ucc-migration/prod.env`,
  mode 600):
  - `MEDPLUM_BASE_URL`, `MEDPLUM_CLIENT_ID`, `MEDPLUM_CLIENT_SECRET` (a project-admin ClientApplication)
  - Firebase service account: `FIREBASE_SERVICE_ACCOUNT`, or `FIREBASE_PROJECT_ID` + `FIREBASE_CLIENT_EMAIL` + `FIREBASE_PRIVATE_KEY`
- The clinic ids to migrate (one run per clinic).
- A working directory outside the repository: `mkdir -p -m 700 ~/ucc-migration/firestore-drafts`

All files produced below contain patient-linked data. Keep them in that directory; the scripts refuse paths
inside the repository and never overwrite a file.

```sh
cd <repo>
W=~/ucc-migration/firestore-drafts
ENV=~/ucc-migration/prod.env
HOST=<production Medplum hostname, exactly as in MEDPLUM_BASE_URL, without https://>
```

## Order of events

1. Deploy the build that contains #235. From this moment the app no longer writes to Firestore, so the legacy
   collection is frozen.
2. Straight away, run steps 1 to 5 below.

Until step 4 finishes, doctors do not see their old treatment drafts. If one starts a new draft in the meantime,
theirs is kept and the legacy one is skipped.

## Step 1. Export Firestore (read-only)

```sh
bun --env-file=$ENV scripts/firestore-draft-migration/export-firestore.ts \
  --project <firebase project id> --out $W/export.json
```

It prints how many documents exist and how many have at least one entry. **If that second number is 0, stop:
there is nothing to migrate.** Skip to "Afterwards".

## Step 2. Dry-run (writes nothing)

```sh
bun --env-file=$ENV scripts/firestore-draft-migration/migrate.ts \
  --input $W/export.json --clinic <clinicId> --allow-remote-host $HOST \
  --report $W/report-<clinicId>-dry.json
```

Check the first line shows the right host, the right clinic and `dry-run (no writes)`. Then read the summary:

- `create:new` are the drafts that would be migrated.
- `skip:other-clinic` is normal (they belong to the other clinics' runs).
- `skip:empty`, `skip:unreachable-draft-id` are normal leftovers.
- `skip:owner-unresolved` / `owner-ambiguous` need step 3.
- Anything else: look it up in the plan, section 3. Skips are safe; they just mean that draft is not migrated.

Open the report. Each row has `updatedAt`. Decide a cutoff: old drafts are abandoned work and would reappear in
the composer and at checkout. Recommended: add `--since <date 7 days before the deploy>` to every command below.

## Step 3. Owners

Drafts need an owning doctor. Rows with `owner-unresolved` carry a `candidateOwner` (the practitioner who last
saved that visit). Choose one:

- **Reviewed (preferred when there are few):** create `$W/owners-<clinicId>.json`:
  ```json
  { "<legacyId from the report>": "<Practitioner id>" }
  ```
  and add `--owners $W/owners-<clinicId>.json`.
- **Automatic:** add `--owner-from-encounter-author` to accept every candidate. The candidate can be a nurse or
  cashier if they edited the visit after the doctor; that doctor would then not see the draft.

Re-run step 2 with the chosen options (new `--report` file name) until the summary is what you expect.

## Step 4. Apply

Same command and options as the last dry-run, plus `--apply` and a manifest path. Optionally do one first with
`--limit 1` and look at that patient in the app.

```sh
bun --env-file=$ENV scripts/firestore-draft-migration/migrate.ts \
  --input $W/export.json --clinic <clinicId> --allow-remote-host $HOST \
  [--since ...] [--owners ... | --owner-from-encounter-author] \
  --apply --manifest $W/manifest-<clinicId>-1.json --report $W/report-<clinicId>-apply.json
```

Expected: `create:new (written)` equals the dry-run's `create:new`, exit code 0. **Keep the manifest**: it is
the only way to roll back. Each apply run needs a new manifest file name (`-2`, `-3`, ...).

Running it again is safe: it reports `skip:already-migrated` and writes nothing.

## Step 5. Verify

- Log in as one of the owning doctors, open a migrated patient's visit: the order composer shows the items and
  says the draft is saved.
- Log in as a doctor of another clinic: nothing of this clinic is visible.
- Repeat steps 2 to 5 for the next clinic.

## Rollback

```sh
# preview
bun --env-file=$ENV scripts/firestore-draft-migration/migrate.ts \
  --rollback --manifest $W/manifest-<clinicId>-1.json --clinic <clinicId> --allow-remote-host $HOST
# do it
... same command ... --apply
```

Each migrated draft is cleared, exactly as if the doctor had pressed Clear all. Drafts a doctor has already
edited or cleared are left alone (`changed-by-clinician-kept`). Run it once per manifest. Re-running step 4
afterwards restores them.

If the #235 deploy itself is rolled back, no migration rollback is required: the old build reads Firestore,
which was never changed.

## If it aborts

`ABORTED: clinic-account-mismatch-undone` (exit 3): the server did not place a migrated draft in the patient's
clinic account, so the script cleared that one draft and stopped. Nothing is left exposed. Do not retry; the
admin client or the access policy differs from dev and needs a look first.

`ABORTED: clinic-account-mismatch-UNDO-FAILED`: same, but the clear also failed. Run the rollback command with
the manifest that was just written; it contains that draft.

Exit code 2: some drafts ended as `error:` (lookup or write failed, usually network). Re-run the same command;
finished drafts are skipped.

`Failed (<ErrorName>)`: an unexpected error. Details are deliberately not printed because they can contain
patient data or tokens. Nothing partial is left behind beyond what the manifest lists.

## Afterwards

- Keep `$W/manifest-*.json` until you are sure no rollback is wanted, then delete the whole `$W` directory and
  the env file.
- Leave the Firestore collection in place for at least two weeks of stable production. Deleting it is a
  separate, manual decision and is not part of this task.
- Record in `.ai/STATE.md`: date, clinics, counts migrated/skipped (counts only, no ids).
