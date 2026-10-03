# Review F5 (branch worktree-wf_2828facf-e30-5, commit e5f05d9)

Scope check: 15 files. Outside the F5 ownership list: `portals/admin-web/src/ops/ibor.tsx` (type-only, one line; not owned by anyone, acceptable) and `backend/api/scripts/test-research-privates.ts` (regex update for PMD-, follows the ADB-023 change; acceptable but record it). No migrations, no secrets. The seed change is idempotent (UPDATE ... WHERE ref LIKE 'MDL-%').

| Issue | Verdict | Notes |
|---|---|---|
| ADB-001 | OK | `ibor/page.tsx` buttons always rendered, disabled with the permission named. |
| ADB-002 | OK | Wording only (`failing()` helper), plus Exceptions tile hint. |
| ADB-003 | REWORK | `ibor.service.ts` `toReporting()`: `amount.mul(fx ?? 0)` and the cash/unsettled lines `.mul(fx ?? 0)`. A missing FX rate silently turns the amount into 0, so the headline total is understated with no warning (same pattern existed for cash before, now extended to MV and accrued). Return an `fxMissing` list/flag in `kpis` and show it in the tile hint, or fall back to the portfolio-currency display. Also `bases.size === 1 ? ... : 'USD'`: hard-coded USD, take it from the platform reporting-currency setting if one exists. |
| ADB-004 | OK (needs-other-group, F3 `ops/shell/Breadcrumbs`) | Correctly not touched. |
| ADB-005 | OK with note | `perf.service.ts` evaluateControls: recon check now required and missing NAV is "not ok". Note: seeded demo periods without released NAV can no longer be locked; ensure `seed-ibor-performance.ts` / demo flow still allows a lock for the demo script, or document it. No test updated for this behavioural change (`scripts/test-*` for performance not edited). |
| ADB-006 | OK (disclosure only) | Banner for stale price history; real data load is F4/seed. Acceptable. |
| ADB-007 | OK | Controls always rendered, disabled with reason (`portfolio-lab/page.tsx`). |
| ADB-008 | OK | Tile relabel and trade-check tile; reasoned. |
| ADB-009 | OK with note | `pm.routes.ts` /clients now attributes pooled-fund commitments pro rata to LpHolding investors by `accountValue`. Reasonable; note the attribution is by account value not by units, so after a NAV change shares drift (acceptable), and a portfolio with a direct client owner skips look-through (`shares.has`) which is correct. Loads all ACTIVE commitments with no limit (fine at current volume). |
| ADB-010 | OK | `research/page.tsx` local `CaseFormModal`: noValidate, per-field errors, server `details` mapped. Verified `useAction.run` swallows and records the error, so the inner rethrow is safe. Confirm CSS class `ops-error-text` is defined in admin-web global CSS (used elsewhere; assumed). Cosmetic: one stray blank line added. |
| ADB-011 | OK | `research.routes.ts` summary counts quorum-reached decisions as awaiting ratification; per-meeting quorum used with DEFAULT_QUORUM fallback. |
| ADB-012 (F5 pages) | OK | Pattern applied locally; should be reconciled with F3's shared pattern (see Cross-group). |
| ADB-023 | OK with note | `lab.routes.ts` `modelRef` via `seqRef(... 'PMD-' ...)` on the existing `modelPortfolio` sequence, seed re-prefixes legacy rows. Notes: (a) `lib/refs.ts:38` (F3 owned) still declares `modelPortfolio` prefix `MDL-`, so Settings > numbering shows the wrong prefix and any code still calling `nextRef(tx, 'modelPortfolio')` would again produce MDL-; grep found no other caller. F3 must change FORMATS to `PMD-`. (b) The raw `UPDATE model_portfolios SET ref = CONCAT('PMD-', SUBSTRING(ref,5))` has no uniqueness guard; if a PMD- row with the same number already exists it fails the seed with a duplicate key. Low risk. (c) ref is still referenced in audit rows and any stored deep links to MDL-1001 for portfolio-lab models would break; acceptable. |

## Cross-group conflicts
- F3 owns `lib/refs.ts`; F5 depends on F3 changing the `modelPortfolio` FORMATS prefix to `PMD-` (otherwise inconsistent numbering display).
- ADB-012 "disabled with reason" is implemented ad hoc per page by F5; F3 (ADB-012, shared ui) may introduce a shared pattern or change `ActionButton`/`ui.tsx` behaviour; reconcile at merge (no file overlap, only behavioural).
- ADB-004 (breadcrumbs) is in F3 `ops/shell`.
