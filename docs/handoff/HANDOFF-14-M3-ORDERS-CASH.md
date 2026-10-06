# Handoff 14: M3 — Orders and cash reservation loop

Date 2026-10-05 · branch `feat/original-ui-wiring` · requirement IDs: ADMIN-5A05, ADMIN-5A15, ADMIN-XFR-01, FR-CASH-015

## 1. Goal (one paragraph)

M3 closes the orders ↔ cash reservation loop in the legacy admin UI: buy order submit reserves cash on the backend (already implemented); the orders bridge shows reservation and ledger availability on the order drawer, supports cancel with reservation release, refreshes the cash page after submit/cancel, and the cash bridge correctly hydrates RESERVED / AVAILABLE / EXPECTED tiles and the reservations button count. No markup/CSS edits; bridges only per CLEANUP rule 1.

## 2. Commands run and results

| Command | Result | Notes |
|---|---|---|
| `node tools/legacy-bridge.mjs --only admin` | **PASS** | Synced `admin-90-orders.js`, `admin-94-cash.js` |
| `node tools/legacy-bridge.mjs --only admin --check` | **PASS** | After sync |
| `npx vitest run --pool=threads tests/frontend/legacy/w3-orders.test.ts` | **PASS** | 3/3 including drawer cash reservation |
| `npx vitest run --pool=threads tests/frontend/legacy/w5-cash-recon-financing.test.ts` | **PASS** | 3/3 including balance tiles |
| `npx vitest run --pool=threads tests/frontend/legacy/w0-entry.test.ts tests/frontend/legacy/w1-command-ops.test.ts` | **PASS** | 10/10 M2 regression |
| `npx tsx scripts/test-orders.ts` | **Not run** | `DATABASE_URL` not set on this host (same as M1/M2 D-43) |
| `npx tsx scripts/test-cash.ts` | **Not run** | `DATABASE_URL` not set on this host |
| `npm run verify` | **Not re-run** | Per HANDOFF-13; Windows Prisma lock / offline DB env unchanged |

## 3. Backend confirmation (read-only)

FR-CASH-015 was **already implemented** in M1; no backend changes in M3.

| Route / module | Status | Notes |
|---|---|---|
| `POST /api/v1/orders/:id/submit` | **Sufficient** | `reserveOrderCash` on buy submit (`orders.routes.ts`) |
| `POST /api/v1/orders/:id/cancel` | **Sufficient** | `releaseOrderCash` + `reservedAmount` zeroed |
| `POST /api/v1/orders/:id/reject` | **Sufficient** | Same release path |
| `GET /api/v1/orders/:id` | **Sufficient** | `reservedAmount`, `cash.holds`, `cash.ledger` (availability aligned with cash page) |
| `POST /api/v1/orders/precheck` | **Sufficient** | Cash check metrics (`available`, `reserved`, `free`) |
| `GET /api/v1/cash/balances` | **Sufficient** | `totals[]` + `ledgers[]` for tile hydration |
| `modules/cash/cash.orders.ts` | **Sufficient** | `reserveOrderCash`, `releaseOrderCash`, `syncOrderReservation` |

## 4. Frontend changes

### `portals/admin-web/src/legacy/bridge/admin-90-orders.js`

- **`toProtoInline`:** passes `reservedAmount` / `reservedLabel` from API rows.
- **`openOrderDrawer` wrap (module scope):** fetches `GET /orders/:id`, enriches proto row, injects cash-reserved snapshot tile + controls-tab ledger line, adds **Cancel** when `allowed` includes `cancel`.
- **`cancelLiveOrder`:** `mx.modal` + `POST /orders/:id/cancel` with version; `loadOrders()` + `mx.refresh('cash')`.
- **`submitTicket`:** after successful submit, `refreshCash()` so RESERVED tile updates without manual navigation.
- **`renderPretrade` wrap:** live `POST /orders/precheck` updates `#cashAfter` / `#sideCashUsage` from cash-check metrics when classic order form is present.

### `portals/admin-web/src/legacy/bridge/admin-94-cash.js`

- **`updateBalanceTiles` fix:** correct article indices — [0] posted, [1] reserved, [2] buffer/holds, [3] expected net, [4] available, [5] withdrawable (was mapping available to blocked slot).
- **`updateReservationButton`:** open reservation count on `view-reservations` button from live reservations list.

### Tests

- `tests/frontend/legacy/w3-orders.test.ts` — jsdom round-trip: drawer fetches order detail, shows cash reserved, cancel button.
- `tests/frontend/legacy/w5-cash-recon-financing.test.ts` — jsdom round-trip: tiles + reservation count from mocked balances API.

## 5. Acceptance criteria

