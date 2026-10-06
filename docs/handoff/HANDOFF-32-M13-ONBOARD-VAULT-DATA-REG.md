# Handoff 32: M13 (slice 9) — Onboarding / vault / data / regulatory live chrome

Date 2026-10-06 · branch `feat/original-ui-wiring` · requirement IDs: ADMIN-5A11, ADMIN-5A16, ADMIN-5A17

## 1. Goal (one paragraph)

M13 slice 9 clears hardcoded KPI strips on Onboarding, Vault, Data Fabric and Regulatory when signed in (`mx.strict(page)`), and closes remaining wiring gaps: risk-factor PUT editor with step-up, data-quality exception assign, vault PM evidence upload in markup, regulatory calendar counts on the KPI row.

## 2. Commands run and results

| Command | Result | Notes |
|---|---|---|
| `node tools/legacy-bridge.mjs --only admin` | **PASS** | |
| `node tools/legacy-bridge.mjs --only admin --check` | **PASS** | |
| `npx vitest run --pool=forks --maxWorkers=1 w6,w7,w8 legacy tests` | **PASS** | |

## 3. Changes

| File | Change |
|---|---|
| `admin-10-kyc.js` | `clearOnboardingKpis`, `patchOnboardingKpis`, `hydrate('onboarding')`, risk-factor PUT editor |
| `admin-40-documents.js` | `clearVaultKpis`, full v33 KPI patch, `hydrate('vault')`, PM evidence + pending changes in markup |
| `admin-84-data.js` | `clearDataKpis`, full KPI patch, `POST /exceptions/:id/assign` |
| `admin-101-regulatory.js` | `clearRegKpis`, calendar `counts` on KPI strip, counts parse fix |
| `16/18/27/28-page-*.html` | Neutral `—` placeholders |
| `w6` / `w7` / `w8` tests | clear* and route assertions |
| `docs/ADMIN-REAL-PAGES.md` | Rows 11, 13, 22–23 gaps cleared |

## 4. Remaining M13 work

Pages 12, 14, 16 (partial), 19, 24–28 still list gaps. Next: **reports schedules**, **model-governance reviews**, **investor-services form**, **valuation depth** — only where routes exist.

## 5. Acceptance checklist

- [x] Onboarding/vault/data/regulatory KPIs show `—` until API loads
- [x] Risk-factor editor PUT with step-up when approver
- [x] Data exception assign wired
- [x] Regulatory waive + calendar counts on KPI row
- [x] w6 + w7 + w8 legacy tests green
- [ ] Full M13 sweep complete

---

## §11 — Copy-paste prompt for M13 continuation

```
Continue M13 on branch feat/original-ui-wiring. Completed through slice 9 (HANDOFF-32). No commit/push unless I ask.

Read: docs/ADMIN-REAL-PAGES.md gap column · HANDOFF-32

Next targets: reports schedule CRUD, model-governance reviews tab, investor-services request form, NAV valuation depth — wire only where GET/POST routes exist; no hardcoded KPIs when mx.strict(page).

Validation: node tools/legacy-bridge.mjs --only admin --check; w6, w7, w8 legacy tests.
```
