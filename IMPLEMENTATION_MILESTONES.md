# Implementation milestones — hardcoded UI audit

## Inputs

- **Project:** Matanho Nexus (`matanho-nexus-v56-deployment`)
- **Original plan:** `docs/srd/REGISTER.md`, `docs/srd/5A-admin.md`, `docs/srd/5B-lp-portal.md`, `docs/srd/5C-onboarding-portal.md`, `docs/srd/5D-investee-portal.md`, `docs/srd/5E-custodian-portal.md`, `docs/BUILD-PLAN.md`, `docs/ORIGINAL-UI-WIRING-PLAN.md`, `docs/CLEANUP-AGENT-PROMPT.md`, `docs/ADMIN-REAL-PAGES.md`, `docs/GAP-ANALYSIS.md`
- **Portals in scope:** `portals/admin-web`, `portals/investor-web`, `portals/company-web`, `portals/onboarding-web`, `portals/custodian-web`

**Audit method:** Code read + existing gap docs cross-checked (2026-10-05). Branch state: `feat/original-ui-wiring` with post-wiring doc pass and deferred-gap bridge work (`admin-61-access-depth.js` platform settings / RBAC propose-change / access-review certify). No browser verification performed in this audit.

**Status legend**

| Status | Meaning |
|---|---|
| **Functional** | End-to-end with real data and persistence |
| **Partial** | Some wiring; material gaps remain |
| **Hardcoded** | Static/mock UI or no-op handlers |
| **Missing** | In plan but not built |
| **Unplanned** | Built but not in plan (report only) |

---

## 1. Requirements list (extracted from plan)

Requirements use stable IDs traceable to SRD sections and `docs/srd/REGISTER.md` FR/BR IDs.

### 1.1 Admin portal (`portals/admin-web`, SRD 5.A)

| Req ID | Requirement | Plan reference |
|---|---|---|
| ADMIN-SHELL-01 | Sidebar: 28 pages, role focus sets, permission union, no ops-native link | 5.A.0.1, CLEANUP §1b–1c, FR-UI-001 |
| ADMIN-SHELL-02 | Topbar: search, notifications, role focus, profile/MFA/sign-out | 5.A.0.2, FR-UI-002 |
| ADMIN-SHELL-03 | Command palette (⌘K) with live navigation | 5.A.0.3 |
| ADMIN-SHELL-04 | Shared drawer/modals, record detail `GET /shell/record/:kind/:id` | 5.A.0.4–0.5, 5.A.29 |
| ADMIN-SHELL-05 | Sidebar health line and live badge counts | FR-UI-001, FR-UI-003 |
| ADMIN-5A01 | Command Centre: KPIs, charts, decision pulse, investment pack | 5.A.1, FR-DASH-* |
| ADMIN-5A02 | Portfolios: list, create, drawer, mandate, evidence | 5.A.2, FR-PORT-* |
| ADMIN-5A03 | Private markets: funds, marks, pipeline, look-through | 5.A.3 |
| ADMIN-5A04 | Portfolio lab: models, what-if, rebalance → orders | 5.A.4 |
| ADMIN-5A05 | Orders: full lifecycle, broker instruction, post-trade | 5.A.5, FR-OMS-* |
| ADMIN-5A06 | Research: cases, valuation, IC workflow | 5.A.6, FR-RES-* |
| ADMIN-5A07 | Risk: limits MC, scenarios, breaches, cases | 5.A.7, FR-RSK-* |
| ADMIN-5A08 | Performance: attribution, periods lock/correct | 5.A.8, FR-PERF-* |
| ADMIN-5A09 | Clients: 360, cash accounts, change requests, portal users | 5.A.9, FR-CLI-008–022 |
| ADMIN-5A10 | Investor services: SLA, request queue | 5.A.10, FR-INV-* |
| ADMIN-5A11 | Onboarding/KYC: queue, checks, risk approve | 5.A.11, FR-ONB-* (staff) |
| ADMIN-5A12 | Reports: catalogue, runs, schedules, distribute | 5.A.12, FR-RPT-* |
| ADMIN-5A13 | Vault: holds, retention, change approvals, upload | 5.A.13, FR-DOC-* |
| ADMIN-5A14 | IBOR: refresh job, reconcile, positions | 5.A.14, FR-IBOR-* |
| ADMIN-5A15 | Cash: journals MC, reservations, statements, close | 5.A.15, FR-CASH-009–019 |
| ADMIN-5A16 | Operations: tasks, calendar, close gates, settlement fails | 5.A.16, FR-OPS-* |
| ADMIN-5A17 | Reconciliations: breaks, signoffs, tolerances, feeds | 5.A.17, FR-REC-* |
| ADMIN-5A18 | Valuation/NAV: release step-up, inputs, external NAV | 5.A.18, FR-VAL-* |
| ADMIN-5A19 | Accounting: CoA, journals, trial balance, periods | 5.A.19 |
| ADMIN-5A20 | Financing: facility lifecycle, margin calls | 5.A.20 |
| ADMIN-5A21 | Corporate actions: elections, process, entitlements | 5.A.21, FR-CA-* |
| ADMIN-5A22 | Regulatory: filings, evidence, submit | 5.A.22 |
| ADMIN-5A23 | Data fabric: sources, rules, exceptions, schedules | 5.A.23, FR-DATA-* |
| ADMIN-5A24 | Model governance: models, reviews, usage | 5.A.24, FR-MOD-* |
| ADMIN-5A25 | Copilot: ask, suggestions, integration banner | 5.A.25 |
| ADMIN-5A26 | RBAC: matrix, change requests, access reviews, SoD | 5.A.26, FR-RBAC-* |
| ADMIN-5A27 | Settings: platform flags/security/retention + workspace prefs | 5.A.27, FR-SET-* |
| ADMIN-5A28 | Audit: facets, drill-down, export, chain verify | 5.A.28, FR-AUD-003–006 |
| ADMIN-XFR-01 | Order submit creates cash reservation (FR-CASH-015) | REGISTER FR-CASH-015, ADMIN-REAL-PAGES L983 |
| ADMIN-XFR-02 | Platform settings consumed by modules (retention, notify, flags) | GAP-011, admin-core engine |
| ADMIN-XFR-03 | Integrations layer with fake/live adapters | BUILD-PLAN WP-8, GAP-A01–A13 |

