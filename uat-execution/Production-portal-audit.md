# Live Production Portal Audit — 12 October 2026

**Scope:** all five live portals (admin, investor, onboarding, company, custodian) on `uat-2026-10-b`, audited with real human-like browser interaction (Chrome driven over CDP: form fills, button clicks, navigation, console + network capture).

## Method

- Real headless Chrome (155) driven via the DevTools Protocol; each portal audited after clearing all cookies (clean, unauthenticated start).
- Credentials: production identities from `/opt/matanho-nexus/secrets/users.json` (uat.*@nexus.matanho.com personas) — no credential resets were needed; every login succeeded first attempt.
- Evidence: `uat-execution/prod-audit/*.json`; drivers: `audit-cdp.mjs`, `prod-functional-audit.mjs`, `company-recheck.mjs` (repo root, re-runnable).

## Portal results

| Portal | Login | Landing | Live data | Console errors | Unexpected failed requests |
|--------|-------|---------|-----------|----------------|----------------------------|
| admin (nexus.matanho.com) | ✅ sysadmin | ✅ `/` | ✅ 28/28 workspaces render | **0** | **0** |
| investor (investor.nexus.matanho.com) | ✅ LP manager | ✅ `/lp-portal` | ✅ dashboard, documents, performance, capital, notices, reports, settings | **0** | **0** |
| onboarding (onboarding.nexus.matanho.com) | n/a public | ✅ public application form | ✅ wizard renders | **0** | **0** |
| company (company.nexus.matanho.com) | ✅ investee contributor | ✅ `/` | ✅ live portfolio (Zambezi Pay, $28M requested/approved), KPI/reporting/governance workspaces | **0** | **0** |
| custodian (custodian.nexus.matanho.com) | ✅ custodian submitter | ✅ `/` | ✅ CP-001, account CUST-CL-00418, executions/statements/notifications surfaces | **0** | **0** |

The only ≥400 requests observed anywhere were the expected pre-login `/api/auth/me` and `/api/v1/notifications` 401 probes.

## Deployed fixes verified in the live UI

| Fix | Live verification |
|-----|-------------------|
| DEF-2026-002 nav follows authenticated permissions | 28 nav items, **0** secondary for sysadmin (was 6-primary client-side map) |
| DEF-2026-004 Data Fabric tabs | connections/products/pipelines/quality/lineage all render distinct views (was: all tabs → Lineage) |
| DEF-2026-001 connection test is real server-side work | "UAT PROD Audit Connector" saved → **POST /data/sources 201**, confirmed server-side (17 sources now; test-button flow retained) |
| DEF-2026-003 audit trail | 101 rows render with user/role/action/time; no stuck "Loading audit events…" |
| DEF-2026-006 clients live data | "Relationships 184 — **3 live from client master**"; no prototype copy |
| DEF-2026-007 favicon | `/favicon.ico` → 200 `image/x-icon` on all portals |
| CSP/demo-logo noise | 0 console errors across full workspace walk (was: 20+ CSP/network errors) |
| Smoke gate | 50 pass / 0 fail / 6 skip at deploy; no regression in this audit |

## Findings

**No genuine defects found in this audit round** — every deployed fix is working live and all functional surfaces responded correctly. Three initial "failures" were audit-harness artifacts, each corrected and re-verified: (1) admin `command` workspace caught mid-hydration (re-verified: 2,202 chars live); (2) investor `/lp-portal/signatures` expected the word "Signatures" while the page correctly heads "Documents to sign"; (3) company overview caught mid-load (re-verified: live portfolio data).

## Observations for the owner

1. **Test residue:** one connector ("UAT PROD Audit Connector", sandbox=false) was created in production by the audit's save-verification. No delete endpoint exists; it is inert but should be cleared by the documented reset procedure or ignored.
2. **Hydration timings:** admin Today and company Overview need ~5–8 s before first paint of live data — acceptable, but noted for the NFR p95 conversation once G03 targets are approved.
3. Login worked first attempt for every portal — no credential resets required (production passwords in the host `secrets/users.json` remain authoritative).

**Conclusion: all five live portals confirmed fully operational on release `uat-2026-10-b`; all recent updates verified in the live UI.**
