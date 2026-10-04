# Frontend tests: Admin console part A (no browser)

Project `admin-web` (Vitest + jsdom + Testing Library + user-event, network mocked with `mockApi`). 15 files, 328 tests, all passing.

Run: `npx vitest run --project admin-web tests/frontend/admin-web/a --reporter=dot` (about 2 minutes on this machine). Add `DEBUG_PRINT_LIMIT=0` to keep failure output short.

Folder note: the brief said `tests/frontend/admin/a/`, but `vitest.config.mts` only includes `tests/frontend/<project>/**` and the project is named `admin-web`, so the tests live in `tests/frontend/admin-web/a/`. Shared helper: `_kit.tsx` (mounts a real page inside the real `SessionProvider`, sets route params, builds real response shapes: `{data, total, summary}` bodies, the API's real validation envelope with `fieldErrors`).

## Flows covered (real components, mocked API with real shapes)

- **Cash** (`cash.test.tsx`, `cash-detail.test.tsx`): balances (derived, explain dialog, add standard ledgers), cash ledger list + paging link, reservations (create, insufficient-cash error and same-key retry, release, consume, sweep), expected cash (add, cancel), statement imports (upload CSV/JSON, staged/committed detail, commit, reject, match, write off), period close (prepare, approve, close, reopen, blockers), controlled journal form (balance maths, create), journal detail (submit, approve and post, step-up retry with the same Idempotency-Key, cancelled step-up, reject, return, discard, reverse), deep links (`?journal= ?import= ?close= ?tab=`), permission gating, empty/error states.
- **Accounting** (`accounting.test.tsx`, `backend-driven-issues.test.tsx`): journals list/filters/paging, trial balance (balanced and out-of-balance), account ledger, periods (open, detail, start close, close, reopen), chart of accounts (standard chart, new account), journal form, journal detail (post, reverse, SoD), no-permission message.
- **Orders** (`orders.test.tsx`): blotter tiles and filters, new ticket (board lot, limit price, suspended security, pre-trade check, draft, create-validate-submit, blocked draft kept), ticket lifecycle (approve with confirm and SoD, reject, submit, route with instruction preview, record fill, settle, cancel, edit with version conflict, realised gain, fills).
- **NAV and Today** (`nav-command.test.tsx`): NAV list, new run, run detail (exceptions, resolve, inputs, recalculate, pack, maker review, release, SoD, immutable released run, superseded link), Today tiles, approval queue, performance/allocation/scenario panels.
- **Portfolios, Risk, Securities** (`portfolios-risk-securities.test.tsx`, `securities.test.tsx`): portfolio list/create, detail with mandate limits and the risk-limits card, mandate edit; risk limits (maker cannot approve), run monitor, breaches, cases, scenarios; securities list, set price, market-data panel (stale flag, refresh, undo run, exceptions).
- **Funds, capital calls, distributions** (`fund-ops.test.tsx`): fund list/create/detail/commitments; capital call list/create (pro rata and explicit), detail (approve SoD, reject, issue, cancel, record payment with over-outstanding refusal); distributions list/create/detail/settle.
- **Notices, bank instructions, reporting, custodian** (`counterparty-ops.test.tsx`): audience/names, receipts, SoD approve, publish/withdraw confirm, create; call-back/activate/reject; reporting open period, accept, return, overdue; custodian day-end review and invite.
- **Reconciliation** (`reconciliation.test.tsx`): overview, source health, break queue filters, break detail and resolve/assign/approve, run matching, account mapping removal (in-app confirm), sources/tolerances, daily sign-off.
- **Operations, corporate actions, dealing, term sheets, investee requests** (`operations.test.tsx`, `corporate-actions.test.tsx`, `dealing-termsheets-investee.test.tsx`).
- **Shared API contract** (`api-contract.test.tsx`): data unwrap vs raw, validation envelope to message, network error, 501 / 403 states, session redirect and non-admin refusal.

## Issue ids with regression tests

ADA-006 (orders working vs awaiting approval), ADA-007 and ADA-009 (Today risk breaches including unrecorded, portfolio risk-limits card, unavailable check), ADA-008 (stale prices on Today, portfolio, market-data panel), ADA-010 (field-level validation reasons shown), ADA-011 (maker review and release reload on 500 and `readBackFailed`), ADA-012 (NAV figure as stored), ADA-013 (business-day staleness wording), ADA-014 (in-app confirm for mapping removal and tolerance withdrawal), ADA-015 (all cash tabs and the ledger pickers render `{data:[...]}`), ADA-016 (full chart offered), ADA-017 (two different people as maker/checker), ADA-018 (auto-opened period), ADA-020 (board lot, volume cap field error), ADA-021 (PAID and COMMITTED columns), ADA-022 (names not UUIDs in call detail and notices), ADA-023 (one ref style), ADA-026 (Overdue marker, open period switches list), ADA-027 (executions received count, day-end family), ADA-028 (accounting no-access message), ADA-030 (severity split on Operations), ADA-031 (confirmed dividend listed), ADB-024 (undo run, exceptions).

## Results

- 328 passed, 0 failed, no product code changed. No product bug was exposed by these tests (every failure during authoring was a test-side query or fixture mistake, fixed in the test, none by weakening an assertion).
- Observations, not changed: Operations task Block / Cancel / Reopen still ask for the reason with `window.prompt` (works, but is the old pattern ADA-014 removed elsewhere; an empty prompt is sent to the API and rejected there). Operations Start / Complete send no Idempotency-Key (the other write actions do).

## Cannot be verified without a browser

- Visual layout and styling: table overflow, modal sizing and scrolling, tile grids, badge colours, the break-drawer overlap fix (ADA-030 CSS part), stale/overdue colouring, the SVG performance chart appearance.
- Responsive behaviour and the mobile sidebar.
- Real focus management, Escape/backdrop close behaviour in a real viewport, scroll position after reload, `autoFocus`.
- `window.prompt`, native `<select>` / date picker / `datetime-local` widgets, real file chooser, file downloads (CSV export, evidence download, `URL.createObjectURL`).
- Real cookies and CSRF across portals, redirect to `/login` navigating the real URL, back/forward navigation.
- The TOTP step-up modal itself (tests install a stub handler and check the retry and key reuse).
- Cross-browser differences and `Intl` / locale date formatting in other time zones.
- Anything that needs the real API: SQL, transactions (ADA-011 root cause), seed data (ADA-017, ADA-027, ADA-031), the NAV/cash arithmetic itself.