### 1.2 LP portal (`portals/investor-web`, SRD 5.B)

| Req ID | Requirement | Plan reference |
|---|---|---|
| LP-001 | Session, fund scope, as-of, nav shell | 5.B.0, FR-LP-001–006 |
| LP-002 | Dashboard KPIs, actions, activity | 5.B.1, FR-LP-007–015 |
| LP-003 | Performance, benchmarks, report jobs | 5.B.2, FR-LP-016–027 |
| LP-004 | Account activity ledger + export | 5.B.3, FR-LP-028–037 |
| LP-005 | Capital calls & distributions (ack, payment proof) | 5.B.4, FR-LP-038–049 |
| LP-006 | Subscriptions & redemptions | 5.B.5 |
| LP-007 | Document centre | 5.B.6 |
| LP-008 | Requests & messages | 5.B.7 |
| LP-009 | Notices + acknowledge | 5.B.8 |
| LP-010 | Organisation, colleagues, bank instructions | 5.B.9 |
| LP-011 | Settings (notifications, display) | 5.B.10 |
| LP-012 | Realtime updates (SSE/poll contract) | BUILD-PLAN N12, GAP-017 |
| LP-013 | E-sign inbox (always live, not domain-flagged) | `/api/v1/esign` |

### 1.3 Investee portal (`portals/company-web`, SRD 5.D)

| Req ID | Requirement | Plan reference |
|---|---|---|
| CO-001 | Company-scoped shell, demo ribbon when fixtures | 5.D.0, FR-CMP-008–011 |
| CO-002 | Overview dashboard | 5.D.1, FR-CMP-012 |
| CO-003 | KPI centre | 5.D.2, FR-CMP-013–014 |
| CO-004 | Reporting centre (structured statements) | 5.D.3, FR-CMP-015–019 |
| CO-005 | Forecast model (persisted, lock months) | 5.D.4, FR-CMP-020–022 |
| CO-006 | Term sheets | 5.D.5, FR-CMP-023–025 |
| CO-007 | Cap table | 5.D.6, FR-CMP-026–028 |
| CO-008 | Governance | 5.D.7, FR-CMP-029–030 |
| CO-009 | Signatures | 5.D.8, FR-CMP-031–033 |
| CO-010 | Capital & procurement requests | 5.D.9, FR-CMP-034–037 |
| CO-011 | Document vault / data room | 5.D.10, FR-CMP-038–040 |
| CO-012 | Messages | 5.D.11, FR-CMP-041–042 |
| CO-013 | Team & access | 5.D.12, FR-CMP-043–044 |
| CO-014 | Settings | 5.D.13 |
| CO-015 | Workspace tools (cap-table tx, board, share links) | GAP-016, `/investee-portal/workspace/*` |
| CO-016 | Native React pages (forecasts, governance, requests, data-room) | D-14, `PortalSwitch.tsx` |

### 1.4 Onboarding portal (`portals/onboarding-web`, SRD 5.C)

| Req ID | Requirement | Plan reference |
|---|---|---|
| ONB-001 | Public 6-step application wizard | 5.C.1–6, FR-ONB-027–038 |
| ONB-002 | Draft create/save/resume (`X-Draft-Token`) | 5.C.0, FR-ONB-039–041 |
| ONB-003 | Evidence upload per slot | 5.C.5 |
| ONB-004 | Submit + server reference | 5.C.6 |
| ONB-005 | Post-submit status tracker + reply | 5.C.7 |
| ONB-006 | AI readiness / client triage side panel | 5.C.0 (SRD rows 11–14) |

### 1.5 Custodian portal (`portals/custodian-web`, SRD 5.E)

| Req ID | Requirement | Plan reference |
|---|---|---|
| CUS-001 | Auth, counterparty scope, MFA | 5.E.0, FR-AUTH-018 |
| CUS-002 | Dashboard | 5.E.3 |
| CUS-003 | Trade executions CRUD | 5.E.1 |
| CUS-004 | Bulk execution upload | GAP-018 (beyond minimal SRD) |
| CUS-005 | Day-end packages (maker/checker) | 5.E.2 |
| CUS-006 | Statements / holdings feed | 5.E, GAP-A05 |
| CUS-007 | Submission history | 5.E.3 |
| CUS-008 | Users & roles | FR-AUTH-018 |
| CUS-009 | Notifications | shared API |
| CUS-010 | Security (MFA, sessions, password) | FR-LP-102 pattern |
| CUS-011 | Recon hand-off to admin | 5.E.4, FR-REC-011/015/016 |

### 1.6 Cross-portal platform

