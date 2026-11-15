Task 150 self-review notes
- Only composer + consult note UI and focused E2E change; no backend, tenant filters, navigation or result display changes.
- Hydration assurance is keyed to patient/consultation/draft and stale GET responses are ignored by effect cleanup.
- Task 3b guard reintroduced from available local commit because origin/dev lacked it; local edits win over late hydration.
- Generic 500/malformed responses remain errors; explicit persistenceAvailable:false supports GET 503 as well as current GET 200 fallback.
- POST/DELETE expose pending requests; independent failures remain visible; Retry replays the original operation. Repeated retry failure does not run a stale rollback over later saved work.
- Fallback remains volatile memory; UI says lost on reload. Unsigned consult note does not claim autosave.
- Status regions announce politely without focus moves; reserved height verified between checking/saving/server-saved states.
- Limits: no durable unsigned draft retention, navigation guard or storage redesign; these belong to U1b fix #1.
