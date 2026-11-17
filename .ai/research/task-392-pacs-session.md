# Task 392 - PACS viewer session revocation + cross-instance single-use launch tokens

Sources: Medplum conditional create (`If-None-Exist`, https://www.medplum.com/docs/fhir-datastore/create-fhir-data , `MedplumClient.createResourceIfNoneExist`), FHIR R4 conditional create (https://hl7.org/fhir/R4/http.html#ccreate), FHIR R4 `Basic`.

## (a) Toggle OFF
Session cookies are stateless HMAC tokens (15 min). Instead of tracking sessions, the launch route and the DICOMweb proxy now re-check the clinic `pacs` module toggle (`isModuleEnabledForClinic`) via `lib/pacs/viewer-guard.ts`. Cached 5 s per clinic per process, so OFF takes effect within ~5 s on every instance (needs no shared state). Any error -> denied. Launch refuses before consuming the token.

## (b) Single-use across instances
`consumeLaunchTokenShared`: per-process map first, then conditional create of a `Basic` (identifier `urn:ucc:pacs-launch-jti|<jti>` + `clinic|<id>`) with a random nonce in `code.text`; the winner is the one whose nonce comes back. Medplum enforces If-None-Exist server-side. Fails closed if Medplum is down. Best-effort sweep deletes records older than 10 min.
Known limit: Medplum's conditional create is not a hard unique constraint under extreme true concurrency (two simultaneous requests could in theory both create); the 60 s life and clinic/study binding bound the impact.