| Req ID | Requirement | Plan reference |
|---|---|---|
| PLAT-001 | Go-live flags (`LP_LIVE_DOMAINS`, `INVESTEE_LIVE_ACTIONS`, etc.) | GAP-001, `config/env.ts` |
| PLAT-002 | Notification delivery honours preferences | GAP-008 |
| PLAT-003 | Worker + outbox delivery | GAP-023 |
| PLAT-004 | CI: typecheck, build, flow scripts | GAP-003 |
| PLAT-005 | Security: CSP, rate limits, request logging | GAP-014, NFR-SEC-* |

---

## 2. Gap matrix per portal

### 2.1 Admin-web — legacy prototype at `/`

**Entry:** `portals/admin-web/next.config.ts` serves V56 prototype; bridges in `src/legacy/bridge/admin-*.js`; reference at `/ops-native` (`src/ops/`, `src/app/(ops-native)/`).

| Req ID | Page / Feature | Plan reference | Status | Evidence | What is missing |
|---|---|---|---|---|---|
| ADMIN-SHELL-01 | Sidebar 28 pages + RBAC | 5.A.0.1 | **Partial** | `admin-60-access.js`, `03-sidebar.html`, `w0-entry.test.ts` | Health/sync static; most badge counts hardcoded in markup |
| ADMIN-SHELL-02 | Topbar search/notifications/role | 5.A.0.2 | **Partial** | `admin-70-shell.js` L77–160 → `/shell/search`, `/notifications`, `PUT /shell/me/role-focus` | Profile name hardcoded `05-header-topbar.html` L28 |
| ADMIN-SHELL-03 | Command palette | 5.A.0.3 | **Hardcoded** | `public/legacy/js/08-inline.js`; no bridge | Live palette + navigation |
| ADMIN-SHELL-04 | Record drawer | 5.A.29 | **Missing** | Drawers local only; no `GET /shell/record` | Wire record links from search/notifications |
| ADMIN-SHELL-05 | Live badges / health | FR-UI-001 | **Hardcoded** | Sidebar `<em>` counts; only 3 pages updated (`admin-71`, `admin-72`) | API-driven counts all pages |
| ADMIN-5A01 | Command | 5.A.1 | **Partial** | `admin-71-command.js` → `/dashboard/today`, `/dashboard/panels` | Chart tabs use demo engine (`ADMIN-REAL-PAGES` L928) |
| ADMIN-5A02 | Portfolios | 5.A.2 | **Partial** | `admin-80-portfolios.js` → `/portfolios*` | YTD return, manager, evidence upload |
| ADMIN-5A03 | Private markets | 5.A.3 | **Partial** | `admin-83-private-markets.js` | Fund/commitment CRUD, mark reject, pipeline PATCH |
| ADMIN-5A04 | Portfolio lab | 5.A.4 | **Partial** | `admin-82-portfolio-lab.js` | Model CRUD; v33 tabs demo |
| ADMIN-5A05 | Orders | 5.A.5 | **Partial** | `admin-90-orders.js` → `/orders*` | Reject/cancel/settle, import, FIX panels |
| ADMIN-5A06 | Research | 5.A.6 | **Partial** | `admin-91-research.js` | IC voting/ratify; filing import toast-only |
| ADMIN-5A07 | Risk | 5.A.7 | **Partial** | `admin-92-risk.js` | Limit MC; case intake local-only (`02-v7-*.js`) |
| ADMIN-5A08 | Performance | 5.A.8 | **Partial** | `admin-93-performance.js` | Period lock/recompute/correct step-up |
| ADMIN-5A09 | Clients | 5.A.9 | **Partial** | `admin-20-clients.js` → `/client-ops/clients/:id/360` | Investor portal users CRUD |
| ADMIN-5A10 | Investor services | 5.A.10 | **Partial** | `admin-30-investor-services.js` | v34 KPI tiles partly demo |
| ADMIN-5A11 | Onboarding | 5.A.11 | **Functional** | `admin-10-kyc.js` | Risk-factor PUT editor view-only |
| ADMIN-5A12 | Reports | 5.A.12 | **Partial** | `admin-102-reports.js` | Schedules create/edit, distribute |
| ADMIN-5A13 | Vault | 5.A.13 | **Partial** | `admin-40-documents.js` | PM evidence file upload |
| ADMIN-5A14 | IBOR | 5.A.14 | **Partial** | `admin-81-ibor.js` | Events/lots tabs; column hide |
| ADMIN-5A15 | Cash | 5.A.15 | **Partial** | `admin-94-cash.js` → `/cash/*` | Journal submit/return; reservation create; `new-expectation` toast |
| ADMIN-5A16 | Operations | 5.A.16 | **Partial** | `admin-72-operations.js` | Close gates; CSV export; v36 chart KPIs static |
| ADMIN-5A17 | Reconciliations | 5.A.17 | **Partial** | `admin-95-recon.js` | Assign/investigate/evidence/escalate/tolerances |
| ADMIN-5A18 | Valuation | 5.A.18 | **Partial** | `admin-98-nav.js` | External NAV, inputs edit, full pack |
| ADMIN-5A19 | Accounting | 5.A.19 | **Partial** | `admin-100-accounting.js` | CoA, trial balance, journal create |
| ADMIN-5A20 | Financing | 5.A.20 | **Partial** | `admin-96-financing.js` L121+ | Lifecycle + margin → toast/ops-native |
| ADMIN-5A21 | Corporate actions | 5.A.21 | **Partial** | `admin-97-corporate-actions.js` | Elections, process step-up; new-event toast |
| ADMIN-5A22 | Regulatory | 5.A.22 | **Partial** | `admin-101-regulatory.js` | Evidence upload; new filing toast |
| ADMIN-5A23 | Data | 5.A.23 | **Partial** | `admin-84-data.js` | Schedules, staged upload, exception resolve |
| ADMIN-5A24 | Model governance | 5.A.24 | **Partial** | `admin-85-model-governance.js` | Reviews/bindings tabs |
| ADMIN-5A25 | Copilot | 5.A.25 | **Partial** | `admin-86-copilot.js` | FAB navigate-only; multi-table unverified |
| ADMIN-5A26 | RBAC | 5.A.26 | **Partial** | `admin-61-access-depth.js` (propose-change, review certify closed D-41) | Withdraw/disable staff; matrix vs batch UX parity |
| ADMIN-5A27 | Settings | 5.A.27 | **Partial** | `admin-61` platform drawer + `platformSettingsV8` panels | Workspace prefs still localStorage when live |
| ADMIN-5A28 | Audit | 5.A.28 | **Functional** | `admin-61-access-depth.js` facets/drill-down | Browser verify large chains |
| ADMIN-XFR-01 | Orders ↔ cash reservation | FR-CASH-015 | **Partial** | Backend gap noted `ADMIN-REAL-PAGES` L983; `admin-90-orders.js` no reservation loop | Backend + order bridge |
| — | `/ops-native` reference | — | **Functional** | `src/ops/api.ts`, 50+ routes | Unplanned as product UI; not in legacy nav |

