# Fixes F1: fund ops, cash, capital calls, notices, reconciliation display

Branch: worktree of `feat/admin-recon-nav`. No browser testing was done; verified with tsc and portal build.

## ADA-015 (blocker) Cash tabs crash - fixed
- Root cause: `api.get()` strips the `data` key, but the Ledgers, Reservations, Expected cash, Statement imports, Period close lists and the New cash journal ledger picker read `r.data` / `ledgers.data.data`.
- Change: those calls now use `apiRequest('GET', ...)` (raw payload, same as the Cash ledger tab already does).
- Files: `portals/admin-web/src/app/(ops)/ops/cash/page.tsx`, `portals/admin-web/src/ops/CashJournalForm.tsx`.
- Re-test: open /ops/cash, click Reservations, Expected cash, Statement imports, Period close. Each shows its table or an empty state ("No reservations."), no error overlay. Open "New cash journal": the ledger dropdown lists ledgers.

## ADA-017 Seed journals same maker/checker - fixed (journals); fills part needs other group
- Root cause: `seed-cash.ts` used one user as maker and poster. Seeded order fills (seed-orders, owned by F2) never post settlement journals.
- Change: poster is now a different active user than the maker; existing OPENING-BALANCE journals with maker == poster are corrected on re-run (idempotent).
- Re-test: reseed, open /ops/cash > Cash ledger: Maker / checker shows two different people.
- Status: fixed for SoD. needs-other-group (F2) for "filled orders do not move posted cash".

## ADA-021 Blank PAID and COMMITTED columns - fixed
- Root cause: UI reads `amountPaid` / `totalCommitted`; API sent `paid` / `totalCommitment`.
- Change: API now also sends `amountPaid` (capital call list and detail) and `totalCommitted` (funds). Old fields kept.
- Files: `modules/ops/capital.routes.ts`, `capital.service.ts`, `funds.routes.ts`.
- Re-test: /ops/capital-calls PAID shows amounts; /ops/funds COMMITTED shows totals. VINTAGE stays "-" because the seeded funds have no vintage value (data, not a UI defect; set it in New/Edit fund).

## ADA-022 UUIDs and blanks in call detail and notices - fixed
- Root cause: API did not send the display names / snapshot fields the UI reads.
- Change: call detail now sends `makerName`, `checkerName`, `allocationMethod` (inferred pro rata vs explicit), allocation `totalCommitmentSnapshot` / `uncalledBeforeSnapshot`, payment `allocationId`, `recordedAt`, `bankReference`, `recordedByName`. Notices list/detail send `createdByName`, `approvedByName`, `userName`, `fundName`, `clientName`; the page shows the user name for user-targeted notices.
- Files: `capital.service.ts`, `notices.routes.ts`, `notices/page.tsx`.
- Re-test: open a capital call detail (names for Prepared by/Approved by, Allocation, Commitment, Unfunded before, LP and Recorded by in Payments) and /ops/notices (Audience and Prepared by show names).

## ADA-023 Reference numbering inconsistent - fixed (display); seeded refs unchanged
- Root cause: notice titles/document names used the call-number label (`CC-014`) while lists show the ref (`CC-00001`).
- Change: issued-call notices, documents and notifications use the call ref.
- Not changed: existing `CC-AGFI-0xx` refs are historical data in the database (no seed in the repo creates them); new calls use `CC-nnnnn`.
- Re-test: issue a call; the LP notice title reads "<call ref> capital call issued".

## ADA-026 Reporting packs - fixed (UI); period labels need F5
- Change: after Open period the list switches to status "open" so the new period is visible; open/returned packs past their due date show an "Overdue" marker.
- Needs-other-group (F5, owns private-markets): inconsistent period labels ("Sept 2026" vs "Apr - Jun 2026") come from the API label.
- File: `reporting/page.tsx`.
- Re-test: Open period for a company; list shows it. Overdue packs show "Overdue".

