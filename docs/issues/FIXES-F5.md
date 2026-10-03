# FIXES-F5: IBOR, performance, portfolio lab, private markets, research, financing

Branch: worktree of `feat/admin-recon-nav` (commit in worktree, not pushed). Sysadmin note: several "missing" controls (ADB-001, 007, 012) were gated by permissions the sysadmin login lacks (`portfolio.manage`, `recon.manage`, `financing.manage`, `private.mark.approve`). The controls now always render, disabled, with the permission named in the tooltip and a line of text.

## ADB-001 IBOR Refresh / Reconcile buttons not visible
- Root cause: buttons rendered only when `portfolio.manage` / `recon.manage` held; sysadmin has neither, so the page text told users to press buttons that were not on the page. Last-refresh tile gave no hint.
- Change: `ibor/page.tsx` always renders both buttons, disabled with reason (permission, or "Pick a portfolio first" for Reconcile). Last-refresh tile hint says what to do / what is needed.
- Files: `portals/admin-web/src/app/(ops)/ops/ibor/page.tsx`.
- Re-test: sign in as sysadmin, /ops/ibor: "Reconcile positions" and "Refresh IBOR" visible and greyed, tooltip "Needs the ... permission". Sign in with a portfolio.manage user: Refresh IBOR works and books the unbooked fills.
- Status: fixed.

## ADB-002 Book state tile reads like a pass
- Root cause: tile hint listed the titles of failing checks with no framing; exceptions tile counted only position rows.
- Change: hint now "2 check(s) need attention: <titles>"; Exceptions tile hint adds "plus N failing book check(s)".
- Files: `ibor/page.tsx`. Re-test: /ops/ibor with failing checks: Book state tile shows Review with the "need attention" wording.
- Status: fixed.