**Admin summary:** 28 pages — **2 Functional**, **26 Partial**, **0 Missing** at page level. Shell chrome: **5 Hardcoded/Missing** surfaces. Largest gap clusters: cash/orders wiring (FR-CASH-015), recon/operations depth, secondary modals/toasts deferring to ops-native.

---

### 2.2 Investor-web (LP portal)

| Req ID | Page / Feature | Plan reference | Status | Evidence | What is missing |
|---|---|---|---|---|---|
| LP-001–011 | All LP domain pages | 5.B.1–10 | **Partial** (flag-gated) | `lib/api/lp-portal-api.ts` L1445+ Proxy; `mock-store.ts` when flags off | Default env: all demo (`LP_LIVE_DOMAINS=''` `config/env.ts:40`) |
| LP-012 | Realtime | 5.B / BUILD N12 | **Partial** | Polling `/realtime`; no SSE push in UI | Push contract, mock cleanup |
| LP-013 | E-sign | esign module | **Functional** | `app/lp-portal/signatures/page.tsx` → `/api/v1/esign` | — |
| PLAT-002 | Notification prefs honoured | GAP-008 | **Partial** | Settings save API exists; worker ignores LP prefs `worker.ts` | Worker reads prefs |

**LP summary:** UI **wired** to live API when flags on. At default dev/UAT flags: **10/10 LP pages Hardcoded (mock)**. With production flags (`deploy/.env.production.example`): **Functional** pending GAP-002 backend verification.

---

### 2.3 Company-web (investee portal)

| Req ID | Page / Feature | Plan reference | Status | Evidence | What is missing |
|---|---|---|---|---|---|
| CO-001 | V8 runtime shell | 5.D.0 | **Partial** | `InvesteePortal.tsx`, `lib/investee/api.ts` flag gating | Shell search/notifications fixture when partial live |
| CO-002–014 | 13 V8 pages | 5.D.1–13 | **Partial** (flag-gated) | `LIVE_PAGE_LOADERS` in `host.ts`; fixtures when action off | Default flags off → demo |
| CO-015 | Workspace tools | GAP-016 | **Partial** | `WorkspaceTools.tsx` → `/investee-portal/workspace/*` | Backend may use `Setting` JSON not full tables |
| CO-016 | Native React pages | D-14 | **Missing** (unwired) | `PortalSwitch.tsx`, `native/*Screen.tsx` exist; `layout.tsx` uses `InvesteePortal` only; page files `return null` | Wire layout + routes |
| CO-007–008 | Cap table / governance depth | FR-CMP-026–030 | **Partial** | Live routes exist; GAP-016 backend | Real tables, MC, certificates |

**Company summary:** **14 Partial** (flag-gated), **4 Missing** (native routes unwired), **0 Functional** at default flags. Backend workspace depth (GAP-016) limits true Functional status even when live.

---

### 2.4 Onboarding-web

| Req ID | Page / Feature | Plan reference | Status | Evidence | What is missing |
|---|---|---|---|---|---|
| ONB-001–005 | Wizard, status, resume | 5.C | **Functional** | `Wizard.tsx`, `Tracker.tsx`, `lib/api.ts` → `/api/v1/public/*` | — |
| ONB-006 | AI readiness panel | 5.C.0 | **Missing** | No `readiness`/`triage` in `portals/onboarding-web/src` | Server-driven panel + API |

**Onboarding summary:** **5 Functional**, **1 Missing**. No mock layer; always hits API.

---

### 2.5 Custodian-web

| Req ID | Page / Feature | Plan reference | Status | Evidence | What is missing |
|---|---|---|---|---|---|
| CUS-001–010 | All portal pages | 5.E | **Functional** (UI) | `lib/api.ts` → `/api/v1/custodian/*`; no mock | Backend feed/parser gaps (GAP-A05) |
| CUS-006 | Statement ingest | 5.E | **Partial** | UI upload exists; MT535/536 parsing adapter missing | `BankStatementAdapter` |
| CUS-011 | Admin recon consume | 5.E.4 | **Partial** | Staff `/ops` recon exists; feed automation missing | CustodianFeedAdapter |

