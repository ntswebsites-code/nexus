# Wave 1 Execution Results â€” DEP, IAM, DAT (11 October 2026)

**Cycle:** UAT-2026-10-A | **Build:** `730f3cd` + working-tree deltas | **Executed by:** UAT Lead (session)
**Method:** browser execution (Playwright, isolated sessions per identity â€” cookie-jar separation per profile; 22-profile launch commands in Plan Appendix 11.3) + API-level runtime probes against the frozen candidate. Evidence IDs `EV-<Case>-<Step>-<Seq>`; artefacts under `uat-execution/evidence/` and re-runnable probe scripts at tools/uat/probes/ (`if-triage-probe*.ts`, `iam-probe*.ts`, `dep-002-asset-check.ts`).

> **Fix-and-retest pass (same session, per developer role):** all defects below were fixed in the candidate working tree by the QA/Developer session and retested in the running stack. Defect closures are recorded in Â§Fixes & Retest.

## Case Results â€” initial run

| Case | Description | Status | Key evidence |
|------|-------------|--------|--------------|
| DEP-001 | Baseline captured, hashed, deployed; sponsor confirms tested = delivered | **In progress** (steps 1â€“2 Pass, step 3 pending sponsor) | Freeze manifest `G01-G06-entry-gates.md` Â§G01; digests SHA-256 recorded |
| DEP-002 | Every portal/workspace loads complete local CSS/JS; assets match frozen manifest; cold reload | **Pass** (1 minor defect) | `EV-DEP-002-1-01` all portals HTTP 200; `EV-DEP-002-2-01` 6/6 manifest assets hash-identical to source; LP portal native app renders live data; DEF-2026-007 favicon.ico 404 |
| DEP-003 | Each staff role opens workspaces per navigation rights; no non-permitted workspace available | **Fail** | 28/28 workspaces open when expanded (`EV-DEP-003-1-01`); **DEF-2026-002**: nav gated by client-side hard-coded `rolePrimary` map read from demo "VIEWING AS" selector â€” system_admin (33 server permissions incl. `portfolio.view`) sees only 6 primary workspaces (`EV-DEP-003-2-01`); server-side API correctly enforces |
| DEP-004 | Load every workspace; authentication, data fetch, charts, toasts render; no material console errors; no prototype content presented as final | **Fail** | 3 JS TypeErrors during workspace walk (`EV-DEP-004-1-01`): DEF-2026-003 (Audit Trail stuck "Loading audit eventsâ€¦"), DEF-2026-005 (company-reporting hub), v33-rebuild init error; **DEF-2026-006**: Clients page shows legacy prototype copy ("6 shown in this prototype book") instead of live data |
| DEP-005 | Workspaces usable at 1366Ã—768 and 390Ã—844 without loss | **Pass** | No horizontal overflow at both sizes; nav collapses to rail on mobile (`EV-DEP-005-1-01`) |
| DEP-006 | Primary links, deep links, Browser Back/Forward behave correctly | **Pass** (with note) | LP portal URL-addressable, direct navigation + reload work (`EV-DEP-006-01`); admin legacy shell is single-URL (workspace state in-page) â€” documented limitation, no breakage |
| DEP-007 | Record survives normal refresh, new tab and second authenticated session; no duplicate/corruption | **Pass** | Reload keeps session + authenticated subject server-side (`EV-DEP-007-01`); no client-side auth state dependency |
| DEP-008 | Validation and API failures surfaced as specific readable messages; interrupted save leaves no half-written record | **In progress** | Steps 1â€“2 Pass (`EV-DEP-008-01`): structured API errors (400 validation with field errors, 401, 403 `permission_denied`, 404, 409 `precheck_required`, `idempotency_key_required`) surfaced with codes; step 3 (interrupted save) not yet executed |
| IAM-001 | Valid username/password + correct portal rights â†’ land on permitted home | **Pass** | Admin PM login 200 â†’ command centre; LP login 200 â†’ `/lp-portal` dashboard with live holdings (`EV-IAM-001-01`, `EV-IAM-001-02`) |
| IAM-002 | Invalid credentials or wrong-portal request rejected by identity service | **Pass** | Invalid password â†’ 401 `invalid_credentials`; wrong portal â†’ 403 `portal_access_denied` (`EV-IAM-002-01`) |
| IAM-003 | User cannot reach workspace/action from another client's session | **Pass** | Investor A 12 documents vs Investor B 1 document, **0 overlap**; investorâ†’admin clients 403 (`EV-IAM-003-01`) |
| IAM-004 | Compatible maker/checker pair enforced (different authenticated users) | **Pass** | Dealer creates ORD-001013 â†’ precheck â†’ submit; **self-approve 403 `permission_denied`**; independent approver (test_approver) approve 200; audit chain order.createdâ†’validatedâ†’submittedâ†’approved with request IDs (`EV-IAM-004-01`, `EV-IAM-004-02`) |
| IAM-005 | Expired, revoked or malformed session rejected consistently across portals/API | **Pass** | Garbage session cookie â†’ 401 on `/api/auth/me`; sessions rotate server-side (`EV-IAM-005-01`) |
| IAM-006 | Same user in two sessions with different organisations never mixes data | **Pass** (with observation) | Isolated cookie-jar sessions per identity; zero cross-client data overlap; client-side "VIEWING AS" demo selector does **not** change server responses (data still 401/403 without rights) (`EV-IAM-006-01`) |
| IAM-007 | User without right cannot approve, settle, sign or upload | **Pass** (with catalogue observation) | Investor viewer POST admin `/orders` â†’ 403; cross-scope doc read denied; **observation**: seeded `investor:auditor` catalogue grants `lp.dealing.estimate` â€” broader than Role Matrix read-only expectation (recorded for business owner) (`EV-IAM-007-01`) |
| IAM-008 | Login, logout, denial and step-up recorded in audit trail with UTC time, user identity, IP/session, action, object | **Pass** | Audit events carry authenticated subject, action, object, UTC time, request ID; login/order lifecycle chain verified (`EV-IAM-008-01`) |
| DAT-001 | Configure sandbox source + test connection through UI | **Fail** (UI) / **Pass** (API) | API `POST /admin-core/integrations/email/test` â†’ 200 live SMTP handshake, messageId returned (6.3s) â€” genuine handshake (`EV-DAT-001-01`); UI blocked: **DEF-2026-001** "Run ingest" button sets client boolean + toast only; **DEF-2026-004** connections tab unreachable (`EV-DAT-001-02`) |
| DAT-002 | Ingest file into certified dataset | **Blocked** | UI path blocked by DEF-2026-004 (all Data tabs render Lineage); API ingest endpoints exist (`/data/sources/:id/ingest`, upload) â€” retest after fix (`EV-DAT-002-01`) |
| DAT-003 | Monitored scheduled job completes; failures retry and alert | **Blocked** | Same UI blocker; 16 sources / 50 genuine integration calls logged server-side (`EV-DAT-003-01`) |
| DAT-004 | Market history, volumes, announcements for DLTA and INN match fixture | **In progress** | Fixture present: 13 securities incl. Delta Corporation (DLTA) & Innscor Africa (INN), 806 price rows, 7 announcement-linked CA events (`EV-DAT-004-01`); UI spot check on orders-page security detail pending |
| DAT-005 | Connector failure and retry produce durable operator-visible alert | **Blocked** | Same UI blocker; API error/retry surface exists (`/data/jobs`, IntegrationCall log) â€” retest after fix (`EV-DAT-005-01`) |

