# Task 160 draft retention evidence

Local Medplum :8113, fake patients only, desktop browser. Images were captured outside the watched source tree and copied here afterward.

- `before-note.png`: Task 150 base component (e66086d) reports unsigned note as current-screen only.
- `before-reload-empty.png`: reload of that base component loses the unsigned fake note.
- `after-note-saved.png`: server-confirmed unsigned draft status.
- `after-reload-retained.png`: retained fake note after reload, using real Medplum persistence.
- `after-treatment-retained.png`: treatment composer server state after reload.

The before capture temporarily used the base workspace component on the local dev server and restored the implementation immediately afterward. No production services or real patient records were accessed.
