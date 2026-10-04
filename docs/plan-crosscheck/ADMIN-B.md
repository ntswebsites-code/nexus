# ADMIN-B plan cross-check (FR-CLI, INV, DOC, UI, RBAC, DASH, AUD, AUTH, PLAT, MOD, DATA, REC leftovers, NFR-*)

Method: sampled by code (grep of routes, schema, UI source), not exhaustive reading of every row. Rows not listed below were judged BUILT on evidence of a route/model plus a matching /ops page; per-row depth was not re-verified (tagged "unverified" where noted). Browser behaviour not tested, per instruction.

Slice size in REGISTER.md: about 190 rows (AUD 6, AUTH 5 visible, CLI 15, DASH 5, DATA 2, DOC 19, INV 13, MOD 3, PLAT 5, RBAC 10, REC 17, UI 11, NFR 9).

Counts (approximate): BUILT 168 / PARTIAL 12 / MISSING 4 / ADAPTER 4 / N-A 2

## PARTIAL, MISSING, ADAPTER

| id | requirement (short) | status | what exists | what is missing | evidence |
|---|---|---|---|---|---|
| NFR-PERF-005 | Pagination on every list endpoint, `{data,page,pageSize,total}` | PARTIAL | `middleware/paginate.ts`, used in ~10 files; `pageSize` in 18 files | about 437 `GET` handlers; most lists still use limit caps, not a full total | backend/api/src/middleware/paginate.ts |
| NFR-OPS-007 | JSON request log, RED metrics, worker queue depth and age | PARTIAL | `requestLog`, `/api/internal/metrics` (token-protected) | queue depth and age metric not found in `observability.ts` or `jobs.ts` (unverified) | backend/api/src/middleware/observability.ts |
| NFR-AV-005 | Idempotent single-delivery worker | PARTIAL | row claiming (`outboxClaim.ts`, `jobs.ts`, stale claims re-taken) | proof of multi-worker/no-duplicate-notification test not located | backend/api/src/lib/outboxClaim.ts |
| FR-DOC-016 | Upload allow-list + malware scan clean before preview | ADAPTER | every upload goes through av-scan adapter (EICAR rejected) | real AV vendor; only a fake scanner | backend/api/src/lib/storage.ts, src/integrations/av-scan |
| FR-DOC-017 | Retention policy screen: schedules and legal holds, create/edit | PARTIAL | per-document `retentionYears`, `DocumentHold` + release route, retention filter in Vault | no retention-schedule model or editable schedule screen found | backend/api/prisma/schema.prisma (DocumentHold), co.vault.routes.ts |
| FR-DASH-005 | Investment pack PDF from IC template | PARTIAL | generic reports PDF (`reports/pdf.ts`) | no Command Centre "Investment pack" button in /ops; only in legacy markup | portals/admin-web/src/legacy/markup/06-page-command.html |
| FR-DASH-002/003 | Chart ranges and KPI amber/red tone | PARTIAL | `/dashboard/today`, `/dashboard/panels` with performance curve | docs state performance chart/allocation/scenario panels "not built" on early version, later added panels; range selector and 15% tone rule unverified | docs/ADMIN-REAL-PAGES.md l.954, l.1233 |
| FR-DASH-004 | Empty-state "Nothing needs your decision" | PARTIAL | approval queue per caller | exact empty state not found | portals/admin-web/src/app/(ops)/ops/command |
| FR-UI-002 | Collapse / workspace mode stored per user | PARTIAL | per-user prefs table (`notification_preferences`, settings ownerId) | /ops nav collapse stored only in CSS/localStorage in legacy bridge; server per-user storage not found | portals/admin-web/src/legacy/bridge/admin-00-common.js |
| FR-UI-003 | Health line shows degraded integration name | PARTIAL | `/ops/health`, integrations page | shell health line component not found (only nav.ts references) | portals/admin-web/src/ops/shell |
| FR-UI-008 | Single accessible dialog, max 4 toasts | PARTIAL | focus trap in CommandPalette and legacy bridge; `aria-live` in session.tsx | no confirmed shared dialog primitive for all /ops drawers; 1 remaining `window.prompt` (BreakExtras.tsx) | portals/admin-web/src/ops/recon/BreakExtras.tsx |
| FR-UI-010/011, FR-PLAT-001 | Second-layer URLs, unknown id shows "Record not found" | PARTIAL | `/ops/record` route, `ui.tsx` not-found state | `?layer=` URL scheme not used; per-type 404 unverified | portals/admin-web/src/app/(ops)/ops/record |
| FR-AUTH-018 | Custodian portal with MFA login | PARTIAL | portal id/URL registered, login/invite/reset pages, backend custodian routes | no MFA enrolment/code UI in custodian-web (no TOTP/mfa match) | portals/custodian-web/src/app/(auth) |
| FR-MOD-003 | Overdue validation chip | PARTIAL | `nextReviewOn` and `reviewOverdue` for APPROVED models | "Validation due" chip/label and Command Centre link not found | backend/api/src/modules/model-governance/mg.routes.ts l.78 |
| FR-CLI-020 | "Client portal" action opens investor portal | PARTIAL | `investor.portalUrl` config exists | no "Client portal" action found in /ops clients (unverified) | portals/admin-web/src/ops/clientops.tsx |
| FR-DOC-013/021, FR-CLI ADB-012, FR-INV-017 | UI disables controls without permission, tooltip "Not permitted for <role>" | PARTIAL | server enforces permissions | exact tooltip string not found; ADB-012 logged Open (clients drawer actions not hidden) | docs/FIXES-LOG.md l.245 |
| NFR-SEC-009 / data NFRs | Rate limits (600/min, 30 uploads/min) | BUILT | `generalLimiter`, `uploadLimiter` | - | backend/api/src/middleware/observability.ts |
| FR-DOC-012 | Evidence-manifest PDF package export | PARTIAL | PDF with hash stored; export register | evidence-manifest package not confirmed | backend/api/src/modules/reports/pdf.ts |
| Email/SMS/e-sign/SSO/screening/payment/market-data/custodian-feed/regulator/broker | external vendor integrations | ADAPTER | adapter registry with fakes and `integration_calls` logging; flag `INTEGRATIONS` | all real vendors; fake SSO not consumed by any staff login; screening is stub | docs/ADMIN-REAL-PAGES.md l.1294-1325, backend/api/src/integrations |
| FR-DATA (connections, integrations) | secrets by reference, test history | ADAPTER | registry, test calls recorded | real vendor connectivity; "Test" is a fake call | backend/api/src/modules/admin-core/integrations.routes.ts |
| DEF-525/526/527/530/531 (defects in this slice) | audit gaps, investor scope on docs/threads, multi-company switch, KYC dual-control gap, funds approval step | unverified | register defects, later fix work logged in FIXES-LOG | not re-verified here | docs/srd/REGISTER.md l.1515-1523 |
| BR-067 (recon tolerances effective-dated per family) | per-family config | MISSING | fixed defaults | effective-dated configuration | docs/ADMIN-REAL-PAGES.md l.564 |
| REC (corporate actions, settlement fails, MT535/CAMT, API pull for feeds) | broader recon feeds | MISSING | CSV upload only | MT535/CAMT, API pull, corporate-action recon | docs/ADMIN-REAL-PAGES.md l.754, l.1284 |
| Scheduled report attachments | email carries a link | MISSING | link in email | attachment delivery (needs email adapter) | docs/ADMIN-REAL-PAGES.md l.1284 |
| Configurable KYC risk factors | rules fixed in code | MISSING | fixed rules | configurable risk factors | docs/ADMIN-REAL-PAGES.md l.1145 |

## Notes
- NFR-SEC-013 (CSP, Referrer-Policy, Permissions-Policy, HSTS) is BUILT in `portals/*/next.config.ts` and `deploy/nginx/matanho-nexus.conf`.
- NFR-OPS-006 (X-Request-Id), NFR-SEC-012 (version_conflict), FR-AUD-005/006, FR-RBAC-011..016, FR-PLAT-004/005 (outbox, Sequence table) all located in code: BUILT.
- Not verified by test in this audit: anything browser-visible.
