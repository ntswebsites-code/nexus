# UAT Evidence Register — Cycle UAT-2026-10-A

**Rules (Manual §04):** every step asserting business state has an EV-ID entry with build, tester, UTC time, business object ID, correlation/request ID; SHA-256 for originals; screenshots alone never pass a step. `EV-<Case>-<Step>-<Seq>`.

## Entry Gates, Flag Triage, Wave 1 (11 Oct 2026)

| EV-ID | Case | Step | Captured (UTC) | Type | Correlation / business IDs | Artefact |
|-------|------|------|----------------|------|----------------------------|----------|
| EV-DEP-001-01 | DEP-001 | 1 | 2026-10-11 18:44 | record | commit `730f3cdf…`, v56.1.0 | `G01-G06-entry-gates.md` §G01 |
| EV-DEP-001-02 | DEP-001 | 2 | 2026-10-11 18:44 | record | SHA-256 archive digests ×4 | `G01-G06-entry-gates.md` §G01 |
| EV-DEP-002-01 | DEP-002 | 1 | 2026-10-11 19:20 | screenshot | 6/6 services HTTP 200/health ok | `evidence/EV-DEP-002-01-admin-dashboard.png` |
| EV-DEP-002-02 | DEP-002 | 2 | 2026-10-11 19:16 | harness output | 6/6 manifest assets hash-identical | `dep-002-asset-check.ts` output |
| EV-DEP-003-01 | DEP-003 | 1 | 2026-10-11 19:29 | harness output | 28/28 workspace panels render | `Wave1-DEP-IAM-DAT-results.md` |
| EV-DEP-003-02 | DEP-003 | 1 | 2026-10-11 19:30 | harness output | sysadmin 33 perms vs 6 visible nav | DEF-2026-002 |
| EV-DEP-004-01 | DEP-004 | 1 | 2026-10-11 19:21 | console log | 3 TypeErrors + favicon 404 | `evidence/EV-DEP-004-01-console-errors.log` |
| EV-DEP-005-01 | DEP-005 | 1 | 2026-10-11 19:46 | harness output | no overflow @1366×768, @390×844 | `Wave1-…results.md` |
| EV-DEP-006-01 | DEP-006 | 1 | 2026-10-11 19:46 | harness output | LP portal URL-addressable | `Wave1-…results.md` |
| EV-DEP-007-01 | DEP-007 | 1 | 2026-10-11 19:47 | harness output | session persists across reload | `Wave1-…results.md` |
| EV-DEP-008-01 | DEP-008 | 1–2 | 2026-10-11 19:50 | harness output | error codes 400/401/403/404/409 | `iam-probe*.ts` output |
| EV-IAM-001-01 | IAM-001 | 1 | 2026-10-11 19:21 | harness output | PM user `61b76f9d…` → command | `iam-probe.ts` |
| EV-IAM-001-02 | IAM-001 | 2 | 2026-10-11 20:16 | snapshot | LP `3639063c…` → `/lp-portal` live dashboard | `evidence/EV-IAM-001-02-lp-portal.yml` |
| EV-IAM-002-01 | IAM-002 | 1 | 2026-10-11 19:36 | harness output | 401 `invalid_credentials`; 403 `portal_access_denied` | `iam-probe.ts` |
| EV-IAM-003-01 | IAM-003 | 1 | 2026-10-11 19:10 | harness output | A=12 docs, B=1 doc, overlap 0 | `if-triage-probe3.ts` |
| EV-IAM-004-01 | IAM-004 | 1 | 2026-10-11 19:42 | harness output | ORD-001013 self-approve 403; approver 200 | `iam-probe2.ts` |
| EV-IAM-004-02 | IAM-004 | 2 | 2026-10-11 19:42 | record | audit req IDs `0f80b1e8…`, `bdb990d5…` | audit-events query |
| EV-IAM-005-01 | IAM-005 | 1 | 2026-10-11 19:36 | harness output | garbage cookie → 401 | `iam-probe.ts` |
| EV-IAM-006-01 | IAM-006 | 1 | 2026-10-11 19:10 | harness output | isolated cookie jars; 0 cross-scope | `if-triage-probe3.ts` |
| EV-IAM-007-01 | IAM-007 | 1 | 2026-10-11 19:36 | harness output | viewer write 403s; catalogue observation | `iam-probe.ts` |
| EV-IAM-008-01 | IAM-008 | 1 | 2026-10-11 20:18 | record | auth.login + order lifecycle + request IDs | audit-events query |
| EV-DAT-001-01 | DAT-001 | 2 | 2026-10-11 19:09 | harness output | email adapter live SMTP messageId `<166869b5…>` | `if-triage-probe.ts` |
| EV-DAT-001-02 | DAT-001 | 2 | 2026-10-11 19:55 | harness output | UI blocked (DEF-2026-001/004) | browser probe |
| EV-DAT-002-01..05-01 | DAT-002..005 | — | 2026-10-11 19:55 | harness output | blocked by DEF-2026-004 | browser probe |
| EV-DAT-004-01 | DAT-004 | 1 | 2026-10-11 20:18 | record | 13 securities incl. DLTA/INN; 806 prices | securities query |
| EV-G01-01..06 | G01–G06 | — | 2026-10-11 18:44–18:55 | record | freeze, partitions, identities, fixtures | `G01-G06-entry-gates.md` |
| EV-IF-01..15 | IF triage | — | 2026-10-11 18:56–19:15 | record | source locators + runtime probes | `IF-triage-record.md` |

## Wave 2 (11 Oct 2026)

