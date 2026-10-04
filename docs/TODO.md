# Matanho Nexus – master TODO and progress tracker

Single place to see what is done, what is running, and what is left. Update it in the same commit as the work.
Legend: [x] done and deployed · [~] built, merged or in progress, not yet verified on UAT · [ ] not started · [A] adapter (placeholder now, real vendor later)
Deep detail lives in: `docs/GAP-ANALYSIS.md` (GAP-xxx, WP-x), `docs/ADMIN-REAL-PAGES.md` (per-page notes and known gaps), `docs/SRD.md` (requirements), `docs/DECISIONS-NEEDED.md`.

## 1. High level (milestones)

| # | Milestone | State |
|---|---|---|
| M1 | Platform base: API, identity/MFA, audit chain, outbox, 5 portals, deploy pipeline to UAT (207.180.234.151) | [x] |
| M2 | LP portal and Investee portal on new UIs with login gating; custodian + domains on HTTPS | [x] |
| M3 | SRD v2, build plan, handoff docs | [x] |
| M4 | Admin `/ops` real pages: Orders, Risk, Portfolios/Securities, Reconciliations, NAV | [x] deployed (uat-rc4) |
| M5 | Admin `/ops` real pages: Accounting, Corporate Actions, Cash & Ledgers | [x] deployed (uat-rc5) |
| M6 | Admin `/ops` real pages: IBOR, Performance, Research, Private Markets, Portfolio Lab, Financing, Clients, Investor Services, Onboarding, Vault, Reports, Regulatory, Data, Models, RBAC, Settings, Audit, Copilot, Operations, Today | [x] deployed (uat-rc7), flow tests not yet run |
| M7 | Close gaps WP-1..WP-8 (verification, wiring, security, investee tables, custodian/onboarding, integrations) | [x] merged, deployed (uat-rc9), smoke 50/0 |
| M8 | Native e-sign, MinIO object storage, public-site market data, custodian file-drop feed | [x] deployed; MinIO switch still on local mode |
| M9 | Turn live data on for all portals (LP_LIVE_DOMAINS, INVESTEE_LIVE_ACTIONS=all, CUSTODIAN_LIVE, ONBOARDING_LIVE) and run full UAT | [ ] |
| M10 | Real vendors behind adapters (market data feed, custodian SWIFT/API, KYC, payments, email/SMS, SSO, LLM) | [ ] owner supplies accounts later |

## 2. Releases on UAT

| Release | Content | Smoke |
|---|---|---|
| uat-rc1 | portals swap, login, custodian domain | 27/0 |
| uat-rc2 | uat fixes | 27/0 |
| uat-rc3 | failed: NAV migration contained a Prisma banner; repaired, DB restored from backup | – |
| uat-rc4 | Orders, Risk, Foundation, Reconciliation, NAV | 27/0 |
| uat-rc5 | Accounting, Corporate Actions, Cash | 27/0 |
| uat-rc6 | failed in seed (IBOR source_id too short) | – |
| uat-rc7 | all remaining admin pages + wiring, widened IBOR source_id | 27/0 |
| uat-rc8 | failed at image build (merge left next.config.ts unclosed; nothing changed on server) | - |
| uat-rc9 | WP-1..8 + e-sign + MinIO + market data; api needed ALLOW_FAKE_INTEGRATIONS=1 on UAT | 50/0 (S13 sweep included) |

## 3. Work packages (from GAP-ANALYSIS)

| WP | Scope | GAP ids | State |
|---|---|---|---|
| WP-1 | Run the never-run flow scripts on UAT, fix bugs, CI workflow, live-data flags prepared | 001 002 003 022 023 024 026 | [x] deployed, remainders in section 5 |
| WP-2 | Orders reserve cash, PM calls/distributions post to ledgers, CA depth | 004 005 007 010 | [x] deployed, remainders in section 5 |
| WP-3 | More recon families, operations control depth | 006 010 | [x] deployed, remainders in section 5 |
| WP-4 | Admin shell (search, palette, notifications), enforcement of settings, security headers/rate limits, idempotency audit, notification prefs | 008 009 011 014 015 | [x] deployed, remainders in section 5 |
| WP-5 | Investee cap table/forecast/governance real tables | 016 017 | [x] deployed, remainders in section 5 |
| WP-6 | Reports, regulatory, data fabric, models, vault, clients depth | 005 010 012 013 | [x] deployed, remainders in section 5 |
| WP-7 | Custodian bulk/amend, onboarding, retire legacy admin, shared types | 017 018 019 021 025 | [x] deployed, remainders in section 5 |
| WP-8 | Integrations layer (fake/live flags, call log, /ops/integrations) | A01..A13 | [x] deployed, remainders in section 5 |
| E-sign | Native e-sign (pdf-lib, hash chain, certificate, signer flows, /ops/esign) | A07 | [x] deployed, remainders in section 5 |
| Storage | MinIO on UAT box, S3 adapter, migrate existing files | A11 | [x] deployed, remainders in section 5 |
| Market data | Public-site scrapers with provenance, worker refresh, securities screen; custodian file-drop feed | A04 A05 | [x] deployed, remainders in section 5 |

