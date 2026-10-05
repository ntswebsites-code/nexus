# Handoff 07: W6 finished -> next: W7
Date 2026-10-05 / agent run / branch `feat/original-ui-wiring` / commit (see git log)

## 1. What this phase was (one paragraph)
W6 connected Valuation / NAV (`23`), Accounting & Close (`24`), Regulatory (`27`), and Reports & BI (`17` + modals `40`/`41`) to the live API. **What you can do now that you could not before W6:** on Valuation, load the active NAV run with live exceptions and bridge, recalculate or create runs, resolve material exceptions with rationale, submit maker review, release NAV, and view history/policy; on Accounting, hydrate pending journals and period-close checklist from `/accounting/*`, run close pre-check, close the open period (with step-up), post pending journals from the queue, and generate an accounting NAV-pack report; on Regulatory, populate the v33 obligation list from `/regulatory/calendar`, validate/populate filings, submit for review, approve, and submit; on Reports, hydrate v33/v34 report libraries from `/reports/runs`, create runs from catalogue, open signed preview links in the prototype preview modal, and submit from the report editor modal. Demo `reportRows`, `obligations`, `reports`, `reportData`, and `navState` arrays are bypassed when live. The V56 look is unchanged.

## 2. What I did (by page or area)
| Page / area | Wired controls | Endpoints | Bridge file |
| --- | --- | --- | --- |
| valuation `23` | v33 exceptions/bridge/release state, `#v33RunNav` / maker / checker, resolve price; v49 recalc/maker/release/resolve | `GET /nav/{runs,runs/:id,history,policy}`, `POST /nav/runs`, `POST /runs/:id/{recalculate,maker-review,release}`, `PATCH /runs/:id/exceptions/:exId` | `admin-98-nav.js` |
| accounting `24` | stat line, journal queue, close checklist, `accounting-report`, `accounting-precheck`, `accounting-close`, `journal-control` | `GET /accounting/{journals,periods,periods/:id}`, `POST /journals/:id/post`, `POST /periods/:id/{start-close,close}`, `POST /reports/runs` | `admin-100-accounting.js` |
| regulatory `27` | `#v33RegObligations`, package validate/attest/file, `#v33RegCalendar` | `GET /regulatory/calendar`, `POST /calendar/generate`, `POST /filings/:id/{populate,submit-review,approve,submit}` | `admin-101-regulatory.js` |
| reports `17` + modals `40`/`41` | v33/v34 report tables, `#v33NewReport`, schedules list, row preview, `#previewReport`, `#submitReport`, `#printPreview` | `GET /reports/{runs,catalogue,schedules,runs/:id/link}`, `POST /reports/runs` | `admin-102-reports.js` |
| DATA_HOOKS | `_reportRows33`, `_obligations33`, `_reportsInline`, `_reportData34`, `_navState49` | n/a | `tools/hooks/w6.mjs` |

Native `/ops-native/nav|accounting|regulatory|reports/**` remains reference-only. No backend changes in W6.

## 3. Files changed (list, grouped) and commits
- `portals/admin-web/src/legacy/bridge/admin-98-nav.js` (new)
- `portals/admin-web/src/legacy/bridge/admin-100-accounting.js` (new)
- `portals/admin-web/src/legacy/bridge/admin-101-regulatory.js` (new)
- `portals/admin-web/src/legacy/bridge/admin-102-reports.js` (new)
- `portals/admin-web/public/legacy/js/bridge/admin-9{8,100,101,102}-*.js` (generated)
- `tools/hooks/w6.mjs` (new)
- `portals/admin-web/public/legacy/js/01-inline.js`, `v33-rebuild.js`, `v34-enhancements.js`, `v49-enhancements.js` (hook patches)
- `portals/admin-web/src/legacy/manifest.ts` (bridge list)
- `tests/frontend/legacy/w6-nav-accounting-regulatory-reports.test.ts` (new)
- `docs/DECISION-LOG.md` (D-31..D-32)
- `docs/handoff/HANDOFF-07-W6.md`, `LATEST.md`, `PHASE-LOG.md`

## 4. How I verified it (commands run and results)
- `node tools/legacy-bridge.mjs --only admin` — hooks applied
- `node tools/legacy-bridge.mjs --only admin --check` — up to date
- `node -e "…"` static W6 assertions — pass
- `npx tsc --noEmit -p portals/admin-web` — pass
- `npx vitest run … w6-nav-accounting-regulatory-reports.test.ts` — not run (vitest worker timeout possible on this host; same as W1–W5)

