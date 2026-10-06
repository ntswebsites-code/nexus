# Handoff 16: M5 — Orders, research, risk, and performance depth

Date 2026-10-05 · branch `feat/original-ui-wiring` · requirement IDs: ADMIN-5A05–08

## 1. Goal (one paragraph)

M5 closes legacy bridge gaps for order reject/settle, research IC workflow (decisions, voting, ratify with maker-checker + step-up), risk limit lifecycle submit/approve/reject/retire plus case intake, and performance official-period lock with step-up when a draft exists. Bridges only; no markup/CSS or ops-native product UI changes.

## 2. Commands run and results

| Command | Result | Notes |
|---|---|---|
| `node tools/legacy-bridge.mjs --only admin` | **PASS** | Synced `admin-90`–`93`, `mx-core.js` |
| `node tools/legacy-bridge.mjs --only admin --check` | **PASS** | After sync |
| `npx vitest run --pool=vmThreads tests/frontend/legacy/w3-orders.test.ts tests/frontend/legacy/w4-research-risk-performance.test.ts` | **PASS** | 9/9 including write round-trips |
| `test-research-privates.ts` / `test-risk.ts` / `test-performance.ts` | **Not run** | `DATABASE_URL` not set on this host |

## 3. Backend confirmation (read-only)

All required routes were already present; no backend changes in M5.

| Area | Routes | Status |
|---|---|---|
| Orders | `POST …/reject` (step-up), `…/settle` | **Sufficient** |
| Research IC | `GET/POST /decisions`, `…/open-voting`, `…/vote`, `…/ratify` (step-up, SoD) | **Sufficient** |
| Research meetings | `POST /meetings` | **Sufficient** |
| Risk limits | `POST …/submit`, `…/approve` (step-up), `…/reject`, `…/retire` | **Sufficient** |
| Risk cases | `POST /cases` | **Sufficient** |
| Performance | `GET /periods`, `POST /periods/:id/lock` (step-up, checker ≠ maker) | **Sufficient** |

## 4. Frontend bridge changes

### `admin-90-orders.js`

- `patchOrderDrawerCash`: inject **Reject** and **Settle** when `detail.allowed` includes those actions.
- `rejectLiveOrder`: reason modal → `POST /orders/:id/reject` with `{ stepUp: true }`.
- `settleLiveOrder`: confirm modal → `POST /orders/:id/settle`.

### `admin-91-research.js`

- `loadIcDecisions`: hydrates open `PROPOSED`/`VOTING` decisions; summary bar IC queue count is clickable.
- `openIcQueueDrawer` / `openIcDecisionModal`: open voting, cast votes, **ratify** (step-up + proposer SoD check).
- `openIcProposalModal` / `openIcMeetingModal`: create decision and schedule meeting.

### `admin-92-risk.js`

- Limit rows: **Submit / Approve / Return / Retire** on draft/pending/active limits (maker-checker on approve).
- `[data-risk-new-case]` intercept → `POST /api/v1/risk/cases` modal.
- Loads all limit statuses for the portfolio (not only ACTIVE).

### `admin-93-performance.js`

- `handleOfficialReturnAction`: if a DRAFT period exists and user has `performance.lock`, opens lock modal → `POST /periods/:id/lock` (step-up); else falls back to prepare draft (`reports.create`).
- Maker-checker guard when preparer attempts lock.

### `packages/legacy-runtime/bridge/mx-core.js`

- `mx.gate` accepts CSS selector strings (`querySelectorAll`), matching bridge usage and jsdom tests.

## 5. Tests

- `w3-orders.test.ts`: static `/reject` + `/settle`; drawer injects reject/settle buttons from `allowed`.
- `w4-research-risk-performance.test.ts`: static path checks; IC vote POST; risk case POST; performance lock POST round-trip.

## 6. Known limits / follow-ups

- IC queue uses a bridge-injected drawer (no dedicated prototype panel); ops-native research remains the full experience.
- Performance lock button label unchanged; behavior is prepare **or** lock depending on draft state and permissions.
- Order reject/settle buttons appear only after live order detail fetch (same pattern as cancel from M3).

## 7. Acceptance checklist

- [x] Order reject + settle wired (drawer patch)
- [x] IC open-voting / vote / ratify with SoD + step-up on ratify
- [x] Risk limit lifecycle + case intake wired
- [x] Performance period lock with step-up when draft ready
- [x] w3/w4 jsdom write round-trips + `legacy-bridge.mjs --check`
- [x] HANDOFF-16 with §11 M6 prompt

---

## §11 — Copy-paste prompt for M6 agent

```
Proceed to M6 on branch feat/original-ui-wiring. Bridges only; no commit/push unless I ask.

Read first:
1. docs/handoff/HANDOFF-16-M5-ORDERS-RESEARCH-RISK-PERF.md (this file)
2. IMPLEMENTATION_MILESTONES.md — M6
3. docs/ADMIN-REAL-PAGES.md — clients/vault/reports/regulatory gap rows

Repo: C:\Users\lysp\Downloads\matanho-nexus-v56-deployment
Branch: feat/original-ui-wiring

## Your scope: M6 — Admin page depth (clients, vault, reports, regulatory)

Requirement IDs: ADMIN-5A09–13, ADMIN-5A22

Goal: Investor portal user CRUD on clients page; vault PM evidence upload; report schedule CRUD + distribute; regulatory evidence upload.

## Do

1. Static gate: `node tools/legacy-bridge.mjs --only admin --check` after bridge edits; targeted vitest for w6/w7.
2. Backend: Confirm distribute endpoint guarded by `feature.report_distribution` (read-only unless missing).
3. Frontend (bridges only): extend `admin-20`, `admin-40`, `admin-102`, `admin-101` (and related bridges per ADMIN-REAL-PAGES).
4. Reference: `portals/admin-web/src/ops/*` clients, documents, reports, regulatory screens; `admin-40-documents.js` upload pattern.
5. Tests: extend w6/w7 jsdom write round-trips; `test-reports.ts`, `test-regulatory.ts` if DB available.
6. Deliverable: `docs/handoff/HANDOFF-17-M6-CLIENTS-VAULT-REPORTS.md` with §11 prompt for M7.

## Do NOT

- Start M7+ or redo M2–M5 unless regressed
- Edit legacy markup/CSS or `/ops-native` product UI
- Deploy/push/merge unless owner asks
- Commit unless owner asks

## Acceptance criteria

- [ ] Schedule create appears in `GET /reports/schedules`
- [ ] Regulatory evidence attach visible on filing row
- [ ] At least one jsdom write round-trip per touched bridge file
- [ ] `legacy-bridge.mjs --check` passes
- [ ] HANDOFF-17 written with §11 prompt for M7
```
