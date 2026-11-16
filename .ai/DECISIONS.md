# Decisions

## 2026-11-16 — Task 358b

- Follow the explicitly requested origin/main base and ai/task-mc-referral-docs branch, with one draft PR to main.
- Store printable HTML as base64 DocumentReference.content.attachment.data. This keeps content and metadata atomic in one resource, avoids orphan Binary resources, and leaves Firebase file uploads in place.
- Sign treatment issues the new drafts; saving composer fields does not issue documents. Preserve historical records without automatically issuing them.
- Issued content is a snapshot. The authenticated practitioner is the issuing doctor; changes to patient records, composer notes or templates do not alter the issued artifact.
- Use the actual local fake-data admin fixture for lifecycle tests because the requested main base predates the dev server's account-scoped staff writes. Record the limitation; do not change shared access policies.