## 4. Adapters (placeholder now, replace later)

| Adapter | Now | Later |
|---|---|---|
| E-sign | native (open source) | optional vendor |
| Object storage | MinIO on UAT server | managed S3 if wanted |
| Market data | free public-site scraping + fake | paid feed (owner to supply) |
| Custodian feed | file-drop upload + fake | SWIFT/API (owner to supply) |
| Email | SMTP/Mailpit | transactional provider |
| SMS/OTP, KYC/AML, payments/bank, SSO, LLM, AV scan, regulator filing, broker FIX | fake (WP-8) | owner decides vendors |

## 5. Known gaps and risks (deep level)

Round 3 (in progress): browser QA of every portal (issues logged only, not fixed) in `docs/issues/ISSUES-*.md`; then fix round. Outstanding feature work is split in round 4 (see section 7).


- New module flow scripts (`backend/api/scripts/test-*.ts`) were written but never executed against a database; WP-1 runs them on UAT.
- Live-data flags still default off, so portals may show demo data until M9.
- Prisma migration hygiene: generate SQL with stdout only and grep for `Update available|pris.ly|npm i` (a banner corrupted uat-rc3). Check VARCHAR widths for composite keys (broke uat-rc6).
- Merging feature branches: append-only shared files; `schema.prisma` and `role-catalog.json` need rebuild/semantic merge, not marker removal.
- Copilot is a keyword router; reports have no PDF output; regulatory filings use internal layouts; several settings are stored but not enforced (WP-4).
- Legacy HTML portals (onboarding, custodian) still run on injected scripts (WP-7).
- Nothing is pushed to GitHub; `dev` is a local branch pointing at the latest merged work.

## 6. Working rules

No browser testing (typecheck, builds and API scripts only) · long tasks on their own branch · never push or force-push without approval · never commit secrets · UAT credentials only in the local credentials file and server secrets · unusual free ports · do not touch other projects on the UAT server · `nginx -t` before any host nginx restart.

## 6b. Round 5 (QA, fixes, tests) status

- 115 browser-QA issues: fixed and merged, see docs/FIXES-LOG.md (46 passed automated tests, 49 fixed awaiting verification, 10 not a defect, 8 partial, 1 open, 1 needs decision at last count).
- Verified without a browser: API typecheck, 5 portal builds, 39 API flow scripts on the UAT host (all pass), 1,447 frontend tests (all pass).
- Not yet deployed: uat-rc10 (round 4 + fixes + tests). Not yet done: turn live-data flags on in UAT.

## 7. Round 4 outstanding feature packages (delegated)

| Pkg | Scope | State |
|---|---|---|
| R4-1 | Admin platform remainders: real SQL paging, If-Match everywhere, role-create and staff-invite maker-checker | [x] built and merged |
| R4-2 | Period-close NAV gate on cash/accounting, positions-vs-custody recon, custodian feed to recon via adapter, payments reconciliation | [x] built and merged |
| R4-3 | Investee: staff-side cap-table screen, watermarking, e-sign sign-off, email adapter delivery | [x] built and merged |
| R4-4 | E-sign: positioned signature fields, pickers instead of raw ids, term sheet and subscription flows | [x] built and merged |
| R4-5 | LP portal remainder: realtime push, performance PDF, notification preferences end to end | [x] built and merged |
| R4-6 | Onboarding portal native React (retire legacy HTML) | [x] built and merged |
| R4-7 | Custodian portal native React (retire legacy HTML) | [x] built and merged |
| R4-8 | Copilot via LLM adapter with live stub, onboarding triage panel, report email attachments, regulator filing placeholders | [x] built and merged |
| R4-9 | Settings enforcement, models called by NAV/risk, data-fabric depth | [x] built and merged |
| R4-10 | Broker contract-note ingestion and order fills, corporate-action announcements from market data | [x] built and merged |
