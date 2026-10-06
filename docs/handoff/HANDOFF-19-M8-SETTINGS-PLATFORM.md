# Handoff 19: M8 — Settings enforcement and platform health UI

Date 2026-10-05 · branch `feat/original-ui-wiring` · requirement IDs: ADMIN-5A27, ADMIN-XFR-02, ADMIN-XFR-03, PLAT-002, PLAT-005

## 1. Goal (one paragraph)

M8 confirms platform settings written via admin-core are consumed at run time (notification routing, retention purge, feature flags, step-up window, numbering), and surfaces platform health plus integration adapter mode in the legacy admin shell. Backend enforcement (GAP-011) was already implemented; this milestone adds legacy bridge depth for settings health/integrations visibility, documents the split between workspace UI prefs and admin-core settings, fixes a pre-existing syntax error in the audit-filter listener, and extends w9 jsdom coverage.

## 2. Commands run and results

| Command | Result | Notes |
|---|---|---|
| `npx tsx scripts/test-admin-core.ts` | **PASS** | Settings registry, validation, copilot router |
| `npx tsx scripts/test-admin-platform.ts` | **PASS** | Pure health rules, alert lifecycle, SQL paging (DB flow skipped without `E2E_CONFIRM`) |
| `node tools/legacy-bridge.mjs --only admin` | **PASS** | Synced `admin-60`, `admin-61` |
| `node tools/legacy-bridge.mjs --only admin --check` | **PASS** | After sync |
| `npx vitest run --pool=vmThreads tests/frontend/legacy/w9-copilot-rbac-audit-qa.test.ts` | **PASS** | 9/9 including settings PUT, integrations banner, copilot banner |
| `scripts/test-enforcement.ts` | **Not run** | Requires `E2E_CONFIRM=throwaway-db` + running API |

## 3. Backend confirmation (read-only — no backend edits in M8)

| Consumer | Setting keys | Module |
|---|---|---|
| Email delivery | `notify.email_enabled`, `notify.email_non_critical`, `notify.critical_channel` | `modules/notifications/delivery.ts`, `digest.ts` |
| Retention purge | `retention.session_days`, `notifications_days`, `outbox_days`, `idempotency_days`, `dq_exceptions_days` (+ audit/doc floors) | `modules/admin-core/retention.ts` |
| Feature flags | `feature.*` (copilot, dq scheduler, report distribution, …) | respective modules via `lib/settings.ts` |
| Step-up window | `security.step_up_minutes` | `requireStepUp` middleware |
| Numbering padding | per-series via `PUT …/settings/numbering/:kind` | `lib/refs.ts` |
| Platform health | worker heartbeat + ops alerts | `modules/admin-core/ops-health*` (shell topbar reads via `admin-70`) |

`scripts/test-admin-shell.ts` includes pure `decideRoute` tests proving `platformEmail: false` suppresses email while in-app bell remains.

## 4. Frontend bridge changes

### `admin-61-access-depth.js`

- **Platform health drawer** (`openPlatformHealthDrawer`, button `data-mx-settings-health`) — `GET /admin-core/ops-health` summary (workers, outbox, alerts).
- **Integrations banner on settings page** — `GET /integrations/banner`; shows simulated-adapter warning when `production && count > 0` (mirrors copilot banner).
- **`mx.hydrate('settings')`** — injects action buttons, loads settings history and integrations banner on settings page open.
- **Fix:** audit filter click listener had an extra `});` (syntax error).

### `admin-60-access.js`

- Comment documenting split: `platformSettingsV8` = workspace UI prefs (`PUT /api/v1/admin/settings`); enforced flags via admin-core Platform settings drawer.

### Unchanged but verified

- `admin-70-shell.js` — topbar health dot from `GET /admin-core/ops-health` when `admin.settings`.
- `admin-86-copilot.js` — integration banner on copilot page (existing).

## 5. Tests

- `w9-copilot-rbac-audit-qa.test.ts`: static checks for ops-health, integrations banner, platform health drawer; jsdom round-trips for admin-core setting PUT (`notify.email_enabled`), settings-page integrations banner, copilot integrations banner.

## 6. Known limits / follow-ups

- `platformSettingsV8` notification toggles (`notifyRisk`, etc.) are workspace UI defaults only — they do not write admin-core `notify.*` keys.
- Full enforcement E2E (`test-enforcement.ts`) needs throwaway DB + API host.
- SSO adapter not in scope (per milestones).

## 7. Acceptance checklist

- [x] Changing `notify.email_enabled` affects worker email send (via `decideRoute` / `routeNotifications`; E2E in `test-enforcement.ts` when DB available)
- [x] Retention job logs applied periods from settings (`retention.ts` `applied` object; E2E in `test-enforcement.ts`)
- [x] Integrations/adapter mode visible in legacy settings and copilot shell
- [x] `legacy-bridge.mjs --check` passes
- [x] HANDOFF-19 with §11 M9 prompt

---

## §11 — Copy-paste prompt for M9 agent

```
Proceed to M9 on branch feat/original-ui-wiring. Investor-web LP live + prefs; no commit/push unless I ask.

Read first:
1. docs/handoff/HANDOFF-19-M8-SETTINGS-PLATFORM.md (this file)
2. IMPLEMENTATION_MILESTONES.md — M9
3. portals/investor-web/src/lib/lp-portal/ (flags, api client)
4. tests/frontend/investor-web/

Repo: C:\Users\lysp\Downloads\matanho-nexus-v56-deployment
Branch: feat/original-ui-wiring

## Your scope: M9 — LP portal live by default and remainder

Requirement IDs: LP-001–012, PLAT-001, PLAT-002

Goal: With flags on, all LP domains use live API; mock store not used in production build path; worker honours LP notification prefs (wired in M8 backend).

## Do

1. Frontend: Tree-shake or exclude mock from production when all domains live; verify each screen uses live client (`lp-portal-api.ts`, `flags.ts`).
2. Backend: Confirm worker reads LP `lp.prefs:*` settings in notification delivery (already in delivery.ts — verify end-to-end).
3. Validation: `tests/frontend/investor-web/*.test.tsx`; `scripts/test-lp-*.ts` on throwaway DB if available.
4. Deliverable: `docs/handoff/HANDOFF-20-M9-LP-LIVE.md` with §11 prompt for M10.

## Do NOT

- Start M10+ or redo M2–M8 unless regressed
- Add Socket.IO (SSE/poll per D-12)
- Deploy/push/merge unless owner asks
- Commit unless owner asks

## Acceptance criteria

- [ ] With `LP_LIVE_DOMAINS=all`, no DemoRibbon in investor-web production path
- [ ] Capital acknowledge persists after refresh (live API)
- [ ] LP notification prefs affect email/in-app routing (worker)
- [ ] Vitest LP suite green
- [ ] HANDOFF-20 written with §11 prompt for M10
```