| Criterion | Status |
|---|---|
| After submit, cash RESERVED increases by order notional | **PASS** (backend M1; bridge calls `refreshCash` after submit) |
| After cancel, reservation released | **PASS** (backend + `cancelLiveOrder` → `refreshCash`) |
| Order ticket/drawer shows matching available balance | **PASS** (drawer `cash.ledger.available` + jsdom w3) |
| Cash page RESERVED / AVAILABLE tiles from API | **PASS** (jsdom w5) |
| 403 SoD on self-approve unchanged | **PASS** (no change to approve path) |
| `legacy-bridge.mjs --check` passes | **PASS** |
| `w3` / `w5` jsdom tests pass | **PASS** |
| HANDOFF-14 written with §11 prompt for M4 | **PASS** |

**Not browser-verified (D-08):** full submit → cash tile delta in deployed UAT.

## 6. What remains for M4+

- **M4:** Cash/recon/ops depth — journal submit/return, expectations create, recon assign/investigate, operations close gates (`admin-94`, `admin-95`, `admin-72`).
- **M5:** Order reject/settle + research/risk/performance depth (reject UI still ops-native-first; cancel wired in M3).
- **Follow-up:** Run `test-orders.ts` / `test-cash.ts` on CI or host with `DATABASE_URL`.

## 7. Files touched (M3)

- `portals/admin-web/src/legacy/bridge/admin-90-orders.js`
- `portals/admin-web/src/legacy/bridge/admin-94-cash.js`
- `portals/admin-web/public/legacy/js/bridge/admin-90-orders.js` (synced)
- `portals/admin-web/public/legacy/js/bridge/admin-94-cash.js` (synced)
- `tests/frontend/legacy/w3-orders.test.ts`
- `tests/frontend/legacy/w5-cash-recon-financing.test.ts`
- `docs/handoff/HANDOFF-14-M3-ORDERS-CASH.md`, `docs/handoff/LATEST.md`

No deploy, push, or commit unless owner requests (D-07).

## 11. Next agent — copy-paste this prompt

> **Handoff rule:** When you complete your phase, write the next `docs/handoff/HANDOFF-*.md`, update `docs/handoff/LATEST.md`, and replace this block with a fresh copy-paste prompt for the following agent. See `docs/handoff/README.md`.

```
Implement milestone M4 only from IMPLEMENTATION_MILESTONES.md.

Read first (in order):
1. IMPLEMENTATION_MILESTONES.md — § M4 and §5 Standing rules
2. docs/handoff/HANDOFF-14-M3-ORDERS-CASH.md — M3 results (orders/cash reservation loop done; do not redo M3 unless verify regressed)
3. docs/CLEANUP-AGENT-PROMPT.md — rule 1 (bridges only; no markup/CSS edits)
4. docs/DECISION-LOG.md — D-07 (no push unless owner asks)
5. docs/ADMIN-REAL-PAGES.md — cash/recon/ops "Not available yet" rows

Repo: C:\Users\lysp\Downloads\matanho-nexus-v56-deployment
Branch: feat/original-ui-wiring

## Your scope: M4 — Admin page depth (cash, recon, operations)

Requirement IDs: ADMIN-5A15–17, FR-CASH-012–019, FR-REC-*, FR-OPS-*

Goal: Replace toast stubs with real API writes for cash journals submit/return, expectations create, recon assign/investigate/escalate, operations close gates and CSV export.

## Do

1. Static gate: `node tools/legacy-bridge.mjs --only admin --check` after bridge edits; targeted vitest for touched w* files.
2. Backend: Confirm any missing recon/ops endpoints per SRD 5.A.16–17 (read-only unless genuinely missing).
3. Frontend (bridges only): `admin-94-cash.js`, `admin-95-recon.js`, `admin-72-operations.js` — `mx.intercept` + real calls; `reasonDrawer` pattern from `admin-61-access-depth.js`.
4. Reference: `portals/admin-web/src/ops/cash.tsx`, `ops/recon/*`, `ops/operations.tsx`.
5. Tests: extend relevant w* jsdom tests; `test-recon.ts`, `test-wiring.ts` if DB available.
6. Deliverable: `docs/handoff/HANDOFF-15-M4-CASH-RECON-OPS.md` with §11 prompt for M5.

## Do NOT

- Start M5–M13 or redo M2/M3 unless regressed
- Edit legacy markup/CSS or `/ops-native` product UI
- Deploy/push/merge unless owner asks in the same message
- Commit unless owner asks

## Acceptance criteria

- [ ] Each ADMIN-REAL-PAGES "Not available yet" control for cash/recon/ops performs real API write and refreshes table
- [ ] w5/w1 (or new) jsdom round-trip tests for at least one write per module
- [ ] `legacy-bridge.mjs --check` passes
- [ ] HANDOFF-15 written with §11 prompt for M5
```
