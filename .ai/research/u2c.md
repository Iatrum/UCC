# U2c: unavailable clinic modules

- `.ai/UX-FINDINGS.md` contains only its heading; scope comes from the user’s finding #3.
- POCT/PACS pages exist, but their layouts call `assertModuleEnabledForCurrentClinic`, which throws a 404 when disabled. Tasks calls `notFound()` when its module is disabled/missing (no tasks package exists). Records unconditionally calls `notFound()`.
- Sidebar navigation comes from `listNavigationModulesForClinic`; its legacy fallback previously advertised Tasks even without a package. Inventory and Analytics have direct app implementations and must remain supported.
- Return a shared `ModuleUnavailable` component under the existing clinic layout, preserving authentication and clinic scope. Check enabled module loading for POCT/PACS layouts (including new-order routes) and Tasks. Respect `.disabled` markers during direct module loads as well as discovery. Only advertise loadable registered landing pages or the two direct app implementations.
- No Medplum/FHIR calls or clinical resource behavior changed; consultation composer untouched.

Official references checked:
- https://nextjs.org/docs/app/api-reference/functions/not-found — `notFound()` terminates rendering with a 404.
- https://nextjs.org/docs/app/api-reference/file-conventions/layout — layouts wrap child pages; returning the fallback keeps the parent clinic shell.
- https://react.dev/learn/conditional-rendering — components can conditionally return JSX.

Validation: `bun run lint` passed (exit 0); `git diff --check` passed. No server or e2e per task instructions.
