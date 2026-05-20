# Medplum Workstreams Roadmap

Goal: define the Medplum-native workstreams that should be piloted after or alongside intake, without breaking the current UCC workflow.

This document is for multi-agent execution. It is intentionally organized into independent tracks so multiple agents can work in parallel with minimal overlap.

Related document:

- [MEDPLUM_PILOT_ROADMAP.md](/Users/hidayat/Documents/Projects/UCC/docs/MEDPLUM_PILOT_ROADMAP.md) covers the first intake pilot using `Questionnaire` and `QuestionnaireResponse`.

## Operating rule

- Do not replace the current workflow directly.
- Each Medplum-native capability must begin as a pilot, shadow path, or gated route.
- Every track must preserve rollback.
- No track should widen its scope beyond what is needed to prove the workflow.

## Priority order

1. `Questionnaire` / `QuestionnaireResponse`
2. `Schedule` / `Slot`
3. `Task`
4. `Bot`
5. `Subscription`
6. `CoverageEligibility*`
7. typed replacements for `Basic`
8. `Binary` / `Media`
9. stronger referral network typing
10. `SMART on FHIR` launch support

## Current status summary

Confirmed current gaps:

- appointments create `Appointment` directly and store clinician as display text rather than a reference-backed availability model: [appointment-service.ts](/Users/hidayat/Documents/Projects/UCC/lib/fhir/appointment-service.ts#L60)
- `Task` access is provisioned in policy, but there is no runtime task workflow: [setup-access-policies.ts](/Users/hidayat/Documents/Projects/UCC/scripts/setup-access-policies.ts#L90)
- `Bot` is not used in runtime code
- `Subscription` is not used in runtime code
- insurer settings are still stored as serialized `Basic`: [route.ts](/Users/hidayat/Documents/Projects/UCC/app/api/settings/insurers/route.ts#L12)
- checkout still has a hardcoded e-invoice gap: [checkout-client.tsx](/Users/hidayat/Documents/Projects/UCC/app/(routes)/orders/checkout/[consultationId]/checkout-client.tsx#L695)
- purchasing is still stored as serialized `Basic`: [route.ts](/Users/hidayat/Documents/Projects/UCC/app/api/purchases/route.ts#L51)
- documents use `DocumentReference` with external URLs, not Medplum-hosted `Binary`: [document-service.ts](/Users/hidayat/Documents/Projects/UCC/lib/fhir/document-service.ts#L34)
- referrals use `ServiceRequest`, but performer/requester are still display-only rather than typed references: [referral-service.ts](/Users/hidayat/Documents/Projects/UCC/lib/fhir/referral-service.ts#L74)

## Execution model for agents

Each track below is designed to be owned by a separate agent or PR stream.

Rules:

- one agent per track unless explicitly split further
- no agent should perform cutover work without approval
- each track should prefer additive files and feature flags over invasive edits
- update this document after each meaningful milestone

## Track 1: Intake forms

Status: planned

Primary Medplum capability:

- `Questionnaire`
- `QuestionnaireResponse`

Pilot shape:

- separate registration pilot route
- current route remains unchanged
- questionnaire artifacts are written alongside current patient creation flow

Out of scope for this track:

- scheduling redesign
- payer workflows
- referral orchestration

Depends on:

- none

Can run in parallel with:

- Track 2 through Track 10

## Track 2: Scheduling

Status: planned

Primary Medplum capability:

- `Schedule`
- `Slot`
- existing `Appointment` as the booking outcome

Problem statement:

- appointments are created directly from app data
- clinician is stored as free display text
- there is no Medplum-native availability model for providers, rooms, or imaging/lab modalities

Target outcome:

- availability is modeled explicitly
- appointments can be created from validated open slots
- future double-book prevention has a strong Medplum backing

Pilot shape:

- do not replace the current appointments UI first
- build a parallel scheduling model behind a feature flag or hidden route
- begin with one availability surface:
  - clinician availability
  - or room availability
  - or imaging modality availability

Recommended milestones:

1. model provider and clinic availability with `Schedule`
2. generate `Slot` resources for a narrow calendar window
3. create a pilot booking surface that books from slots
4. map booked slots into `Appointment`
5. compare booked-slot behavior against the current appointment flow

Suggested file areas:

- `lib/fhir/appointment-service.ts`
- `app/api/appointments/route.ts`
- new scheduling helpers under `lib/fhir/`
- pilot appointment or scheduling route under `app/(routes)/appointments/`

Out of scope for this track:

- bots
- subscriptions
- payer workflows

Depends on:

- none

Can run in parallel with:

- Track 1
- Track 3
- Track 4
- Track 5

## Track 3: Operational work queues

Status: planned

Primary Medplum capability:

- `Task`

Problem statement:

- workflow state is still mostly app-owned
- queueing, follow-up, and exception handling are not modeled as Medplum-native work items

Target outcome:

- key operational handoffs become explicit `Task` resources
- ownership, due state, and completion state become queryable and auditable

Pilot candidates:

- referral follow-up
- incomplete documentation
- abnormal result review
- billing exception follow-up
- low-stock reorder

Recommended first pilot:

- incomplete documentation or abnormal result review

Reason:

- lower financial risk than billing
- more operationally contained than referral cutover

Recommended milestones:

1. define one task profile for one workflow only
2. create task creation helpers
3. surface task list in a pilot UI or admin view
4. add task state transitions
5. validate whether staff can actually use it without friction

Suggested file areas:

- new task helpers under `lib/fhir/`
- relevant route handlers that currently own workflow transitions
- optional new UI under dashboard or admin

Out of scope for this track:

- full queue replacement across the app
- cross-module task unification on the first PR

Depends on:

- none

Can run in parallel with:

- all other tracks

## Track 4: Server-side automation

Status: planned

Primary Medplum capability:

- `Bot`

Problem statement:

- business logic is concentrated in route handlers and client-side flows
- many follow-up or enrichment behaviors should be event-driven and server-side

Target outcome:

- workflow automation lives closer to Medplum data events
- app code carries less orchestration logic

Recommended pilot candidates:

- post-registration enrichment from intake forms
- appointment reminders
- abnormal result follow-up creation
- referral progression hooks
- low-stock alert generation

Recommended first pilot:

- convert questionnaire responses into structured follow-up artifacts

Reason:

- it naturally follows Track 1
- it is narrow and easy to validate

Recommended milestones:

1. identify one bot use case
2. define input event and output artifact
3. create the bot
4. expose a safe test harness or manual trigger
5. verify idempotency and failure behavior

Out of scope for this track:

- broad rewrite of current route handlers
- many bots at once

Depends on:

- optional dependency on Track 1 if bot is intake-related

Can run in parallel with:

- Track 2
- Track 3
- Track 5

## Track 5: Real-time updates

Status: planned

Primary Medplum capability:

- `Subscription`
- WebSocket notifications

Problem statement:

- multi-user operational surfaces do not have a Medplum-native real-time update model
- waiting room, tasks, appointments, and results would benefit from push updates

Target outcome:

- client surfaces receive targeted updates when underlying resources change

Recommended pilot candidates:

- appointment changes
- waiting room status
- new lab/imaging result arrivals
- task queue changes

Recommended first pilot:

- appointment change notifications

Reason:

- smaller blast radius than full waiting room state
- aligns naturally with scheduling work

Recommended milestones:

1. define one subscribed resource type
2. create a subscription registration path
3. wire a client listener for one pilot screen
4. verify multi-user state convergence

Out of scope for this track:

- broad polling removal everywhere
- many resource types in the first iteration

Depends on:

- none

Can run in parallel with:

- Track 2
- Track 3
- Track 4

## Track 6: Payer workflows

Status: planned

Primary Medplum capability:

- `Coverage`
- `CoverageEligibilityRequest`
- `CoverageEligibilityResponse`

Problem statement:

- insurer configuration is still opaque
- payer eligibility is not modeled
- checkout still exposes an unfinished e-invoice path

Target outcome:

- panel billing and insurance eligibility are represented with typed payer resources
- app can evolve toward real payer workflows instead of string settings blobs

Recommended milestones:

1. define insurer-to-coverage model
2. introduce `Coverage` for patient payer relationships
3. design one eligibility request/response pilot
4. keep current checkout path intact while eligibility runs in parallel

Out of scope for this track:

- full billing replacement
- forced migration of all historical data on the first pass

Depends on:

- none

Can run in parallel with:

- Tracks 1 through 5

## Track 7: Typed replacements for `Basic`

Status: planned

Primary problem areas:

- insurer settings
- purchasing workflows

Problem statement:

- JSON blobs in `Basic` are workable but weak for search, policy control, interoperability, and incremental workflow evolution

Principle:

- do not replace `Basic` just for purity
- replace it when the typed resource materially improves workflow and maintainability

Priority order inside this track:

1. insurers
2. purchasing

Recommended milestones:

1. document where `Basic` is still used
2. decide per area whether a typed FHIR resource is worth the migration
3. pilot one replacement path at a time

Out of scope for this track:

- mass migration of every `Basic` record without a consumer

Depends on:

- optional dependency on Track 6 for insurer redesign

Can run in parallel with:

- all other tracks

## Track 8: Attachments and captured media

Status: planned

Primary Medplum capability:

- `Binary`
- `Media`
- `DocumentReference` with Medplum-hosted attachments where appropriate

Problem statement:

- camera, scan, audio, and file capture flows exist
- documents are registered as references to external bucket URLs
- attachment governance and auditability would improve with Medplum-native binary handling

Recommended pilot candidates:

- scanned ID capture
- consultation audio
- uploaded patient files

Recommended first pilot:

- one non-critical attachment class, such as scanned IDs or uploaded patient files

Reason:

- lower risk than moving every document class at once

Recommended milestones:

1. choose one attachment type
2. define storage and access model
3. create Medplum-hosted binary flow
4. link it back through `DocumentReference` or `Media`

Out of scope for this track:

- migrating all historical bucket content on day one

Depends on:

- none

Can run in parallel with:

- all other tracks

## Track 9: Referral network typing

Status: planned

Primary Medplum capability:

- stronger `ServiceRequest` references
- `Task`
- optional `Communication`

Problem statement:

- referral resources are conceptually correct, but destination and requester data are still largely display strings
- referral coordination is not modeled as a typed, trackable workflow

Target outcome:

- referrals reference actual `Organization` and `Practitioner` resources where possible
- operational follow-up can be attached using `Task`
- optional communications can be layered later

Recommended milestones:

1. introduce typed referral destination references
2. introduce typed requester references
3. add pilot follow-up tasks for referral progress
4. optionally add communication artifacts later

Out of scope for this track:

- full referral network directory if not needed for the pilot

Depends on:

- optional dependency on Track 3 if tasks are part of the pilot

Can run in parallel with:

- all other tracks

## Track 10: SMART on FHIR launch

Status: deferred

Primary Medplum capability:

- SMART on FHIR launch support

When to do this:

- only if UCC needs to launch from another EHR
- or if external apps need to launch inside UCC

Why deferred:

- high architectural scope
- low value unless integration requirements are concrete

## Suggested agent allocation

If you want multiple agents working in parallel, this is the cleanest initial split:

1. Agent A: Track 1 intake forms
2. Agent B: Track 2 scheduling
3. Agent C: Track 3 tasks
4. Agent D: Track 6 payer workflows
5. Agent E: Track 8 attachments and media

Second wave:

1. Agent F: Track 4 bots
2. Agent G: Track 5 subscriptions
3. Agent H: Track 9 referrals

## Dependencies matrix

- Track 1 can start immediately
- Track 2 can start immediately
- Track 3 can start immediately
- Track 4 is strongest after Track 1 or Track 3 has a concrete event source
- Track 5 is strongest after Track 2 or Track 3 has a concrete real-time surface
- Track 6 can start immediately
- Track 7 can start immediately, but should avoid broad migrations without an owning workflow
- Track 8 can start immediately
- Track 9 can start immediately, but gets stronger if Track 3 exists
- Track 10 stays deferred

## Definition of done for any track

A track is not done when code exists. A track is done when:

1. the current workflow is still intact
2. the pilot path is gated or isolated
3. rollback is clear
4. the new Medplum resources are actually created and usable
5. the pilot has a narrow, testable success condition
6. this document is updated with status and follow-up work

## Update rules for future agents

Whenever an agent works on one of these tracks:

1. update the relevant track status
2. add completed milestones under that track
3. note blockers directly in the track
4. do not silently expand scope into cutover work
5. add new file targets if the track introduces them

## Summary

This roadmap exists so multiple agents can work without stepping on each other:

- intake is one track
- scheduling is one track
- tasks are one track
- bots are one track
- subscriptions are one track
- payer workflows are one track
- typed resource cleanup is one track
- attachments/media are one track
- referral typing is one track

Current recommendation:

- keep the intake pilot roadmap separate
- use this document to coordinate every other Medplum-native workstream
