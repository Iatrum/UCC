# U1b live usability audit research — 2026-10-31

Scope: local :3210 app / :8113 Medplum only; one synthetic patient; no application edits, commits, billing submission, or treatment signing. Script and raw facts in /workspace/ai-logs/u1b/.

Read AGENTS.md, e2e/README.md, all e2e/lib/*.ts, e2e/tests/workflow.spec.ts, e2e/global-setup.ts, and .ai/UX-FINDINGS.md. Existing saved session reused without login. Workflow steps 02–07 establish registration/check-in/consultation and x-api-key ingestion. Never write the key or session into evidence.

Code inspected: patient-profile-workspace.tsx gates Treatment on treatmentConsultation (signed note); order-composer.tsx controls draft persistence and pickers; lab-results-view.tsx fetches reports on mount and treats unsuccessful responses as an empty report list; labs/order and labs/receive route implementations plus lab-service.ts establish the synthetic ServiceRequest → DiagnosticReport/Observation fixture path. The additional lab-order API fixture avoids treatment signing and sends no physical device command. It is not evidence that a real analyser is online.

Official references verified before browser mutations:
- https://www.medplum.com/docs/api/fhir/resources/servicerequest — ServiceRequest API/resource reference.
- https://hl7.org/fhir/R4/diagnosticreport.html — R4 report separates report content from atomic Observation results and associates with the request.
- https://nextjs.org/docs/app/getting-started/error-handling — expected failures should be handled and exposed in the UI.
- https://react.dev/reference/react-dom/components/input — input semantics and accessible labels.

No changes to FHIR SDK APIs, application code, or runtime dependencies are proposed. Synthetic 500 responses are intercepted only in the audit browser and must be labelled as injected evidence.

## Authorized composer continuation
The user subsequently authorized signing only the existing fake patient's consultation note. The note was signed once; Treatment and checkout were left unsigned. All six catalog types were added through the live picker. Read order-composer draft hydration, persistence, item/document detail controls, and patient-profile-workspace catalog mapping/sign handlers. Active US imaging is excluded by a DX-only filter. Real draft GET responses returned persistenceAvailable:false; a separate browser-only 5s delay exposes the pre-hydration autosaved label. No Firebase replacement or application edit. Screenshot/facts caveats and scope are recorded with findings #15–22.
