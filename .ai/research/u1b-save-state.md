# Task 150 — honest save status (2026-11-15)

## Repository findings
- Base: origin/dev 2f56211. The task-specific push/draft-PR instructions override the general AGENTS prohibition. Full-suite check-all is excluded by the explicit targeted-check instructions.
- Composer initializes hydrated=false but renders “All changes autosaved.” GET is Firestore-backed, returns a 200 unavailable snapshot; POST/DELETE may return 503 persistenceAvailable:false. Generic errors must not be inferred to mean local fallback.
- Drafts currently exist only in memory if persistence is unavailable. “Saved on this device only” must carry an explicit current-screen/lost-on-reload qualification. No localStorage, storage redesign or Firebase replacement.
- Consult notes have no draft GET/autosave on this base; POST /api/consultations on Sign is their first save. Show “Not saved — sign to save” for unsigned notes, Saving… during POST, and Failed to save + Retry after failure. Do not invent draft hydration or server assurance.
- STATE records Task 3/3b. Local commit a852c1f contains merge-on-hydration protection missing from origin/dev; preserve that protection when revising hydration. The working checkout’s UX-FINDINGS has #9/#16/#18 and the requested ranking, but origin/dev’s file is only a heading. Reviewed the working checkout read-only.
- Retry must replay the failed operation, rather than merely clearing the error or reloading and losing a failed edit. Keep failures sticky across unrelated successful writes. Track DELETE as well as POST in saving status.

## Sources reviewed and application
- React effects: https://react.dev/reference/react/useEffect — cleanup ignores obsolete async responses; dependencies must reflect inputs. Keep hydration keyed to draft identity, not changing parent callbacks.
- React transitions: https://react.dev/reference/react/useTransition — pending rendering is not proof of server persistence; input updates should remain synchronous. Use explicit request state, not transitions, for save assurance.
- Next.js App Router client boundary: https://nextjs.org/docs/app/api-reference/directives/use-client — interactive state belongs in existing client components.
- Medplum datastore: https://www.medplum.com/docs/fhir-datastore and FHIR R4 resource model: https://hl7.org/fhir/R4/resource.html — no changes to clinical resources, tenant checks or persistence APIs in this task.
- Nielsen visibility of system status: https://www.nngroup.com/articles/visibility-system-status/ — state must reflect actual system feedback, including uncertainty and failure.
- GOV.UK notification banner: https://design-system.service.gov.uk/components/notification-banner/ — banners are for information outside the immediate task. Use a compact inline status by the save action instead.
- WCAG status messages: https://www.w3.org/WAI/WCAG22/Understanding/status-messages.html — expose status without moving focus; role=status, aria-live=polite and aria-atomic.

## Design
Reserve status height. Hydration takes precedence over all assurance. Resolve to Saved (server), Saving…, Saved on this device only (current screen; lost on reload), or Failed to save with a keyboard-accessible Retry. Keep note status honest about its existing sign-only lifecycle. No sidebar/nav, Lab, POCT or clinic scope changes.
