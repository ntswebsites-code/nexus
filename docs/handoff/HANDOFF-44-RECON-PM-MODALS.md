# HANDOFF-44 — Recon query/candidate and PM pipeline modals

**Branch:** `feat/original-ui-wiring`  
**Date:** 2026-10-06  
**Prior:** HANDOFF-43

## 1. Goal

Replace remaining `window.prompt` chains on recon and private-markets write paths with in-app modals (S1/S4 plan cross-check).

## 2. Changes

| File | Change |
|---|---|
| `admin-95-recon.js` | `openBreakQueryModal`, `openAcceptCandidateModal` |
| `admin-83-private-markets.js` | Pipeline deal, liquidity scenario, cashflow cancel modals |
| `admin-85-model-governance.js` | Version reject reason modal |
| `w5` / `w8` tests | Static assertions for modal form ids |

## 3. Honest remaining limitations

Unchanged from HANDOFF-43: recon connector 503, accounting multi-basis, model v37 grid UX, audit browser QA, post-admin M9 deploy (D-07).

Other pages still use `window.prompt` for short maker-checker reasons (clients, vault, financing, etc.) — acceptable for step-up flows until a shared reason-dialog helper is extracted.

## 4. Verification

```bash
node tools/legacy-bridge.mjs --only admin --check
npx vitest run --pool=threads --maxWorkers=1 tests/frontend/legacy/w5-cash-recon-financing.test.ts
npx vitest run --pool=threads --maxWorkers=1 tests/frontend/legacy/w8-private-markets-data-models.test.ts
```

## §11 — Next

Post-admin: UAT deploy `uat-rc11-original-ui`, `/ops-native` owner sign-off (D-07). M11 browser QA per `HANDOFF-11-POST-WIRING.md` §5.
