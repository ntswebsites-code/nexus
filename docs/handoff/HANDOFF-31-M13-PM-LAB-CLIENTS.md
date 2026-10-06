# Handoff 31: M13 (slice 8) — Private markets / portfolio-lab / clients live chrome

Date 2026-10-06 · branch `feat/original-ui-wiring` · requirement IDs: ADMIN-5A4, ADMIN-5A15

## 1. Goal (one paragraph)

M13 slice 8 removes prototype numbers from Private Markets, Portfolio Construction and Clients when signed in (`mx.strict(page)`). State bars and KPI strips clear on hydrate; demo-only panes hide when live. Fund/commitment and portfolio-lab model lifecycle modals wire to existing API routes; clients page KPIs patch from `/client-ops/clients/summary` with a pending-changes badge on the header inbox.

## 2. Commands run and results

| Command | Result | Notes |
|---|---|---|
| `node tools/legacy-bridge.mjs --only admin` | **PASS** | |
| `node tools/legacy-bridge.mjs --only admin --check` | **PASS** | |
| `npx vitest run --pool=forks tests/frontend/legacy/w7-clients-services-onboarding-vault.test.ts` | **PASS** | |
| `npx vitest run --pool=forks tests/frontend/legacy/w8-private-markets-data-models.test.ts` | **PASS** | |

## 3. Changes

| File | Change |
|---|---|
| `admin-83-private-markets.js` | `clearPmChrome`, `togglePmDemoPanels`, look-through %, commitment modal, statebar index fix |
| `admin-82-portfolio-lab.js` | `clearLabKpis`, models modal (create/activate/retire/clone/delete) |
| `admin-20-clients.js` | `clearClientsKpis`, fixed KPI selector, pending-changes badge, `hydrate('clients')` |
| `08/09/14-page-*.html` | Neutral placeholders; PM fund/commitment actions; lab Models button |
| `w7` / `w8` tests | clear* and route assertions |
| `docs/ADMIN-REAL-PAGES.md` | Rows 3–4, 9 gap columns |

## 4. Remaining M13 work

Pages 11–14, 16 (partial), 19, 23–28 still list gaps. Next: **onboarding/vault polish**, **data schedules**, **regulatory filing depth** — only where routes exist.

## 5. Acceptance checklist

- [x] Private markets statebar/J-curve show `—` until API loads; demo panes hidden
- [x] Fund + commitment modals POST to live routes
- [x] Portfolio-lab KPIs clear; model lifecycle modal wired
- [x] Clients KPI strip live; pending changes badge on header
- [x] w7 + w8 legacy tests green
- [ ] Full M13 sweep complete

---

## §11 — Copy-paste prompt for M13 continuation

```
Continue M13 on branch feat/original-ui-wiring. Completed through slice 8 (HANDOFF-31). No commit/push unless I ask.

Read: docs/ADMIN-REAL-PAGES.md gap column · HANDOFF-31

Next targets: onboarding risk-factor editor, vault PM evidence upload UX, data exception assign, regulatory filing waive — wire only where GET/POST routes exist; no hardcoded KPIs when mx.strict(page).

Validation: node tools/legacy-bridge.mjs --only admin --check; w7, w8 legacy tests.
```
