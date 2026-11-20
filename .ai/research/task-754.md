# Task 754 — Scheduling route unit coverage

- Next.js 16 Route Handlers expose HTTP methods as named exports and accept Web API requests. Tests call the exported handlers with `NextRequest` and assert on the HTTP response. [Next.js Route Handlers](https://nextjs.org/docs/app/api-reference/file-conventions/route)
- React 19 is the UI runtime. This task exercises route modules without rendering a component. [React 19](https://react.dev/blog/2024/12/05/react-19)
- Use the existing in-memory Medplum double for reads, searches, writes, and tenant account assignment. Scheduling services use the SDK's resource methods, including token searches for clinic identifiers. [Medplum 5.2.8 client source](https://github.com/medplum/medplum/blob/v5.2.8/packages/core/src/client.ts) · [FHIR R4 REST API](https://hl7.org/fhir/R4/http.html) · [FHIR R4 token search](https://hl7.org/fhir/R4/search.html#token)
- A Schedule holds availability, a Slot represents a time on a Schedule, and an Appointment can reference the booked Slot. [FHIR R4 Schedule](https://hl7.org/fhir/R4/schedule.html) · [Slot](https://hl7.org/fhir/R4/slot.html) · [Appointment](https://hl7.org/fhir/R4/appointment.html)
- DICOM PS3.18 covers image web services. The selected routes operate on FHIR scheduling resources. [DICOM PS3.18 scope](https://dicom.nema.org/medical/dicom/current/output/chtml/part18/chapter_1.html)

## Baseline and selection

At PR #355 head `25f1d7b` (based on `origin/dev` at `737cbd8`), Bun 1.4.4 passed 1,345 tests. Run `bun test --coverage --coverage-reporter=lcov --coverage-dir=<output> tests/unit` and compare `SF` entries in the LCOV report against the 61 tracked `app/api/**/route.ts` files. A missing source entry indicates no recorded coverage. [Bun code coverage](https://bun.sh/docs/test/code-coverage)

The five scheduling route files are tied at zero recorded coverage and cover six HTTP handlers. They extend the appointment work on this PR and exercise patient, schedule, and slot scoping. None of the five route files are changed by another open PR. PR #349 changes the shared scheduling service and its existing service tests.

## Results

API route files with recorded coverage went from 34 of 61 (55.7%) to 39 of 61 (63.9%). This percentage counts files. Per-file line coverage uses LCOV's `LH` and `LF` fields.

| Route file under `app/api/scheduling` | Before | After |
| --- | ---: | ---: |
| `book/route.ts` | 0% | 95.2% (40/42) |
| `manual-book/route.ts` | 0% | 96.4% (54/56) |
| `schedules/route.ts` | 0% | 100% (29/29) |
| `slots/generate/route.ts` | 0% | 100% (49/49) |
| `slots/route.ts` | 0% | 100% (27/27) |

The focused suite passed 33 tests and the full suite passed 1,378. Three regression cases failed with the original slot-generation route. An invalid date, a reversed window, or a zero duration returned HTTP 500 and could create a schedule when the caller supplied only a practitioner. The fixed route returns HTTP 400 before any schedule or slot write.

`tsc --noEmit --incremental false`, ESLint on both changed TypeScript files, the clinic/admin client check, and `git diff --check` passed. The task excludes Playwright and a dev server, which the full end-to-end gate requires.

## Changelog entry

Added unit tests for booking, schedules, and slots. They check that staff sign in, that clinic boundaries are enforced, and that valid requests work. Invalid slot-generation requests now return a clear error before creating a schedule.

## Decisions

- Use the existing fake Medplum client and run the real scheduling services through the route exports. This checks HTTP responses alongside clinic filters and identifiers on saved resources.
- Validate the time window and duration in the slot-generation route before schedule creation. The service keeps its own validation for callers that use it directly.
- Keep these entries here because other open PRs already change `.ai/CHANGELOG.md` and `.ai/DECISIONS.md`.