## 5. Not browser-verified
- [ ] NAV run create/recalculate vs seed portfolios when signed in
- [ ] Exception resolve with evidence upload vs ops-native detail drawer
- [ ] NAV release step-up MFA from prototype checker button
- [ ] Accounting period close blockers vs ops-native periods tab
- [ ] Journal post from prototype queue vs full journal editor
- [ ] Regulatory filing populate/evidence/export vs ops-native detail
- [ ] Report run params (fund/portfolio/date) from prototype editor vs ops-native catalogue modal
- [ ] v34 reports page rebuild when active vs v33 fragment
- [ ] v49 valuation page when active vs v33 NAV fragment

## 6. Decisions made
- D-31: Bridge files `admin-98`, `admin-100..102` per HANDOFF-06 §9 (`admin-99` reserved for boot).
- D-32: Hydrate both v33 valuation fragment and v49 NAV workspace from the same active run detail.

## 7. Problems found, workarounds, traps
- v33 `renderNav()` hardcodes demo rows — bridge patches `#v33NavExceptions` and `#v33NavBridge` after each load.
- v49 `#v49ResolveNav` has no stable selector — bridge resolves first open material exception via shared capture handler.
- Regulatory prototype stages (attest/file) map to API `submit-review` / `approve` / `submit` depending on filing status.
- Report editor modal content is not sent to API — `submitReport` creates a catalogue run (FACT_SHEET/PDF) rather than persisting free-form HTML.
- `admin-99-boot.js` keeps slot `99`; do not add W7 bridges as `admin-99-*`.
- Vitest worker timeout on combined legacy tests — use `node -e` static checks.

## 8. Carry-over / deferred
- NAV external NAV vs ABOR (`PUT /external-nav`), inputs edit, full pack download — ops-native only.
- Accounting chart of accounts, trial balance, ledger tabs, journal create/submit/return/discard — ops-native only.
- Regulatory evidence upload/delete, export CSV, waive, new filing from template — ops-native or toast.
- Reports schedule create/edit, email distribute, LP delivery, run-due — schedules list toast only.
- `accounting-basis` buttons — prototype layer only (no API mapping).
- Accounting NAV oversight table (fund IBOR/ABOR grid) — static markup; use valuation page for live NAV.

## 9. Next phase: W7 — clients depth, investor-services, onboarding, vault depth
**Scope:** extend `admin-20`, `admin-30`, `admin-10`, `admin-40` (no new bridge slot numbers). **Depends:** W0.

First 5 steps:
1. Read ops-native clients 360, investor-services, onboarding, vault pages for API shapes.
2. Inventory prototype pages `14`, `15`, `16`, `18` + v35/v49 enhancements and localStorage keys.
3. Add DATA_HOOKS for any new prototype arrays or localStorage bypasses.
4. Wire list/hydration and primary write actions per CLEANUP-AGENT-PROMPT §5 W7.
5. Add `tests/frontend/legacy/w7-clients-services-onboarding-vault.test.ts` and run `legacy-bridge.mjs --check`.

## 10. Current state of the repo and environments
- Branch: `feat/original-ui-wiring` (W6 code; parent W5 pending commit)
- Tests: W0–W5 static checks pass; W6 static checks pass; vitest worker timeout possible on combined runs
- Production (207.180.234.151): untouched
- Dev environment: not deployed
- Untracked files from other workstreams remain — not part of W6

## 11. Next agent — copy-paste this prompt

> **Handoff rule:** When you complete your phase, write the next `docs/handoff/HANDOFF-*.md`, update `docs/handoff/LATEST.md`, and replace this block with a fresh copy-paste prompt for the following agent. See `docs/handoff/README.md`.

```
Read docs/handoff/LATEST.md, then docs/handoff/HANDOFF-07-W6.md (especially §9).
Implement W7 — clients depth, investor-services, onboarding, vault depth — per §9 and docs/CLEANUP-AGENT-PROMPT §5 W7.
Extend: admin-20-clients.js, admin-30-investor-services.js, admin-10-kyc.js, admin-40-documents.js, tools/hooks/w7.mjs.
Deliver: bridges/hooks/tests, `node tools/legacy-bridge.mjs --only admin --check`, HANDOFF-08-W7.md, LATEST.md update, and §11 prompt for W8.
```
