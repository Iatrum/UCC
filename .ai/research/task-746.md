# Task 746: phone/tablet pass over Settings, Admin, Appointments, Analytics, Inventory

Follow-up to Task 718 (`.ai/research/task-718.md`).

## References
- Flex/grid items have `min-width:auto`, so long unbroken text widens the track: https://developer.mozilla.org/en-US/docs/Web/CSS/min-width#auto and https://www.w3.org/TR/css-grid-1/#min-size-auto. Tailwind `grid-cols-1` compiles to `repeat(1, minmax(0, 1fr))`: https://tailwindcss.com/docs/grid-template-columns.
- WCAG 2.2 target size (minimum) 24px, enhanced 44px; the task asked for >= 40px: https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html
- No Medplum/FHIR/DICOM API is touched (CSS classes only).

## Method
`origin/dev` @ `737cbd8`, worktree `/home/dev/ucc-task746`, one `next dev --webpack` on :3746 (killed afterwards), dev Medplum :8113, fake data only. Playwright (touch enabled) at 390x844 and 768x1024 as `doctor@ucc.local` (Settings x5, Appointments list + calendar + new, Analytics, Inventory) and the local dev admin (`/admin`, users, invite, branches, organisations, modules, settings). An in-page check listed page-level horizontal overflow, interactive elements past the right edge, controls under 40px high, clipped text and inner scrollers. The audit script lives outside the repo. Screenshots: `.ai/screenshots/task-746/{before,after}/` (390px, changed pages; the other pages and 768px runs showed no layout problem beyond the tap-target note below).

## Problems found (before) and fixes
| # | Page | Problem (390px) | Fix |
|---|------|-----------------|-----|
| 1 | Admin > Organisations | `Add Organisation` button clipped off the right edge; org card and its title pushed wider than the screen (`organisation/page.tsx`) | header `flex-wrap gap-4`; grid `grid-cols-1`; card header `min-w-0` |
| 2 | Admin > Branches | Header button crowded the description; long subdomain/name widened the card (`clinics/page.tsx`) | same pattern; name `overflow-wrap:anywhere` |
| 3 | Admin > Users | `Invite User` button overlapped the description; names/emails cut to 10 characters (`users/page.tsx`) | header wraps; status pills wrap; name `break-words` and email `break-all` below `sm`, ellipsis kept from `sm` up |
| 4 | Admin > Settings | `Create Medplum client credentials` button ran off the card; URL row cramped | button wraps text (`h-auto whitespace-normal`); rows `flex-wrap`; URL `break-all`, 40px link height on phones |
| 5 | Settings (clinic) | Card grid had no base column, so a card grew to content width and the page's main area scrolled sideways (230/285px) | `grid-cols-1` base |
| 6 | Appointments | Calendar toggle row: `Week` / `Day` clipped off screen; List/Calendar/Month buttons 36px high; prev/today/next 32-36px | rows `flex-wrap`; `min-h-10 sm:min-h-0` |
| 7 | Analytics | Tab bar cut `Duit & Operasi` (needed sideways scroll); tabs 32px and ranges 28px high | tabs `grid-cols-3`, ranges `grid-cols-4` below `sm`, `min-h-10 sm:min-h-0`; `sm:` and up unchanged |
| 8 | Inventory | Three stat tiles side by side overflowed their own boxes ("29 items" crossing the tile edge); filter pills ~28px high | tiles stack below 480px; pills `min-h-10 sm:min-h-0` |

## Not changed (on purpose)
- Sidebar and admin left rail (32px logo/theme/nav links, 146x36 nav items): navigation, out of scope.
- Catalog, inventory and appointments tables scroll sideways inside their own box (intended `overflow-x-auto`; same as #33 of Task 718). Patient-name links inside table rows are 16px high but sit in rows that are taller; no change.
- `truncate` text with a `title` tooltip (analytics diagnosis names, admin org/branch ids on 390px lists).
- 768px: no overflow or clipped controls on any page; only the same small sidebar/inline links.
- Not walked: admin detail pages (`/admin/users/[id]`, `/admin/clinics/[id]`, `/admin/organisation/[id]`, `/new` forms) and Appointments detail.
- POCT, X-ray, composer and Lab tab untouched.

## Verification
- Page-level horizontal overflow 0 on every walked page at 390 and 768, before and after (the problems were inside the scroll area / clipped controls, not the document).
- Interactive elements past the right edge 0; `tsc --noEmit` and eslint clean on the changed files.
- Admin-main inner scroll removed on Organisations, Settings and Users (was 326/462, 326/344).