**Custodian summary:** **11 Functional** at UI layer, **2 Partial** at integration depth. GAP-ANALYSIS GAP-018 partially stale (bulk/amend UI exists in `executions/page.tsx`).

---

## 3. Milestones (execution order)

### M1: Verify foundation and enable live data

**Portal(s):** All  
**Requirement IDs covered:** PLAT-001, PLAT-003, PLAT-004, GAP-002 (verification)  
**Depends on:** —  
**Can run in parallel with:** —

**Goal:** Fresh DB with all migrations seeded; flow scripts green; LP/investee flags default to live in UAT example; worker delivers notifications.

**Current state:** 18 migrations; `scripts/test-*.ts` not all run on host (`GAP-ANALYSIS` L84); flags empty in `backend/api/src/config/env.ts`; worker not running locally (`GAP-023`).

**Work to do:**
- Backend: Run/fix all `backend/api/scripts/test-*.ts` on disposable MySQL; fix failures in owning modules only
- Frontend: Confirm `DemoRibbon` shows when flags off (`investor-web`, `company-web`)
- Validation: Extend `tools/uat/smoke.ts` read-only GET sweep

**How it should be done:** Follow `docs/GAP-ANALYSIS.md` WP-1; CI pattern in proposed `.github/workflows/`; seed via `prisma/seed-uat.ts`.

**Acceptance criteria:**
- All module flow scripts pass on throwaway DB
- `deploy/.env.production.example` sets `LP_LIVE_DOMAINS=all`, `INVESTEE_LIVE_ACTIONS=true`
- Worker process runs and delivers at least one test notification

**Verification steps:**
```bash
cd backend/api && npx prisma migrate deploy && npx tsx prisma/seed-uat.ts
E2E_CONFIRM=throwaway-db npx tsx scripts/test-*.ts  # each module script
npm run build -w @matanho/investor-web -w @matanho/company-web
```

**Not included:** Deploy, push, browser QA.

---

### M2: Admin shell — live chrome

**Portal(s):** admin-web (legacy `/`)  
**Requirement IDs covered:** ADMIN-SHELL-02–05, FR-UI-001–003  
**Depends on:** M1  
**Can run in parallel with:** M3, M4, M5

**Goal:** Topbar profile, sidebar badges, health line, and record drawer use live API; command palette navigates real pages.

**Current state:** `admin-70-shell.js` partial; `05-header-topbar.html` hardcoded name; `08-inline.js` palette prototype-only; no `/shell/record` wiring.

**Work to do:**
- Backend: Confirm `/shell/search`, `/shell/record/:kind/:id`, `/shell/me` payloads sufficient
- Frontend: Extend `admin-70-shell.js` / new bridge hook: hydrate profile from `mx.loadMe()`; wire palette to `GET /shell/search` + `navigate()`; badge counts from dashboard/workload APIs; optional live health from ops-health if permitted
- Validation: Extend `w1-command-ops.test.ts`, `w0-entry.test.ts`

**How it should be done:** Pattern from `admin-70-shell.js` intercept/wrap; `mx.modal` for palette; do not edit markup (`CLEANUP-AGENT-PROMPT` rule 1 exception: none — use bridge only).

**Acceptance criteria:**
- Signed-in user sees real name/role in topbar (not "Tendai Moyo")
- ⌘K opens search results that navigate to hash pages
- Clicking a notification with record link opens drawer via `/shell/record`

**Verification steps:** jsdom tests + `node tools/legacy-bridge.mjs --check`; manual checklist after M1 deploy (owner).

**Not included:** ops-native Shell.tsx changes.

---

### M3: Orders and cash reservation loop

**Portal(s):** admin-web legacy  
**Requirement IDs covered:** ADMIN-5A05, ADMIN-5A15, ADMIN-XFR-01, FR-CASH-015  
**Depends on:** M1  
**Can run in parallel with:** M2, M4, M5

**Goal:** Buy order submit creates cash reservation; cash page and order ticket show matching available balance; cancel releases reservation.

**Current state:** `admin-90-orders.js` wired for submit/approve/route; `admin-94-cash.js` partial; backend FR-CASH-015 not wired (`GAP-ANALYSIS` GAP-004).

**Work to do:**
- Backend: Wire reservation in `modules/orders/*` + `modules/cash/cash.reservations*` per FR-CASH-015
- Frontend: Order ticket reads reservation status; cash bridge shows reserved tile delta
- Validation: `scripts/test-orders.ts`, `test-cash.ts`; extend `w3-orders.test.ts`, `w5-cash-recon-financing.test.ts`

**How it should be done:** Reference `portals/admin-web/src/ops/orders*.tsx`, `ops/cash.tsx` for request shapes.

**Acceptance criteria:** After submit, cash RESERVED increases by order notional; after cancel, reservation released; 403 SoD on self-approve unchanged.

**Verification steps:** Run flow scripts; jsdom mock API round-trip test for reservation POST.

**Not included:** FIX routing (GAP-A13).

---

### M4: Admin page depth — cash, recon, operations

**Portal(s):** admin-web legacy  
**Requirement IDs covered:** ADMIN-5A15–17, FR-CASH-012–019, FR-REC-*, FR-OPS-*  
**Depends on:** M1, M3 (cash)  
**Can run in parallel with:** M2, M5, M6

