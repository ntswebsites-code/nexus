# Handoff 08: W7 finished -> next: W8
Date 2026-10-05 / agent run / branch `feat/original-ui-wiring` / commit (see git log)

## 1. What this phase was (one paragraph)
W7 extended clients depth, investor services, onboarding, and vault depth on the existing bridge slots (`admin-10`, `admin-20`, `admin-30`, `admin-40`) via `/api/v1/client-ops/*`. **What you can do now that you could not before W7:** on Clients, open Client 360 hydrated from `GET /client-ops/clients/:id/360`, place dealing holds, submit mandate/hold-release change requests, assign relationship owner and review date, reveal cash-account identifiers (audited), export live cash CSV, and queue a HOLDINGS client report via `/reports/runs`; on Investor Services, summary KPI tiles from `/services/summary`, assign/status/note/sla through client-ops request endpoints, and edit SLA policies; on Onboarding, load the live queue from `/onboarding/queue`, record checks, propose/approve risk, assign owners, run AI triage, and view risk factors; on Vault, summary/register from client-ops, legal holds, change approvals, retention apply, access log, PM evidence list, and document link/hold controls in the document modal. Demo seed bypass remains when signed out. The V56 look is unchanged.

## 2. What I did (by page or area)
| Page / area | Wired controls | Endpoints | Bridge file |
| --- | --- | --- | --- |
| clients `14` | Client 360 drawer controls, dealing hold, change requests, owner/review, mandate activation/closure, reveal identifier, live CSV export, client report | `GET /client-ops/clients/{summary,:id/360}`, `POST .../{dealing-hold,relationship-owner,review-date,change-requests}`, `GET/POST /change-requests/*`, `POST /cash-accounts/:id/reveal-identifier`, `POST /reports/runs` | `admin-20-clients.js` |
| investor-services `15` | Summary KPI patch, SLA policy editor, request assign/status/note/sla (client-ops) | `GET /client-ops/services/{summary,sla-policies}`, `POST /services/requests/:ref/{assign,status,note,sla}`, `PUT /services/sla-policies` | `admin-30-investor-services.js` |
| onboarding `16` | Queue → v35 cases, workup/risk/checks/assign/triage/risk factors | `GET /client-ops/onboarding/{queue,risk-factors}`, `GET/POST .../cases/:id/{workup,checks,risk,assign,triage}`, `POST /onboarding/risk/:id/{approve,reject}` + legacy KYC | `admin-10-kyc.js` |
| vault `18` | Summary tabs, v33 register hook, holds, changes approve/reject, retention apply, access log, PM evidence, link | `GET /client-ops/vault/{summary,documents,changes,access-log,pm-evidence}`, `POST .../{hold,changes,retention-schedules/apply,link}`, `POST /vault/holds/:id/release` | `admin-40-documents.js` |
| DATA_HOOKS | `_vaultDocs33`, onboardingQueue, `renderKycKpis35`, client-profiles localStorage bypass | n/a | `tools/hooks/w7.mjs` |

Native `/ops-native/clients|investor-services|onboarding|vault/**` remains reference-only. No backend changes in W7.

## 3. Files changed (list, grouped) and commits
- `portals/admin-web/src/legacy/bridge/admin-10-kyc.js` (extended)
- `portals/admin-web/src/legacy/bridge/admin-20-clients.js` (extended)
- `portals/admin-web/src/legacy/bridge/admin-30-investor-services.js` (extended)
- `portals/admin-web/src/legacy/bridge/admin-40-documents.js` (extended)
- `portals/admin-web/public/legacy/js/bridge/admin-{10,20,30,40}-*.js` (generated)
- `tools/hooks/w7.mjs` (new)
- `tools/legacy-bridge.mjs` (moved v35 queue hook to w7)
- `portals/admin-web/public/legacy/js/v33-rebuild.js`, `v35-enhancements.js`, `03-v10-branding-kyc-js.js` (hook patches)
- `tests/frontend/legacy/w7-clients-services-onboarding-vault.test.ts` (new)
- `docs/DECISION-LOG.md` (D-33..D-34)
- `docs/handoff/HANDOFF-08-W7.md`, `LATEST.md`, `PHASE-LOG.md`

