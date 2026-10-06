# Handoff 30: M13 (slice 7) — Research / risk / performance live chrome

Date 2026-10-06 · branch `feat/original-ui-wiring` · requirement IDs: ADMIN-5A14, ADMIN-5A7, ADMIN-5A8

## 1. Goal (one paragraph)

M13 slice 7 removes prototype numbers from Research, Risk and Performance when signed in (`mx.strict(page)`). Source bars, hero panels, status bars and KPI strips now clear to neutral placeholders on hydrate and repopulate from live APIs. Risk demo bottom worklists hide when live; performance drops the `* 83.6` benchmark fallback and auto-recomputes stale draft periods before lock.

## 2. Commands run and results

| Command | Result | Notes |
|---|---|---|
| `node tools/legacy-bridge.mjs --only admin` | **PASS** | |
| `node tools/legacy-bridge.mjs --only admin --check` | **PASS** | |
| `npx vitest run --pool=vmThreads tests/frontend/legacy/w4-research-risk-performance.test.ts` | **PASS** | |

## 3. Changes

| File | Change |
|---|---|
| `admin-91-research.js` | `clearResearchChrome`, summary bar from `/research/summary`, hydrate clears hero |
| `admin-92-risk.js` | `clearRiskChrome`, `toggleRiskDemoPanels`, statusbar IDs (`riskClosestLimit`, `riskOpenExceptions`) |
| `admin-93-performance.js` | `clearPerformanceChrome`, fix `toV17Rows` benchmark, stale draft → `POST /periods/:id/recompute` |
| `11/12/13-page-*.html` | Neutral `—` placeholders instead of Delta/demo figures |
| `w4-research-risk-performance.test.ts` | clear* assertions + recompute test |
| `docs/ADMIN-REAL-PAGES.md` | Rows 6–8 wired/gap columns |

## 4. Remaining M13 work

Pages 3–4, 9–14, 16 (partial), 19, 23–28 still list gaps. Next: **private-markets CRUD modals**, **portfolio-lab model CRUD**, **clients/onboarding** inbox polish — only where routes exist.

## 5. Acceptance checklist

- [x] Research sourcebar + hero show `—` until API loads
- [x] Risk statusbar/limit table/scenario strip live; demo bottom panels hidden
- [x] Performance stat line/control bar live; no hardcoded benchmark multiplier
- [x] Stale draft recompute wired before lock
- [x] w4 legacy tests green
- [ ] Full M13 sweep complete

---

## §11 — Copy-paste prompt for M13 continuation

```
Continue M13 on branch feat/original-ui-wiring. Completed through slice 7 (HANDOFF-30). No commit/push unless I ask.

Read: docs/ADMIN-REAL-PAGES.md gap column · HANDOFF-30

Next targets: private-markets fund/commitment modals, portfolio-lab model CRUD, clients pending-change inbox — wire only where GET/POST routes exist; no hardcoded KPIs when mx.strict(page).

Validation: node tools/legacy-bridge.mjs --only admin --check; w4, w8 legacy tests.
```
