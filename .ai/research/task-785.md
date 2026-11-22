# Task 785 · Open backlog review

## References

Reviewed the project's platform references for the checklist terminology and version boundary. The repo records Medplum 5.2.15 for dev, and production version parity remains open. [Medplum 5.2.8 release](https://github.com/medplum/medplum/releases/tag/v5.2.8) · [Next.js 16](https://nextjs.org/blog/next-16) · [React 19](https://react.dev/blog/2024/12/05/react-19) · [FHIR R4](https://www.hl7.org/fhir/R4/) · [DICOM PS3.18](https://dicom.nema.org/medical/dicom/current/output/html/part18.html)

## Verification

- On `origin/dev` at `239510c`, pilot A7 had already passed the [fake-data Time Chit staff walk](task-765.md) in merged [#358](https://github.com/Iatrum/UCC/pull/358). B4 was merged in [#318](https://github.com/Iatrum/UCC/pull/318). D4 is marked DONE on dev in the checklist.
- C3 still requires a fresh authorized dev super-admin login for the [live rehearsal](../RUNBOOK-task5-production-migration.md). C4 still needs a current-head browser gate and exact production version parity. [#342](https://github.com/Iatrum/UCC/pull/342) fixed the original completed-status behavior. The billing replay fix remains in [#352](https://github.com/Iatrum/UCC/pull/352), whose focused browser rerun and clinic audit passed on its branch.
- The review covered ten open PRs targeting `dev`. Reviewed their descriptions and diffs. Linked #352 with C4 and grouped #355 and #360 under scheduling.
- A case-insensitive whole-word search for TODO and FIXME in `app/`, `lib/` and `components/` returned zero matches.