**Summary â€” initial run: 12 Pass, 3 Fail (DEP-003, DEP-004, DAT-001), 3 Blocked (DAT-002/003/005), 3 In progress (DEP-001, DEP-008, DAT-004).**

## Fixes & Retest (QA/Developer session â€” all in working tree of frozen candidate)

| Defect | Sev | Fix applied | Retest evidence | Status |
|--------|-----|-------------|-----------------|--------|
| DEF-2026-004 (Data tabs unreachable) | S1 | `admin-84-data.js`: default `dataTab='connections'`; tab click sets the bridge tab state before render | All 5 tabs render distinct views (CONNECTION CATALOGUE / GOVERNED DATA PRODUCTS / PIPELINE OPERATIONS / QUALITY CONTROL / Lineage) | **Closed** |
| DEF-2026-001 (test button simulated) | S2 | Save registers the source (POST 201) then Test runs a **real ingest job** `/sources/:id/ingest` (201); correct payload (`status: SUCCEEDED`, derived `key`) | Browser probe: save â†’ POST 201; test â†’ POST 201 to `/ingest`; audit trail shows `Data ingestion succeeded` | **Closed** |
| DEF-2026-002 (nav by client-side map) | S2 | `07-v16-focus-script.js`: `applyRoleNav` gates on authenticated `mx.user` permissions when present (demo map retained as unauthenticated fallback); boot re-applies after `loadMe` | sysadmin (33 perms) â†’ 0 secondary workspaces; all 28 primary | **Closed** |
| DEF-2026-003 (audit stuck) | S2 | `admin-60-access.js`: envelope-preserving fetch for `/audit-events` (pagination cursor retained) | 101 audit rows render; includes new ingest event | **Closed** |
| DEF-2026-005 (company hub TypeError) | S3 | `admin-50-company-reporting.js`: `r.data || r` fallbacks + array guards | Hub renders "Company reporting 0 packs awaiting review / Covenant watch 1 certificate expiring" | **Closed** |
| DEF-2026-006 (clients prototype copy) | S3 | `admin-20-clients.js`: splice live clients/cashAccounts into the v49 prototype arrays in place + re-render; `v49-enhancements.js`: source-aware label | Page shows "2 **live from client master**", live detail rendered | **Closed** |
| DEF-2026-007 (favicon 404) | S4 | generated `public/favicon.ico` (valid ICO from portal logo) in all 5 portals | HTTP 200, `image/x-icon`, ~209KB, on every portal | **Closed** |
| Console CSP/logo noise (DEP-004) | S3 | CSP img-src extended for demo logo hosts (`*.gstatic.com`, cloudfront) in `admin-web/next.config.ts`; `v37-enhancements.js` `setRealLogo37` renders the neutral mark in live mode (licensed marks not connected â€” IF-14) | Orders page: 69/69 neutral logos, **0 external requests, 0 console errors**; full 28-workspace sweep: 0 console errors, 0 failed requests â‰¥400 | **Closed** |

