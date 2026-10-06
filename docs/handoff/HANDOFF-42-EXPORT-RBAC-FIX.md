# HANDOFF-42 — Streaming exports + RBAC maker-checker fix

**Branch:** `feat/original-ui-wiring`  
**Date:** 2026-10-06  
**Prior:** HANDOFF-41

## 1. Goal

Fix live tabular exports that incorrectly used `mx.download` (signed-URL JSON) and unblock admin-61 RBAC change-request wrappers blocked by admin-60.

## 2. Changes

| File | Change |
|---|---|
| `admin-00-common.js` | `mx.streamDownload(path, fallbackName)` for CSV/XLSX byte streams |
| `admin-90-orders.js` | Blotter export modal CSV + XLSX via `streamDownload` |
| `admin-92-risk.js` | Compliance report modal CSV + XLSX |
| `admin-93-performance.js` | Attribution export modal CSV + XLSX |
| `admin-60-access.js` | Removed duplicate `togglePermissionV8` / `assignUserRoleV8` wraps (admin-61 owns live path) |
| `admin-61-access-depth.js` | Block demo matrix toggles when `mx.live && mx.strict('rbac')` without `admin.rbac` |
| Tests + `ADMIN-REAL-PAGES.md` | Rows 5, 7, 26, 27 updated |

## 3. Honest remaining limitations

| Area | Note |
|---|---|
| Recon connector | 503 when custodian adapter not configured (toast wired) |
| Accounting | Multi-basis book config has no API |
| Model governance | v37 wizard simplified UX |
| Audit | Large-chain facet parity (browser QA deferred) |

## 4. Verification

```bash
node tools/legacy-bridge.mjs --only admin --check
npx vitest run --pool=threads --maxWorkers=1 tests/frontend/legacy/w0-entry.test.ts
npx vitest run --pool=threads --maxWorkers=1 tests/frontend/legacy/w3-orders.test.ts
npx vitest run --pool=threads --maxWorkers=1 tests/frontend/legacy/w4-research-risk-performance.test.ts
npx vitest run --pool=threads --maxWorkers=1 tests/frontend/legacy/w9-copilot-rbac-audit-qa.test.ts
```

## §11 — Next

Post-admin: M9 LP live flags, UAT deploy, `/ops-native` owner sign-off (D-07).
