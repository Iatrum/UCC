# Task 11 implementation review

Scope: Lab tab only, existing POCT toggle; no sidebar/composer changes.

Verified against pinned SDK and running server source maps: Subscription channel websocket, criteria filters, GET binding operation, JSON bind/unbind, handshake/event Bundle shapes, one-hour Medplum token lifetime. Native browser leases renew after gated authorization; 90 seconds is the browser renewal bound, not the server JWT TTL. No project capability/config changes.

Clinic boundary: POST uses requireClinicAuth, checks toggle before reads/issuance, verifies patient identifier and optional Encounter subject+clinic; criteria includes clinic identifier + patient (+encounter). Token uses staff client, never admin client. Messages only invalidate a gated same-origin fetch; payload is never rendered. Results API preserves generic reports and filters linked POCT reports when off.

Lifecycle review: abort fetches on patient/encounter change/unmount, coalesce pending invalidations, clear timers and unbind/close socket, reconnect after failure, refresh on handshake, renew before lease deadline. Polling every30s also checks toggle while connected; disabled state stops POCT activity. CSP permits configured Medplum HTTP/WS origin.

Browser coverage: notification refetch with real fake-data ingestion, unrelated-subscription rejection, real30s fallback, module-off hiding, active SPA Lab-panel unmount with31s no-poll assertion, auth/clinic/patient/encounter scope. Capability-unavailable server returns503 and polling continues; transport test controls WS availability without mocking clinical reads.

Validation status: type checks pass; browser/full gate pending. This is self-review, not an independent approval. Do not claim ready until progress-11 records a passing foreground gate.
