# Handoff 02: W1 finished -> next: W2
Date 2026-10-05 / agent run / branch `feat/original-ui-wiring` / commit (see section 10)

## 1. What this phase was (one paragraph)
W1 wired the Command Centre (Today), Operations Control, and shared topbar shell to the real API through three new bridge scripts. Signed-in staff now see live KPIs, approval counts, runbook tasks, global search, notifications, role-focus persistence, and investment-pack generation in the original V56 UI — without changing any prototype markup or CSS.

## 2. What I did (by page or area)
| Page / area | Wired controls | Endpoints | Bridge file |
| --- | --- | --- | --- |
| Topbar / shell | Global search (Enter), notifications bell, role-focus on `#roleSwitcher` | `GET /shell/search`, `GET/POST /notifications*`, `GET/PUT /shell/me/role-focus` | `admin-70-shell.js` |
| command (Today) | KPI strip (`#gio*`), as-of label, performance headline + SVG from panels, investment pack button, sidebar badges | `GET /dashboard/today`, `GET /dashboard/panels`, `POST /reports/runs`, `GET /reports/runs/:id/link`, `GET /reports/lookups` | `admin-71-command.js` |
| operations | Status KPIs, runbook list + filters, task modal (start/complete/block/reopen), new task, calendar modal | `GET /operations/status`, `GET /operations/tasks`, `POST /operations/tasks`, `POST /operations/tasks/:id/*`, `GET /operations/calendar`, `POST /operations/tasks/generate` | `admin-72-operations.js` |
| DATA_HOOKS | `opsTasks` demo bypass when live | n/a | `tools/hooks/w1.mjs` |

Profile drawer, MFA and sign-out remain in `admin-60-access.js` (unchanged). Native `/ops-native` screens remain reference-only.

## 3. Files changed (list, grouped) and commits
- `portals/admin-web/src/legacy/bridge/admin-70-shell.js` (new)
- `portals/admin-web/src/legacy/bridge/admin-71-command.js` (new)
- `portals/admin-web/src/legacy/bridge/admin-72-operations.js` (new)
- `tools/hooks/w1.mjs` (new)
- `portals/admin-web/public/legacy/js/v33-rebuild.js` (hook patch)
- `portals/admin-web/src/legacy/manifest.ts` (bridge list)
- `tests/frontend/legacy/w1-command-ops.test.ts` (new)
- `docs/handoff/*`, wiring docs imported from `feat/admin-recon-nav`

## 4. How I verified it (commands run and results)
- `node tools/legacy-bridge.mjs --only admin` — updated manifest + w1 hook
- `node tools/legacy-bridge.mjs --only admin --check` — up to date
- `npx vitest run --project admin-web tests/frontend/legacy/w1-command-ops.test.ts` — 2/2 pass
- `npx vitest run --project admin-web tests/frontend/legacy/w0-entry.test.ts` — 5/5 pass (run alone; combined run hits vitest worker timeout on this machine)
- `npm run build -w @matanho/admin-web` — not re-run this session (passed at W0); recommend before merge

## 5. Not browser-verified
- [ ] Today KPI numbers match API when signed in as System Administrator
- [ ] Performance chart interaction (range buttons, April drawdown band) with live series
- [ ] Operations task maker-checker / creator-cannot-complete error toasts
- [ ] Global search result navigation to hash pages vs `/ops-native` links
- [ ] Notification bell unread count badge in topbar

## 6. Decisions made
- D-20: Shell search uses Enter in `#globalSearch` + modal results (prototype has no palette component); logged in DECISION-LOG.
- D-21: Operations v36 dynamic page rebuilt by `v36-enhancements.js` — bridge targets shared `#v33OpsRunbook` / `#v36OpsRunbook` containers after build.
- Profile drawer left in admin-60; admin-70 only adds search/bell/role-focus to avoid duplicate interceptors.

## 7. Problems found, workarounds, traps
- `generate-investment-pack` is handled in `01-inline.js` via report editor — W1 intercept must run with `mx.strict('command')` and capture-phase ordering (bridge loads before prototype).
- `opsTasks` is `const` inside v33 IIFE — use DATA_HOOKS `__mxData.opsTasks` prefix, not `mx.replace`.
- Vitest sometimes times out starting workers when multiple legacy test files run together; run individually on slow hosts.

## 8. Carry-over / deferred
- Today: attribution/scenario/risk-heat/liquidity waterfall panels still use prototype chart engine demo data when those tabs open (panels API has performance/allocation/scenario but full chart-engine replacement deferred).
- Operations: CSV/XLSX export buttons (`#v36OpsExport`) not wired — needs download helper on bridge.
- Topbar: `GET /shell/record/:kind/:id` for detail drawer links not wired (shared chrome; partial in W9).
- Close gates / settlement fails (`/ops-controls/*`) not on operations fragment — defer to W5 or ops-controls bridge.

## 9. Next phase: W2 — portfolios, IBOR, portfolio-lab
**Scope:** pages `07`, `19`, `09`. **Owns:** `admin-80-portfolios.js`, `admin-81-ibor.js`, `admin-82-portfolio-lab.js`, `tools/hooks/w2.mjs`. **Depends:** W0.

First 5 steps:
1. Read `src/app/(ops-native)/ops-native/portfolios/page.tsx`, `ibor/page.tsx`, `portfolio-lab/page.tsx` for API shapes.
2. Inventory prototype controls in `07-page-portfolios.html`, `19-page-ibor.html`, `09-page-portfolio-lab.html` + scoped `rg` on prototype JS.
3. Verify/implement `POST /portfolios` if missing (FR-PORT-011).
4. Add DATA_HOOKS for `institutionalPositions` / portfolio arrays as needed.
5. Add `tests/frontend/legacy/w2-portfolios-ibor.test.ts` and run `legacy-bridge.mjs --check`.

## 10. Current state of the repo and environments
- Branch: `feat/original-ui-wiring` (W1 commit pending at handoff write; parent W0 `eeafba4`)
- Tests: W0 5/5, W1 2/2 (legacy project, individual runs)
- Production (207.180.234.151): untouched per owner instruction
- Dev environment: not deployed
- Untracked files from other workstreams remain in working tree (investee-native stash, company-web native screens) — not part of W1
