# Handoff 15: M4 — Cash, recon, and operations depth

Date 2026-10-05 · branch `feat/original-ui-wiring` · requirement IDs: ADMIN-5A15–17, FR-CASH-012–019, FR-REC-*, FR-OPS-*

## 1. Goal (one paragraph)

M4 replaces toast stubs with real API writes for cash journal workflow (submit / return / reject), reservation and expectation create/cancel, recon break assign / investigate / escalate, and operations close-gate hydration plus runbook CSV export. Bridges only; no markup/CSS or ops-native product UI changes.

## 2. Commands run and results

| Command | Result | Notes |
|---|---|---|
| `node tools/legacy-bridge.mjs --only admin` | **PASS** | Synced `admin-72-operations.js`, `admin-94-cash.js`, `admin-95-recon.js` |
| `node tools/legacy-bridge.mjs --only admin --check` | **PASS** | After sync |
| `npx vitest run tests/frontend/legacy/w5-cash-recon-financing.test.ts` | **PASS** | 4/4 including reservation POST round-trip |
| `npx vitest run tests/frontend/legacy/w0-entry.test.ts tests/frontend/legacy/w1-command-ops.test.ts` | **PASS** | 10/10 M2 regression |
| `npx tsx scripts/test-recon.ts` / `test-wiring.ts` | **Not run** | `DATABASE_URL` not set on this host |
| `npm run verify` | **Not re-run** | Per HANDOFF-14 |

## 3. Backend confirmation (read-only)

All required routes were already present; no backend changes in M4.

| Area | Routes | Status |
|---|---|---|
| Cash journals | `POST …/submit`, `…/return`, `…/reject` | **Sufficient** |
| Cash reservations | `POST /api/v1/cash/reservations` | **Sufficient** |
| Cash expectations | `POST /api/v1/cash/expectations`, `…/:id/cancel` | **Sufficient** |
| Recon breaks | `POST …/assign`, `…/investigate`, `…/escalate` | **Sufficient** |
| Operations | `GET /api/v1/operations/tasks?format=csv`, `GET /operations/status` (close blockers) | **Sufficient** |

## 4. Frontend bridge changes

### `admin-94-cash.js`

- `openJournalDrawer` wrap: DRAFT **Submit**, PENDING **Return / Reject** (reason drawer), keeps approve/reverse paths.
- `saveReservation` wrap: `POST /api/v1/cash/reservations` via resolved bank ledger.
- `[data-action="new-expectation"]` intercept: modal → `POST /api/v1/cash/expectations`.
- `renderExpectations` wrap: **Cancel** on open rows → `POST …/cancel` with reason.
- Helpers: `reasonDrawer`, `resolveBankLedger`, `patchJournalDrawer`.

### `admin-95-recon.js`

- `renderBreakDetail` wrap: inject **Assign to me**, **Start investigation**, **Escalate** → live break actions.
- Capture handlers: `#v33ReconQuery` → investigate; `[data-recon-v12="assign"]` → assign.
- Existing resolve / approve / accept-match / run / signoff paths unchanged.

### `admin-72-operations.js`

- `renderStatus`: hydrate dependency lanes from `status.dependencies`; **Close blockers** KPI opens cash close portfolio modal.
- `ensureOpsExportButton`: **Export CSV** → `GET /operations/tasks?format=csv` (blob download).

### `mx-core.js` (small fix)

- `mx.gate` now accepts CSS selector strings (querySelectorAll), matching how bridges already call it.

## 5. Tests

- `w5-cash-recon-financing.test.ts`: static API path checks for M4 endpoints; jsdom `saveReservation` POST round-trip.
- `w0` + `w1`: regression green.

## 6. Known limits / follow-ups

- Escalate modal defaults `toUserId` to the signed-in user (no staff picker in legacy UI); ops-native `BreakExtras` remains the full picker experience.
- Expectation cancel adds a row action column without a matching table header (bridge-only injection).
- Journal **submit** from drawer requires opening a DRAFT row after live hydrate (prototype drawer had no submit button before).

## 7. Acceptance checklist

- [x] Cash journal submit/return/reject wired (drawer patch)
- [x] Reservation create + expectation create/cancel wired
- [x] Recon assign / investigate / escalate wired
- [x] Ops close gates hydrated + CSV export
- [x] w5 write round-trip + `legacy-bridge.mjs --check`
- [x] HANDOFF-15 with §11 M5 prompt

---

## §11 — Copy-paste prompt for M5 agent

```
Proceed to M5 on branch feat/original-ui-wiring. Bridges only; no commit/push unless I ask.

Read first:
1. docs/handoff/HANDOFF-15-M4-CASH-RECON-OPS.md (this file)
2. IMPLEMENTATION_MILESTONES.md — M5
3. docs/ADMIN-REAL-PAGES.md — orders/research/risk/performance gap rows

Repo: C:\Users\lysp\Downloads\matanho-nexus-v56-deployment
Branch: feat/original-ui-wiring

## Your scope: M5 — Admin page depth (orders, research, risk, performance)

Requirement IDs: ADMIN-5A05–08

Goal: Order reject/cancel/settle; research IC workflow; risk limit MC + case intake; performance period lock with step-up.

## Do

1. Static gate: `node tools/legacy-bridge.mjs --only admin --check` after bridge edits; targeted vitest for w3/w4.
2. Backend: Confirm step-up on performance lock routes (read-only unless missing).
3. Frontend (bridges only): extend `admin-90-orders.js`, `admin-91-research.js`, `admin-92-risk.js`, `admin-93-performance.js`.
4. Reference: `portals/admin-web/src/ops/orders*.tsx`, `research.tsx`, `risk.tsx`, `performance.tsx`.
5. Tests: extend w3/w4 jsdom write round-trips; `test-research-privates.ts`, `test-risk.ts`, `test-performance.ts` if DB available.
6. Deliverable: `docs/handoff/HANDOFF-16-M5-ORDERS-RESEARCH-RISK-PERF.md` with §11 prompt for M6.

## Do NOT

- Start M6+ or redo M2–M4 unless regressed
- Edit legacy markup/CSS or `/ops-native` product UI
- Deploy/push/merge unless owner asks
- Commit unless owner asks

## Acceptance criteria

- [ ] IC ratify requires different user + step-up (or honest mx.fail on SoD)
- [ ] Performance period lock persists via API after refresh
- [ ] At least one jsdom write round-trip per touched bridge file
- [ ] `legacy-bridge.mjs --check` passes
- [ ] HANDOFF-16 written with §11 prompt for M6
```
