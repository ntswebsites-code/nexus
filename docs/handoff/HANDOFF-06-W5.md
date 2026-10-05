# Handoff 06: W5 finished -> next: W6
Date 2026-10-05 / agent run / branch `feat/original-ui-wiring` / commit (see git log)

## 1. What this phase was (one paragraph)
W5 connected Cash & Ledgers (`20`), Reconciliations (`22`), Collateral & Financing (`25`), and Corporate Actions (`26`) to the live API. **What you can do now that you could not before W5:** on Cash, hydrate context selects, balance tiles, and all four tables from `/cash/*`, explain available cash, create draft journals, approve/reverse posted journals, release reservations, upload statement imports, and run period-close precheck; on Reconciliations, load overview KPIs and the v33 break queue from `/recon/breaks`, run matching via `POST /recon/runs`, submit maker resolution and checker approval, accept match candidates, and record daily sign-off; on Financing, replace `matanho-v52-financing` with live facilities and margin calls in the v52 workspace and v33 facility table; on Corporate Actions, populate the v15 event book from `/corporate-actions/events` and upcoming, project entitlements, and confirm announced events. Browser `localStorage` for `matanho-recon-v12`, `matanho-v52-financing`, and `matanho-v53-counterpart-imports` is bypassed when live. The V56 look is unchanged.

## 2. What I did (by page or area)
| Page / area | Wired controls | Endpoints | Bridge file |
| --- | --- | --- | --- |
| cash `20` | context bar selects, balance tiles, formula card, ledger/reservations/expectations/imports tables, `cash-explain`, `new-cash-journal`, journal approve/reverse drawers, `new-reservation` release, `import-statement` upload, import validate/submit/commit/reject, `period-close-precheck` | `GET /cash/{context,balances,balances/explain,journals,reservations,expectations,statement-imports}`, `POST /cash/journals`, `POST /journals/:id/{approve,reverse}`, `POST /reservations/:id/release`, `POST /statement-imports` + `/:id/{validate,submit,commit,reject}`, `GET /period-closes/precheck` | `admin-94-cash.js` |
| reconciliations `22` | v33 KPIs, `#v33BreakList` / detail, `#v33RunRecon`, `#v33ReconSubmit` / `#v33ReconChecker`, accept candidate/rematch, `#v33ReconSignoff`; v12 `reconCasesV12` hydration | `GET /recon/{overview,breaks}`, `POST /recon/runs`, `POST /breaks/:id/{resolve,approve,accept-match}`, `POST /recon/signoffs` | `admin-95-recon.js` |
| financing `25` | v33 KPI strip, `#v33FacilityRows`, v52 `fin52` workspace (facilities chart, margin list) | `GET /financing/{facilities,margin-calls}` | `admin-96-financing.js` |
| corporate-actions `26` | v15 state bar, `#v15CorpActionRows`, `data-v15-ca-action="project"`, confirm from drawer on announced events | `GET /corporate-actions/{events,upcoming}`, `POST /events/:id/{entitlements/calculate,confirm}` | `admin-97-corporate-actions.js` |
| DATA_HOOKS | `cashJournals`, `cashReservations`, `cashExpectations`, `statementImports`, `_reconBreaks33`, `_facilities33`, `_fin52`, `_v15CorpActions`, recon/financing localStorage bypass | n/a | `tools/hooks/w5.mjs` |

Native `/ops-native/cash|reconciliation|financing|corporate-actions/**` remains reference-only. No backend changes in W5.

## 3. Files changed (list, grouped) and commits
- `portals/admin-web/src/legacy/bridge/admin-94-cash.js` (new)
- `portals/admin-web/src/legacy/bridge/admin-95-recon.js` (new)
- `portals/admin-web/src/legacy/bridge/admin-96-financing.js` (new)
- `portals/admin-web/src/legacy/bridge/admin-97-corporate-actions.js` (new)
- `portals/admin-web/public/legacy/js/bridge/admin-9{4,5,6,7}-*.js` (generated)
- `tools/hooks/w5.mjs` (new)
- `portals/admin-web/public/legacy/js/01-inline.js`, `04-v12-user-focused-js.js`, `06-inline.js`, `v33-rebuild.js`, `v52-enhancements.js`, `v53-enhancements.js` (hook patches)
- `portals/admin-web/src/legacy/manifest.ts` (bridge list)
- `tests/frontend/legacy/w5-cash-recon-financing.test.ts` (new)
- `docs/DECISION-LOG.md` (D-29..D-30)
- `docs/handoff/HANDOFF-06-W5.md`, `LATEST.md`, `PHASE-LOG.md`

