# Task 456 — UX audit 418 Medium #9/#10

Sources: zod 4 docs (https://zod.dev/error-customization — `error` param on `z.enum`/`z.string`); React Hook Form zodResolver shows issue.message.
- Inventory: "Order soon" = `0 < stock <= minimumStock`; out-of-stock has its own tile/filter, so tiles no longer double count. Logic in `lib/inventory/stock-summary.ts`.
- Banner lists first 5 order-soon names + "and N more" button (switches to Overview, filter "Order soon"). Out-of-stock items alone no longer trigger the banner (they have their own tile) — flagged for review.
- Registration (`new` and `new-v1`): shared field schemas in `lib/patients/registration-schema.ts`; DOB is required in validation, so its label now has the red asterisk and the error mentions NRIC auto-fill.
- Evidence: before/after screenshots outside repo (/tmp/ux456). Dev server on :3466 with `next dev --webpack` (Turbopack rejects the symlinked node_modules in the worktree), killed afterwards; 8 fake `UX456*` medications seeded then deleted.
- Gate: unit 450/450, tsc, eslint clean. Full e2e check-all NOT run (needs :3210 + /workspace log paths; RAM shared with production).
