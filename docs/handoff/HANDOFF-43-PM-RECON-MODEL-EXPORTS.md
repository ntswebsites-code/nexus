# HANDOFF-43 — PM look-through, recon export, model register modal

**Branch:** `feat/original-ui-wiring`  
**Date:** 2026-10-06  
**Prior:** HANDOFF-42

## 1. Goal

Wire remaining S3/S4 export routes and fix broken PM look-through download.

## 2. Changes

| File | Change |
|---|---|
| `admin-83-private-markets.js` | Look-through export via `streamDownload` CSV/XLSX (was broken JSON parse) |
| `admin-95-recon.js` | **Export breaks** button → `GET /recon/breaks?format=csv&status=open` |
| `admin-85-model-governance.js` | Register model modal (replaces `window.prompt` chain) |
| `w5` / `w8` tests + `ADMIN-REAL-PAGES.md` | Rows 3, 18, 24; w5 ops export assertions fixed |

## 3. Honest remaining limitations

| Area | Note |
|---|---|
| Recon connector | 503 when custodian adapter not configured |
| Accounting | Multi-basis book config has no API (panel hidden when live) |
| Model governance | v37 grid UX vs ops-native wizard |
| Audit | Large-chain facet parity (browser QA deferred) |

## 4. Verification

```bash
node tools/legacy-bridge.mjs --only admin --check
npx vitest run --pool=threads --maxWorkers=1 tests/frontend/legacy/w5-cash-recon-financing.test.ts
npx vitest run --pool=threads --maxWorkers=1 tests/frontend/legacy/w8-private-markets-data-models.test.ts
```

## §11 — Next

Post-admin: M9 LP live, UAT deploy, `/ops-native` owner sign-off (D-07).