| EV-ID | Case | Step | Captured (UTC) | Type | Correlation / business IDs | Artefact |
|-------|------|------|----------------|------|----------------------------|----------|
| EV-NAV-001-01 | NAV-001 | 1-3 | 2026-10-11 22:0x | harness output | NAV-00007 navPerUnit 1041.2690 | `wave2a-probe-output.json` |
| EV-NAV-002-01 | NAV-002 | 2 | 2026-10-11 22:0x | harness output | self-release 403 segregation_of_duties | `wave2a-probe-output.json` |
| EV-CSH-001-01 | CSH-001/002 | 1-3 | 2026-10-11 22:0x | harness output | CJ-00008 draft→POSTED; self-post 403 sod_violation | `wave2a-probe-output.json` |
| EV-REC-001-01 | REC-001/002 | 1-3 | 2026-10-11 22:0x | harness output | statement import 201/3 lines; re-import 409 dedupe | `wave2a-probe-output.json` |
| EV-ORD-001-01 | ORD-001–009 | 1-8 | 2026-10-11 22:1x | harness output | ORD-001016 Draft→Validated→AwaitingApproval→Approved→Routing→PartiallyFilled→Filled; notional 229.00; EMAIL instruction FBC | `wave2b-probe-output.json` + order record |
| EV-DOC-001-01 | DOC-001 | 1-3 | 2026-10-11 22:0x | harness output | upload SHA-256 == computed (`7914fc03…`); signed download 200; unsigned 403 | `wave2a-probe-output.json` |
| EV-PM-001-01 | PM-001/002 | 1-3 | 2026-10-11 22:1x | harness output | 4 funds, MC-0001 ISSUED | `wave2b-probe-output.json` |
| EV-FIN-001-01 | FIN-001/002 | 1-2 | 2026-10-11 22:1x | harness output | FAC-1001 coverage 1.5947 OK; draw 201 | `wave2b/c-probe-output.json` |
| EV-RSK-001-01 | RSK-001–003 | 1-3 | 2026-10-11 22:2x | harness output | LIM-1003; self-approve 403 sod_violation; conflict 409 | `wave2c-probe-output.json` |
| EV-CA-001-01 | CA-001 | 1 | 2026-10-11 22:1x | harness output | 7 events; future record date blocked (409) | `wave2b-probe-output.json` |
| EV-CST-001-01 | CST-001 | 1-3 | 2026-10-11 22:2x | harness output | submit 201 CUST-CL-00418; duplicate 409; unserviced 403 | `wave2d-probe-output.json` |
| EV-ONB-001-01 | ONB-001–004 | 1-3 | 2026-10-11 22:0x | harness output | draft 201 + token; readiness checklist 200 | `wave2c-probe-output.json` |
| EV-CLI-001-01 | CLI-001 | 1-3 | 2026-10-11 22:2x | record | 3 clients, 6 portfolios | `wave2d-probe-output.json` |
| EV-AUD-001-01 | AUD-001 | 1-3 | 2026-10-11 22:2x | harness output | 101 rows; lifecycle chains + request IDs | audit-events queries |
| EV-LP-001-01 | LP-001 | 1-2 | 2026-10-11 20:16 | snapshot | Investor A live dashboard; A=12/B=1 docs | `evidence/EV-IAM-001-02-lp-portal.yml` |
| EV-DEP-006..008-02 | DEP-007/008 | 1-3 | 2026-10-11 21:2x | harness output | session survived restart; interrupted save atomic | browser + probe |

## Production Deployment & Audit (12 Oct 2026)

| EV-ID | Case | Step | Captured (UTC) | Type | Correlation / business IDs | Artefact |
|-------|------|------|----------------|------|----------------------------|----------|
| EV-DEPLOY-01 | deploy | — | 2026-10-12 00:22–00:48 | record | release uat-2026-10-b; smoke 50 pass / 0 fail / 6 skip | `Production-deployment.md` |
| EV-DEPLOY-02 | deploy | — | 2026-10-12 08:43–08:48 | record | release uat-2026-10-c (audit-deadlock fix); smoke 50/0 | `NFR-results.md` |
| EV-AUDIT-01 | portal audit | — | 2026-10-12 05:0x–07:0x | harness output | 5 portals, real CDP browser; 0 console errors | `prod-audit/*.json`, `Production-portal-audit.md` |
| EV-NFR-001-01 | NFR-001 | 1 | 2026-10-12 08:0x | harness output | 5 viewports × 2 portals, no overflow | `nfr/nfr-001-responsive.json` |
| EV-NFR-003-01 | NFR-003 | 2-3 | 2026-10-12 08:0x | harness output | server-side API p95 242/265ms; 15/15 prod concurrent logins | `nfr/nfr-003-*.json` |
| EV-NFR-004-01 | NFR-004 | 1-2 | 2026-10-12 07:2x | harness output | idempotent replay same record; abort → no duplicate | `nfr/nfr-004-005-009.json` |
| EV-NFR-005-01 | NFR-005 | 1-3 | 2026-10-12 07:2x | harness output | same-version two sessions; 409 invalid_state; 403 sod | `nfr/nfr-004-005-009.json` |
| EV-NFR-007-01 | NFR-007 | 1-3 | 2026-10-12 07:5x | record | 263 tables restored, 19.3s RTO, counts reconciled | `nfr/` + restore script |
| EV-NFR-009-01 | NFR-009 | 1-3 | 2026-10-12 07:2x | harness output | 0.01 boundary exact; UTC audit; month-end filters | `nfr/nfr-004-005-009.json` |
| EV-J01-01 | J01 | 1-7 | 2026-10-11 22:4x | harness output | ONB-104837 → KYC-1008 → CL-00420 + MND-1001 + CCA-2001 | `j01b-journey-output.json` |
| EV-J05-01 | J05 | 1-3 | 2026-10-12 09:4x | harness output | browser execution submit 201 (`UAT-BROWSER-MV50RASH`) | `j05-execution-submit.mjs` output |
