# Handoff 20: M9 — LP portal live by default and remainder

Date 2026-10-05 · branch `feat/original-ui-wiring` · requirement IDs: LP-001–012, PLAT-001, PLAT-002

## 1. Goal (one paragraph)

M9 ensures that when platform flags mark every LP data domain live (`LP_LIVE_DOMAINS=all` / `GET /api/v1/platform/flags` with all `lp.*` true), investor-web routes all `lpPortalApi` calls to the live API and does not load the mock store on the initial bundle path. The demo-data ribbon hides when every listed domain is live. Backend LP notification prefs (`lp.prefs:*`) were already honoured by the worker via `routeNotifications` in M8; this milestone confirms that wiring. Vitest LP suite extended for flags/ribbon and api-client redirect behaviour.

## 2. Commands run and results

| Command | Result | Notes |
|---|---|---|
| `npx vitest run --pool=vmThreads tests/frontend/investor-web/` | **PASS** | Full LP suite (240 tests) |
| `npx vitest run --pool=vmThreads tests/frontend/investor-web/flags-ribbon.test.tsx` | **PASS** | Demo ribbon hide/show |
| `npx vitest run --pool=vmThreads tests/frontend/investor-web/lib-api-client.test.ts` | **PASS** | Session redirect + step-up |
| `npx tsx backend/api/scripts/test-admin-shell.ts` | **Not run** | Requires `E2E_CONFIRM=throwaway-db` + API |
| `npx tsx backend/api/scripts/test-lp-remainder.ts` | **Not run** | Requires `E2E_CONFIRM=throwaway-db` + API |

## 3. Backend confirmation (read-only — no backend edits in M9)

| Consumer | Setting keys | Module |
|---|---|---|
| LP notification prefs | `lp.prefs:<clientId>` → `notifications.{email*,inApp*,digest}` | `modules/notifications/delivery.ts` (`decideRoute`, `routeNotifications`, `lpCategory`) |
| LP prefs API | `PUT /api/v1/lp-portal/settings` | `modules/lp-portal/routes/settings.routes.ts` |

`test-admin-shell.ts` includes pure `decideRoute` / `routeNotifications` checks proving stored LP prefs affect email (`off`) and in-app (`true`) for `document.published`.

## 4. Frontend changes

### `lp-portal-api.ts`

- Removed static `import` of `mock-api`.
- Added `loadMockLpPortalApi()` — dynamic `import("@/lib/lp-portal/mock-api")` only when a domain flag is false.
- `lpPortalApi` Proxy unchanged: waits for `loadLpFlags()`, routes to mock only when `flags.lp[domain] !== true`.

### `api-client.ts`

- Exported `loginRedirectHref` (pure URL builder for tests).
- Added `setRedirectHandler` test hook — jsdom cannot spy on `location.assign`; production path still uses `window.location.assign`.

### `flags.ts` / `demo-data-ribbon.tsx`

- Unchanged behaviour; verified via new Vitest coverage.

## 5. Tests

- **`flags-ribbon.test.tsx`** (new): hides ribbon when all domains live; shows ribbon naming non-live domains; uses `reloadLpFlags()` between cases.
- **`lib-api-client.test.ts`**: `loginRedirectHref` pure test; session expiry via `setRedirectHandler` (once on `LP_UNAUTHORIZED`, suppressed with `authRedirect: false`).

## 6. Known limits / follow-ups

- Full E2E capital-acknowledge persist-after-refresh needs throwaway DB (`test-lp-remainder.ts`).
- Mock module remains in the build graph as a lazy chunk (not on the critical path when all domains live).
- Socket.IO not in scope (SSE/poll per D-12).

## 7. Acceptance checklist

- [x] With all LP domains live, `DemoDataRibbon` is not rendered (`flags-ribbon.test.tsx`)
- [x] Mock store loaded only when a domain flag is false (`loadMockLpPortalApi` dynamic import)
- [x] LP notification prefs affect email/in-app routing (worker — `delivery.ts` + `test-admin-shell.ts` when DB available)
- [x] Vitest LP suite green
- [x] HANDOFF-20 with §11 M10 prompt

---

## §11 — Copy-paste prompt for M10 agent

```
Proceed to M10 on branch feat/original-ui-wiring. Company-web native pages + workspace depth; no commit/push unless I ask.

Read first:
1. docs/handoff/HANDOFF-20-M9-LP-LIVE.md (this file)
2. IMPLEMENTATION_MILESTONES.md — M10
3. portals/company-web/src/components/native/* and lib/native-pages.ts
4. tests/frontend/company-web/native-screens.test.tsx
5. backend/api/src/modules/investee-portal/workspace/

Repo: C:\Users\lysp\Downloads\matanho-nexus-v56-deployment
Branch: feat/original-ui-wiring

## Your scope: M10 — Company-web wire native pages and workspace depth

Requirement IDs: CO-016, CO-005–011, CO-015, FR-CMP-020–028, GAP-016

Goal: `PortalSwitch` active in portal layout; native screens for forecasts/governance/requests/data-room; workspace tables replace Setting JSON where GAP-016 requires.

## Do

1. Frontend: Wire `PortalSwitch` in `(portal)/layout.tsx`; fix `(portal)/*/page.tsx` to render native routes; enable `INVESTEE_LIVE_ACTIONS` when flags on.
2. Backend: Confirm workspace tables migration complete (GAP-016); cap-table transaction persists in DB not Setting JSON.
3. Validation: `tests/frontend/company-web/native-screens.test.tsx`; `scripts/test-investee-workspace.ts` on throwaway DB if available.
4. Deliverable: `docs/handoff/HANDOFF-21-M10-COMPANY-NATIVE.md` with §11 prompt for M11.

## Do NOT

- Start M11+ or redo M2–M9 unless regressed
- Remove full V8 runtime (phased per milestones)
- Deploy/push/merge unless owner asks
- Commit unless owner asks

## Acceptance criteria

- [ ] `/forecasts` renders native screen with live data when flag on
- [ ] Cap-table transaction persists in DB not Setting JSON
- [ ] Vitest company-web native screens green
- [ ] HANDOFF-21 written with §11 prompt for M11
```
