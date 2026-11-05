# Task 10 review-fix research
- https://www.hl7.org/fhir/R4/subscription.html — criteria use FHIR searches, notifications reflect newly matching resources.
- https://www.hl7.org/fhir/R4/diagnosticreport.html — basedOn links report to ServiceRequest; identifier supports clinic partition.
- https://react.dev/reference/react/useEffect — external subscriptions require cleanup.
- https://nextjs.org/docs/app/api-reference/directives/use-client — client boundary for browser state and effects.
Code verified: isModuleEnabledForClinic uses Organization config; requireClinicAuth resolves authenticated clinic; getClinicIdentifierValue reads clinic identifier; Medplum search supports cache:no-cache.
Decision: explicit user kill-switch requirement supersedes old progress-task10 decisions 5/6. Off blocks new bridge writes and pending UI. Completed-order replays return existing clinic-scoped report; corrections are not a new report workflow.
