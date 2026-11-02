# U2d — Document template preview and save confirmation

- Read AGENTS.md and .ai/UX-FINDINGS.md (the latter currently contains only its heading).
- Settings page delegates to components/settings/document-template-editor.tsx. Reuse lib/document-templates.ts fillPreviewData for fictional patient/clinic placeholders; no clinical data is fetched for previews.
- Preview derives directly from current HTML, appears by default beside the editor on wide screens and below on smaller screens, and uses iframe srcDoc with sandbox="" (no script or same-origin permissions).
- Reuse the existing AlertDialog components to confirm before either template POST. Warning identifies all future MCs/referrals as affected.
- React DOM props reference: https://react.dev/reference/react-dom/components/common
- iframe srcdoc and empty sandbox reference: https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/iframe
- No Next.js, Medplum, or FHIR API changes; consultation composer and persistence API remain untouched.
- Validation: bun run lint. No dev server, e2e, commit, remote operation, or other worktree access, per task instructions.
