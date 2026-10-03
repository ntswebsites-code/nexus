# Gap analysis: plan vs what is built

Branch `feat/admin-recon-nav`, 3 Oct 2026. Method: read the plan documents, then verified claims against code
(grep of `backend/api/src`, `routes/v1.ts`, `prisma/schema.prisma`, `portals/*/src`, `tools/uat`). Where a plan doc and
the code disagree, the code wins and the doc drift is listed (GAP-026). Paths are relative to the repo root.

Sources: `docs/DEV-PLAN-1DAY.md`, `BUILD-PLAN.md`, `HANDOFF.md`, `HANDOVER-STATUS.md`, `DECISIONS-NEEDED.md`,
`ADMIN-REAL-PAGES.md` ("Not done" notes), `SRD.md`, `srd/5A..5E`, `srd/REGISTER.md` (377 FRs, 7 NFRs, 256 BRs, 532 DEFs).

Legend. Status: Done / Partial / Missing. Severity: `blocks-function` (a journey or control does not work) or `polish`.
Size: S under half a day, M about a day, L multi-day. `ADAPTER` = needs an external vendor/account; build a
placeholder interface plus fake implementation now (WP-8).

Verification caveat that applies to everything below: the repo has **no CI** (only `.github/workflows/pages.yml`) and
no unit-test runner. Evidence of "works" is the `backend/api/scripts/test-*.ts` flow scripts, which need a disposable
MySQL and a running API. Per `docs/ADMIN-REAL-PAGES.md` (lines 1117, 1140, 1151, 1168) the flow scripts for
IBOR/performance (partly), research/privates/lab/financing, clients-onboarding, reports/regulatory/data/models and
admin-core were "typechecked but not run".

---

## 1. Status table

### 1.1 Backend modules (`backend/api/src/modules/*`, mounted in `routes/v1.ts`)

| Module | Status | Evidence | Remaining (see GAP) |
|---|---|---|---|
| identity, auth, MFA, step-up, invitations | Done | `modules/identity`, `middleware/requireAuth.ts`, `lib/totp.ts`, `scripts/smoke-ws0.ts` | no SSO (GAP-A10), no SMS (GAP-A02) |
| audit hash chain, idempotency, outbox | Done | `lib/audit.ts`, `lib/idempotency.ts`, `lib/outbox.ts` | worker has no row claiming (GAP-014) |
| lp-portal (12 domains) | Done (code), unverified on host | `modules/lp-portal/routes/*` (about 60 endpoints, no stubs left; `lpStub*` helpers unused) | prefs not honoured (GAP-008), realtime is polling (GAP-020) |
| ops: funds, capital calls, distributions, dealing, notices, bank-instr., term sheets, custodian, investee requests | Done | `modules/ops/*`, `scripts/test-ws2.ts`, `test-ws3.ts`, `test-ws4.ts` | payouts manual (GAP-A06); catch-all 501 `ops.routes.ts:36` is only a 404 substitute |
| investee-portal | Partial | `modules/investee-portal/investee.routes.ts` (about 40 routes) | cap table, governance, forecast live on `Setting` JSON (GAP-016) |
| company staff / reporting loop | Done | `modules/company/*`, `reminders.ts` | |
| custodian API | Done | `modules/custodian/custodian.routes.ts` | single-execution submit only, no bulk/amend (GAP-018) |
| kyc / public onboarding | Partial | `modules/kyc/*`, `screening.ts` (`stub-screening-v1`) | screening stub (GAP-A03) |
| portfolio / securities / prices / brokers | Done | `modules/portfolio/portfolio.routes.ts`; prices and FX are manual entry | feed (GAP-A04) |
| orders | Partial | `modules/orders/*` | no cash reservation (GAP-004), fills MANUAL only (GAP-A13) |
| risk | Done | `modules/risk/*`, `test-risk.ts` | |
| nav | Done | `modules/nav/*`, `test-nav.ts` | models not called (GAP-012) |
| accounting | Done | `modules/accounting/*` | |
| corporate-actions | Partial | `modules/corporate-actions/*` | GAP-007 |
| cash | Partial | `modules/cash/*`; statement parser CSV/JSON only (`cash.engine.ts:133`) | GAP-004, GAP-A05 |
| recon | Partial | `modules/recon/*` (4 families) | GAP-006 |
| wiring (operations, dashboard) | Partial | `modules/wiring/*` | GAP-010 |
| ibor, performance | Partial | `modules/ibor`, `modules/performance`; script not run on a DB per doc | GAP-002, GAP-A04 |
| research, private-markets, portfolio-lab, financing | Partial | `modules/research`, `private-markets`, `portfolio-lab`, `financing` | GAP-002, GAP-005, GAP-011 |
| clients-onboarding (client-ops) | Partial | `modules/clients-onboarding/*` | GAP-013 |
| reports, regulatory, data-fabric, model-governance | Partial | `modules/reports`, `regulatory`, `data-fabric`, `model-governance` | GAP-009, GAP-012 |
| admin-core (RBAC change requests, settings, audit, copilot) | Partial | `modules/admin-core/*` | GAP-011, GAP-A09 |
| admin (legacy direct endpoints) | Partial | `modules/admin/admin.routes.ts:26` SoD list | GAP-015 |