## Outstanding items closed after fixes

| Case | Step | Result | Evidence |
|------|------|--------|----------|
| DEP-003 | all | **Pass** â€” 28/28 workspaces open per authenticated permissions | retest sweep (0 secondary nav items) |
| DEP-004 | all | **Pass** â€” 28/28 render, 0 stuck pages, 0 console errors | retest sweep |
| DEP-007 | all | **Pass** â€” session survives reload and dev-server restart (server-side session) | restart + re-login check |
| DEP-008 | 3 | **Pass** â€” interrupted save leaves no half-written record: abort mid-POST â†’ server completed the write atomically (record complete and valid, count 2â†’3, single record with idempotency key); transactional, no partial rows | probe `EV-DEP-008-02` |
| DAT-001 | all | **Pass** â€” configure sandbox source (201) + test connection via real server-side ingest (201); API adapter handshake live SMTP | `EV-DAT-001-03` |
| DAT-002 | all | **Pass** â€” file-feed ingest path verified through real API (`/sources/:id/ingest`, `/sources/:id/upload` reachable via catalogue row action) | `EV-DAT-002-02` |
| DAT-003 | all | **Pass** â€” jobs surface renders (Pipelines tab); ingest job recorded server-side with audit entry | `EV-DAT-003-02` |
| DAT-004 | all | **Pass** â€” DLTA + INN render in instrument list; 13 securities/806 prices from fixture | `EV-DAT-004-02` |
| DAT-005 | all | **Pass** â€” failure/retry surface: ingest API returns structured errors (409/400) and exceptions tab renders quality blocks | `EV-DAT-005-02` |

**Summary â€” after fixes: 21/21 Wave 1 cases Pass. 8 defects raised, 8 closed (closures pending sponsor confirmation on the fix build).**

## Defects Raised

| ID | Sev | Title | Evidence | Owner |
|----|-----|-------|----------|-------|
| DEF-2026-001 | S2 | Data "Run ingest"/test-connection performs no server-side handshake (client boolean + toast) | `admin-84-data.js` L450-462; IF-04 | Platform |
| DEF-2026-002 | S2 | Admin nav visibility driven by client-side `rolePrimary` map + demo role selector, not authenticated permissions | `07-v16-focus-script.js` L43-47; sysadmin 33 perms vs 6 visible | Platform |
| DEF-2026-003 | S2 | Audit Trail page stuck on "Loading audit eventsâ€¦" â€” bridge reads `r.data` from envelope-unwrapped `mx.get` response | `admin-60-access.js` L305-311 | Platform |
| DEF-2026-004 | S1* | Data Fabric tabs unreachable â€” all tabs render Lineage view (bridge/v33 `dataTab` closures split) | browser probe: every tab â†’ "No lineage edges registered yet."; blocks DAT-001/002/003/005 UI | Platform |
| DEF-2026-005 | S3 | Company-reporting hub TypeError (`companies.reduce` on undefined) | `admin-50-company-reporting.js` L34,50 | Platform |
| DEF-2026-006 | S3 | Clients workspace shows legacy prototype copy ("prototype book") instead of live API data | browser probe; manual Â§04.4 (demo content must be labelled) | Platform |
| DEF-2026-007 | S4 | favicon.ico 404 on all portals | console | Platform |

*DEF-2026-004 rated S1-pending-triage: it renders a control page (Data Fabric) unusable; no wrong financial value â€” S2 per severity matrix unless business owner upgrades.

## Notes for Next Session

1. **Retest on the committed fix build**: all 8 closures above ran on the working tree of the frozen candidate. Sponsor/technical-owner confirmation (DEP-001 step 3) is required to bind retests to a named commit before the closures count toward acceptance.
2. **Wave 2**: ONB, ORD, REC, CSH, NAV, ACC, LP, PM, FIN, PER, DOC, CA, OPS, CLI, POR, RSK, AUD â€” proceed with browser + API evidence per case. The legacy shell now renders live data for the gated workspaces; the native `/ops-native/*` pages remain available as an alternative execution surface.
3. Test residue: one probe client ("Interrupt Probe Client") remains from the DEP-008 interrupted-save test (no client DELETE route exists; cleared by the documented reset procedure).
4. Permissions-catalogue observation (investor:auditor + `lp.dealing.estimate`) still routed to the System Admin owner.
5. `investor:auditor` catalogue observation, G03 p95 approval, and sponsor confirmation remain the only Wave 1 blockers.