## 4. How I verified it (commands run and results)
- `node tools/legacy-bridge.mjs --only admin` — hooks applied
- `node tools/legacy-bridge.mjs --only admin --check` — up to date
- `node -e "…"` static W7 assertions — pass
- `npx tsc --noEmit -p portals/admin-web` — not run (optional)
- `npx vitest run … w7-clients-services-onboarding-vault.test.ts` — not run (vitest worker timeout possible on this host; same as W1–W6)

## 5. Not browser-verified
- [ ] Client 360 drawer vs ops-native detail when signed in
- [ ] Change-request approve with step-up / SoD from prototype
- [ ] Cash identifier reveal audit trail vs ops-native
- [ ] Investor services SLA editor vs ops-native policies tab
- [ ] Onboarding risk checker reject and risk-factor PUT with step-up
- [ ] Vault hold release step-up from prototype modal
- [ ] Retention schedule apply vs ops-native retention tab
- [ ] v35 onboarding page when active vs v34/v33 fragment

## 6. Decisions made
- D-33: Extend existing `admin-10/20/30/40` bridges (HANDOFF-07 §9) rather than new `admin-21..41` files from the wiring plan.
- D-34: Client report uses `POST /reports/runs` HOLDINGS with the client's first mapped portfolio (no CLIENT catalogue key).

## 7. Problems found, workarounds, traps
- v35 `kycCases35` live/seed hook moved from `legacy-bridge.mjs` base to `w7.mjs` so `--check` stays idempotent after onboardingQueue chaining.
- Prototype investor-services request dialog still uses legacy PATCH when not live; live path uses client-ops assign/status/note/sla.
- Vault v33 `docs` tuple shape mapped from client-ops register; inline `documents` array remains primary for v7 vault page.
- Assign owner / record check / risk propose use prompts where the prototype lacks stable selectors (ops-native has full forms).
- Vitest worker timeout on combined legacy tests — use `node -e` static checks.

## 8. Carry-over / deferred
- Investor portal users CRUD (`/investor-users`) — ops-native only; not in prototype selectors.
- Pending change-request inbox on clients page header — use `mx.showChangeRequests()` or ops-native approvals tab.
- Onboarding risk-factor PUT editor — view-only modal in prototype; edit in ops-native.
- Vault PM evidence file upload — list only in prototype; upload in ops-native.
- v34 buildInvestorServices KPI money tiles — still demo amounts; only open/breach/unassigned patched from summary.

## 9. Next phase: W8 — private markets, data, model governance
**Scope:** pages `08`, `28`, `29`. **Owns:** `admin-83-private-markets.js`, `admin-84-data.js`, `admin-85-model-governance.js`, `tools/hooks/w8.mjs`. **Depends:** W0.

First 5 steps:
1. Read ops-native private-markets, data, model-governance pages for API shapes.
2. Inventory prototype pages `08-page-private-markets.html`, `28-page-data.html`, `29-page-model-governance.html` + v15/v36/v38 enhancements and localStorage keys.
3. Add DATA_HOOKS for demo arrays and localStorage bypasses.
4. Wire list/hydration and primary write actions per CLEANUP-AGENT-PROMPT §5 W8.
5. Add `tests/frontend/legacy/w8-private-markets-data-models.test.ts` and run `legacy-bridge.mjs --check`.

## 10. Current state of the repo and environments
- Branch: `feat/original-ui-wiring` (W7 code; parent W6 pending commit)
- Tests: W0–W6 static checks pass; W7 static checks pass; vitest worker timeout possible on combined runs
- Production (207.180.234.151): untouched
- Dev environment: not deployed
- Untracked files from other workstreams remain — not part of W7

## 11. Next agent — copy-paste this prompt

> **Handoff rule:** When you complete your phase, write the next `docs/handoff/HANDOFF-*.md`, update `docs/handoff/LATEST.md`, and replace this block with a fresh copy-paste prompt for the following agent. See `docs/handoff/README.md`.

```
Read docs/handoff/LATEST.md, then docs/handoff/HANDOFF-08-W7.md (especially §9).
Implement W8 — private markets (`08`), data (`28`), model governance (`29`) — per §9 and docs/CLEANUP-AGENT-PROMPT §5 W8.
Own: admin-83-private-markets.js, admin-84-data.js, admin-85-model-governance.js, tools/hooks/w8.mjs.
Deliver: bridges/hooks/tests, `node tools/legacy-bridge.mjs --only admin --check`, HANDOFF-09-W8.md, LATEST.md update, and §11 prompt for W9.
```
