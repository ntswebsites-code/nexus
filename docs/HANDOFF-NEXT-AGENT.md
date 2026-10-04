 48 scripts: 3,729 checks passed, 0 failed, 0 non-zero exits | run on the UAT host, fresh throwaway schema per script, all migrations apply cleanly; 4 offline scripts (esign, esign-depth, market-data, object-storage) report 0 DB checks by design |

Written 2026-10-04 from the repo (git log, docs/*) plus facts supplied by the lead agent. Where a fact could not be confirmed it says **unverified**.
Read this file top to bottom once, then use section 10 (document map) to dive deeper. A ready-to-paste starter prompt is in `docs/NEXT-AGENT-PROMPT.md`.

Repo (owner's machine): `C:\Users\lysp\Downloads\matanho-nexus-v56-deployment`. Remote: `https://github.com/odlemon/matanho-nexus.git`.
Tools you will have are Git Bash and PowerShell on Windows 11.

---

## 1. What this system is

**Matanho Nexus** is an institutional investment-management platform: a staff operations console plus four external portals, all served by one API.

### 1.1 Portals

| Portal | Package | Dev port | UAT host | Audience | UI state |
|---|---|---|---|---|---|
| admin-web (ops console under `/ops`) | `@matanho/admin-web` | 3100 | `nexus.matanho.com` | staff | native React `/ops` pages for every module (route group `(ops)`); a legacy V56 HTML UI still exists in `(legacy)` for a few pages |
| investor-web (LP portal) | `@matanho/investor-web` | 3101 | `investor.nexus.matanho.com` | limited partners | native React + Tailwind, route group `(lp)`; live data when flags are on |
| onboarding-web | `@matanho/onboarding-web` | 3102 | `onboarding.nexus.matanho.com` | public applicants (no sign-in) | native React wizard (R4-6), route groups `(app)`, `(auth)`, `(sign)` |
| company-web (Investee portal) | `@matanho/company-web` | 3103 | `company.nexus.matanho.com` | portfolio companies | **mixed**: V8 mock runtime script hosted in React (`components/investee-portal-v8-mock/matanho-investee-portal-runtime.js`, 234 KB) fed by a live payload, plus a few native screens (workspace tools, e-sign, share links). See section 9 P1 |
| custodian-web | `@matanho/custodian-web` | 3104 | `custodian.nexus.matanho.com` | custodian staff | native React (R4-7): executions, bulk upload, day-end, statements and holdings upload, users and roles, security/MFA page |

Local stack (docs/LOCAL-STACK.md) uses unusual ports instead: API 48211, admin 48221, investor 48222, onboarding 48223, company 48224, custodian 48225. The API default port is 4100.

### 1.2 Repository layout

```
backend/api/            Express 5 + TypeScript + Prisma 6 + MySQL 8, port 4100
  prisma/schema.prisma, prisma/migrations (44 at time of writing), prisma/seed*.ts, prisma/seed/role-catalog.json
  scripts/              flow scripts test-*.ts, offline-*.ts, smoke-ws0.ts, e2e-phase1.ts, migrate-storage-to-s3.ts (52 files)
  src/app.ts server.ts worker.ts   routes/v1.ts (mounts every module)   modules/*   integrations/*   lib/*   middleware/*   auth/*
packages/shared/        portal registry, zod schemas, DTO types, typed API client
packages/portal-kit/    shared login/invite/reset/MFA screens, session hook, auth proxy (createPortalProxy)
packages/legacy-runtime renders the original prototype markup and scripts (legacy admin pages only)
portals/*-web           the five Next.js 16 apps
tools/uat/              pack-release.ps1, run-flows.sh, server-flows.sh, smoke.ts, contract-harness.ts, seed exporter, check-sh.sh
tools/dashboard/        progress dashboard (read-only, built from docs)
deploy/                 deploy.sh, rollback.sh, reset-uat.sh, issue-certs.sh, docker-compose.prod.yml, Dockerfile.api/.portal, nginx/
tests/frontend/         Vitest + jsdom suites (projects: admin-web, admin (b), investor-web, onboarding-web, company-web, custodian-web, portal-kit, shared)
docs/                   all documentation (section 10)
legacy-static/, LP/, investee/   archives of the original prototypes
secrets/                GIT-IGNORED: local-stack.env, start-stack.sh, stop-stack.ps1, uat-users.json, logs/
.github/workflows/      ci.yml, pages.yml
```

### 1.3 API modules (`backend/api/src/modules`, mounted in `routes/v1.ts` under `/api/v1`)

| Group | Modules (folder) and mount |
|---|---|
| Identity and platform | `identity` (login, invites, reset), `account-security` (MFA enrolment, sessions, password), `platform` (`/platform/flags`, flags admin), `admin`, `admin-core` (RBAC change requests, settings, audit extras, Copilot, integrations screen), `search` (`/shell`: global search, command palette), `notifications`, `files`, `documents`, `opsctl` |
| Portal-facing | `lp-portal` (`/lp-portal`), `investee-portal` (`/investee-portal`, `/investee-public`), `custodian` (`/custodian`), `kyc` (public onboarding `/onboarding/*`, staff `/kyc`), `investor`, `company`, `clients`, `clients-onboarding` (`/client-ops`: clients 360, investor services, vault, retention schedules) |
| Ops console | `ops` (`/ops`: funds, capital calls, distributions, dealing, notices, term sheets, investee requests, bank instructions), `portfolio` (portfolios, securities, brokers), `orders` (OMS), `risk`, `nav` (valuation), `recon`, `accounting`, `cash`, `corporate-actions`, `ibor`, `performance`, `research`, `private-markets`, `portfolio-lab`, `financing`, `reports`, `regulatory`, `data-fabric`, `model-governance`, `views` (saved views), `imports` (shared CSV/XLSX/JSON import service, S3), `ledger` (LP ledger and FX stamps), `wiring` (operations runbook, Today/Command Centre, auto-journals), `trading-feeds` (contract notes, FIX fills, CA feed), `term-sheets`, `esign`, `ops` docs |
| Integrations routes | `integrations/market-data/routes.ts`, `integrations/custodian-feed/routes.ts` |

Unmatched investee endpoints answer 501 (catch-all near the end of `modules/investee-portal/investee.routes.ts`); new investee routes must be registered before it (T2 fixed a route that was shadowed).

### 1.4 Cross-cutting design

- **Auth and sessions**: `auth/session.ts`; httpOnly session cookie. In production one cookie on the parent domain is shared by portals; outside production each portal has its own `nexus_session_<port>` (F3 fix ADA-004, in `config/cors.ts` and `portal-kit/src/proxy.ts`). Portal access is by role per portal (`requirePortalAccess`); investee users are checked by active `CompanyUser` membership instead. `REQUIRE_AUTH_PORTALS` selects gated portals.
- **MFA and step-up**: TOTP with backup codes. `mfa_required` policy is OFF on UAT (D-33). `MFA_PORTALS` includes custodian. Money actions use `requireStepUp` (window default 5 minutes); with no authenticator enrolled and policy off, step-up is skipped by design (ADA-003 not a defect). Tests that check "no step-up" must age `session.mfaVerifiedAt` first.
- **RBAC**: `prisma/seed/role-catalog.json` (roles, permissions). Roles are separation-of-duties-clean (system administrator is view-only on operations). Seeding is additive and never revokes; retire legacy grants only with `SEED_APPLY_ROLE_RETIREMENTS=1 npx tsx prisma/seed-admin-shell.ts` after assigning `admin:settings_admin`.
- **Maker-checker**: enforced per object (maker id != approver id) with 403 `segregation_of_duties` or `permission_denied`; applies to orders, NAV release, journals, cash journals, recon sign-off, corporate actions, term sheets, capital calls, role creation, staff invites, benchmark points, and more.
- **Audit hash chain**: `lib/audit.ts`. Each event is appended inside the same transaction, `hash = sha256(prevHash + body)`, tail row locked `FOR UPDATE`; a verify routine walks the chain.
- **Outbox and worker**: `lib/outbox.ts`, `outboxClaim.ts`, `worker.ts` (one worker instance on UAT). Notifications, mail, report schedules, retention enforcement, market-data refresh, async IBOR refresh and report jobs run through it. Queue depth and age are on `/api/health?deep=1` and `/api/internal/metrics`.
- **Idempotency and concurrency**: `Idempotency-Key` header on mutating routes (`lib/idempotency.ts`, `idempotent('name')`), `If-Match` / `version` optimistic locking (409 `version_conflict`).
- **Validation envelope**: `middleware/validate.ts` returns readable `fieldErrors`; investee uses an NVCCZ envelope.
- **Pagination**: `middleware/paginate.ts`, `STAFF_LIST_PREFIXES`; `sqlPage`/`pageEnvelope` for SQL paging with `total` (S8). About 400 handlers are still cap-only (list in ADMIN-REAL-PAGES, Package S8).
- **Settings enforcement**: `lib/settings.ts`, `lib/policy.ts`, `lib/portal-flags.ts` (flags: env defaults merged with admin overrides, 5 s cache).

### 1.5 Integrations adapter layer (`backend/api/src/integrations`, WP-8)

Typed registry with a call log, `/ops/integrations` screen. Each adapter folder has `fake.ts`, `live.ts`, `index.ts`, `types.ts`. A mode flag per adapter is `INTEGRATION_<NAME>` (name upper-cased, dashes to underscores), built in `config/env.ts` from `integrations/core/names.ts`.

- Modes: `fake` (simulation, default for most), `live` (vendor stub: throws `NotConfiguredError` naming missing env vars, built by `liveStub`), plus real modes `native`, `public`, `file-drop`, `local`, `s3`.
- **Production guard**: the API refuses to start in production when any integration is `fake` unless `ALLOW_FAKE_INTEGRATIONS=1`. UAT sets it (D-04, in `/opt/matanho-nexus/.env.production`, backup `/root/env.production.bak-rc9`).
- Real modes shipped: esign `native` (default), object-storage `local|s3|fake` (default `local`), market-data `fake|public|live`, custodian-feed `file-drop|fake|live`, broker-routing `fake|file-drop|live`, email via SMTP when `SMTP_HOST` is set.

Full per-vendor table is in section 9 P3.

---

## 2. Chronological narrative of the engagement

Dates are in the 1-4 Oct 2026 window (docs and commits). The engagement started from the V56 static prototype package and ended with the S1-S8 packages. Source for commit hashes: `git log --oneline` (219 commits at HEAD).

### Round 0: foundation (commits 8bf1571 to ee87cc4)
- Original V56 static package restructured into five Next.js portals around a shared Express/Prisma API with shared auth (`0adef6f`; `main` still points here). Legacy prototypes preserved byte-for-byte through `packages/legacy-runtime`.
- Baseline: Phase 1 API, new LP and Investee portals, **SRD v2** (`docs/SRD.md`, `docs/srd/*`) and the one-day plan (`docs/DEV-PLAN-1DAY.md`).
- Eight parallel workstreams on branches `ws/1-lp-core`, `ws/2-capital`, `ws/3-investee`, `ws/4-custodian`, `ws/5-lp-ui`, `ws/6-investee-ui`, `ws/7-ops-console`, `ws/8-deploy-qa` (WS0 day-one migration and stubs first). Delivered: LP documents/vault/e-sign, notices, service requests, notifications and realtime; capital calls, distributions, dealing, step-up; investee contract, term sheets, shared company pack; custodian executions and day-end packages with server hash and approval SoD; V65 onboarding mapping; credentialed LP client, runtime domain flags, demo ribbon; native `/ops` console; Mailpit, deploy/rollback scripts, UAT seed exporter and smoke suite S1-S12. All merged to dev (`ee87cc4` hand-over, decisions D-10..D-32 in `docs/DECISIONS-NEEDED.md`).
- Portal swaps and login gating (portals moved to new UIs behind login), custodian domain, domains on HTTPS (host nginx plus certbot).

### Round 1: UAT cut and journeys (e1c80ee to 197e443)
Local gap closing (onboarding resume order, bank verification, invites, investee workflows, UAT contract alignment, idempotency race), journey phases P3, P6, P10 verified locally, investee KPI flattening fix, decisions D-33..D-37 confirmed. Cloud-agent re-verify blocked on SSH (no deploy key on that VM). Releases **uat-rc1 and uat-rc2** deployed, smoke 27/0 (`docs/HANDOVER-STATUS.md`, `PROGRESS.md`).

### Round 2: admin real pages (3 Oct)
Native `/ops` pages with backend modules, flow scripts, seeds and docs (each described in `docs/ADMIN-REAL-PAGES.md`). Delivered by parallel worktree agents merged into `feat/admin-recon-nav`:
- Portfolio foundation (portfolios, securities, prices, positions, brokers, FX), Orders (OMS, pre-trade checks, status machine, blotter, ticket), Risk and Compliance (limits, breaches, scenarios, cases, monitor), Reconciliation (runs, breaks workflow, sources, sign-offs, daily sign-off), NAV and Valuation (engine, exceptions, maker review, release). **uat-rc3 failed** (NAV migration contained a captured Prisma banner; repaired, DB restored from backup), **uat-rc4** ok (27/0).
- Accounting and Close, Corporate Actions, Cash and Ledgers; Wiring (orders reserve cash, system-made journals), Operations Control, Command Centre (Today). **uat-rc5** ok.
- IBOR and Positions, Performance and Attribution, Clients/Investor Services/Onboarding and KYC/Document Vault, Research and IC, Private Markets, Portfolio Construction (Lab), Collateral and Financing, Reports and BI, Regulatory Reporting, Data Fabric, Model Governance, Admin Core (RBAC, Settings, Audit, grounded Copilot). **uat-rc6 failed** in seed (IBOR `source_id` VARCHAR too short for composite key; widened to 80), **uat-rc7** ok (27/0).

### Round 3: gap work packages WP-1..8 (3 Oct; `docs/GAP-ANALYSIS.md`)
- WP-1 CI workflow, `npm run verify`, offline rule tests, S13 smoke sweep, live-flag template; first-ever run of the flow scripts (found data-fabric dataset table name 500, corporate-actions write permission, auditor research permission; see `docs/VERIFY.md`). WP-2 orders/cash/private-markets/corporate-action wiring. WP-3 reconciliation depth and operations control. WP-4 admin shell (search, palette, notifications), settings enforcement, security headers and rate limits, idempotency audit. WP-5 investee workspace tables (cap-table transactions with maker-checker, certificates, GL journals, waterfall, forecast locks, board, signature requests, share links, search, access review). WP-6 reports PDF and schedules, data-fabric feeds, model reviews, KYC risk factors, client change requests, vault disposal. WP-7 custodian bulk upload/amend/cancel/history, day-end control totals, legacy admin retirement, LP realtime polling, Playwright smoke file. WP-8 integrations layer.
- Plus: native **e-sign** (`ae208a1`: adapter, pdf-lib, hash chain, certificate, signer pages, `/ops/esign`), **MinIO** object storage service and S3 adapter with migration script (`8a39cc0`), **public-site market-data scraping** with provenance and a **custodian file-drop feed** (`0abc66e`).
- Merge fixes (`96b1a3c`, `7eb93b7`, `2b4cfea`). **uat-rc8 failed** at image build (merge left `next.config.ts` unclosed; nothing changed on the server). **uat-rc9** deployed (WP-1..8, e-sign, MinIO container, market data); the API refused to start until `ALLOW_FAKE_INTEGRATIONS=1` was set (D-04). Smoke **50 pass, 0 fail** (S13 included).

### Round 4: feature packages R4-1..R4-10 (3 Oct)
R4-1 platform remainders (SQL paging, If-Match, maker-checker role create and staff invite, SoD completion, worker/outbox health alerts). R4-2 close gates, payments reconciliation, settlement fails, custody positions via adapter. R4-3 investee remainders (staff review, watermark, e-sign sign-off, mail log). R4-4 e-sign depth (positioned fields, editor, bulk send). R4-5 LP remainder (SSE stream, statements, preferences). R4-6 onboarding portal native. R4-7 custodian portal native. R4-8 Copilot via LLM adapter, onboarding triage, report attachments, regulator receipts. R4-9 settings enforcement, models called by NAV/risk, data-fabric depth. R4-10 contract notes, FIX fills, settlement instructions, CA feed. Merged as `b0e1411`.

### Round 5: browser QA, fix rounds, tests (3-4 Oct)
- **Browser QA** of every portal logged **115 issues** (`docs/issues/ISSUES-admin-a.md`, `ISSUES-admin-b.md`, `ISSUES-investee-onboarding.md`, `ISSUES-lp-custodian.md`; IDs ADA, ADB, INO, LPC; 3 critical, 39 major, 73 minor). Grouped in `docs/issues/FIX-GROUPS.md`, tracked in `docs/STATUS-BOARD.md`.
- **Fix rounds F1..F9** (F1 fund ops/cash; F2 orders/NAV/accounting/risk/Today; F3 personas/auth/shell/roles; F4 market data/integrations; F5 IBOR/performance/lab/private markets/research; F6 clients/services/vault/reports/regulatory; F7 investee portal; F8 LP portal; F9 custodian/onboarding), each with `FIXES-Fn.md`, a supervisor `REVIEW-Fn.md`, then a **rework** commit per group. A watchdog agent (`docs/issues/WATCHDOG.md`) relaunched failed agents (F1-F4 failed at launch with empty agent ids).
- Owner **stopped all browser activity** (D-08, `37668ec`), so everything after is verified without a browser.
- Consolidated outcome in `docs/FIXES-LOG.md`: 95 fixed, 10 not a defect, 8 partially fixed, 1 open, 1 needs decision.
- **API flow triage T1..T3** (`docs/test-runs/TRIAGE-T*.md`, RUN-2026-10-04-fails.txt): 17 failing scripts triaged; real bugs fixed (recon reopen post-commit version check, Command Centre cash double count, investee-review routes shadowed by the 501 catch-all, AI triage for PEP without source of funds rated HIGH); the rest were stale tests updated to the intended behaviour, no rule loosened (D-10). Also a UTF-8 BOM in the `ops_controls` migration stripped (`4340a55`).
- **Frontend Vitest suite** (`7565fe4`): Vitest + jsdom + Testing Library, no browser, regression tests per QA issue; about 1,447 tests before S1-S8; per-portal results in `docs/test-runs/FE-*.md`. UI bugs found by the tests were fixed (onboarding scoring Edit gating, clients cash-account Approve, e-sign inbox without `esign.view`).
- Decision log and TODO updated (`89c5aad`; this is where `dev` and origin/dev point).

### Round 6: plan cross-check and packages S1..S8 (4 Oct)
`b47c65e` audited SRD requirements and business rules against code (`docs/plan-crosscheck/*.md`: ADMIN-A 112 ids, ADMIN-B ~190, LP 113, INVESTEE-ONBOARDING-CUSTODIAN, RULES-1 BR-021..148, RULES-2 BR-149..276). Then eight packages (each has an ADMIN-REAL-PAGES section, a migration where noted, offline/flow/Vitest tests):

| Pkg | Commit | Delivered | Ids closed |
|---|---|---|---|
| S1 | `3cfcc60` | `operations.task.manage`, control-task self-completion block, hand-off notifications, chart click-through, XLSX export, CA stages (instruct, reconcile), in-app reason dialogs; migration `ops_controls` | FR-OPS-010/011/012/013/015, BR-063 |
| S2 | `abb62c0` | recon population gate, accept candidate match, `counterpart_imports` pipeline, CAMT.053/MT940/MT535, sub-ledger-to-GL close gate, cash context bar and explain, tab aria and sort, margin disposition checker | BR-065, FR-REC-006/017, FR-CASH-009/010/017/018/019, FR-FIN-002/004 |
| S3 | `c430d82` | shared import/export framework (preview, dry run, row errors, audit, control totals); orders import, blotter export, margin statement import, risk imports and compliance report, attribution and look-through exports, funds/commitments/valuations import, ledger FX stamps | FR-OMS-010/012/020, FR-FIN-005, FR-RSK-012/013, FR-PERF-005, FR-PM-003, S10 |
| S4 | `1af2a1a` | valuation model with versions, filing import to vault, notes/catalysts/risks, issuer financials, private-markets pipeline and diligence, portfolio filters/saved views/KPIs/evidence, IBOR column chooser, SQL paging, async refresh, chart markers and keyboard | FR-RES-006/007/008/009, FR-PM-002, FR-PORT-009/010/011/015, FR-IBOR-002/004/007, FR-PERF-006/007 |
| S5 | `c970f9c` | STOP_LIMIT and price override, resume-draft prompt, post-trade allocation and contract-note PDF hook, `valuation.run/maker/release`, external NAV variance, NAV history and policy panels, scenario thresholds | FR-OMS-011/018/019, FR-VAL-009/015/017, BR-029 |
| S6 | `180b46d` | LP presentation currency and FX stamps, benchmark points, account number reveal, RESTATED, async report jobs, MFA/sessions/password pages, switcher, sorts, activity PDF, invitation resend, confirm-account and letter upload; Socket.IO deviation D-12 | FR-LP-004/010/018/029/032/033/054/062/072/095/099/102/104, BR-087/091/094/095/096/101/143/152/170/171 |
| S7 | `991f81e` | forecast versions and P&L, drawdown ledger and tranche control, resubmission fingerprint, 48 h SLA queue, VC review and RFQ, reserved matters table, deal stage advance, term sheet reject/void/amend/templates; migration `investee_deals_depth` | BR-208/209/212/218/221/229/230/263/270/272/273, CMP-016/030/035 (API and staff UI only) |
| S8 | `ab3f751` | SQL paging with total on the busiest staff lists, queue metrics, document retention schedules with enforcement and editable tab, Investment pack button, portal flags admin and demo switch, `deploy/reset-uat.sh`; migration `platform_ops_s8` | NFR-PERF-005, NFR-OPS-007, FR-DOC-017, FR-DASH-004/005, S26, 12.6 |

Status at the end of the engagement: S1-S8 are merged on `feat/admin-recon-nav` but **not deployed**, and their flow scripts were run in private UAT-host harnesses by the package agents (S7 67 checks, S8 `test-platform-ops`); the lead's final verification table is in section 3.2 (to be filled in).

---

## 3. Current state

### 3.1 Branches and releases

| Ref | Commit | Meaning |
|---|---|---|
| `main` (and `origin/main`) | `0adef6f` | untouched baseline (restructure commit). Do not work here without the owner. |
| `dev` and `origin/dev` | `89c5aad` at the time of writing | integration branch, **pushed** to origin at the owner's request after the round 5 verification. It does not yet include the cross-check commit and S1..S8 (`feat/admin-recon-nav` is 9 commits ahead: `b47c65e`, `3cfcc60`, `abb62c0`, `c430d82`, `1af2a1a`, `c970f9c`, `180b46d`, `991f81e`, `ab3f751`). The lead intends dev to equal the working branch after the lead pushes; confirm with `git rev-parse dev origin/dev HEAD`. |
| `feat/admin-recon-nav` | `ab3f751` | **working branch** (current checkout). |
| other local branches | | `feat/*`, `ws/*`, `worktree-agent-*`, `worktree-wf_*` are historical agent branches, already merged; leave them alone (cleanup is optional and is the owner's call). No git tags exist. |

Working tree at hand-off: only `.claude/` is untracked.

| Release (UAT server) | State |
|---|---|
| uat-rc1, rc2, rc4, rc5, rc7 | deployed, smoke 27/0 |
| uat-rc3, rc6, rc8 | failed (banner in migration; VARCHAR overflow; broken `next.config.ts`); fixed and superseded |
| **uat-rc9** | **live** (WP-1..8, e-sign, MinIO container, market data); smoke 50 pass / 0 fail |
| **uat-rc10** | **NOT deployed.** Contains round 4, fix rounds, triage fixes, frontend tests, plan cross-check and S1..S8 (new migrations: `20261201100000_ops_controls`, `20261207100000_investee_deals_depth`, `20261208100000_platform_ops_s8` and earlier ones; all additive) |

### 3.2 Final verification results (2026-10-04, final code = feat/admin-recon-nav after S8)

| Check | Result | Notes |
|---|---|---|
| API typecheck (`npm run typecheck`) | PASS | `npx tsc --noEmit` in backend/api: no errors |
| admin-web build | PASS | next build (Turbopack) compiled OK |
| investor-web build | PASS | compiled OK |
| onboarding-web build | PASS | compiled OK (native React) |
| company-web build | PASS | compiled OK |
| custodian-web build | PASS | compiled OK (native React) |
| Frontend test count (`npm run test:frontend`) | 1,612 passed, 0 failed (95 files) | was about 1,447 before S1-S8 |
| API flow scripts pass / fail | 48 scripts: 3,729 checks passed, 0 failed, 0 non-zero exits | run on the UAT host, fresh throwaway schema per script; all 40+ migrations apply cleanly; 4 offline scripts (esign, esign-depth, market-data, object-storage) report 0 DB checks by design |

### 3.3 What is verified, and how

| Evidence | What it covers |
|---|---|
| `npm run verify` / tsc / 5 portal builds (builds in the main checkout, not worktrees) | compile-level correctness |
| 39 API flow scripts on the UAT host in a throwaway schema (before S1-S8) | module behaviour against real MySQL 8.4; all migrations apply to a fresh DB |
| Vitest suite (about 1,447 tests before S1-S8) | frontend flows with mocked API (jsdom) |
| uat-rc9 smoke S1-S13 (50/0) | read-only checks of the live UAT stack |
| NOT verified: any real-browser behaviour | visual/CSS, real cookies across portals, file choosers/downloads, date pickers; see section 9 P1.3 |

---

## 4. How to run and verify

### 4.1 Local stack (docs/LOCAL-STACK.md)
Uses local Windows MySQL 8.4 service (`127.0.0.1:3306`, database `matanho_local_stack`), fake/native/local integrations, flags live, no MFA.
- Config: `secrets/local-stack.env` (git-ignored, has DB credentials; do not print it). Logs: `secrets/logs/`.
- Start (Git Bash, repo root): `bash secrets/start-stack.sh`. Stop (PowerShell): `powershell -File secrets/stop-stack.ps1`.
- Migrations and seeds: from `backend/api`, `set -a; . ../../secrets/local-stack.env; set +a`, then `npx prisma migrate deploy` and `npx tsx prisma/<seed>.ts` (seeds are idempotent: seed, seed-uat with `SEED_UAT_CONFIRM=1`, portfolio, nav, accounting, cash, corporate-actions, orders, risk, reports, research-privates, market-data, ibor-performance, integrations, admin-core, admin-shell, clients-onboarding, investee-workspace, custodian-ops, recon, esign, wiring, investee-deals, platform-ops ...).
- Test personas and where their passwords live: `secrets/uat-users.json` (git-ignored; fields `persona`, `email`, `password`; emails `<persona>@uat.matanho.test`). Persona names: admin `local_admin`, `sysadmin`, `client_services`, `compliance`, `investment_director`, `operations`, `analyst`, `test_portfolio_manager`, `test_dealer`, `test_approver`, `test_fund_accountant`, `test_compliance`, `test_settings_admin`; LP `lp_a_manager`, `lp_a_signatory`, `lp_a_viewer`, `lp_b_signatory`; investee `investee_101_approver/contributor/viewer`, `investee_102_admin`; custodian `custodian_submitter`, `custodian_approver`, `test_custodian_approver`. Do not print passwords.
- Use hostname `localhost` only (not 127.0.0.1) if a browser is ever used.
- Prisma generate fails or hangs while a local API process holds the query-engine DLL: stop the API first.

### 4.2 Static and offline checks (no database)
- `npm run verify` (root): prisma validate and generate, tsc for shared/api/legacy-runtime/portal-kit, tsc for all five portals, offline rule tests, shell syntax check (`tools/uat/check-sh.sh`).
- `npm run typecheck`, `npm run typecheck:portals`, `npm run test:offline`.
- Portal builds: `npm run build -w @matanho/<admin-web|investor-web|onboarding-web|company-web|custodian-web>`. **Always run these after merges**: tsc does not catch `next.config.ts` breakage or stale `.next/types` after removing pages (delete `portals/<x>/.next` if types refer to removed pages). Run in the main checkout: worktrees without `node_modules` make Turbopack builds fail (fallback `next build --webpack`).
- Frontend: `npm run test:frontend` (all projects), or `npm run test:frontend:admin|investor|onboarding|company|custodian|portal-kit|shared`. See `tests/frontend/README.md`.

### 4.3 API flow scripts
- Local: `DB_ROOT_URL=mysql://root:<pw>@127.0.0.1:3306 bash tools/uat/run-flows.sh [script ...]` (fresh schema per script). Rules in `docs/VERIFY.md`: `NODE_ENV=development`, restart the API between scripts (rate limiter), same `STORAGE_DIR` and `PUBLIC_API_URL` for API and script, a fresh schema per script, seeded personas for `test-local-gaps` and `test-investee-workspace`.
- On the UAT host (the usual way, because local MySQL is slow to set up): `bash tools/uat/server-flows.sh` as root in `/opt/matanho-nexus`; it creates throwaway schema `nexus_wp1_test`, a temporary API container on the compose network, and never touches live data. Results: `/root/wp1-run/summary.txt`, per-script logs `/root/wp1-run/<script>.log`. A copy of the script lives on the server as `/root/server-flows.sh`.
- `/root/mkimg.sh` on the server builds the tester image `nexus-wp1-img` **with a regenerated Prisma client**. The UAT-host test image has a stale Prisma client unless regenerated, which makes new tables look missing.
- Private copies per agent: when several agents test at once, each uses its own copy of the harness (own schema name, own source dir such as `/root/wp1-src-<tag>`, own output dir) so they never share the throwaway database. Package agents S7/S8 used tags `s7`/`s8`.
- Full procedure: `docs/VERIFY.md`, `docs/test-runs/TRIAGE-T1.md`.

### 4.4 Progress dashboard (`tools/dashboard`)
From the repo root: `node tools/dashboard/server.mjs 47931` (static, 127.0.0.1 only) and `node tools/dashboard/build-status.mjs --watch 120` (regenerates `status.json` every 120 s from STATUS-BOARD.md, TODO.md, issues docs, DECISION-LOG, git worktrees, agent journals; `manual-status.json` holds lead overrides). Open http://127.0.0.1:47931/. Details in `tools/dashboard/README.md`.

---

## 5. How to deploy (UAT server)

Deploys are manual, from the owner's machine, to the UAT box. Do them only when the owner has asked.

1. **Build the tarball** (committed files only; excludes node_modules, .next, dist, .env*, secrets). `tools/uat/pack-release.ps1` **must be run through PowerShell; it fails from Git Bash**:
   `powershell -ExecutionPolicy Bypass -File tools/uat/pack-release.ps1 -Ref HEAD -Release uat-rc10`
   Output: `%TEMP%\nexus-release\uat-rc10.tar.gz` plus `.sha256` and `.manifest.txt`. Commit everything you want shipped first; untracked files are not included.
2. **Copy**: `scp` the tarball (and `.sha256`) to `root@207.180.234.151:/root/nexus-releases/` (key `~/.ssh/id_ed25519`).
3. **Place the deploy scripts** for this release: extract `deploy/deploy.sh` and `deploy/rollback.sh` from the tarball into `/root/nexus-releases/<rel>/deploy/` (for example `tar -xzf /root/nexus-releases/<rel>.tar.gz -C /root/nexus-releases/<rel> deploy/deploy.sh deploy/rollback.sh`). On a Windows machine, tar with a `C:` path treats it as a host, so use `/c/...` POSIX paths there.
4. **Run detached**:
   `SEED_UAT=1 DETACH=1 bash /root/nexus-releases/<rel>/deploy/deploy.sh <rel> api worker admin investor onboarding company custodian`
5. **Watch** `/root/nexus-backups/<rel>/deploy.log` with a background poll (`ssh -n -f` plus `setsid nohup` for any detached remote job; never block a foreground tool on it). `build.log` is in the same folder.
6. What the script does: mysqldump plus file-store snapshot to `/root/nexus-backups/<rel>/`; tags running images `:pre-<rel>` (first run only); backs up and replaces source dirs (never touches `.env.production` or `secrets/`); builds images; runs the `migrate` job (prisma migrate deploy + seed.ts), optional UAT seed; `up -d --no-deps` of the named services (one worker); smoke suite; **auto-rollback on smoke failure** (`AUTO_ROLLBACK=1` default, D-30). Knobs: `SKIP_BACKUP SKIP_EXTRACT SKIP_BUILD SKIP_MIGRATE`, `SEED_UAT_MFA_REQUIRED=1`, `SMOKE=0`, `SMOKE_MODE=readonly|full`, `AUTO_ROLLBACK=0`, `RELEASE_TARBALL=<path>`.
7. **Rollback**: `bash /root/nexus-backups/<rel>/rollback.sh [--flags-off] [--restore-code] <rel> <service...>` (retags `:pre-<rel>` images; schema is additive so no down-migration). DB restore is deliberately manual: `RESTORE_DB=1 RESTORE_DB_CONFIRM=<rel>`. Backups: `/root/nexus-backups/<rel>/` (db.sql.gz, file snapshot, code, logs).
8. **Smoke** (read-only S1-S13; run by deploy.sh; manual run: `tools/uat/smoke.ts` with `SMOKE_API` and a persona users file; header of the file lists the variables). Expected for rc9: 50 pass, 0 fail; rc10 adds checks, so expect more.
9. **Host nginx** is not touched by deploy. deploy.sh prints a diff warning if `deploy/nginx/matanho-nexus.conf` changed; apply by hand: edit, `nginx -t`, then `systemctl reload nginx`. certbot owns the live TLS config. Domains: nexus.matanho.com (admin), investor.nexus.matanho.com, onboarding.nexus.matanho.com, company.nexus.matanho.com, custodian.nexus.matanho.com (DNS and SSL done). `deploy/issue-certs.sh` issues certs.
10. **Production fake-integrations guard**: the API refused to start with fake integrations until `ALLOW_FAKE_INTEGRATIONS=1` was set in `/opt/matanho-nexus/.env.production` (backup of the earlier file: `/root/env.production.bak-rc9`). It is already set on UAT; keep it until real vendors exist.
11. Reset of UAT data (not installed, not scheduled, never run): `deploy/reset-uat.sh` (reseed or restore baseline dump, dumps first, deploy lock, confirm env var).
12. Before every deploy check migrations: first bytes must not be a UTF-8 BOM, and SQL must not contain a Prisma banner (section 8).

After deploying uat-rc10 update `docs/TODO.md` (releases table) and tell the owner.

---

## 6. Environments and access (no secrets here)

| Item | Value / location |
|---|---|
| UAT server | `207.180.234.151`, ssh as `root` with key `~/.ssh/id_ed25519` (owner's machine) |
| Project dir / compose project | `/opt/matanho-nexus`, project `matanho-nexus`, file `deploy/docker-compose.prod.yml` |
| Env file (secrets, flags) | `/opt/matanho-nexus/.env.production` (never print, never commit) |
| Server user secrets | `/opt/matanho-nexus/secrets/users.json` (used by `SEED_UAT=1`) |
| UAT credentials (owner) | only in `C:\Users\lysp\Downloads\nexus-uat-credentials.txt` on the owner's machine |
| Local personas | `secrets/uat-users.json` (git-ignored) |
| Other projects on the box | e.g. `nts-property-os`, and others: **never touch them** (no restarts, no prunes, no nginx changes beyond this project's vhost) |
| Mail on UAT | Mailpit, not public; read via an SSH tunnel to port 8025 on the host (D-34) |
| MinIO | container `matanho-nexus-minio-1`, console `127.0.0.1:19101`, buckets `nexus-documents`, `nexus-esign`, `nexus-exports`. The app is still on **local** storage (`INTEGRATION_OBJECT_STORAGE` default `local`). Switching to s3 and migrating existing files with `backend/api/scripts/migrate-storage-to-s3.ts` is NOT done. |
| Host nginx | `deploy/nginx/matanho-nexus.conf` plus certbot; `nginx -t` before any reload |
| GitHub | `https://github.com/odlemon/matanho-nexus.git`; CI workflow exists but has never run |
| Old Traefik box | retired (owner's memory note); prod-like UAT is the single box above |

---

## 7. Owner's standing rules and preferences

1. **No browser testing or browser actions** (token cost, D-08). Items that would need a browser are recorded as "not browser-verified". Use tsc, builds, Vitest (jsdom), API flow scripts, direct endpoint calls.
2. **Keep outputs lean** (no long logs in replies; summarise).
3. **Long tasks get their own branch**; small tasks go on main-line with a quick deploy (owner memory note on branching workflow).
4. **Never push or force-push unless the owner says so.** `dev` was pushed once at the owner's request after verification (D-07).
5. **Never commit** `.env*`, `secrets/`, credentials, user files. Never print or write passwords, keys or tokens; refer to where they live.
6. **Use unusual free local ports** for anything you start (the local stack uses 48211-48225, the dashboard 47931).
7. **Do not touch other projects** on the UAT box.
8. **Restart host nginx only after `nginx -t`.**
9. **Decide autonomously**; log every decision in `docs/DECISION-LOG.md` (next number is D-13; D-12 is the SSE-versus-Socket.IO decision). Rule used: 1) plan, specs, guides in the repo; 2) existing code patterns; 3) simplest option that is easy to change later. Only irreversible or data-deleting steps are skipped and logged.
9b. Decisions that need the owner go in `docs/DECISIONS-NEEDED.md` with the interim choice taken.
10. **Fix root causes; never weaken tests** to get green (D-10). A stale test is updated to the intended behaviour, a business rule is never loosened.
11. Severity mapping: **blocker = critical, polish = minor** (D-05).
12. Update `docs/TODO.md` in the same commit as the work.
13. Commits: only when the owner or the task asks. The lead agent normally commits and merges.

---

## 8. Hard-won traps and how to avoid them

| # | Trap | What happened | How to avoid |
|---|---|---|---|
| 1 | UTF-8 BOM in a migration | MySQL rejected `ops_controls` migration (`4340a55`) | write SQL without BOM; check `head -c3 file \| xxd`; PowerShell `Out-File`/`>` add a BOM, use Write/Edit tools or `[IO.File]::WriteAllText` with `UTF8Encoding($false)` |
| 2 | Prisma update banner in migration SQL | uat-rc3 failed: output redirect captured the "Update available" banner | capture **stdout only** from `prisma migrate diff`, then `grep -n 'Update available\|pris.ly\|npm i' migration.sql` must find nothing |
| 3 | VARCHAR overflow in composite keys | uat-rc6 seed failed: IBOR `source_id` 73-char key in a VARCHAR(64) (widened to 80, `675a402`) | compute the longest composite key and size columns with headroom; seed with realistic ids |
| 4 | Parallel branches append to `schema.prisma` and `role-catalog.json` | textual conflicts every merge | each package wraps its models in `// ---- Name ----` ... `// ---- end Name ----` markers. Merge script pattern: extract each marked block from every branch, 3-way merge the remainder (git merge-file against the common base), then re-insert the blocks once each and `prisma validate`. The role catalog is JSON: merge semantically (union roles and permissions by key, union per-role permission lists, never drop a grant) and re-validate with `tools/ws0-role-catalog.mjs` conventions. Do not just delete conflict markers |
| 5 | Duplicate column in two migrations | two packages added the same column | grep all migrations for `ADD COLUMN <name>` before merging; dedupe (`96b1a3c`) |
| 6 | `next.config.ts` broken by a merge | uat-rc8 image build failed; tsc did not notice | always run `npm run build -w @matanho/<portal>` after merging, not only tsc |
| 7 | Windows tar paths | `tar` with `C:\...` treats `C` as a remote host | use `/c/Users/...` POSIX paths in Git Bash tar and scp; Node wants `C:/...` |
| 8 | `pkill -f` killing the shell | the pattern matched its own ssh command line | use `[s]pattern` style patterns and run the kill in a separate call |
| 9 | Detached remote jobs | foreground ssh hung or died with the tool | `ssh -n -f host 'setsid nohup bash script > log 2>&1 &'` then poll the log |
| 10 | Prisma generate fails or hangs | a local API holds the engine DLL | stop local API/stack first |
| 11 | Stale `.next/types` | removed pages still referenced by generated types | delete `portals/<x>/.next` and rebuild |
| 12 | Worktrees without `node_modules` | Turbopack rejects the `node_modules` junction, builds fail | build in the main checkout, or `next build --webpack` as a fallback |
| 13 | Launching many worktree agents at once fails | F1-F4 failed at launch with empty agent ids | batches of 4-5, stagger launches |
| 14 | Network drops kill long agents | work lost mid-way | relaunch continuing from partial files (check worktree diff first) |
| 15 | Shell backticks inside `node -e` | corrupted template strings | write a temp `.mjs` file instead of inline `node -e` with template literals |
| 16 | UAT-host test image stale Prisma client | new tables reported missing in flow runs | rebuild with `/root/mkimg.sh` (regenerates the client) |
| 17 | `pack-release.ps1` from Git Bash | fails | always `powershell -ExecutionPolicy Bypass -File ...` |
| 18 | Production fake-integration guard | uat-rc9 API would not start | `ALLOW_FAKE_INTEGRATIONS=1` in `.env.production` (UAT only) |
| 19 | Flow scripts and the login rate limiter | 30 attempts per 15 min per IP in production mode | `NODE_ENV=development` and restart API between scripts |
| 20 | Step-up window in tests | enrolment counts as step-up, so a "no step-up" check passed | age `session.mfaVerifiedAt` past 5 minutes first |
| 21 | Role seeding | destructive retire on every seed removed grants | seeds are additive; retire only with `SEED_APPLY_ROLE_RETIREMENTS=1` |
| 22 | Investee 501 catch-all | later routes shadowed (T2) | register new investee routes before the catch-all |
| 23 | Existing databases keep old seed rows | seed fixes (DAY-DEMO1, NAV-00001) do not rewrite existing rows | note it in the release notes; reseed with `SEED_UAT_RESET=1` on UAT when acceptable (D-35) |
| 24 | Cookie clashes in browsers on one host | sessions overwritten across portals | per-port cookies exist outside production; production uses the parent domain |

---

## 9. What is NOT done (prioritised)

### P0: deploy and switch data live
1. **Deploy uat-rc10** (section 5) and run the smoke suite. Pre-checks: `git status` clean, final verification table (3.2) green, migrations BOM and banner check, `git log dev..HEAD` reviewed. Expect the migrations listed in 3.1. If smoke fails the script auto-rolls back; read `/root/nexus-backups/uat-rc10/deploy.log`.
2. **Turn live-data flags on in UAT** (`docs/GO-LIVE-FLAGS.md`): set in `/opt/matanho-nexus/.env.production` (keep a copy first): `LP_LIVE_DOMAINS=all`, `INVESTEE_LIVE_ACTIONS=all`, `CUSTODIAN_LIVE=true`, `ONBOARDING_LIVE=true`; recreate `api`: `docker compose -p matanho-nexus -f deploy/docker-compose.prod.yml up -d --no-deps api`; confirm `GET /api/v1/platform/flags`. Run `tools/uat/contract-harness.ts` first and flip only domains that PASS. Flags can also be overridden at runtime from `/ops/portal-flags` (S8, needs `admin.settings`, step-up). Rollback: `bash deploy/rollback.sh --flags-off <rel> api`. Then update TODO milestone M9.

### P1: investee portal front end and remaining front-end gaps
**P1.1 company-web screens still on the V8 mock runtime.** The portal pages under `portals/company-web/src/app/(portal)/` (`page` overview, `reports`, `requests`, `cap-table`, `forecasts`, `kpis`, `governance`, `data-room`, `messages`, `signatures`, `terms`, `team`, `settings`) render the runtime script `components/investee-portal-v8-mock/matanho-investee-portal-runtime.js`; individual actions go live per key through `INVESTEE_LIVE_ACTIONS` (`lib/investee/api.ts`), otherwise the Demo data ribbon shows. Native React exists only for `components/WorkspaceTools.tsx` (tabs: cap table, board and forecast months lock/unlock, signature requests, share links, KPIs and export, access and MFA), e-sign signer pages and share pages. Consequently the **S7 features have API only on the company side** (verified by grep: no company-web code references forecast versions, tranche, drawdown or resubmit endpoints; the only forecast UI is month lock/unlock):

| S7 feature | API | Company-web UI | Staff UI (admin `/ops/investee-requests`, `/ops/term-sheets`) |
|---|---|---|---|
| Forecast versions, submit, 409 on stale base, P&L and cash roll-forward (BR-208/209/263) | `POST /investee-portal/forecast/submit`, `GET /forecast/versions[/:n]`, `PUT /forecast` with `cells` and `baseVersion` | **missing** (version history, submit, P&L view, opening-cash entry) | submitted versions readable at `GET /ops/investee-requests/forecasts/:companyId[/:n]`: UI unverified |
| Drawdown ledger and tranche panel, over-draw refusal (BR-229/270/272, CMP-035) | `GET /procurement` returns `tranche`; refusal 409 `tranche_exceeded` | **missing** (tranche panel; the mock shows no tranche; error message not surfaced) | tranche editor at `/ops/investee-requests/tranche/:companyId`: UI present per S7 notes |
| Requisition resubmit and submit saved draft (BR-273) | `POST /procurement/:ref/resubmit`, `/submit` | **missing** (resubmit action, unchanged-fingerprint error) | n/a |
| RETURNED / RFQ_SENT / CONVERTED_TO_PO statuses | yes | **missing** (status chips and actions in requests screen) | Return, Send RFQ, Convert to PO buttons present |
| 48 h SLA queue (BR-230) | `GET /ops/investee-requests/sla`, `slaBreached` on rows | n/a | admin page flags breaches (present) |
| Reserved matters table and notice period (CMP-030, BR-218) | `/ops/investee-requests/reserved-matters/:companyId` | governance screen still lists constants from the mock (**unverified** whether the live payload feeds it) | staff maintenance screen: UI unverified, check `investee-requests/page.tsx` |
| Compliance health (BR-221) | in governance metrics | **missing** display | n/a |

Also still missing on the investee side (from `plan-crosscheck/INVESTEE-ONBOARDING-CUSTODIAN.md` and S7 notes): CMP-009 production guard forcing live-only (no mock mode in production), CMP-018 .xlsx templates, CMP-021 actuals from accepted reports and server `locked` refusal (unverified), CMP-033 signing-authority staff screen, CMP-036 drill-down on drawdown items, CMP-038 vault download/preview/delete/versioning (INO-021, no API), CMP-044 external-access log from audit events, CMP-046 session timeout on the security card, BR-246/249/250/251/252/254/257..261/271 messages and read-receipts.
Recommended approach: replace the mock screens one by one with native React in `portals/company-web/src/app/(portal)/*`, reusing `lib/investee/api.ts` call helpers and `WorkspaceTools.tsx` patterns, with Vitest tests in `tests/frontend/company-web/`; start with requests (resubmit, tranche, RFQ states) and forecasts (versions, P&L), then governance (reserved matters, compliance health).

**P1.2 Plan cross-check items still PARTIAL or MISSING.** Source files: `docs/plan-crosscheck/*.md`. S1-S8 closed the ids listed in section 2 (round 6 table). Remaining, by group (re-verify against code before starting; the audits were static and several are marked unverified):

| Group | Open ids (not closed by S1-S8) |
|---|---|
| ADMIN-A (FR-CASH, FIN, IBOR, OMS, OPS, PERF, PM, PORT, REC, RES, RSK, VAL) | FR-PORT-013 (optimiser job with as-of), FR-VAL-011 (document link and independent override approver), FR-VAL-014 (link exception to recon break and ops task), FR-VAL-016 (generated PDF evidence documents); S1-S8 left "not done" notes: instruct does not transmit to a custodian (FR-OPS-015), reusable proceeds not modelled in explain (FR-CASH-010), research valuation is DCF only, import caps 2000 rows and 60 columns, imports create LIMIT drafts without the 10% override rule |
| ADMIN-B (CLI, INV, DOC, UI, RBAC, DASH, AUD, AUTH, PLAT, MOD, DATA, NFR) | NFR-AV-005 multi-worker proof; FR-DASH-002/003 chart range selector and KPI tones; FR-UI-002 server-side nav collapse stored per user; FR-UI-003 shell health line naming the degraded integration; FR-UI-008 shared accessible dialog, max 4 toasts, last `window.prompt` usages; FR-UI-010/011 and FR-PLAT-001 `?layer=` URLs and "Record not found"; FR-AUTH-018 custodian MFA UI (S6 added a Security page; verify against requirement); FR-MOD-003 overdue validation chip; FR-CLI-020 "Client portal" action; permission tooltip "Not permitted for <role>" (FR-DOC-013/021, ADB-012, FR-INV-017); FR-DOC-012 evidence-manifest package export; NFR-SEC-009 rate limits (600/min, 30 uploads/min) verify; FR-DATA secrets by reference and test history; DEF-525/526/527/530/531 (audit gaps, investor scope on docs/threads, multi-company switch, KYC dual-control gap, funds approval step); BR-067 per-family recon tolerance effective dating (partly built); broader recon feeds API pull; remaining unpaged lists (orders, trades, cash movements, journals, research notes, audit explorer, notifications, e-sign envelopes, import batches, market-data series) |
| LP | FR-LP-055/064/073 dedicated event names (`lp_dealing_updated`, `lp_document_published`, capital event) are delivered as generic notifications (D-12 keeps SSE, verify event vocabulary), FR-LP-058 staff dealing status transitions and maker-checker on unit allocation (unverified), FR-LP-096 staff verification task/maker-checker for bank change (unverified), FR-LP-042 real virus scanner (adapter), FR-LP-082 Socket.IO (decision D-12, kept SSE); S6 left: QR image for the authenticator, no admin screen for benchmark points (API only), history chart converts only when all funds convert at one rate |
| INVESTEE-ONBOARDING-CUSTODIAN | CMP ids above in P1.1; ONB-022 (due date, escalation, channel persisted), ONB-023 (suitability inputs, mandate donut), ONB-024 (dual-control warning text), ONB-026 (case-pack export with manifest and hashes), ONB-029 (typed columns for step-1 fields), ONB-032 (typed tax and funding fields, draft bank account), ONB-033 (slot catalogue help and accepted types), ONB-034 (server OCR), ONB-038 (IP and user agent on declaration), ONB-040 (receipt email on submit), 5E custodian SWIFT/API feed (adapter), 5E day-end validation beyond trade count |
| RULES-1 (BR-021..148) | 128 rows: 56 BUILT, 64 PARTIAL, 6 MISSING, 1 adapter at audit time; S8 states PARTIAL rows were not touched, except those named in S1-S8 (BR-029, 063, 065, 078, 087, 091, 094, 095, 096, 101, 143). Re-read the file and pick by value |
| RULES-2 (BR-149..276) | 128 rows: 63 BUILT, 51 PARTIAL, 12 MISSING, 1 adapter at audit time; closed since: BR-152, 170, 171, 208, 209, 212, 218, 221, 229, 230, 263, 270, 272, 273 (S6, S7). Re-read the file and pick by value |

(RULES-1 and RULES-2 lists are long, and only counts are repeated here on purpose; open the files for the full id list.)

**P1.3 "Not browser-verified" list** (`docs/FIXES-LOG.md` section 5, `docs/test-runs/FE-*.md` "Cannot be verified without a browser"): visual and CSS (ADA-030 drawer overlap, ADB-026 mobile drawer, ADB-028(a) dropdown wrap, ADA-026 overdue colouring, charts); real cookies across portals (ADA-004, LPC-001, session redirects ADA-005 and LPC-019); native widgets (file choosers and downloads ADB-016, INO-014, INO-021, INO-023; date pickers; `window.prompt` is replaced in operations tasks by S1); critical items by code reading only (LPC-017 amend dialog, "not a defect, with doubt"; LPC-022 API fix without UI test; ADA-015 covered only with a mocked API); INO-017 MFA enrol then sign needs an end-to-end test; ADA-011 root cause (a transient DB drop) cannot be reproduced. All S1-S8 UI is likewise not browser-verified. When the owner allows a browser pass, start with this list.

**P1.4 Remaining PARTIAL / open / needs-decision issues from `docs/FIXES-LOG.md`** (section 4 there):
- Partially fixed: ADA-023 (existing `CC-AGFI-0xx` refs need data migration), ADA-026 (period-label inconsistency orphaned in `company.service.ts` and demo JSON), ADA-009 (no background scheduler for the risk monitor), ADB-012 (clients drawer hold/owner/review-date and "New client" hidden without `clients.edit`), ADB-028 (shell details), ADB-019 (12 securities without ISIN; real ISINs not fabricated), INO-021 (vault download/preview/delete has no API), LPC-024 (legacy "Signature required" actions have no native inbox entry).
- Open: ADA-005 (slow hard navigation, dev-mode compile; re-check 401s), ADB-006 (stale price history needs data work), ADB-013 hard-coded holder name `Matanho Managed Funds` in `modules/clients/clients.routes.ts`, review points not re-reviewed by a supervisor after the rework commits.
- Needs decision: INO-029 (resume returns to step 1; S-packages may have changed this, verify), ADA-022 (store allocation method on the call, schema change), vault numbering `LP-DOC-` versus `DOC-`, existing databases keeping old seed rows (DAY-DEMO1, NAV-00001).
- Note: FIXES-LOG section 4 also lists "T1..T3 triage fixes not merged" and "tester product fixes uncommitted"; those are stale: the triage commits and the Vitest commit (`7565fe4`) are merged on `feat/admin-recon-nav`. Verify with `git log --oneline | grep -E "T1:|T2:|T3:|Frontend test suite"`.

### P2: infrastructure
- **Switch the app to MinIO**: MinIO is running on the UAT box with the three buckets. Set `INTEGRATION_OBJECT_STORAGE=s3` plus `STORAGE_S3_ENDPOINT`, `STORAGE_S3_ACCESS_KEY`, `STORAGE_S3_SECRET_KEY` (and optionally bucket names, `STORAGE_S3_REGION`) in `.env.production` (credentials are in the server env / MinIO container env; do not print), migrate existing files with `backend/api/scripts/migrate-storage-to-s3.ts` (run in a throwaway first), verify downloads and e-sign certificates, keep the local store as backup. Health status is shown at `/ops/integrations`.
- **GitHub Actions CI** (`.github/workflows/ci.yml`: job `verify` = prisma validate/generate, typechecks, offline tests, UAT harness typecheck; job `flows` = MySQL 8.4 service plus `run-flows.sh`) has **never run on GitHub**. It triggers on push to `main`, `feat/**`, and pull requests. Expect first-run fixes (Node 22, workspace install, flow runtime). `pages.yml` is a separate Pages workflow, unverified. Do not push to trigger it without the owner's say.
- Decide whether to add the frontend Vitest suite to CI (not in ci.yml at the time of writing: **unverified**, read the file).
- Install or schedule `deploy/reset-uat.sh` only if the owner wants periodic resets.
- Scheduler for the risk monitor (ADA-009) and other background jobs beyond the outbox worker (decision needed).
- Multi-worker idempotent delivery proof (NFR-AV-005).

### P3: real vendor integrations behind adapters
Every adapter lives in `backend/api/src/integrations/<name>/` (`types.ts` declares the interface and `meta`, `fake.ts` the simulation, `live.ts` the vendor stub). Flag: `INTEGRATION_<NAME>`. Selecting `live` with the env vars missing yields `NotConfiguredError` naming them (visible on `/ops/integrations`). Replace `live.ts`, keep the interface, add a contract test against the fake.

| Integration | Folder | Flag (`INTEGRATION_...`) | Today | What the live stub needs (env vars and calls) |
|---|---|---|---|---|
| Market data feed | `market-data` | `MARKET_DATA` (`fake`/`public`/`live`) | `public` scrapes free sites with provenance; worker refresh; bounded `simulate` for fake only | `MARKET_DATA_LIVE_BASE_URL`, `MARKET_DATA_LIVE_API_KEY`; implement the four adapter methods in `live.ts` against the licensed vendor (Bloomberg, Refinitiv, ZSE Data Direct or similar) |
| Custodian feed | `custodian-feed` | `CUSTODIAN_FEED` (`file-drop`/`fake`/`live`) | file-drop upload (CSV/JSON; MT940, MT535, CAMT.053 parsers from S2) | `CUSTODIAN_FEED_SWIFT_BIC`, `_SWIFT_ENDPOINT`, `_SWIFT_CERT`, `_API_BASE_URL`, `_API_KEY`; SWIFT MT535/536/940 over Alliance Access or a service bureau, or the custodian REST API |
| KYC / AML screening | `screening` | `SCREENING` | fake | `SCREENING_API_URL`, `SCREENING_API_KEY` (sanctions/PEP screening call) |
| Identity verification | `identity-verification` | `IDENTITY_VERIFICATION` | fake | `IDV_API_URL`, `IDV_API_KEY` |
| Payments / bank | `payment`, `bank-statement` | `PAYMENT`, `BANK_STATEMENT` | fake | `PAYMENT_API_URL`, `PAYMENT_API_KEY`; `BANK_STATEMENT_HOST`, `BANK_STATEMENT_USER`, `BANK_STATEMENT_KEY` (statement pull; CAMT.053 parser exists in cash) |
| Email | `email` | `EMAIL` | `live` is real SMTP when `SMTP_HOST` is set (Mailpit on UAT) | `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_SECURE`; an SES/SendGrid HTTP client would replace `send` |
| SMS / OTP | `sms` | `SMS` | fake | `SMS_API_KEY`, `SMS_SENDER_ID` |
| SSO | `sso` | `SSO` | fake | `SSO_ISSUER_URL`, `SSO_CLIENT_ID`, `SSO_CLIENT_SECRET` (OIDC) |
| LLM (Copilot, onboarding triage) | `llm` | `LLM` | fake rule-based (grounded keyword router, rule triage) | `LLM_API_KEY`, `LLM_MODEL`; advisory only, must never decide |
| E-sign vendor (optional) | `esign` | `ESIGN` (`native`/`fake`/`live`) | `native` (open source, pdf-lib, hash chain, certificate) is the real default | optional hosted vendor: implement `live.ts` seal, verify chain, envelope delivery |
| Broker routing / FIX | `broker-routing` | `BROKER_ROUTING` (`fake`/`file-drop`/`live`) | file-drop contract notes and fills (R4-10) | `BROKER_FIX_HOST`, `BROKER_FIX_SENDER_ID`, `BROKER_FIX_TARGET_ID` (FIX session) |
| Regulator filing | `regulator-filing` | `REGULATOR_FILING` | fake (internal layouts and receipts) | `REGULATOR_API_URL`, `REGULATOR_API_KEY` |
| Malware scanner | `av-scan` | `AV_SCAN` | fake (flags test signatures) | `AV_SCAN_HOST` (ClamAV or similar) |
| Object storage | `object-storage` | `OBJECT_STORAGE` (`local`/`s3`/`fake`) | `local` default; `s3` implemented (MinIO) | see P2 |

(Flag names are derived by `integrationEnvKey`: upper-case with dashes as underscores.)

### P4: decisions waiting for the owner
`docs/DECISIONS-NEEDED.md` (D-01..D-37 interim choices confirmed 2 Oct) and `docs/DECISION-LOG.md`. Open items: LP realtime uses **SSE and polling, not Socket.IO** (D-12 in DECISION-LOG: the requirement FR-LP-082 asks for Socket.IO; keep SSE unless the owner overrides); FIXES-LOG needs-decision rows (section P1.4); mandatory MFA in UAT stays off (D-33); whether to delete merged historical branches; vendor choices for P3.

---

## 10. Document map

| Document | What it is for |
|---|---|
| `docs/HANDOFF-NEXT-AGENT.md` | this file |
| `docs/NEXT-AGENT-PROMPT.md` | paste-ready starter prompt for the next agent |
| `docs/TODO.md` | master tracker: milestones M1-M10, releases, WP and R4/S packages, adapters, risks, working rules. Update with every change |
| `docs/STATUS-BOARD.md` | QA issue groups F1-F9 and next stages (partly stale: shows "queued") |
| `docs/DECISION-LOG.md` | decisions made on the owner's behalf (D-01..D-12) |
| `docs/DECISIONS-NEEDED.md` | interim decisions D-01..D-37 from the build and their confirmation |
| `docs/GO-LIVE-FLAGS.md` | the four live-data flags and how to switch them |
| `docs/ADMIN-REAL-PAGES.md` | per-module notes for every `/ops` page: routes, permissions, tests, "Not done" lists; contains Package S1..S8 sections (208 KB) |
| `docs/GAP-ANALYSIS.md` | gap register GAP-xxx, work packages WP-1..8, adapters A01..A13 |
| `docs/FIXES-LOG.md` | consolidated results for the 115 QA issues, open items, not-browser-verified list |
| `docs/issues/ISSUES-*.md` | the 115 raw QA issues; `FIX-GROUPS.md` mapping; `FIXES-F1..F9.md` agent notes; `REVIEW-F1..F9.md` supervisor verdicts; `WATCHDOG.md` agent supervision log |
| `docs/test-runs/TRIAGE-T1..T3.md` | flow-script failure triage; `RUN-2026-10-04-fails.txt` raw run; `FE-*.md` frontend test run reports and "cannot verify" lists |
| `docs/plan-crosscheck/*.md` | static audit of SRD requirements and business rules against code |
| `docs/VERIFY.md` | how to prove the build, flow-script rules, bugs found |
| `docs/LOCAL-STACK.md` | local stack ports, personas, seeds, start/stop |
| `docs/SRD.md`, `docs/srd/*` | requirements (REGISTER.md lists every FR/BR id; 5A-5E per portal; appendix) |
| `docs/BUILD-PLAN.md`, `docs/DEV-PLAN-1DAY.md` | build plan (144 KB) and the one-day UAT plan (deploy section 8) |
| `docs/ARCHITECTURE.md`, `docs/PORTALS.md`, `docs/DOMAIN-ENTITIES.md` | architecture and portal structure (parts predate the native rewrites; the legacy-runtime text describes the original approach) |
| `docs/HANDOFF.md`, `docs/HANDOVER-STATUS.md`, `PROGRESS.md` | earlier workstream hand-off and early verification history (1-2 Oct); historical |
| `docs/CLEANUP-NOTES.md` | legacy archive notes |
| `tests/frontend/README.md` | how the frontend suite is organised |
| `tools/dashboard/README.md` | dashboard commands and data sources |
| `deploy/deploy.sh`, `rollback.sh`, `reset-uat.sh`, `docker-compose.prod.yml`, `nginx/` | deployment (header comments are the manual) |
| `tools/uat/*` | pack-release, run-flows, server-flows, smoke, contract harness, seed data |
| `.github/workflows/ci.yml` | CI definition (never run on GitHub) |
