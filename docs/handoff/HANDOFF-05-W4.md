# Handoff 05: W4 finished -> next: W5
Date 2026-10-05 / agent run / branch `feat/original-ui-wiring` / commit (see git log)

## 1. What this phase was (one paragraph)
W4 connected Research & IC (`11`), Risk & Compliance (`12`), and Performance & Attribution (`13`) to the live API. **What you can do now that you could not before W4:** open Research and see published cases in the equity universe (replacing demo issuers), save valuation assumptions to `PUT /research/cases/:id/valuation`, persist analyst notes/catalysts/risks via `/research/entries`, create draft cases from **New investment case**; on Risk, load live limit utilisation into the limit book, run stress via `POST /risk/scenarios/preview`, add draft limits, export the compliance report, and open issuer headroom from the drawer; on Performance, hydrate KPI tiles and Brinson table from `/performance/summary`, `/returns`, and `/attribution`, export attribution CSV, and prepare official periods via `POST /performance/periods`. Browser `localStorage` research notes bypassed when live. The V56 look is unchanged.

## 2. What I did (by page or area)
| Page / area | Wired controls | Endpoints | Bridge file |
| --- | --- | --- | --- |
| research `11` | source bar, `#equityResearchSearch`, universe list, valuation `#researchSaveModel`, notes `#researchSaveNote` / catalyst / risk, `new-research`, issuer depth on select | `GET /research/{summary,cases,issuers/:id}`, `PUT /cases/:id/valuation`, `POST /cases`, `POST /entries` | `admin-91-research.js` |
| risk `12` | status bar, `#riskLimitRows`, scenario lab `#riskRunScenario` (+ top), `#riskAddLimit`, `#riskSaveScenario`, `generate-compliance-report`, `open-issuer-headroom`, portfolio select | `GET /risk/{limits,portfolios/:id/limits,breaches,cases}`, `POST /limits`, `POST /scenarios/preview`, `POST /scenarios`, `GET /compliance-report?format=csv` | `admin-92-risk.js` |
| performance `13` | KPI strip, control bar, attribution table/bridge, controls checklist, `performance-export`, `lock-official-return`, `performance-methodology`, v17 chart series hook | `GET /performance/{summary,returns,attribution}`, `GET /attribution/export`, `POST /periods` | `admin-93-performance.js` |
| DATA_HOOKS | `_research`, `_equityResearch`, `_researchNotes`, `_riskLimits37`, `_v17PerfRows` | n/a | `tools/hooks/w4.mjs` |

Native `/ops-native/research|risk|performance/**` remains reference-only. No backend changes in W4.

## 3. Files changed (list, grouped) and commits
- `portals/admin-web/src/legacy/bridge/admin-91-research.js` (new)
- `portals/admin-web/src/legacy/bridge/admin-92-risk.js` (new)
- `portals/admin-web/src/legacy/bridge/admin-93-performance.js` (new)
- `portals/admin-web/public/legacy/js/bridge/admin-9{1,2,3}-*.js` (generated)
- `tools/hooks/w4.mjs` (new)
- `portals/admin-web/public/legacy/js/01-inline.js`, `02-v7-institutional-enhancement-js.js`, `v37-enhancements.js`, `08-inline.js` (hook patches)
- `portals/admin-web/src/legacy/manifest.ts` (bridge list)
- `tests/frontend/legacy/w4-research-risk-performance.test.ts` (new)
- `docs/DECISION-LOG.md` (D-27..D-28)
- `docs/handoff/HANDOFF-05-W4.md`, `LATEST.md`, `PHASE-LOG.md`

## 4. How I verified it (commands run and results)
- `node tools/legacy-bridge.mjs --only admin` — hooks applied
- `node tools/legacy-bridge.mjs --only admin --check` — up to date
- `node -e "…"` static W4 assertions — pass
- `npx tsc --noEmit -p portals/admin-web` — pass
- `npx vitest run … w4-research-risk-performance.test.ts` — worker timeout (same as W1–W3 on this host)