**Goal:** Close gaps listed in `ADMIN-REAL-PAGES.md` for cash journals submit/return, expectations create, recon assign/investigate/escalate, operations close gates and CSV export.

**Current state:** Bridges defer via toast to ops-native for several controls (`admin-96`, `admin-95` partial coverage).

**Work to do:**
- Backend: Any missing recon/ops endpoints per SRD 5.A.16–17
- Frontend: Replace toast stubs in `admin-94-cash.js`, `admin-95-recon.js`, `admin-72-operations.js` with `mx.intercept` + real calls; use `reasonDrawer` pattern from `admin-61-access-depth.js`
- Validation: Per-file jsdom tests; `test-recon.ts`, `test-wiring.ts`

**How it should be done:** Copy API usage from `src/ops/cash.tsx`, `ops/recon/*`, `ops/operations.tsx`.

**Acceptance criteria:** Each control in ADMIN-REAL-PAGES "Not available yet" row for cash/recon/ops performs real API write and refreshes table.

**Verification steps:** jsdom write round-trip per page; module flow scripts pass.

**Not included:** New recon families (POSITIONS_VS_CUSTODY) — see M7.

---

### M5: Admin page depth — orders, research, risk, performance

**Portal(s):** admin-web legacy  
**Requirement IDs covered:** ADMIN-5A05–08  
**Depends on:** M1, M3  
**Can run in parallel with:** M2, M4, M6

**Goal:** Order reject/cancel/settle; research IC workflow; risk limit MC + case intake; performance period lock with step-up.

**Current state:** Partial bridges; IC and period lock in ops-native only.

**Work to do:**
- Frontend: Extend `admin-90`, `admin-91`, `admin-92`, `admin-93` bridges
- Backend: Confirm step-up on performance lock routes
- Validation: `w3`, `w4` tests; flow scripts

**How it should be done:** Reference `src/ops/orders*.tsx`, `research.tsx`, `risk.tsx`, `performance.tsx`.

**Acceptance criteria:** IC ratify requires different user + step-up; performance lock persists after refresh.

**Verification steps:** jsdom + `test-research-privates.ts`, `test-risk.ts`, `test-performance.ts`.

**Not included:** Methodology API (honest "Not available yet" if no route).

---

### M6: Admin page depth — clients, vault, reports, regulatory

**Portal(s):** admin-web legacy  
**Requirement IDs covered:** ADMIN-5A09–13, ADMIN-5A22  
**Depends on:** M1  
**Can run in parallel with:** M2–M5, M7

**Goal:** Investor portal user CRUD on clients page; vault PM evidence upload; report schedule CRUD + distribute; regulatory evidence upload.

**Current state:** `admin-20`, `admin-40`, `admin-102`, `admin-101` partial; several actions toast-only.

**Work to do:**
- Frontend: Wire remaining intercepts; file upload via `mx.upload`
- Backend: Confirm distribute endpoint guarded by `feature.report_distribution`
- Validation: `w6`, `w7` tests

**How it should be done:** `admin-40-documents.js` upload pattern; ops-native reports/regulatory screens.

**Acceptance criteria:** Schedule create appears in `GET /reports/schedules`; regulatory evidence attach visible on filing row.

**Verification steps:** jsdom upload mock; `test-reports.ts`, `test-regulatory.ts`.

**Not included:** PDF renderer changes.

---

### M7: Admin page depth — PM, financing, CA, data, models + recon families

**Portal(s):** admin-web legacy + backend recon  
**Requirement IDs covered:** ADMIN-5A03–04, 5A20–21, 5A23–24, ADMIN-5A17 (extended)  
**Depends on:** M1, M4  
**Can run in parallel with:** M6, M8

**Goal:** Close private-markets CRUD gaps; financing lifecycle; corporate-action elections/process; data exception resolve; model reviews tab; add recon families per GAP-006.

**Current state:** Toast deferrals in `admin-96-financing.js`, `admin-97-corporate-actions.js`; recon module partial.

**Work to do:**
- Backend: Recon families, tolerances (GAP-006) in `modules/recon/*`
- Frontend: Bridge depth in `admin-83`, `admin-96`, `admin-97`, `admin-84`, `admin-85`
- Validation: Module tests + jsdom

**How it should be done:** ops-native reference screens; maker-checker via `mx.fail` segregation_of_duties toasts.

**Acceptance criteria:** Financing draw creates facility state change in API; CA process requires step-up; recon break assign persists owner.

**Verification steps:** Flow scripts per module.

**Not included:** Market-data adapter (M10).

---

### M8: Admin settings enforcement and platform health UI

**Portal(s):** admin-web legacy + backend  
**Requirement IDs covered:** ADMIN-5A27, ADMIN-XFR-02, ADMIN-XFR-03, PLAT-002, PLAT-005  
**Depends on:** M1  
**Can run in parallel with:** M6, M7

**Goal:** Platform settings written via admin-core are read by worker/modules; notification prefs honoured; integrations banner reflects adapter mode in legacy copilot/settings.

**Current state:** `lib/settings.ts` reader exists; GAP-011 says most settings recorded not consumed; worker ignores LP prefs.

**Work to do:**
- Backend: Settings consumer wiring in worker, retention job, notify delivery (`GAP-011`)
- Frontend: Legacy settings workspace prefs (`platformSettingsV8`) — decide bridge to `/admin/settings` or document as UI-only; platform drawer already in `admin-61`
- Validation: `test-admin-core.ts`, `test-admin-platform.ts`