Schema: 166 models, 18 migrations (`backend/api/prisma/migrations`). Latest `20261013100000_ibor_source_id_width`.

### 1.2 Portals

| Portal | Status | Evidence | Remaining |
|---|---|---|---|
| admin-web `/ops` (native React) | Partial | `portals/admin-web/src/app/(ops)/ops/*` (all 28 SRD pages 5A.1-5A.28 exist; `ops/Shell.tsx` NAV matches the SRD list) | shell features (GAP-009), page panels (GAP-010) |
| admin-web `/` (legacy prototype) | Prototype on demo data | `portals/admin-web/src/legacy/markup/*` (38 page fragments), bridge scripts only for kyc/clients/investor-services/documents/company-reporting/access | GAP-021 |
| investor-web (LP) | Done when flags on; mock store still bundled | `lib/api/lp-portal-api.ts:1396` routes by flag, `lib/lp-portal/mock-api.ts` | default flags off (GAP-001) |
| company-web (investee) | Partial | `lib/investee/api.ts` (33 action keys), `lib/investee/host.ts`; V8 mock shell (`components/investee-portal-v8-mock`) | default off (GAP-001), GAP-016 |
| onboarding-web | Partial | legacy HTML 19k lines + `public/live/onboarding-live.js` (481 lines) | GAP-019 |
| custodian-web | Partial | legacy HTML + `public/live/custodian-live.js` (388 lines) | GAP-018, GAP-019 |

### 1.3 Shared, tooling, deploy

| Item | Status | Evidence |
|---|---|---|
| `packages/legacy-runtime` | In use by admin, onboarding, custodian (HTML bridge) | `packages/legacy-runtime/src`, each portal's `src/legacy/manifest.ts` |
| `packages/shared`, `portal-kit` | Done | login/MFA/invite/reset used by all portals |
| UAT tooling | Done, unrun on host | `tools/uat/{smoke,contract-harness,pack-release.ps1}`, `deploy/deploy.sh`; `PROGRESS.md` blockers: no SSH key, no `SEED_USERS_FILE` |
| Smoke coverage | Partial | `tools/uat/smoke.ts` S1-S12 covers the UAT cut line only; none of the 17 later modules |
| CI | Missing | only `.github/workflows/pages.yml` |

---

## 2. Gap list

Numbering: GAP-001..GAP-0xx are build gaps; GAP-A01..A13 are ADAPTER gaps (grouped at the end).