## ADB-003 Headline market value mixes currencies
- Root cause: `overview()` summed each position's base-currency MV, but portfolios have different base currencies (USD and ZWG), and cash/unsettled were converted to each portfolio's base then added together.
- Change: overview picks one reporting currency (the base when the scope has a single base currency, else USD), converts MV, accrued, available cash and unsettled buys into it with the platform FX resolver, and returns it as `kpis.currency`. Tiles show the currency code. Ledger rows keep their own per-portfolio base currency label (already correct). Added `currency` to the `IborOverview` kpis type.
- Files: `backend/api/src/modules/ibor/ibor.service.ts`, `portals/admin-web/src/ops/ibor.tsx` (type only; not in anyone's ownership list, minimal edit), `ibor/page.tsx`.
- Re-test: /ops/ibor "All portfolios": Market value tile reads "USD ..." and no longer equals the sum of mixed USD+ZWG figures; Unsettled buys / Available cash carry "USD". Pick a single ZWG portfolio: tiles read "ZWG ...".
- Status: fixed. Caveat: accrued income is treated as being in the portfolio base currency (as before).

## ADB-004 Breadcrumb shows raw "position"
- Root cause: `ops/shell/Breadcrumbs.tsx` prints raw path segments for nested routes.
- Status: needs-other-group (F3 owns `ops/shell`). Suggest a label map for known sub-routes (`position` -> "Position", period ids -> "Period"). The ~10 s dev-server reload is Next dev compile time, not a defect.

## ADB-005 Official-return controls all green on missing evidence
- Root cause: `evaluateControls` ignored the holdings-reconciliation check (a missing run passed) and treated "no released NAV on period end" as a pass (`navOk = true`).
- Change: IBOR control now also requires a holdings reconciliation run with no break; Valuation control is a warning when there is no released NAV to compare. Lock is therefore blocked until evidence exists.
- Files: `backend/api/src/modules/performance/perf.service.ts`.
- Re-test: /ops/performance, prepare a period with no recon run / no released NAV: controls IBOR and Valuation show warning with the evidence text; "Lock" unavailable. After running Reconcile positions and releasing a NAV on period end, they pass.
- Status: fixed. Note: seeded demo periods without a released NAV can no longer be locked until one exists (intended).

## ADB-006 Performance data ends 26 Aug; blank dates accepted
- Root cause: default window is the portfolio price history; the form pre-fills those dates so "blank" is really the defaults, with no hint they are stale. Prices end 26 Aug because market data was not loaded since (data, F4). Platinum benchmark "USD LIBOR + 3%" has no constituent composition in the seed.
- Change: warning banner when the latest return window ends more than 7 days before today; period form hints (confirm dates, cannot be in the future); benchmark column shows "No composition" with tooltip instead of a bare dash.
- Files: `performance/page.tsx`. Re-test: /ops/performance shows the amber banner "Price history ends 26 Aug 2026, N days before today"; Platinum row shows "No composition".
- Status: fixed (disclosure). Loading newer prices is F4/seed data.

## ADB-007 Portfolio Construction has no create/edit/approve/save/order controls
- Root cause: all controls hidden unless `portfolio.manage` / `orders.create`.
- Change: New model, Edit, Activate, Clone, Retire, Save as proposal, Create draft orders, Discard always render, disabled with permission reason. Model list row shows a "Check" tag with the first problem (e.g. total 100.0100%) (also covers the list-row part of ADB-008).
- Files: `portfolio-lab/page.tsx`. Re-test: sysadmin on /ops/portfolio-lab: disabled "New model" with tooltip; open MDL/PMD model: disabled actions plus text. As a `portfolio.manage` user everything works as before.
- Status: fixed.

## ADB-008 What-if verdicts inconsistent
- Root cause: the Mandate tile reports whole-book constraints only; per-trade check failures were not summarised.
- Change: Mandate tile relabelled "Mandate (whole book)"; new "Trade checks" tile (`N fail · M review`) and an amber banner when any trade fails explaining those trades cannot become orders. Draft model total != 100% flagged in the list row.
- Files: `portfolio-lab/page.tsx`. The per-line cash message ("only 0.00 is free ... funded by the sale proceeds") is by design: that check is downgraded to Review for funded buys.
- Re-test: run what-if Balanced Growth Fund vs Balanced Core: tiles show Mandate Within and Trade checks "8 fail ...", plus banner.
- Status: fixed.

## ADB-009 Private Markets "By client" empty
- Root cause: `/private-markets/clients` only looked at portfolios with `portfolio.clientId`; the commitments sit in Balanced Growth Fund, a pooled fund portfolio with no owner client.
- Change: attribute commitments to clients either by portfolio owner (100%) or, for a portfolio that backs a fund, by look-through to active `LpHolding` investors pro rata to account value. Commitments, flows and marks are scaled by the share. Overview NAV tile hint now mentions newer marks awaiting approval (the 03 Sep vs 01 Oct difference is the approved-vs-pending mark, not a defect).
- Files: `backend/api/src/modules/private-markets/pm.routes.ts`, `private-markets/page.tsx`.
- Re-test: /ops/private-markets > By client lists the investors in Balanced Growth Fund with their shares of the 15.16m; shares sum to the Overview totals.
- Status: fixed.

## ADB-010 Research case form validation errors
- Root cause: shared FormModal showed only the generic message and relied on native browser validation.
- Change: new local `CaseFormModal` (used for New case and Edit draft): `noValidate`, client-side rules (thesis 20+ chars, numeric positive target price, ranges), per-field inline error text, and server `details` (path/message) mapped to fields on a 400; unmapped errors stay in the alert.
- Files: `research/page.tsx`. Re-test: /ops/research > New case, thesis "qa", target price "abc": inline messages under Thesis and Target price, modal stays open; valid input creates the draft.
- Status: fixed.

## ADB-011 "Awaiting ratification" counts decision with 0 votes
- Root cause: summary counted every VOTING decision.
- Change: `awaitingRatification` counts VOTING decisions whose votes reached the meeting quorum (default 3); new `votingOpen` counts the rest, shown in the tile hint. Proposer self-vote is left as is (SRD gives no rule; recorded for decision).
- Files: `research.routes.ts`, `research/page.tsx`. Re-test: ICD-1001 with 0 votes: tile 0, hint "1 still collecting votes".
- Status: fixed.

## ADB-012 (financing, portfolio-lab, private marks parts)
- Root cause: gated actions silently omitted.
- Change: financing (New facility/pool, Set a rule, Run margin monitor, facility Draw/Repay/Close/Approve, margin call Acknowledge/Dispute/Mark as met/Waive, Post collateral), private mark Approve and the portfolio-lab controls render disabled with the permission named.
- Files: `financing/page.tsx`, `private-markets/page.tsx`, `portfolio-lab/page.tsx`. Re-test: sysadmin, /ops/financing, open margin call MC-0001: disabled buttons with "Needs the financing.manage permission".
- Status: fixed for F5 pages. Onboarding and Clients pages are F6; a shared disabled-with-reason pattern is F3's.

## ADB-023 Model ID clash MDL-1001/1002
- Root cause: Portfolio Construction (`modelPortfolio`) and Model Governance (`govModel`) both use prefix `MDL-` in `lib/refs.ts` (F3-owned).
- Change (without touching refs.ts): Portfolio Construction allocates refs itself as `PMD-####` via `seqRef` on the existing `modelPortfolio` sequence (numbering continues); the seed uses the same; the seed idempotently re-prefixes existing `MDL-` rows in `model_portfolios` to `PMD-` (only rows still matching `MDL-%`). `test-research-privates.ts` regex updated.
- Files: `portfolio-lab/lab.routes.ts`, `prisma/seed-research-privates.ts`, `scripts/test-research-privates.ts`.
- Re-test: run the seed, /ops/portfolio-lab lists PMD-1001 and PMD-1002; Model Governance still shows MDL-1001/1002; create a new model -> PMD-1003.
- Status: fixed. Needs-other-group (F3, low priority): Settings > numbering view still lists `modelPortfolio` with prefix `MDL-`; change it to `PMD-` in `lib/refs.ts` FORMATS.

## Summary
Fixed: ADB-001, 002, 003, 005, 006, 007, 008, 009, 010, 011, 023 (+ ADB-012 for F5 pages). Not-a-defect: none. Needs-other-group: ADB-004 (F3 breadcrumbs), refs.ts numbering label (F3).
