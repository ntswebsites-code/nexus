# Handoff 13: M2 — Admin shell live chrome

Date 2026-10-05 · branch `feat/original-ui-wiring` · requirement IDs: ADMIN-SHELL-02–05, FR-UI-001–003

## 1. Goal (one paragraph)

M2 wires the legacy admin shell at `/` to live backend chrome: signed-in profile in the topbar, ⌘K command palette search via `GET /shell/search`, notification links and search hits opening `GET /shell/record/:kind/:id` in the prototype drawer, sidebar badge counts from dashboard/operations APIs, and health/sync line from ops-health (when permitted) or operations status. No markup/CSS edits; bridges only per CLEANUP rule 1.

## 2. Commands run and results

| Command | Result | Notes |
|---|---|---|
| `node tools/legacy-bridge.mjs --only admin` | **PASS** | Synced `admin-70-shell.js` to `public/legacy/js/bridge/` |
| `node tools/legacy-bridge.mjs --only admin --check` | **PASS** | After sync |
| `npx vitest run --pool=threads tests/frontend/legacy/w0-entry.test.ts` | **PASS** | 6/6 including profile hydration |
| `npx vitest run --pool=threads tests/frontend/legacy/w1-command-ops.test.ts` | **PASS** | 4/4 including palette + notification record drawer |
| `npm run typecheck` + `npm run typecheck:portals` | **PASS** | |
| `npm run verify` | **PARTIAL** | `db:generate` EPERM (Prisma DLL lock on Windows host, per M1 D-43); `test:offline` last script needs `DATABASE_URL` in env on this host |
| M1 flow scripts | **Not re-run** | Per HANDOFF-12; no backend changes in M2 |

## 3. Backend confirmation (read-only)

| Route | Status | Notes |
|---|---|---|
| `GET /api/v1/shell/search` | **Sufficient** | `shell.routes.ts` + `registry.ts`; hits include `href` `/ops/record/:kind/:id` |
| `GET /api/v1/shell/record/:kind/:id` | **Sufficient** | Record fields + optional audit history |
| `GET /api/auth/me` | **Sufficient** | Used by `mx.loadMe()` for profile |
| `GET /api/v1/shell/me/role-focus` | **Sufficient** | Already used by shell bridge |
| `GET /api/v1/notifications` | **Sufficient** | Items carry `link` (ops paths or record paths) |
| `GET /api/v1/dashboard/today` | **Sufficient** | Approvals, orders, breaks, risk, runbook counts for badges |
| `GET /api/v1/operations/status` | **Sufficient** | Corporate actions, cash deadlines, close blockers, service health |
| `GET /api/v1/admin-core/ops-health` | **Sufficient** | `admin.settings` only; status OK/WARNING/CRITICAL |

No backend code changes required for M2.

## 4. Frontend changes

### `portals/admin-web/src/legacy/bridge/admin-70-shell.js`

- **Profile:** `hydrateProfile()` sets topbar name, avatar initials, `#roleLabel` from `mx.user` + `state.role` / `roleLabels` (replaces hardcoded "Tendai Moyo" without markup edits).
- **Badges:** `refreshShellChrome()` clears all sidebar `<em>` counts when live, then applies `GET /dashboard/today` (+ `GET /operations/status` when `operations.view`).
- **Health:** `#lastSync` relative time from API `asOf`; health line from `ops-health` (`admin.settings`) or `operations/status.serviceHealth`.
- **Search:** Enter on `#globalSearch` unchanged (modal + `/shell/search`); results use `followShellLink()`.
- **Command palette:** Wraps `v17RenderCommands` / `v17OpenCommand` — queries ≥2 chars debounce to `/shell/search`; ⌘K opens palette (capture handler when live).
- **Notifications:** Bell intercept unchanged pattern; click marks read then `followShellLink(link)` (record drawer or `navigate(page)`).
- **Record drawer:** `openRecordDrawer(kind, id)` → `GET /shell/record` → prototype `openDrawer` with fields/history + optional "Open in module".
- **Link routing:** `/ops/record/*`, `/ops/orders/:id`, and `/ops/*` module paths map to legacy hash pages (`OPS_PAGE` table).

### Tests

- `tests/frontend/legacy/_harness.ts` — `bootLegacyShell()`, `stubLegacyShellGlobals()`.
- `tests/frontend/legacy/w0-entry.test.ts` — profile hydration tripwire.
- `tests/frontend/legacy/w1-command-ops.test.ts` — palette search + notification record drawer.