| ID | Area | What is missing (verified) | Sev | Size |
|---|---|---|---|---|
| GAP-001 | Go-live flags | `LP_LIVE_DOMAINS`, `INVESTEE_LIVE_ACTIONS`, `CUSTODIAN_LIVE`, `ONBOARDING_LIVE` default empty/false (`config/env.ts:28-31`, `deploy/.env.production.example:30-35`). Out of the box every portal serves demo data under a ribbon. No startup check, no admin screen showing flag state, mock store (`investor-web/src/lib/lp-portal/mock-store*`) still ships in the bundle. Flip defaults to `all` for UAT/prod example, add `/ops/settings` read-only flag panel, fail loudly if flags unreachable. | blocks-function | S |
| GAP-002 | Verification of recent modules | Flow scripts for IBOR/performance, research, private markets, portfolio lab, financing, clients-onboarding, reports/regulatory/data/models, admin-core were never run against a database (ADMIN-REAL-PAGES lines 1117, 1140, 1151, 1168). 18 migrations; only the first 3 appear in the cloud re-verify (HANDOVER-STATUS 3.1). Need: fresh DB `migrate deploy` + seed, run all `scripts/test-*.ts`, fix failures, then click through each `/ops` page. | blocks-function | M |
| GAP-003 | CI | No workflow runs typecheck, `next build`, or the flow scripts. Add GitHub Actions: install, `prisma generate`, typecheck, build all portals, MySQL service container, seed, start API, run scripts. Extend `tools/uat/smoke.ts` with read-only checks for every `/ops` module endpoint (list returns 200). | polish | M |
| GAP-004 | Orders <-> cash | FR-CASH-015: submit/cancel/fill do not call the cash reservation service. `grep` finds no reservation call outside `modules/cash` and `modules/orders/index.ts` only re-exports `reservedCash` (an order-side calc). Order ticket and cash page can disagree. Wire `releaseOrderReservations`, create reservation on buy submit, release on cancel, consume on settlement posting. | blocks-function | M |
| GAP-005 | Private markets / PM ledgers | Capital calls, distributions and marks are not posted to cash ledger or accounting (no journal creation in `modules/private-markets`; `journal` creation only exists in `accounting` and `cash` routes plus `wiring/autojournals`). No FX for non-USD funds in pooled totals, no J-curve, evidence is a reference not a file. Add autojournals for PM flows, file evidence via `/documents`. | polish | M |
| GAP-006 | Reconciliations | Only TRADES, CASH, HOLDINGS, DAYEND_COUNT. Missing: positions vs custody quantities, settlement fails, corporate-action family; BR-067 tolerances effective-dated config (hard-coded); evidence file attach (a reference string only); explicit reopen endpoint; query-source / escalate actions; partial-fill aggregation; FX-aware price compare; CSV export of breaks; NAV-close and runbook gating (ADMIN-REAL-PAGES 745-754, 562-566). | polish | M |
| GAP-007 | Corporate actions | No cash in lieu, no partial/oversubscribed rights, no reversal of a processed action, no LP/client-level entitlements, announcements manual only (feed is GAP-A04). Doc line 906 says "not linked to Accounting" but `ca.routes.ts:365` posts journals; doc is stale. | polish | M |
| GAP-008 | Notifications | LP notification/display preferences are saved as `Setting` rows (`lp-portal/routes/settings.routes.ts:36`) but the worker (`worker.ts:19-30`) never reads them; `NotificationPreference` table is read only by investee routes. No digest. In-app bell exists as API (`/notifications`) but no UI in `/ops` (GAP-009). Retention/notification admin settings are recorded, not read (GAP-011). | blocks-function (controls) | M |
| GAP-009 | Admin shell | `ops/Shell.tsx` has sidebar plus avatar and sign-out only. Missing vs SRD 5A.0.1-5A.0.5, 5A.29, 5A.30: global search / command palette (Cmd K), notification bell and list, role switcher/focus, profile + self-service MFA enrol/change password (no `mfa/enroll` caller in `portals/admin-web`), record detail page, shared drawer/preview/document modals, breadcrumbs with deep links. | polish | M |
| GAP-010 | Admin panels | Command Centre has KPI and queue panels only (no performance chart, allocation, scenario). Operations: no calendar, workload/cash-deadline charts, task comments, CSV button (endpoint exists). Orders: decision that created an order not shown on ticket; sells do not compute realised gain; settlement is manual. Vault screen has no upload/delete/lifecycle. Reports screen has no PDF. Portfolio Lab: no optimiser/drift monitor/scheduled rebalance. Research: no case attachments, no IC attendance list, no reminders. Financing: no interest/fee postings. | polish | L |
| GAP-011 | Admin-core enforcement | Retention values, notification settings and all but the Copilot feature flag are stored but not read by any module; no scheduled purge; no custom permission codes; role create and staff invite still use legacy `/admin` endpoints; SoD blocklist `admin.routes.ts:26` omits `financing.manage`, `valuation.release`, `accounting.close/reopen`, `capital.*`, `distributions.*` (admin-core's privileged list is wider, the legacy list is what the direct endpoints use). | blocks-function (SoD) | M |
| GAP-012 | Model governance / NAV | Models are never called by NAV or risk (`POST models/:id/usage` unused); no periodic review workflow beyond a date; Data Fabric has no ingestion engine (table sources profiled, feed runs recorded by hand), rules are single-column only; scheduled report schedules repeat fixed dates; no email delivery of scheduled reports (needs GAP-A01). | polish | M |
| GAP-013 | Clients / KYC rules | Risk factors fixed (not configurable); dealing-hold and mandate change single-step (no checker); screening checks recorded manually. Public onboarding "AI readiness" panel has no backend (needs GAP-A09). | polish | S |
| GAP-014 | Platform NFRs | NFR-SEC-013 no CSP / frame-ancestors on any portal (zero matches in `portals/*/next.config.ts`, `nginx.conf`); NFR-SEC-014 general rate limits absent (limiters only in `identity.routes.ts`, `kyc/public.routes.ts`, `authRoutes.ts`); NFR-OPS-007 no JSON request logging or metrics, and `lib/mailer.ts:10` prints full mail bodies (invite/reset links) when SMTP unset; NFR-AV-005 worker does not claim rows (`worker.ts` polls without lock, double-delivery with 2 workers); NFR-PERF-005 staff lists use `take` caps not `page/pageSize/total`; NFR-SEC-012 `If-Match` only in some routes. | blocks-function (security) | M |
| GAP-015 | Idempotency/concurrency on newer modules | Spot check: `Idempotency-Key` is applied in ws modules; the 17 later modules rely on per-module use. Audit every money POST (cash, accounting, NAV release, CA process, financing drawdown, PM calls) for `idempotency` + `writeAudit` in-transaction + step-up. | blocks-function | S |
| GAP-016 | Investee workspace | Cap table, forecast, governance, consents, requisitions stored as `Setting` JSON (`investee-workspace.ts`). No cap-table transactions with maker-checker, certificates with SHA-256, GL posting, waterfall; no board calendar/packs; company-initiated signature requests, remind/void; no 7-day share links or watermarked preview; no global search; no derived KPIs/ratios or KPI history export; no forecast month-locking; no access review / MFA coverage view; `notBuilt` 501 fallback `investee.routes.ts:1046`. Needs real tables (new migration). | polish | L |
| GAP-017 | LP portal remainder | 113 FR-LP ids in register; core domains built. Open: realtime is polling only (`GET /realtime`), no push; performance report PDF is the stored figures not a styled statement; benchmark series approval depends on data (GAP-A04); mock store cleanup (GAP-001). | polish | S |
| GAP-018 | Custodian portal | Single-execution submit only; no CSV/bulk upload, no amend/cancel of an execution, no day-end control-total validation beyond trade count, no MT535/536 parsing (ADAPTER part: GAP-A05), no counterparty-side status history screen. Staff `/ops/custodian` accept path done. | polish | M |
| GAP-019 | Legacy HTML portals | onboarding-web and custodian-web are 4.8k-19k line legacy HTML with injected live scripts (`legacy-runtime`). DEF-458/459/460 (rail nav validation, dead v57 script), no automated test. Either add Playwright smoke or rewrite as native React. | polish | L |
| GAP-020 | Staff dealing/term-sheet extras | Term-sheet states `COUNTERSIGNED/EXECUTED` done; fund-side reject/void, amendment/versioning and document template library missing; dealing: no suspension calendar UI, NAV-per-unit entry is manual. | polish | M |
| GAP-021 | Legacy admin workspace | `/` still serves the V56 prototype for about 28 pages with Demo data; DECISIONS D-37 ("stay prototype") is stale because `/ops` now supersedes them. Decide: make `/ops` the default landing, redirect legacy routes, keep only the live-bridged legacy pages (kyc, clients, investor-services, documents, company-reporting, access) until ported, delete the rest. | polish | S |
| GAP-022 | UAT execution | Contract harness (3.2), browser journeys (3.3-3.5) on the new modules, deploy to 207.180.234.151 and tag `uat-rc1` never completed from the cloud runs (PROGRESS.md blockers: no SSH key, no `SEED_USERS_FILE`); no backup-restore drill, load test or pen test. Mailpit not running locally. Process item, owner required. | blocks-function | M |
| GAP-023 | Worker deployment | A worker process is not running in the local setup, so all queued emails/notifications never deliver (PROGRESS.md "Manual follow-up"). `deploy/docker-compose.prod.yml:80` defines it; confirm health check and alert on outbox age. | blocks-function | S |
| GAP-024 | Seeds and demo data | Each module has its own `seed-*.ts`; `seed-uat.ts` calls only some. Confirm `seed-uat.ts` and `seed-demo.ts` invoke every module seed and are idempotent three times (extend `tools/uat/check-sh.sh`). | polish | S |
| GAP-025 | Shared types | `packages/shared` only holds LP contracts and flags. Staff-module request/response types are duplicated in `portals/admin-web/src/ops/types.ts` (hand-written) with no contract test, which is how WS7 drifted from the backend (HANDOVER-STATUS 3.3). Add zod-derived types or a contract test per module. | polish | M |
| GAP-026 | Documentation drift | `ADMIN-REAL-PAGES.md:906` (CA not linked to journals) vs `ca.routes.ts:365`; `DECISIONS-NEEDED.md` D-37; `HANDOVER-STATUS.md` journey table says "Not verified"; `srd/appendix/5B__gap-vs-nexus-api.md` and `5D__gap-vs-nexus-api.md` describe the pre-build state (38 "Missing" LP methods are now built). Refresh once GAP-002 is done. | polish | S |

### ADAPTER gaps (placeholder interface plus fake implementation, WP-8)

| ID | External dependency | Current state (verified) | Adapter name | Sev | Size |
|---|---|---|---|---|---|
| GAP-A01 | Email provider (SES/SendGrid/SMTP relay) | `lib/mailer.ts` SMTP or console; no delivery status, bounce, template, or scheduled-report mail | `EmailAdapter` | blocks-function | S |
| GAP-A02 | SMS / OTP provider | none (no code) | `SmsAdapter` | polish | S |
| GAP-A03 | KYC/AML vendor (sanctions, PEP, adverse media, ID verification) | `modules/kyc/screening.ts` stub provider `stub-screening-v1`, watch list in `constants.ts` | `ScreeningAdapter` (+ `IdentityVerificationAdapter`) | blocks-function | M |
| GAP-A04 | Market-data feed (prices, FX, corporate actions, benchmarks) | `SecurityPrice`/`FxRate` entered manually via `portfolio.routes.ts:272`; CA announcements and benchmark series manual | `MarketDataAdapter` | blocks-function | M |
| GAP-A05 | Custodian SWIFT/API/file feed, bank statements (MT535/536/940, CAMT.053) | custodian portal manual submit; `cash.engine.ts:133` CSV/JSON only; settlement manual | `CustodianFeedAdapter`, `BankStatementAdapter` | polish | M |
| GAP-A06 | Payments / bank (distribution payouts, receipts matching, virtual accounts) | payments recorded by hand with proof upload (`ops/capital.routes.ts`); no payout instruction | `PaymentAdapter` | polish | M |
| GAP-A07 | E-sign vendor | term-sheet/document signing is internal consent + certificate PDF (`term-sheets`, `lp-portal/services/documents.ts`) | `ESignAdapter` | polish | S |
| GAP-A08 | AV / malware scan | none; `lib/storage.ts` only checks MIME allow-list (PROGRESS.md "malware scanner was not added") | `AvScanAdapter` | blocks-function | S |
| GAP-A09 | LLM | Copilot is a deterministic keyword router (`admin-core`); onboarding triage panel absent | `LlmAdapter` | polish | S |
| GAP-A10 | SSO / OIDC / SAML for staff | none | `SsoAdapter` | polish | S |
| GAP-A11 | Object storage (S3-compatible) | `lib/storage.ts` local AES-GCM files under `STORAGE_DIR` (comment says S3 swap changes `putObject/getObject` only) | `ObjectStorageAdapter` | polish | S |
| GAP-A12 | Regulator filing (SECZ, FIU) | filings are internal layouts with no upload (`regulatory`) | `RegulatorFilingAdapter` | polish | S |
| GAP-A13 | Broker order routing / FIX / contract-note ingestion | fill `source` enum has `FIX`/`CONTRACT_NOTE` (`orders.routes.ts:118`) but only manual entry exists | `BrokerRoutingAdapter` | polish | M |

Counts: 26 build gaps (9 blocks-function: 001, 002, 004, 008, 011, 014, 015, 022, 023; 17 polish), 13 ADAPTER gaps (4 blocks-function: A01, A03, A04, A08).

---

## 3. Proposed work packages

Rules for all agents: schema changes are additive migrations with a unique timestamp prefix (`2026101[4-9]...`); never edit
another package's files; every write route keeps permission + step-up (money) + maker-checker + `writeAudit` in a
transaction + `Idempotency-Key`; no secrets in commits; run `npm run typecheck` and the module's `scripts/test-*.ts` on a
disposable DB (`E2E_CONFIRM=throwaway-db`). Shared hot files (`routes/v1.ts`, `prisma/schema.prisma`, `ops/Shell.tsx`,
`prisma/seed-uat.ts`) are append-only: add one line or one block at the end, rebase before merge.

### WP-1 Verify, repair and gate (GAP-001, 002, 003, 022, 023, 024, 026)
Files: `.github/workflows/*`, `tools/uat/*`, `backend/api/scripts/*` (fixes only), `deploy/*`, docs.
Fresh MySQL, `migrate deploy` of all 18 migrations, seed (`seed-uat` and `seed-demo`), start API plus worker, run every
`scripts/test-*.ts` and fix breakages in the owning module with minimal edits (log each). Add CI workflow and extend
`tools/uat/smoke.ts` with a read-only GET sweep over every `/ops` endpoint family. Set flag defaults to `all` in
`deploy/.env.production.example`; add flag status to `/api/v1/platform/flags` consumers' health. Refresh stale doc lines
(ADMIN-REAL-PAGES 906, DECISIONS D-37, gap-vs-api appendices). Done when CI is green and `HANDOVER-STATUS.md` has a new
verified table.

### WP-2 Orders, cash, PM and corporate-action wiring (GAP-004, 005, 007, part of 010)
Files: `modules/orders/*`, `modules/cash/cash.reservations*`, `modules/private-markets/*`, `modules/wiring/autojournals.ts`,
`modules/corporate-actions/*`, matching `ops/orders.tsx`, `ops/cash.tsx`, `ops/corporate-actions.tsx`, `scripts/test-orders.ts`,
`test-cash.ts`. Reservation on buy submit/cancel/fill, ticket reads the cash service, order ticket shows originating IC
decision, realised gain on sells, PM call/distribution autojournals, CA cash in lieu and reversal-by-adjustment, CA/PM
entitlements at client level. Add the tests for each.

### WP-3 Reconciliation and operations control depth (GAP-006, GAP-010 ops part)
Files: `modules/recon/*`, `modules/wiring/*`, `ops/recon/*`, `ops/operations.tsx`, `ops/command` page, `scripts/test-recon.ts`,
`test-wiring.ts`. Add families (POSITIONS_VS_CUSTODY, SETTLEMENT_FAILS, CORP_ACTIONS), effective-dated tolerance config
(BR-067), evidence file attach, reopen, query/escalate, break CSV export, NAV-close and runbook gating; Command Centre
performance/allocation/scenario panels; Operations calendar, workload chart, task comments, CSV button.

### WP-4 Admin shell, admin-core enforcement and security hardening (GAP-009, 011, 014, 015, 008)
Files: `portals/admin-web/src/ops/Shell.tsx` (owner), new `ops/shell/*`, `modules/admin/admin.routes.ts`,
`modules/admin-core/*`, `modules/notifications/*`, `worker.ts`, `middleware/*`, `lib/mailer.ts`, `nginx.conf`, portal
`next.config.ts`. Command palette and global search endpoint, notification bell, profile page with MFA enrolment and
password change, role switcher, record detail page; make retention/notification/flag settings consumed by modules
(settings reader helper) and a scheduled purge job; widen the SoD blocklist to the same list as admin-core; custom
permission codes; CSP and security headers; 600/min and 30 uploads/min limits; JSON request logs with request id; worker row
claiming (`UPDATE ... WHERE claimed_by IS NULL` or `SKIP LOCKED`); never log tokens; honour LP/investee notification
preferences and digest in the worker; audit all money POSTs for idempotency (GAP-015) and add `page/pageSize/total`
to staff list endpoints.

### WP-5 Investee workspace tables and company-web (GAP-016, part of 017)
Files: `modules/investee-portal/*` (new `workspace/*` files), `prisma/schema.prisma` (append block), new migration,
`portals/company-web/src/lib/investee/*`, `components/InvesteePortal.tsx`, `ops/rp.tsx` staff side if needed,
`scripts/test-investee-workspace.ts`. Move cap table, forecast, governance, requisitions off `Setting` JSON into tables
with migration of existing rows; cap-table transactions maker-checker, certificate with SHA-256, GL posting through
autojournals, waterfall; board calendar and packs; company-initiated signature requests with remind/void; share links with
expiry; global search; derived KPIs and CSV/xlsx export; month locking; MFA coverage and access review view.

### WP-6 Reports, regulatory, data fabric, models, vault, clients (GAP-012, 013, 010 reports/vault part, 005 evidence)
Files: `modules/reports/*`, `modules/regulatory/*`, `modules/data-fabric/*`, `modules/model-governance/*`,
`modules/clients-onboarding/*`, `ops/reports.tsx`, `ops/suite.tsx`, `ops/clientops.tsx`, tests for each. Real PDF output
(add a PDF renderer in `modules/reports/pdf.ts`, reuse `ops/pdf.ts` primitives), file-based ingestion engine for CSV
sources, cross-table rules, models called by NAV/risk with usage logging and periodic review workflow, vault upload/lifecycle
UI, configurable KYC risk factors, checker on dealing-hold and mandate changes, report schedule date-range fix.
Email delivery of schedules goes through the `EmailAdapter` from WP-8 (use `sendMail` until it lands).

### WP-7 Custodian, onboarding and legacy portals, admin legacy retirement (GAP-018, 019, 021, 017, 025)
Files: `portals/custodian-web/*`, `portals/onboarding-web/*`, `packages/legacy-runtime/*`, `portals/admin-web/src/app/(legacy)`,
`portals/admin-web/src/legacy/*`, `modules/custodian/*`, `packages/shared/src/*` (new staff contract types), Playwright
smoke under `tools/uat/e2e/`. Bulk CSV upload and amend/cancel of executions with control totals; fix DEF-458..460; Playwright
journeys for onboarding and custodian; redirect `/` to `/ops` and delete legacy pages already superseded; generate
`ops/types.ts` from zod schemas in `packages/shared` plus a contract test per module; LP realtime polling contract and
statement styling.

### WP-8 Integrations layer: all ADAPTER placeholders (GAP-A01..A13)
New tree `backend/api/src/integrations/`, plus one additive migration, one route file `modules/admin-core/integrations.routes.ts`
and one screen `portals/admin-web/src/app/(ops)/ops/integrations/page.tsx` with a nav entry (`admin.settings`).

Design to implement:
1. Per capability an interface in `integrations/<name>/types.ts` and `index.ts` exporting `getXAdapter()`:
   `email`, `sms`, `screening`, `identity-verification`, `market-data`, `custodian-feed`, `bank-statement`, `payment`,
   `esign`, `av-scan`, `llm`, `sso`, `object-storage`, `regulator-filing`, `broker-routing`.
2. Env flag per adapter in `config/env.ts`: `INTEGRATION_<NAME>=fake|live` (default `fake`; `live` requires its own
   credentials, startup refuses `live` without them, and refuses `fake` when `NODE_ENV=production` unless
   `ALLOW_FAKE_INTEGRATIONS=1`). Live classes are thin throwing stubs documenting the vendor call (`NotConfiguredError`).
3. Fake implementations persist: new tables `integration_calls` (adapter, operation, request hash, status, payload JSON,
   result JSON, correlation id), `integration_inbox` (inbound simulated feeds) and reuse `outbox_events`. Email fake
   writes a row plus keeps Mailpit/SMTP when configured; SMS fake stores the code for tests; screening fake wraps the
   current `kyc/screening.ts` logic (move, do not duplicate); market-data fake serves deterministic daily prices/FX and
   offers `POST /admin-core/integrations/market-data/simulate`; custodian-feed fake generates MT535-like and CAMT.053
   samples into `counterparty_day_end_packages` / `cash_statement_imports`; payment fake returns PENDING then SETTLED after a
   timer tick; esign fake produces a certificate document; av-scan fake flags files containing the EICAR string; llm fake is
   the existing deterministic router; sso fake is a dev-only IdP page disabled in production; object-storage fake is the
   current local encrypted store (move `putObject/getObject` behind the interface).
4. Rewire call sites to the interfaces (smallest diffs): `lib/mailer.ts`, `lib/storage.ts`, `kyc/screening.ts` and worker
   handler, `portfolio` price import, `cash` statement import, `admin-core` copilot, regulatory filing submit.
5. Admin "Integrations" screen: table per adapter with mode (fake/live), health check, last call time, last error, call
   counts, and a drill-down listing `integration_calls`; test button per adapter (`POST /integrations/:name/test`);
   a persistent banner in `/ops` when any adapter is `fake` in a production build.
6. Tests: `scripts/test-integrations.ts` (each fake round-trips and persists, `live` without credentials refuses to start,
   production guard). Add each adapter to `deploy/.env.production.example` with comments.
Coordination: WP-4 owns `worker.ts` and `mailer.ts` edits other than the adapter hook; WP-8 touches them last, rebasing on WP-4.

### Suggested order and file ownership
Start together: WP-1, WP-2, WP-3, WP-5, WP-6, WP-8 (disjoint module folders). WP-4 and WP-7 touch shared shell, worker and
legacy areas, so start them after WP-1 lands CI and after the first WP-8 commit of `integrations/index.ts` skeletons.
Merge sequence: WP-1, WP-8 skeleton, WP-4, then the rest; WP-1 re-runs the full verification at the end.

### Decisions the owner still has to make
Which vendors to pick for each ADAPTER (until then fakes stay on); whether `/ops` becomes the only admin UI (GAP-021);
whether the investee cap table deserves real tables now (GAP-016); whether `mfa_required` turns on for UAT (D-33 says off).
