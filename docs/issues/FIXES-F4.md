# Fixes F4: market data, securities, integrations

## ADA-019 (major) Wild VENDOR prices accepted, no run, no provenance
- Root cause: the Integrations "Run feed" button called `POST /admin-core/integrations/market-data/sync` (owned by F3), which wrote unvalidated fake-provider values straight into security_prices as VENDOR. The fake adapter also generated levels unrelated to the stored prices (0.5..50 base per ticker), so any run moved prices by thousands of percent. No md_refresh_runs or md_provenance rows were written.
- Change: the fake provider now walks a deterministic step of at most +-2% from the last stored price/FX rate (`FetchContext.anchors`, passed by the refresh service). The Integrations button now calls new `POST /api/v1/market-data/simulate`, which runs the same refresh as the scheduler: sanity bound (40% prices, 25% FX) with rejects recorded as exceptions, a run record, provenance per accepted value.
- Files: `backend/api/src/integrations/market-data/{fake,types,service,routes}.ts`, `portals/admin-web/src/app/(ops)/ops/integrations/page.tsx`.
- Re-test: Integrations > Simulated feeds > Market data > Run feed. Expected: success note with counts; Securities page > Market data feed shows the run under Recent refreshes, provenance per security, no move beyond about 2%.
- Status: fixed. Needs-other-group (F3): the old route `/admin-core/integrations/market-data/sync|simulate` in `modules/admin-core/integrations.routes.ts` is no longer used by the UI but is still unguarded; F3 should delegate it to `refreshMarketData` or remove it.

## ADB-024 (major) Simulated feed accepts absurd prices; no undo
- Root cause: same as ADA-019 (no bounds, no review/reverse).
- Change: bounds and exceptions as above. Every run records the rows it created or changed (`summary.undo`); new `POST /api/v1/market-data/runs/:id/undo` (portfolio.manage or admin.settings) deletes created rows and restores changed ones, marks the run and its provenance REVERTED, and writes an audit event. Securities page > Recent refreshes has an "Undo run" button (with confirm) on any revertible run.
- Files: `integrations/market-data/service.ts`, `routes.ts`, `portals/admin-web/src/ops/market-data.tsx`.
- Re-test: run feed, note a price, press Undo run on that run: prices/FX from the run disappear (latest price returns to the earlier value), run shows reverted; a second undo returns 409.
- Status: fixed.

## ADB-022 (polish) Integrations screen
- Raw JSON toast replaced with a readable sentence (counts accepted/rejected, pointer to exceptions and undo); other feeds use plain key/value text. Failure simulation copy now says 0 fails every call until Clear restores service. Feed description updated.
- Files: `portals/admin-web/src/app/(ops)/ops/integrations/page.tsx`.
- Re-test: run any feed, the note is plain text. Status: fixed.

## ADA-008 (minor) Stale prices used for valuation without warning
- Root cause: snapshots valued positions on any older price silently; only the market-data panel flagged staleness. (Seed prices are dated 2026-08-26 by design in seed-portfolio.)
- Change: `getPortfolioSnapshot` returns `staleWarnings` (positions priced more than 3 business days old) and summaries return `stalePrices`; kept separate from `warnings` so the "cannot be valued" logic in orders is unchanged. The market-data panel shows a warning banner with the count of stale or missing prices.
- Files: `backend/api/src/modules/portfolio/portfolio.service.ts`, `portals/admin-web/src/ops/market-data.tsx`.
- Re-test: /ops/securities shows the stale banner; the portfolio snapshot JSON has `staleWarnings` listing each ticker.
- Status: fixed on the API and securities page. Needs-other-group (F2): render `staleWarnings`/`stalePrices` on `/ops/portfolios/[id]`, the list and Today (F2-owned pages).

## Verification
tsc --noEmit clean in backend/api and portals/admin-web; `next build --webpack` for admin-web succeeds (the default Turbopack build failed only because node_modules was a junction in the worktree). No schema change.