**How it should be done:** `backend/api/src/modules/admin-core/admin-core.engine.ts` SETTINGS registry; `integrations/` adapters from WP-8.

**Acceptance criteria:** Changing `notify.email_enabled` affects worker email send; retention job logs applied periods from settings.

**Verification steps:** Flow scripts; unit test settings reader.

**Not included:** SSO adapter.

---

### M9: LP portal — live by default and remainder

**Portal(s):** investor-web  
**Requirement IDs covered:** LP-001–012, PLAT-001, PLAT-002  
**Depends on:** M1, M8 (notification prefs)  
**Can run in parallel with:** M10–M12

**Goal:** With flags on, all LP domains use live API; mock store not used in production build path; realtime polling contract stable.

**Current state:** Proxy in `lp-portal-api.ts`; mock bundled; prefs not honoured in worker.

**Work to do:**
- Frontend: Tree-shake or exclude mock from production when all domains live; verify each screen uses live client
- Backend: Worker reads LP notification prefs
- Validation: `tests/frontend/investor-web/*.test.tsx`

**How it should be done:** `lib/lp-portal/flags.ts`, existing Vitest LP tests.

**Acceptance criteria:** With `LP_LIVE_DOMAINS=all`, no `DemoRibbon`; capital acknowledge persists after refresh.

**Verification steps:** Vitest + `scripts/test-lp-*.ts` on throwaway DB.

**Not included:** Socket.IO (SSE/poll per D-12).

---

### M10: Company-web — wire native pages and workspace depth

**Portal(s):** company-web + backend investee workspace  
**Requirement IDs covered:** CO-016, CO-005–011, CO-015, FR-CMP-020–028, GAP-016  
**Depends on:** M1, M9 (flags)  
**Can run in parallel with:** M11

**Goal:** `PortalSwitch` active in portal layout; native screens for forecasts/governance/requests/data-room; workspace tables replace Setting JSON where GAP-016 requires.

**Current state:** `app/(portal)/layout.tsx` uses `InvesteePortal` only; `PortalSwitch.tsx` unused in layout; backend workspace may be JSON (`investee-workspace.ts`).

**Work to do:**
- Frontend: Wire `PortalSwitch` in layout; fix `(portal)/*/page.tsx` to render native routes; enable `INVESTEE_LIVE_ACTIONS`
- Backend: Migration for workspace tables if not complete (GAP-016)
- Validation: `tests/frontend/company-web/native-screens.test.tsx`, `test-investee-workspace.ts`

**How it should be done:** `components/native/*Screen.tsx`, `lib/native-pages.ts`, `lib/investee/api.ts` patterns.

**Acceptance criteria:** `/forecasts` renders native screen with live data when flag on; cap-table transaction persists in DB not Setting JSON.

**Verification steps:** Vitest native screens; workspace flow script.

**Not included:** Full V8 runtime removal (phased).

---

### M11: Onboarding AI readiness panel

**Portal(s):** onboarding-web + backend  
**Requirement IDs covered:** ONB-006, GAP-A09 (LLM triage)  
**Depends on:** M1, M10 (integrations)  
**Can run in parallel with:** M10, M12

**Goal:** SRD 5.C.0 readiness/triage panel appears in wizard with server-driven scoring (fake LLM adapter acceptable).

**Current state:** Missing from `portals/onboarding-web/src`; staff triage exists in admin KYC bridge.

**Work to do:**
- Backend: Public or draft-scoped triage endpoint (or extend `/public/applications/:id`)
- Frontend: Panel component in `Wizard.tsx` calling API
- Validation: onboarding flow test

**How it should be done:** `integrations/llm` fake adapter; staff `admin-10-kyc.js` triage pattern.

**Acceptance criteria:** Submitting wizard shows readiness score from API, not client-only formula.

**Verification steps:** Public API test; component test.

**Not included:** Live LLM vendor.

---

### M12: Custodian feed integration and admin recon consume

**Portal(s):** custodian-web + backend  
**Requirement IDs covered:** CUS-006, CUS-011, GAP-A05  
**Depends on:** M1, M10 (integrations skeleton)  
**Can run in parallel with:** M9–M11

**Goal:** Statement upload parses CAMT/MT940 via adapter; day-end packages flow into admin recon without manual re-key.

**Current state:** UI uploads; `cash.engine.ts` CSV/JSON only; adapter layer in `backend/api/src/integrations/`.

**Work to do:**
- Backend: Wire `BankStatementAdapter`, `CustodianFeedAdapter` fakes to custodian + recon modules
- Frontend: Custodian statements page shows parse results/errors
- Validation: `test-integrations.ts`, custodian tests

**How it should be done:** `integrations/bank-statement`, `integrations/custodian-feed` per BUILD-PLAN WP-8.

**Acceptance criteria:** Upload sample CAMT creates statement import row consumable by admin cash recon.

**Verification steps:** Integration test script; custodian Vitest.

**Not included:** Live SWIFT connectivity.

---

### M13: Admin legacy — remaining page gaps and chart live data

**Portal(s):** admin-web legacy  
**Requirement IDs covered:** ADMIN-5A01 (charts), ADMIN-5A02–04, 5A14, 5A18–19, 5A25–26 remainder  
**Depends on:** M2–M8  
**Can run in parallel with:** — (final admin sweep)

**Goal:** Zero entries in `ADMIN-REAL-PAGES.md` "Not available yet" that have backend routes; honest empty states for routes that do not exist.

