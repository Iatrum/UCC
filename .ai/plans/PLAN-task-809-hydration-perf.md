# PLAN Task 809 — cut hydration cost on staff screens (plan/research only, no code changes)

Context: Task 802 / `.ai/research/task-791.md` (PR #370) found every backing route takes 12-85 ms, yet the first client
fetch starts ~190-240 ms after navigation (JS download + hydration). This plan ranks commit-sized changes.
Base: origin/dev `eba7551`, Next 16.4.5 (webpack build, `next build --webpack`), React 19.2.6.

## Method
- `next build --webpack` once, then once more with `@next/bundle-analyzer` (`analyzerMode: "json"`, installed with
  `bun add --no-save`, `next.config.js` edited and reverted, nothing committed) to get per-chunk gzip sizes and package breakdown.
- Next 16 no longer prints per-route "First Load JS". I derived it from `.next/server/app/**/page_client-reference-manifest.js`
  (client chunks per route) plus `rootMainFiles`/`polyfillFiles` from `build-manifest.json`, gzipped each chunk
  (throwaway scripts outside the repo).
- Cross-checked with ONE production server (`next start -p 3809`, dev Medplum :8113, fake data, headless Chromium 1440x900,
  fresh context = empty HTTP cache): sum of `response.request().sizes().responseBodySize` for `/_next/static/**/*.js`.
  The two agree within ~10% (manifest 360-390 KB vs wire 322-343 KB). Server killed afterwards (process group).
- Host is shared with production on 2 vCPU: timings carry about ±50 ms noise; treat <10% differences as noise.

## Measured: JS per screen (gzip KB, cold cache, wire bytes; manifest-derived First Load in brackets)
| Screen | JS files | JS KB (wire) | manifest First Load | route-specific chunks | cold visible ms | first `/api` fetch starts (cold / warm) ms |
|---|---|---|---|---|---|---|
| Patients list `/patients` | 29 | 330 | 368 | 10 KB | 763 | 382 / 292 |
| Patient profile `/patients/[id]` | 30 | 333 | 380 | 22 KB | 570 | 408 / 403 |
| Lab tab `/patients/[id]/labs-imaging` | 32 | 337 | 397 | 38 KB | 569 | 335 / 286 |
| Billing `/orders` | 30 | 328 | 366 | 8 KB | 550 | 424 / 455 |
| Appointments | 29 | 322 | 360 | 1 KB | 552 | 360 / 267 |
| Dashboard | 31 | 343 | 381 | 23 KB | 389 | 386 / 283 |
| Inventory | 30 | 336 | 375 | 16 KB | 353 | 352 / 269 |
| Analytics | 30 | 450 | 489 | 131 KB (recharts) | 1575 (first uncached summary) | 684 / 336 |
| Checkout `/orders/checkout/[id]` (manifest only) | - | - | 391 | 33 KB | - | - |
| Consultation edit `/consultations/[id]/edit` (manifest only) | - | - | 615 | 257 KB (tiptap/prosemirror) | - | - |

Key observation: **~320 KB gzip (~1.1 MB parsed) is loaded on every screen; route-specific code is only 1-40 KB** (except
analytics and consultation edit). So the cost is the shared baseline, not any one page. Even warm (JS from HTTP cache) the first
fetch still starts ~270-300 ms in on this host, i.e. parse/execute/hydrate, not download, dominates after the first visit.

### What the shared baseline is (gzip KB)
| Chunk | KB | Contents | Needed on every screen? |
|---|---|---|---|
| `framework` + `main-app` + `webpack` + polyfills (`rootMainFiles`) | 169 | react-dom 55, next client runtime ~100, polyfills | yes (floor) |
| `1085-*` | 35 | zod 26, react-hook-form 10, @hookform/resolvers | **no** - used only by patient new/edit forms and appointment new-form |
| `77957f66-*` | 31 | `@medplum/core` (MedplumClient) | **questionable** - only constructed inside `MedplumAuthProvider`; nothing outside `lib/auth-medplum.tsx` reads `.medplum` |
| `649-*` | 12 | date-fns 5, cmdk 4, radix popover | no - date-picker + diagnosis/procedure/medication search |
| radix dialog/select/popper/floating-ui/toast/tabs/scroll-area (`9706`,`9663`,`2526`,`9483`,`3774`,`2484`,`5292`) | ~45 | UI primitives | partly (sidebar/toaster need some) |
| app shared chunks (`625`,`4033`,`3889`,`7206`, layouts) | ~35 | app code shared by routes | mostly |

### Top 3 heaviest client bundles on the staff screens (route-specific / lazily loaded)
1. **Consultation editor stack**: `409-*` (prosemirror-model 82 + transform 42 + tiptap extensions) 160 KB + prosemirror-view 2x30 +
   `@tiptap/core` 29 = **~250 KB gzip**. Already isolated: `/patients/[id]` loads it via `next/dynamic` (`patient-profile-workspace.tsx:40`),
   so profile/first-load is not affected (verified: not requested on `/patients`). Only `/consultations/[id]/edit` loads it statically. **Composer: OUT OF SCOPE.**
2. **Analytics**: `1904-*` recharts 112 + es-toolkit/immer/d3 = **122 KB gzip**, loaded only on `/analytics` (+131 KB route-specific). Not a hot daily screen.
3. **Shared baseline bundle on every route**: zod + react-hook-form (35 KB) + `@medplum/core` (31 KB) + date-fns/cmdk/popover (12 KB) = **~78 KB gzip
   (~24% of the 330 KB)** that no list/read screen executes. This is the highest-leverage target because it hits all screens.

Main staff screens individually: patients list is the biggest of the daily screens only by 10 KB of route code; profile/lab tab/billing add
8-38 KB. None has a heavy page-specific bundle.

## Research notes (official docs)
- Next.js 16 *Server and Client Components* / *Fetching Data*: fetch in Server Components, stream with `<Suspense>`; client
  components still receive server-rendered HTML, so first paint does not need the JS, but interaction and any `useEffect` fetch do.
  <https://nextjs.org/docs/app/getting-started/server-and-client-components>, <https://nextjs.org/docs/app/getting-started/fetching-data>
- *Lazy loading* (`next/dynamic`, `React.lazy`, dynamic `import()`): defers a client component's JS until rendered; `ssr:false` only valid in Client Components.
  <https://nextjs.org/docs/app/guides/lazy-loading>
- *optimizePackageImports* (already enabled for `lucide-react`; default list already covers many libs incl. `date-fns`, `@radix-ui` is NOT
  in the default list in all versions - verify against `node_modules/next/dist/server/config.js` `optimizePackageImports` before adding).
  <https://nextjs.org/docs/app/api-reference/config/next-config-js/optimizePackageImports>
- *Package bundling guide* + `@next/bundle-analyzer`; Next 16.1+ also has `next experimental-analyze` but it targets Turbopack, and this repo builds with `--webpack`.
  <https://nextjs.org/docs/app/guides/package-bundling>
- React 19 `use`/Suspense streaming and React Compiler (not enabled; not proposed - build-time risk).
  <https://react.dev/reference/react/Suspense>
- Not verified live: whether Turbopack production build would chunk differently. Out of scope (build system change).

## Ranked candidates (each = one commit; none touches the composer, sidebar or nav)
Gain figures are estimates from the gzip numbers above; real gain is judged only by the measurement protocol below.

| # | Change | Expected gain | Risk | Notes |
|---|---|---|---|---|
| 1 | **Find out why zod/RHF (`1085`) and date-fns/cmdk (`649`) are in every route's chunk list**, then stop it. Start with a stats run (`webpack --json` / analyzer `generateStatsFile`, look at `chunk.origins`/`reasons` for those modules). The forms that import them are only `patients/new*`, `patients/[id]/edit`, `modules/appointments/pages/appointments-slots-pilot.tsx` (statically imported by `appointments-root.tsx`), `new-appointment-form.tsx`. Likely fix: `next/dynamic` those form entry points (and `date-picker`) so the libs leave the shared group. | up to -47 KB gzip (-170 KB parsed) on every screen; ~-20-40 ms to first fetch | low-med (form routes get a loading fallback; e2e forms specs) | Webpack `splitChunks` placement is an assumption until the stats run confirms; do the stats step first and abort if the chunk is genuinely referenced by the layout. Appointments is the one wiring to check since the sidebar manifest lists these chunks. |
| 2 | **Remove `@medplum/core` from the root layout bundle**: `MedplumAuthProvider` creates a `MedplumClient` that no component reads (`grep .medplum` finds no consumer). Either drop it from the provider (keep `/api/auth/medplum-session` semantics) or lazy-create it. Needs a careful read of `lib/auth-medplum.tsx` 100-190 (session restore, clinic storage) first. | -31 KB gzip (-124 KB parsed) on every screen | **medium** (auth/session path; clinic separation must stay) | Must have its own review; do not touch login behaviour. Verify no e2e/auth spec relies on MedplumClient storage. |
| 3 | **Server-render the first page of the patients list** (Server Component fetch + Suspense, hand the rows to the client table as props) and drop the mount `useEffect` fetches (`patients/page.tsx` is `'use client'`, 312 lines). Rows are then in the HTML; the first API fetch disappears from the critical path. | Patients list visible content ~-250-350 ms cold (no longer waits for hydration + fetch); biggest perceived win | medium (clinic scoping must reuse the same server auth helper as the API route; pagination/stats state; behaviour parity) | Same pattern as `/analytics` (already streams behind the heading). Repeat later for dashboard, appointments if it pays off. |
| 4 | **Split `components/ui/command.tsx` / search comboboxes** (`diagnosis-search`, `procedure-search`, `medication-search`) out of the shared group via `next/dynamic` where used outside the composer (settings/catalog pages only). | -12 KB gzip if #1 does not already remove `649` | low | Composer's own use of these search components is OUT OF SCOPE; only call sites outside the composer qualify, otherwise skip. |
| 5 | **Audit the other Radix primitives in the baseline** (`9706` popper/floating-ui 10 KB, `9663` select 7 KB, `2526` focus-scope/remove-scroll 8 KB, `9483` dialog). They are in layout-level chunk lists because the sidebar/toaster/feedback control import them. Check whether `FeedbackControl` (+Dialog, default-off module) can be `next/dynamic` loaded only when `showFeedback` is true. | -10-20 KB gzip when feedback is off | low | `FeedbackControl` is in the routes layout but not the sidebar/nav; keep markup identical when the module is off. Confirm it is not "nav" before doing it; if in doubt skip. |
| 6 | **Lab tab / billing**: add `Suspense` + server-fetched initial data, same pattern as #3. | per screen ~-150-300 ms | medium | Lab/POCT results must stay only in the Lab tab; no critical-result banners. Do after #3 proves the pattern. |
| 7 | **Analytics**: keep recharts out of the first route chunk via `next/dynamic` charts (`components/analytics/analytics-dashboard.tsx` already uses dynamic for part). Check what remains static. | up to -100 KB gzip on `/analytics` only | low | Low priority (rarely opened). |
| 8 | Measure `reactStrictMode`/`productionBrowserSourceMaps` off, `compress` on, and `Cache-Control` for static chunks on the VPS reverse proxy (Traefik/nginx): confirm `immutable` on `/_next/static` and brotli, since warm visits still start the first fetch ~270 ms in. | Unknown; might turn the 322 KB wire cost into ~270 KB with brotli | low (infra, not app) | Must not touch the production Traefik from here; hand to infra owner. |

### OUT OF SCOPE (do not do under this plan)
- Anything in the consultation composer: `patient-profile-workspace.tsx` composer parts, `rich-text-editor.tsx`, `order-composer`, `/consultations/[id]/edit`,
  the tiptap/prosemirror chunks (the ~250 KB stack above). They are already dynamically imported on the profile; leave them.
- Sidebar and navigation (`components/sidebar.tsx`, `app/(routes)/layout.tsx` nav wiring, module registry): no changes. #5 may only touch the feedback control, and only if it is
  confirmed to be outside nav.
- Replacing Firebase Storage, Medplum auth model, build tool (Turbopack), React Compiler.

## How to measure before/after (every candidate)
1. Worktree from origin/dev, `bun install --frozen-lockfile`, copy `.env.local` (git-ignored), `NODE_OPTIONS=--max-old-space-size=3072`.
2. `bunx next build --webpack` for BEFORE and AFTER (separate dirs or sequentially; one server at a time, unique port, kill process group).
3. Size: (a) chunk table from `page_client-reference-manifest.js` + gzip as in this plan, (b) analyzer JSON per package, (c) wire bytes from Playwright
   `request.sizes()` on a fresh context. Record JS files, KB, and which of `1085/649/77957f66` are fetched.
4. Time: `e2e/scripts/perf-screens.mjs` (Task 791) -> `visibleMs`, plus `firstApiFetchMs` (first `fetch` request start relative to `goto`), 1 cold + 5 warm
   runs, median. Run BEFORE and AFTER back to back in the same session (noise ±50 ms; an effect <10% is noise).
5. Acceptance: JS KB drops by the expected amount on the targeted screens and no screen grows; `e2e/scripts/check-all.sh <label>` shows no new failures;
   composer smoke unchanged.

Throwaway measurement scripts lived in `/home/dev/ucc-809-tools/` (not committed); the method above is enough to recreate them.
