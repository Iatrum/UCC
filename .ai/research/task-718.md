# Task 718: phone-width UX pass (notes)
- Tailwind v4/3 utilities only; no API use. Responsive prefixes: base = phone, `sm` 640, `lg` 1024 (https://tailwindcss.com/docs/responsive-design).
- Flex/grid items need `min-w-0` / `minmax(0,1fr)` or they grow to content width (CSS Grid/Flexbox spec "automatic minimum size"): cause of #26/#27.
- `overflow-wrap:anywhere` (unlike `break-word`) lowers min-content size, so long unbroken names wrap inside flex columns (MDN overflow-wrap).
- Findings and evidence: `.ai/UX-FINDINGS.md` Part 4. Screenshots: `.ai/screenshots/task-718/`.
