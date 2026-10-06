# Handoff 18: M7 — PM, financing, CA, data, models + recon depth

Date 2026-10-05 · branch `feat/original-ui-wiring` · requirement IDs: ADMIN-5A03–04, 5A20–21, 5A23–24, ADMIN-5A17 (extended)

## 1. Goal (one paragraph)

M7 closes legacy bridge gaps for private-markets pipeline depth (mark reject, deal drawer, stage advance, diligence, fund register, lookthrough export); financing facility create/draw/repay and margin-call lifecycle; corporate-action event CRUD and processing drawer with step-up; data quality exception resolve/waive; model-governance reviews modal and CSV export; and recon break query plus accept-candidate. Bridges only; no markup/CSS or ops-native product UI changes. Backend recon families (GAP-006) confirmed read-only sufficient for current bridge scope — no backend edits in M7.

## 2. Commands run and results

| Command | Result | Notes |
|---|---|---|
| `node tools/legacy-bridge.mjs --only admin` | **PASS** | Synced `admin-83`, `admin-84`, `admin-85`, `admin-95`, `admin-96`, `admin-97` |
| `node tools/legacy-bridge.mjs --only admin --check` | **PASS** | After sync |
| `npx vitest run --pool=vmThreads tests/frontend/legacy/w5-cash-recon-financing.test.ts tests/frontend/legacy/w8-private-markets-data-models.test.ts` | **PASS** | 9/9 including financing draw, CA process, data resolve round-trips |

## 3. Backend confirmation (read-only)

| Area | Routes | Status |
|---|---|---|
| Private markets | marks approve/reject, pipeline stage, diligence complete, funds CRUD, lookthrough export | **Sufficient** |
| Financing | facilities CRUD, draw/repay (step-up on draw), margin calls acknowledge/dispute/resolve/waive | **Sufficient** |
| Corporate actions | events CRUD, confirm, entitlements, instruct, process/reverse (step-up), reconcile, cancel, elections | **Sufficient** |
| Data fabric | exceptions acknowledge/resolve/waive, rules run | **Sufficient** |
| Model governance | models submit/approve, reviews list, export | **Sufficient** |
| Recon | breaks assign/query/accept-candidate, runs, signoffs | **Sufficient** (assign wired M4) |

## 4. Frontend bridge changes

### `admin-83-private-markets.js`

- Mark **reject** with reason prompt.
- `openDealDrawer`: fetches pipeline detail; stage advance (`POST …/stage`); diligence complete.
- `openNewFundModal` for fund register create.
- Lookthrough export via `GET …/lookthrough/export` + blob download.

### `admin-96-financing.js`

- Margin calls route fixed (`/calls` not `/margin-calls`).
- `openNewFacilityModal`, `openFacilityMovementModal` (draw w/ step-up, repay).
- `openMarginCallModal` (acknowledge / dispute / resolve / waive).
- `mx.openFacilityMovementModal` exported.

### `admin-97-corporate-actions.js`

- Full event lifecycle: `openNewEventModal`, `openEventDrawer` / `mx.openCorpActionDrawer`.
- Confirm, entitlements, instruct, **process** (step-up), reconcile, reverse (step-up), cancel, elections.

### `admin-84-data.js`

- Quality tab: **Resolve** and **Waive** buttons on exceptions with reason prompts.

### `admin-85-model-governance.js`

- Real CSV export on `#v37ModelExport`.
- Reviews modal (`GET /reviews`).
- v33 row double-click → `openModelActions`.

### `admin-95-recon.js`

- `#v33ReconQuery` → `POST /breaks/:id/query` (replaces investigate shim).
- `accept-match` → `accept-candidate` with candidate ID + rationale prompt.

## 5. Tests

- `w5-cash-recon-financing.test.ts`: static path checks for recon query/accept-candidate, financing draw, CA process; jsdom round-trips for facility draw (step-up) and CA process (step-up). Uses `mx.refresh(page)` — not `mx.hydrate(page)` (single-arg hydrate overwrites registrars).
- `w8-private-markets-data-models.test.ts`: static path checks for PM/data/MG APIs; jsdom round-trip for data exception resolve (`var dataTab = "quality"` + `mx.refresh('data')`).

## 6. Known limits / follow-ups

- Recon: evidence upload, reopen, reject, tolerances, account-map, custodian feed still open per ADMIN-REAL-PAGES.
- Data: staged upload, schedules tab, real connection test not wired.
- PM: commitment/cashflow CRUD modals not fully wired (pipeline depth + fund register added).
- Financing: facility submit/approve lifecycle not wired (create + draw/repay + margin calls only).
- jsdom write round-trips cover financing, CA, and data bridges; PM/MG/recon bridges validated via static path assertions (recon assign from M4).

## 7. Acceptance checklist

- [x] Financing draw creates facility state change in API (jsdom POST `…/facilities/:id/draw`)
- [x] CA process requires step-up where API does (`{ stepUp: true }` on process POST)
- [x] Recon break assign persists owner (M4); query + accept-candidate wired M7
- [x] jsdom write round-trips on touched bridges (financing, CA, data; static on PM/MG/recon)
- [x] `legacy-bridge.mjs --check` passes
- [x] HANDOFF-18 with §11 M8 prompt

---

## §11 — Copy-paste prompt for M8 agent

```
Proceed to M8 on branch feat/original-ui-wiring. Bridges + backend settings consumers; no commit/push unless I ask.

Read first:
1. docs/handoff/HANDOFF-18-M7-PM-FINANCING-CA-DATA.md (this file)
2. IMPLEMENTATION_MILESTONES.md — M8
3. docs/ADMIN-REAL-PAGES.md — settings/platform/copilot gap rows
4. backend/api/src/modules/admin-core/admin-core.engine.ts SETTINGS registry

Repo: C:\Users\lysp\Downloads\matanho-nexus-v56-deployment
Branch: feat/original-ui-wiring

## Your scope: M8 — Admin settings enforcement and platform health UI

Requirement IDs: ADMIN-5A27, ADMIN-XFR-02, ADMIN-XFR-03, PLAT-002, PLAT-005

Goal: Platform settings written via admin-core are read by worker/modules; notification prefs honoured; integrations banner reflects adapter mode in legacy copilot/settings.

## Do

1. Backend: Settings consumer wiring in worker, retention job, notify delivery (GAP-011) — read `lib/settings.ts` and admin-core SETTINGS registry first.
2. Frontend (bridges only where legacy settings touch API): legacy settings workspace prefs (`platformSettingsV8`) — bridge to `/admin/settings` or document as UI-only; platform drawer in `admin-61`.
3. Validation: `test-admin-core.ts`, `test-admin-platform.ts`; targeted vitest if bridge changes.
4. Deliverable: `docs/handoff/HANDOFF-19-M8-SETTINGS-PLATFORM.md` with §11 prompt for M9.

## Do NOT

- Start M9+ or redo M2–M7 unless regressed
- Edit legacy markup/CSS or `/ops-native` product UI (except if explicitly required for settings banner)
- Deploy/push/merge unless owner asks
- Commit unless owner asks

## Acceptance criteria

- [ ] Changing `notify.email_enabled` affects worker email send
- [ ] Retention job logs applied periods from settings
- [ ] Integrations/adapter mode visible in legacy settings or copilot shell
- [ ] `legacy-bridge.mjs --check` passes if bridges touched
- [ ] HANDOFF-19 written with §11 prompt for M9
```