## ADA-027 Day-end trade counts disagree - fixed (labelling); seed data part needs F9
- Root cause: the three numbers are different scopes: package-reported trades (2), executions on that account and date (Reconciliation source health, 3), and `counts.executions` = every execution in the list (5).
- Change: `/ops/custodian/submissions` day-ends now include `executionsReceived` (same query as source health); the Custodian page shows it under Trades.
- Needs-other-group (F9, owns seed-custodian): Holdings MV 0.00 on the seeded package with 7 position rows (REC-00003) is seed data.
- Files: `modules/ops/custodian.routes.ts`, `custodian/page.tsx`.

## ADA-030 Break drawer overlap and "8 open, 8 high" - fixed
- Change: the internal/external value boxes use a single wrapping column with `minWidth: 0` and `overflow-wrap`, so long values (trade ref) no longer overlap labels. Operations control now shows the real split from `bySeverity`, e.g. "8 open (3 critical, 5 high)". (`recon.high` in the wiring service, F2, folds critical into high; the page no longer relies on it.)
- Files: `ops/recon/common.tsx`, `ops/recon/BreakDetail.tsx`, `operations/page.tsx`.

## ADA-031 Seed dates and wording - fixed
- Change: corporate action seed rolls ex/record dates back and pay dates forward to weekdays, drops "Demo event." wording, tidies legacy rows idempotently, and adds a CONFIRMED CMCL.VX cash dividend whose record date has passed so Calculate entitlements / Process can be exercised. The seeded unsettled-trade break now uses a weekday trade date and neutral wording.
- Files: `prisma/seed-corporate-actions.ts`, `prisma/seed-recon-ops.ts`.
- Note: entitlements need CMCL.VX holdings at the record date; process needs a user other than the maker (F3 personas). The existing REC-00004 row in a current database keeps its text until reseeded on a fresh DB.

## Summary
fixed 8 (ADA-015, 021, 022, 023, 026, 027, 030, 031), partial with other-group follow-ups: ADA-017 (F2), ADA-026 (F5), ADA-027 (F9).

## Verification
- `npx tsc --noEmit` clean in `backend/api` and `portals/admin-web`. No schema change, no migration.
- `npm run build -w @matanho/admin-web` could not run in this worktree (no node_modules of its own; Turbopack rejects a symlinked root). Re-run it in the merged checkout.

## Rework round
- ADA-017 seed poster: `seed-cash.ts` now picks an active admin-portal user holding `cash.journal.approve` (not the maker); updateMany still limited to OPENING-BALANCE journals the seed made with maker == poster. Fills-do-not-move-cash half is F2 territory (orphaned, not done here).
- ADA-031: formatting fixed; CMCL.VX holdings exist (seed-portfolio, as of 2026-08-26, before the record date) so entitlements are non-zero; marker match now ` Sample event.` suffix; legacy tidy skipped when NODE_ENV=production.
- ADA-026: `isOverdue` uses `row.due.slice(0,10)`. Period-label inconsistency remains orphaned (F5 private-markets API label), not done.
- ADA-027 / LPC-012 (DAY-DEMO1, `seed-recon.ts`): package now has a stored official file and sha256 (`packageHash`), holdings MV computed from positions/prices (was 0.00), prepared by a submitter-role custodian user so an approver persona can approve. Existing databases keep the old row (seed skips when DEMO- records exist).
- F3 handoff: `window.confirm` in `recon/RunTab.tsx` and `recon/SourcesTab.tsx` replaced with `ConfirmDialog`.
- ADA-022 (store allocation method on the call) and ADA-023 (data migration of existing CC-AGFI refs) left: schema/migration not essential.
- Verify: tsc clean in admin-web; backend/api tsc only reports pre-existing `nextRef` errors in `seed-research-privates.ts` (F5 file); admin-web built with `next build --webpack` (Turbopack fails only on the worktree node_modules junction).
