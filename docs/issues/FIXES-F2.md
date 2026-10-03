# Fixes F2: orders, NAV, accounting, risk, Today dashboard, portfolios

Status key: fixed / not-a-defect / needs-other-group / not-fixed. All changes are on the F2 worktree branch; nothing pushed.

## ADA-006 Today "Orders working" counted Awaiting approval
- Root cause: `WORKING_ORDERS` in `wiring/control.service.ts` included `AwaitingApproval`; the Orders page defines Working as approved/routing/partly filled. The tile hint also printed the raw camelCase status ("awaitingapproval").
- Change: Working now excludes AwaitingApproval; the payload adds `ordersWorking.awaitingApproval` and the tile hint shows "N awaiting approval". Status names are split on camelCase.
- Files: `backend/api/src/modules/wiring/control.service.ts`, `portals/admin-web/src/app/(ops)/ops/command/page.tsx`.
- Re-test: open /ops/command with 1 approved and 1 awaiting-approval order. Expect "Orders working 1 - 1 approved - 1 awaiting approval", matching the Orders page tiles.
- Status: fixed.

## ADA-007 Risk breaches 0 on Today while limits exceeded, mandate vs firm limits disagree
- Root cause: Today counted only recorded `RiskBreach` rows (created by the manual monitor run). The Portfolio page showed only the mandate limit, never the active firm/portfolio risk limits.
- Change: new read-only `countUnrecordedExceedances()` in `risk.service.ts` (limits over threshold today with no breach row); Today "Risk breaches" = open + unrecorded, with a hint "N over limit, not yet recorded (run the monitor)". Portfolio detail gains a "Risk limits (firm and portfolio)" card (needs risk.view) judged on the same snapshot; the list page label now says "mandate limit".
- Files: `modules/risk/risk.service.ts`, `modules/wiring/control.service.ts`, `command/page.tsx`, `portfolios/[id]/page.tsx`, `portfolios/page.tsx`.
- Re-test: before running the monitor, open /ops/command: Risk breaches > 0 with the "not yet recorded" hint. Open /ops/portfolios/PF-1005: the new card shows LIM-1001 15% vs 75.3% = breach.
- Not changed: scenario "Escalate" with "LOSS 0.0000%" is the scenario engine reporting the limit breach (the result is escalate because the limit is already exceeded, not because of loss). Left as is.
- Status: fixed.

## ADA-009 Breaches only appear after a manual Run monitor
- Root cause: same as ADA-007 (no scheduler; breaches are recorded only by the monitor).
- Change: the exceedance is now visible without manual action on Today (and on the portfolio page). Recording cases still requires Run monitor (no background scheduler exists in this codebase; adding one is out of scope).
- Re-test: as ADA-007.
- Status: fixed (visibility); scheduled auto-run not added.

## ADA-011 NAV maker-review 500 after commit, UI stale
- Root cause: `respond()` in `nav.routes.ts` re-reads the run after the transaction committed; a transient database drop (Prisma P1001/P1002/P1017, MySQL unreachable) there returned 500 although the write succeeded. The UI did not refetch after an error.
- Change: `respond()` retries the read-back up to 4 times on those transient codes. The maker-review and release buttons reload the page on error so the header reflects the stored state.
- Files: `modules/nav/nav.routes.ts`, `nav/[id]/page.tsx`.
- Re-test: maker review a Draft NAV; header changes to Maker reviewed. If an error ever shows, the header refreshes to the real status.
- Status: fixed (the underlying drop was environmental load, cannot be reproduced without DB outage).

## ADA-012 NAV market value 0.01 off the Portfolio page
- Root cause: NAV summed each already-rounded line `marketValueBase`; the Portfolio page sums unrounded values and rounds once.
- Change: NAV market value uses the snapshot total `securitiesValueBase` (same valued set).
- Files: `modules/nav/nav.service.ts`.
- Re-test: PF-1001, recalculate NAV: securities and NAV equal the Portfolio page figure (19,801,207.69 / 21,635,767.69).
- Status: fixed (new runs; existing NAV-00001 keeps its stored figure until recalculated).

## ADA-013 Stale age inconsistent (27d vs 38 days)
- Root cause: Securities freshness uses business days, NAV used calendar days.
- Change: NAV staleness and its message use business days, and the message says "business days" (limit unit unchanged: `nav_stale_days`, now business days).
- Files: `modules/nav/nav.engine.ts`, `modules/nav/nav.service.ts`.
- Re-test: same price shows "27 business days old" on the NAV exception and "27d" on Securities.
- Status: fixed.

## ADA-016 NAV release creates only a 4-account chart
- Root cause: `accountIds()` in `wiring/autojournals.ts` created only the accounts the journal needed.
- Change: on first automatic posting for an entity the full standard chart is installed (missing codes only).
- Files: `modules/wiring/autojournals.ts`.
- Re-test: release a NAV for an entity with no chart, open New journal: full chart listed.
- Status: fixed (for new postings; PF-1001 existing 4 accounts get the rest on next auto journal, or via Install default chart).

## ADA-018 Journal posted with no accounting period
- Root cause: posting did not require a period; `periodId` null.
- Change: posting a journal opens the month's period automatically (audited as `accounting.period_opened`, automatic: true) when none exists; closed periods still refuse.
- Files: `modules/accounting/accounting.routes.ts`.
- Re-test: post a journal dated in a month with no period; Periods tab lists that month for the entity.
- Status: fixed.

## ADA-020 Orders validation gaps
- Root cause: create/patch accepted any positive quantity; lot rule only in pre-check; submit used zod's default text.
- Change: create and edit reject (400, field `quantity`) a quantity that is not a board-lot multiple or exceeds 10x average daily volume; submit/reject-style reasons now say "A rationale is required" / "A reason is required" when the field is missing. Pre-check behaviour unchanged. "Board lot 1 respected" for ZIM.VX is correct (board lot is 1).
- Files: `modules/orders/orders.routes.ts`.
- Re-test: POST /orders with quantity 999999999 -> 400 with quantity message; submit with no body rationale -> field "rationale", "A rationale is required".
- Status: fixed.

## Needs other group
- Field-level validation envelope for the generic `Validation failed` text (ADA-010) is F3 (`middleware/validate.ts`); F2 only supplies field paths through the existing envelope.
- ADA-008/ADA-019 stale price data are F4.
