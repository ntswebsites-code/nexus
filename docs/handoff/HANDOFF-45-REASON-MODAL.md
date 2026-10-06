# HANDOFF-45 — Shared `mx.reasonModal` helper

**Branch:** `feat/original-ui-wiring`  
**Date:** 2026-10-06  
**Prior:** HANDOFF-44

## 1. Goal

Extract S1 in-app reason dialogs into `admin-00-common.js` and wire remaining sidebar `window.prompt` paths on financing, corporate actions, accounting, regulatory, data, portfolio-lab, and PM marks.

## 2. Changes

| File | Change |
|---|---|
| `admin-00-common.js` | `mx.reasonModal({ eyebrow, title, label, minLength, onConfirm })` |
| `admin-96-financing.js` | Margin call dispute/resolve/waive |
| `admin-97-corporate-actions.js` | Reverse/cancel event |
| `admin-100-accounting.js` | Journal return to maker |
| `admin-101-regulatory.js` | Filing waive |
| `admin-84-data.js` | Exception resolve/waive |
| `admin-82-portfolio-lab.js` | Model retire |
| `admin-83-private-markets.js` | Mark return/reject |
| `w0` / `w5` / `w6` / `w8` tests | Static + data resolve modal interaction |

## 3. Honest remaining limitations

Clients, vault, onboarding, RBAC (2FA reset), and company-reporting card still use `window.prompt` for multi-field or low-traffic flows. Post-admin deploy/browser QA unchanged (D-07).

## 4. Verification

```bash
node tools/legacy-bridge.mjs --only admin --check
npx vitest run --pool=vmThreads --maxWorkers=1 tests/frontend/legacy/w0-entry.test.ts
npx vitest run --pool=vmThreads --maxWorkers=1 tests/frontend/legacy/w5-cash-recon-financing.test.ts
npx vitest run --pool=vmThreads --maxWorkers=1 tests/frontend/legacy/w6-nav-accounting-regulatory-reports.test.ts
npx vitest run --pool=vmThreads --maxWorkers=1 tests/frontend/legacy/w8-private-markets-data-models.test.ts
```

## §11 — Next

Owner-driven: UAT deploy `uat-rc11-original-ui`, browser QA `HANDOFF-11-POST-WIRING.md` §5, `/ops-native` sign-off (D-07).