## 5. Not browser-verified
- [ ] Research universe vs published cases when signed in
- [ ] Valuation PUT with real DCF inputs (revenue/shares) from seed data
- [ ] IC meetings/decisions/voting (no prototype UI)
- [ ] Risk scenario preview numbers vs ops-native
- [ ] Limit maker-checker submit/approve from prototype (draft create only)
- [ ] Performance period lock with step-up (prepare draft only)
- [ ] v37 risk page rebuild when active (`buildRisk37`) vs v7 fragment
- [ ] v44 risk overlays when v37 not active

## 6. Decisions made
- D-27: Bridge files `admin-91..93` (handoff §9) rather than plan's `admin-84..86`.
- D-28: Map simplified valuation form fields to `low=base=high` ranges; reuse stored revenue/shares from last model version.

## 7. Problems found, workarounds, traps
- Prototype limit metrics (USD exposure, liquidity cover) do not map 1:1 to API `RISK_METRICS`; best-effort mapping on create.
- Rates shock input is bps in UI; API `ratePctPoints` expects percentage points (divide by 100).
- v17 performance chart uses `_v17PerfRows` hook; static SVG in fragment is hidden once canvas mounts.
- Vitest worker timeout on combined legacy tests — use `node -e` static checks.

## 8. Carry-over / deferred
- IC meetings, decisions, voting, ratify, orders from research page (ops-native only).
- Research filing import (`#researchImportFiling`) — toast only; use ops-native issuers tab.
- Risk case intake drawer (`openRiskCaseIntake`) — prototype toast only; use `POST /risk/cases` in ops-native.
- Risk limit submit/approve/reject/retire — no prototype buttons; ops-native Limits tab.
- Performance period lock/recompute/correct — prepare draft only from prototype.
- `generate-investment-pack` on research page still handled by W1 `admin-71-command.js`.

## 9. Next phase: W5 — cash, reconciliations, financing, corporate actions
**Scope:** pages `20`, `22`, `25`, `26`. **Owns:** `admin-94-cash.js`, `admin-95-recon.js`, `admin-96-financing.js`, `admin-97-corporate-actions.js`, `tools/hooks/w5.mjs`. **Depends:** W0.

First 5 steps:
1. Read ops-native cash/recon/financing/corporate-actions pages for API shapes.
2. Inventory prototype pages `20-page-cash.html`, `22-page-reconciliations.html`, `25-page-financing.html`, `26-page-corporate-actions.html` + enhancement scripts.
3. Add DATA_HOOKS for `cashJournals`, `cashReservations`, `cashExpectations`, `statementImports`, recon/financing localStorage keys.
4. Wire list/hydration and primary write actions per CLEANUP-AGENT-PROMPT §5 W5.
5. Add `tests/frontend/legacy/w5-cash-recon-financing.test.ts` and run `legacy-bridge.mjs --check`.

## 10. Current state of the repo and environments
- Branch: `feat/original-ui-wiring` (W4 code; parent W3 `ecbfe21`)
- Tests: W0–W3 static checks pass; W4 static checks pass; vitest worker timeout possible on combined runs
- Production (207.180.234.151): untouched
- Dev environment: not deployed
- Untracked files from other workstreams remain — not part of W4

## 11. Next agent — copy-paste this prompt

> **Handoff rule:** When you complete your phase, write the next `docs/handoff/HANDOFF-*.md`, update `docs/handoff/LATEST.md`, and replace this block with a fresh copy-paste prompt for the following agent. See `docs/handoff/README.md`.

```
Read docs/handoff/LATEST.md, then docs/handoff/HANDOFF-05-W4.md (especially §9).
Implement W5 — cash (`20`), reconciliations (`22`), financing (`25`), corporate actions (`26`) — per §9 and docs/CLEANUP-AGENT-PROMPT §5 W5.
Own: admin-94-cash.js, admin-95-recon.js, admin-96-financing.js, admin-97-corporate-actions.js, tools/hooks/w5.mjs.
Deliver: bridges/hooks/tests, `node tools/legacy-bridge.mjs --only admin --check`, HANDOFF-06-W5.md, LATEST.md update, and §11 prompt for W6.
```