**Current state:** **Complete** (2026-10-06, HANDOFF-39 + HANDOFF-40). All 28 sidebar pages clear hardcoded KPIs when `mx.live && mx.strict(page)`; `ADMIN-REAL-PAGES` gap column is `—` or honest API-only limits.

**Work done:**
- Frontend: Full bridge sweep (slices 1–17); command palette and GIO charts wired in W1
- Post-sweep polish: IBOR column-group visibility, operations runbook XLSX export, performance TE/IR from live daily series
- Docs: `ADMIN-REAL-PAGES`, handoffs `HANDOFF-36`–`HANDOFF-40`
- Validation: `w0`–`w9` legacy tests pass (`--pool=threads` on Windows)

**How it should be done:** `mx.replace` + prototype chart redraw pattern from W1 handoff.

**Acceptance criteria:** `ADMIN-REAL-PAGES` shows "—" or explicit "no API" for every closed gap; 27/27 jsdom tests pass per file.

**Verification steps:**
```bash
node tools/legacy-bridge.mjs --only admin --check
npx vitest run --pool=threads tests/frontend/legacy/w0-entry.test.ts
# ... through w9, one file at a time on Windows
```

**Not included:** Delete `/ops-native` (owner sign-off).

---

## 4. Dependency and parallelisation overview

```
M1 (verify + flags + worker)
 ├── M2 (admin shell) ──────────────┐
 ├── M3 (orders/cash reservation) ──┼── M4 (cash/recon/ops depth)
 │                                   ├── M5 (orders/research/risk/perf)
 │                                   ├── M6 (clients/vault/reports)
 │                                   ├── M7 (PM/financing/CA/data/recon+)
 │                                   └── M8 (settings enforcement)
 ├── M9 (LP live) ─── depends M8 for prefs
 ├── M10 (company native + workspace) ─── M11 (onboarding AI) optional parallel
 └── M12 (custodian feeds) ─── integrations from M8/WP-8

M13 (admin legacy sweep) after M2–M8
```

| Parallel batch | Milestones |
|---|---|
| After M1 | M2, M3, M9, M10, M12 |
| After M3 | M4, M5 |
| After M4–M8 | M13 |
| Sequential | M1 → M8 prefs → M9; M10 → M11 |

---

## 5. Standing rules for implementation agents

- Follow existing architecture: Express modules in `backend/api/src/modules/*`, legacy bridges in `portals/admin-web/src/legacy/bridge/`, React ops reference in `src/ops/`, portal-kit auth in `packages/portal-kit`.
- Replace hardcoded and mock data with real API data when signed in / flags on. Leave honest "Not available yet" only when the plan has no backend requirement and no SRD FR exists.
- Stay within the milestone scope. Do not refactor unrelated code or delete `/ops-native` without owner sign-off.
- Do not push, deploy, or change CI/infrastructure unless a future milestone explicitly includes it (out of scope for this plan's agents).
- Do not mark a milestone complete until every acceptance criterion passes (jsdom and/or `scripts/test-*.ts` as specified).
- Log decisions in `docs/DECISION-LOG.md` when the plan is ambiguous; stop and ask the owner for irreversible choices (portal restore, ops-native deletion, vendor selection).
- Admin legacy UI: do not edit `src/legacy/markup/*.html` or `public/legacy/css/*` except W0-intended sidebar restore; wire via bridges and `tools/hooks/*.mjs` only (`CLEANUP-AGENT-PROMPT` rule 1).
- Use `mx.intercept`, `mx.wrapGlobal`, `reasonDrawer`/`openDrawer`, step-up via `mx.post` (not `window.prompt`) for admin legacy writes.
- Run `node tools/legacy-bridge.mjs --only admin --check` after bridge edits; sync public copies.

---

## 6. Open questions

1. **Default UI product:** Is legacy V56 at `/` the permanent admin UI, or should `/` redirect to a future native shell? (`GAP-021`, D-39 retains `/ops-native`.)

2. **Workspace settings split:** Should prototype `platformSettingsV8` (density, letterhead, trading defaults) persist via `/api/v1/admin/settings` or remain UI-only while admin-core handles platform flags? Plan lists both in 5.A.27; code has dual paths (`admin-60-access.js` L303 vs `admin-61`).

3. **Company portal strategy:** Migrate all 13 V8 pages to native React (`PortalSwitch`) or keep V8 indefinitely for some pages? (`CO-016`, D-14.)

4. **Onboarding/custodian restore:** Owner choice per D-42 — restore pre-R4 HTML, keep React, or UAT rc1 portals only.

5. **Flag semantics for custodian/onboarding:** `CUSTODIAN_LIVE` / `ONBOARDING_LIVE` exist in platform flags but portals do not read them — gate API, remove flags, or add demo mode?

6. **LP e-sign vs LP domains:** Should e-sign stay always-live while LP data is phased? (`LP-013` bypasses `LP_LIVE_DOMAINS`.)

7. **Adapter vendors:** Which external systems replace fakes for email, screening, market-data, custodian feeds? (GAP-A01–A13 — blocks production, not UI wiring.)

8. **SRD doc drift:** `docs/srd/5B-lp-portal.md` describes mock-only LP; code contradicts. Refresh after M1 verification? (GAP-026.)

9. **Browser verification:** HANDOFF-11 §5 checklist unverified — who runs post-deploy QA?

10. **Investee backend depth:** Is GAP-016 (real tables for cap table/forecast/governance) in scope before UAT sign-off, or is live JSON acceptable interim?

---

*End of audit. No implementation performed. Review this document before assigning milestones to agents.*