## 4. How I verified it (commands run and results)
- `node tools/legacy-bridge.mjs --only admin` — hooks applied
- `node tools/legacy-bridge.mjs --only admin --check` — up to date
- `node -e "…"` static W5 assertions — pass
- `npx tsc --noEmit -p portals/admin-web` — pass
- `npx vitest run … w5-cash-recon-financing.test.ts` — not run (vitest worker timeout possible on this host; same as W1–W4)

## 5. Not browser-verified
- [ ] Cash context filters vs seed portfolios/accounts when signed in
- [ ] Journal create with real ledger lines from seed data
- [ ] Statement import CAMT/MT940 commit with checker step-up
- [ ] Recon break resolve/approve vs ops-native detail drawer
- [ ] Financing facility draw/repay and margin acknowledge/dispute/resolve
- [ ] Corporate action elections, process/instruct/reconcile with step-up
- [ ] v35 recon rebuild when active vs v33 fragment
- [ ] v52 financing overlay timing vs v33 `initFinancing`

## 6. Decisions made
- D-29: Bridge files `admin-94..97` per HANDOFF-05 §9 (continues post–W4 numbering; plan table `admin-91-nav` etc. is stale).
- D-30: Prototype cash journal draft maps to a minimal balanced two-line `POST /cash/journals`; full multi-line editor remains ops-native.

## 7. Problems found, workarounds, traps
- Prototype journal drawer uses display `ref` in tables; bridges keep `apiId` for `POST` actions.
- Recon v33 detail buttons are intercepted in capture phase — do not edit `v33-rebuild.js` render functions for live wiring.
- Financing millions in v52 are derived from API decimal strings (`/ 1e6`); v33 facility table uses raw currency units.
- `admin-99-boot.js` keeps slot `99`; W6 bridges must use `admin-98` and `admin-100+` (not `admin-99-*` except boot).
- Vitest worker timeout on combined legacy tests — use `node -e` static checks.

## 8. Carry-over / deferred
- Cash journal submit/return/reject, reservation create/consume, expectation cancel — partial or ops-native only.
- Recon assign/investigate/evidence/query/escalate/reopen, tolerances, account map, custodian feed — ops-native only.
- Financing facility lifecycle (submit/approve/draw/repay) and margin dispute/resolve/waive — toast or ops-native.
- Corporate actions new-event modal, elections `PUT`, process/instruct/reconcile/reverse/cancel — ops-native or confirm-only from prototype.
- `new-expectation` on cash page — toast only (no prototype form wiring).
- Counterparty import register in v53 — localStorage bypassed when live; upload goes to ops-native custodian feed.

## 9. Next phase: W6 — valuation (NAV), accounting, regulatory, reports
**Scope:** pages `23`, `24`, `27`, `17` (+ report editor/preview modals `40`/`41`). **Owns:** `admin-98-nav.js`, `admin-100-accounting.js`, `admin-101-regulatory.js`, `admin-102-reports.js`, `tools/hooks/w6.mjs`. **Depends:** W0.

First 5 steps:
1. Read ops-native valuation/accounting/regulatory/reports pages for API shapes.
2. Inventory prototype pages `23-page-valuation.html`, `24-page-accounting.html`, `27-page-regulatory.html`, `17-page-reports.html` + v33/v56 enhancement scripts and modals.
3. Add DATA_HOOKS for NAV exceptions, accounting journals/periods, regulatory obligations, report catalogue/runs localStorage keys.
4. Wire list/hydration and primary write actions per CLEANUP-AGENT-PROMPT §5 W6.
5. Add `tests/frontend/legacy/w6-nav-accounting-regulatory-reports.test.ts` and run `legacy-bridge.mjs --check`.

## 10. Current state of the repo and environments
- Branch: `feat/original-ui-wiring` (W5 code; parent W4 pending commit)
- Tests: W0–W4 static checks pass; W5 static checks pass; vitest worker timeout possible on combined runs
- Production (207.180.234.151): untouched
- Dev environment: not deployed
- Untracked files from other workstreams remain — not part of W5

## 11. Next agent — copy-paste this prompt

> **Handoff rule:** When you complete your phase, write the next `docs/handoff/HANDOFF-*.md`, update `docs/handoff/LATEST.md`, and replace this block with a fresh copy-paste prompt for the following agent. See `docs/handoff/README.md`.

```
Read docs/handoff/LATEST.md, then docs/handoff/HANDOFF-06-W5.md (especially §9).
Implement W6 — valuation/NAV (`23`), accounting (`24`), regulatory (`27`), reports (`17` + modals) — per §9 and docs/CLEANUP-AGENT-PROMPT §5 W6.
Own: admin-98-nav.js, admin-100-accounting.js, admin-101-regulatory.js, admin-102-reports.js, tools/hooks/w6.mjs.
Deliver: bridges/hooks/tests, `node tools/legacy-bridge.mjs --only admin --check`, HANDOFF-07-W6.md, LATEST.md update, and §11 prompt for W7.
```