## 5. Acceptance criteria

| Criterion | Status |
|---|---|
| Signed-in user sees real name/role in topbar (not "Tendai Moyo") | **PASS** (jsdom `w0-entry`) |
| ⌘K opens search results that navigate to hash pages / record drawer | **PASS** (jsdom `w1-command-ops`) |
| Notification with record link opens drawer via `/shell/record` | **PASS** (jsdom `w1-command-ops`) |
| Sidebar badges from live APIs when signed in | **PASS** (code + `refreshShellChrome`; not browser-verified) |
| `legacy-bridge.mjs --check` passes | **PASS** |
| `w0` / `w1` jsdom tests pass | **PASS** |
| HANDOFF-13 written with §11 prompt for M3 | **PASS** |

**Not browser-verified (D-08):** visual topbar/palette/badge/health appearance on deployed UAT.

## 6. What remains for M3+

- **M3:** Orders ↔ cash reservation loop (`admin-90-orders.js`, FR-CASH-015).
- **M4–M13:** Per `IMPLEMENTATION_MILESTONES.md`.
- **Follow-up:** Full `npm run verify` on Linux CI or Windows host after closing Prisma file lock; M1 flow matrix unchanged.

## 7. Files touched (M2)

- `portals/admin-web/src/legacy/bridge/admin-70-shell.js`
- `portals/admin-web/public/legacy/js/bridge/admin-70-shell.js` (synced)
- `tests/frontend/legacy/_harness.ts`
- `tests/frontend/legacy/w0-entry.test.ts`
- `tests/frontend/legacy/w1-command-ops.test.ts`
- `docs/handoff/HANDOFF-13-M2-ADMIN-SHELL.md`, `docs/handoff/LATEST.md`

No deploy, push, or commit unless owner requests (D-07).

## 11. Next agent — copy-paste this prompt

> **Handoff rule:** When you complete your phase, write the next `docs/handoff/HANDOFF-*.md`, update `docs/handoff/LATEST.md`, and replace this block with a fresh copy-paste prompt for the following agent. See `docs/handoff/README.md`.

```
Implement milestone M3 only from IMPLEMENTATION_MILESTONES.md.

Read first (in order):
1. IMPLEMENTATION_MILESTONES.md — § M3 and §5 Standing rules
2. docs/handoff/HANDOFF-13-M2-ADMIN-SHELL.md — M2 results (shell chrome done; do not redo M2 unless verify regressed)
3. docs/CLEANUP-AGENT-PROMPT.md — rule 1 (bridges only; no markup/CSS edits)
4. docs/DECISION-LOG.md — D-07 (no push unless owner asks)

Repo: C:\Users\lysp\Downloads\matanho-nexus-v56-deployment
Branch: feat/original-ui-wiring

## Your scope: M3 — Orders and cash reservation loop

Requirement IDs: ADMIN-5A05, ADMIN-5A15, ADMIN-XFR-01, FR-CASH-015

Goal: Buy order submit creates cash reservation; cash page and order ticket show matching available balance; cancel releases reservation.

## Do

1. Static gate: `npm run verify` (or typecheck + targeted tests if Windows Prisma lock); `node tools/legacy-bridge.mjs --only admin --check` after bridge edits.
2. Backend: Wire reservation in `modules/orders/*` + `modules/cash/cash.reservations*` per FR-CASH-015 if not already present.
3. Frontend (bridges only): `admin-90-orders.js` reservation status on ticket; `admin-94-cash.js` reserved tile delta.
4. Tests: `scripts/test-orders.ts`, `test-cash.ts`; extend `w3-orders.test.ts`, `w5-cash-recon-financing.test.ts`.
5. Deliverable: `docs/handoff/HANDOFF-14-M3-ORDERS-CASH.md` with commands, evidence, and §11 prompt for M4.

## Do NOT

- Start M4–M13 or redo M2 shell unless regressed
- Edit legacy markup/CSS or `/ops-native` product UI
- Deploy/push/merge unless owner asks in the same message
- Commit unless owner asks

## Acceptance criteria

- [ ] After submit, cash RESERVED increases by order notional
- [ ] After cancel, reservation released
- [ ] 403 SoD on self-approve unchanged
- [ ] Flow scripts + w3/w5 jsdom tests pass
- [ ] HANDOFF-14 written with §11 prompt for M4
```
