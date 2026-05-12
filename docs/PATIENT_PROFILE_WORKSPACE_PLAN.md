# Patient Profile Workspace Plan

## Design decisions

1. Patient identity and safety context live in persistent chrome.
   - Keep name, age, contact, emergency contact, vitals, medical alert, and appointment summary in the page header and left sidebar.
   - Do not restore a separate `Patient Details` tab.
   - The tab strip stays task-focused: `Consultation History`, `Labs & Imaging`, and `Documents`.

2. Documents are split into two clearly named surfaces.
   - `Generated documents` contains MCs and referral letters produced from consultations.
   - `Uploaded files` remains the file-management surface for PDFs attached to the patient record.
   - Generated documents must not read like generic attachments.

3. The action panel is desktop-first and collapses on smaller screens.
   - The 480px consult/treatment panel stays as a side panel on wide screens.
   - On mobile, it should become a drawer or full-width overlay rather than a squeezed second column.
   - Consultation history, lab results, and documents should remain readable without horizontal scrolling.

4. Empty and error states are explicit UI.
   - No consultation history: show a calm empty state with a clear next action.
   - No generated documents: explain that signed MCs/referrals will appear here after a consult.
   - No uploaded files: show an upload prompt, not just blank space.
   - Queue update, consult signing, treatment signing, and document upload failures need visible recovery text, not only toasts.

## Layout hierarchy

```text
Patient profile page
├─ Header: identity, demographics, key risks, actions
├─ Left sidebar: vitals, emergency contact
└─ Main workspace
   ├─ Task tabs
   │  ├─ Consultation History
   │  ├─ Labs & Imaging
   │  └─ Documents
   └─ Action panel
      ├─ Consult form
      └─ Treatment composer
```

## Notes for implementation

- Consultation rows can expand for detail, but the collapsed table must remain the primary scan surface.
- Use the existing chrome for patient context instead of repeating that data inside each tab.
- Keep generated documents visually distinct from uploaded files so the patient record does not become a mixed attachment list.
