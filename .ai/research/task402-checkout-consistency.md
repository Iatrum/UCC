# Task 402 — fixes for Task 359 review of Task 358 (checkout stock deduction)

## Verified on the dev Medplum (127.0.0.1:8113, fake data, probe objects deleted)
- `request.ifMatch` inside a transaction Bundle entry is **ignored** (stale version accepted, with W/"v", "v" and bare forms).
  So the original PR's Medication If-Match in the stock transaction did not protect anything.
- `If-Match` as an HTTP **header** on a single `updateResource` works (412 Precondition Failed for stale).
- Conditional update entry `PUT Invoice?_id=..&_lastUpdated=eq..` with a stale value returns entry status 400, but
  the other entries in the same transaction were **still applied** (no rollback) → transactions cannot be used as a guard.
- A no-op PUT does not bump the version.
Docs: FHIR R4 http#concurrency (ETag/If-Match), Medplum SDK `updateResource(resource, {headers})`, `createResourceIfNoneExist`.

## Design
Per (visit, medication): read dispense → check invoice version → claim dispense (If-Match header; conditional create with
claim token) carrying `stock-pending` delta → If-Match PUT of Medication (retry on 412) → settle dispense.
- P1 concurrency: invoice saved with If-Match (retry re-reads); reconcile aborts as `superseded` if the invoice version moved, was
  cancelled or deleted; dispense claim serializes concurrent reconcilers; only the claim owner settles (no double stock write);
  failed stock write releases the claim; abandoned claim taken over after 30 s (`STALE_CLAIM_MS`).
- P1 ambiguity: earlier deductions are restored only when no unresolved line (ambiguous name / renamed item) could still bill them;
  reported via `unresolved`/`retained` and a `stock-line-unresolved` billing exception Task. Reverse is keyed by dispense/medication id.
- P2 pagination: `searchAll` follows `_offset` pages for catalog and dispenses.
- P2 void/delete: invoice is cancelled (If-Match) BEFORE stock is restored; delete = cancel → restore → delete. Re-running void on a
  cancelled invoice retries only the restore.

## Residual risks
- Network timeout *after* the server applied the Medication PUT can leave a settled-but-unmarked claim; stale takeover would then apply it once more (rare).
- Concurrent first checkouts for a visit with no invoice can still create two invoices (not changed here).
- Live concurrent e2e not rerun (RAM/rate-limit); unit tests use a fake mirroring the verified Medplum behaviour.
