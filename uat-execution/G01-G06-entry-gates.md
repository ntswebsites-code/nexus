# UAT Entry Gates G01–G06 — Execution Record

**Cycle:** UAT-2026-10-A | **Date:** 11 October 2026 (18:44–18:55 UTC) | **Executor:** UAT Lead (session)
**Candidate:** commit `730f3cdf320fe05f7c884c477447e3ab04f31854` (short `730f3cd`) + working-tree deltas | **Version:** 56.1.0 | **Branch:** `feat/original-ui-wiring`

---

## G01 — Candidate frozen: URL, commit, build, archive digest recorded

| Item | Value |
|------|-------|
| API | http://localhost:4100/api — health `{"status":"ok","uptimeSeconds":30,"timestamp":"2026-10-11T18:43:22.785Z"}` (EV-DEP-001-01) |
| Portals | 3100 admin, 3101 investor, 3102 onboarding, 3103 company, 3104 custodian — **all HTTP 200** (EV-DEP-001-01) |
| Commit | `730f3cdf320fe05f7c884c477447e3ab04f31854` (2026-10-08T18:36:46+02:00) |
| Working tree | 16 modified files (+41/−121) + 25 untracked paths — deltas enumerated below |
| Archive digests (SHA-256) | backend-api-src.tar.gz `B4041ADD…1FDF4`; portals-source.tar.gz `A7180066…267AF`; matanho-nexus-dev.tar.gz `F6FF60BD…C271E`; prisma-schema.tar.gz `DC0ED85E…AD273` |
| Live flags | `LP_LIVE_DOMAINS=all`, `CUSTODIAN_LIVE=true`, `ONBOARDING_LIVE=true`, `INVESTEE_LIVE_ACTIONS=all`, `INTEGRATION_EMAIL=live` — verified via `GET /api/v1/platform/flags` (EV-DEP-001-01) |
| CORS | origins `http://localhost:3100..3104` configured at API boot |

**Working-tree delta summary (freeze manifest part 2):** `git diff --stat` = 16 files, +41/−121 across backend integrations/email, mailer, reports.service, worker, admin next.config, custodian statements page; untracked includes `backend/api/src/config/emailConfig.ts`, `deploy/*`, UAT docs and execution artifacts. Sponsor/technical-owner confirmation (DEP-001 step 3) ⬜ pending — required before results count toward acceptance.

**Status: ✅ Passed** (manifest recorded; sponsor confirmation pending as separate DEP-001 step).

## G02 — Environment approved: isolated test partitions, backups, reset procedure

| Check | Result | Evidence |
|-------|--------|----------|
| DB reachable, schema complete | `matanho_nexus` — **43/43 migrations applied** (was **1/43** at session start — corrected this session, see §Corrections) | `prisma migrate deploy` output |
| Investor A partition | CL-00418 Horizon Pension Fund LP (funds FND-AGFI, FND-AEOF) | seed verification query |
| Investor B partition | CL-90001 Kariba Provident Fund | seed verification query |
| Counterparty partition | CP-001 (Test Custodian A) — submitter + approver | seed verification query |
| Company partitions | PC-101 (3 personas), PC-102 (isolation pair) | seed verification query |
| Pre-execution backup | `uat-execution/backups/matanho_nexus_preUAT_20261011.sql` (0.93 MB, SHA-256 `02D1FE8C…1CF5D`) | backup artifact |
| Reset procedure | Documented in F00 + `tools/uat/fixtures/F00_environment_template.json`: re-run UAT loader with `SEED_UAT_CONFIRM=1 SEED_USERS_FILE=secrets/uat-users.json SEED_UAT_RESET=1` | seed-uat.ts header |

**Status: ✅ Passed** — logical partitions exist and are verified; single logical DB, isolation enforced by scoping (proven at runtime by IAM-003/IAM-006).

## G03 — Concurrency/response-time targets approved

p95/concurrency targets **defined** in `tools/uat/fixtures/F00_environment_template.json`: p95 page load 2,000 ms; p95 API read 500 ms; p95 API write 1,000 ms; 25 concurrent users.

**Status: ⚠️ Conditional** — values are PROPOSED, business-owner approval outstanding. Blocks NFR-001–NFR-009 execution only (Wave 3), not Wave 1.

## G04 — Timezone, policy references, recovery objectives documented

In `F00_environment_template.json`: timezone Africa/Harare (CAT, UTC+2, evidence in UTC); cycle UAT-2026-10-A; policies (`mfa_required=false` verified against seeded Policy rows); recovery objectives RPO 15 min / RTO 60 min; backup/snapshot procedures.

**Status: ✅ Passed**

## G05 — 22 test identities provisioned via normal test-access process

Provisioned via base seed + UAT loader (`seed.ts` then `seed-uat.ts` with `SEED_USERS_FILE=secrets/uat-users.json`, `SEED_RESET_PASSWORDS=1`), then **each identity authenticated against the running API** — 24/24 personas returned HTTP 200 with server-side subjects (playbook `check-identities.ts`). Full mapping: Plan Section 4.5. Sample: sysadmin `ec89196f…`, lp_a_manager `3639063c…` (Investor A), lp_b_signatory `a99b2edc…` (Investor B), custodian_submitter `d6e0228c…`, investee_101_approver `ac4c49fa…`.

**Status: ✅ Passed** (22/22 matrix refs mapped; 24/24 personas authenticated; ⚠️ matrix-ref/persona deltas recorded in Section 4.5)

## G06 — Fixture contracts mapped to sandbox schema; loaded; counts/hashes verified

Approved loader = UAT seed (idempotent, ref-matched). Verified counts post-load:

| Fixture group | Verified loaded |
|----------------|-----------------|
| F02/F03/F04 (accounts, securities, golden order) | 2 clients, 2 funds, 6 portfolios, 84 positions, 13 securities, 806 prices, 9 orders, 5 fills |
| F05 (mixed recon inputs) | 1 cash-statement import/5 lines; 1 trade feed/3 lines (recon runs created at execution) |
| F06 (cash & journals) | 6 cash journals, 1 statement import |
| F07/F08 (NAV, performance inputs) | valuation inputs loaded; NAV runs / performance periods created at execution |
| F09 (private markets) | 4 PM funds, 4 commitments, 4 capital calls, 3 distributions |
| F10 (facilities) | 2 facilities, 2 risk limits |
| F12 (documents) | 15 documents + 15 versions + 24 file objects (one-page placeholder PDFs — **original byte-sets still required**, see IF-02/IF-07) |
| F13 (connectors) | 16 data sources, 60 integration calls, 20 outbox events |
| F14 (models/risk) | 3 governance models, 2 risk limits, 1 term sheet |
| F15 (corporate actions) | 7 CA events |
| Cross-cutting | 2 onboarding applications, 1 KYC case, 7 notices, 5 report definitions, 115 audit events, 3 companies, 1 counterparty |

**Status: ✅ Passed with notes** — economic values preserved by loader; execution-time records (recon runs, NAV runs, journals, performance periods) are expected to be created by the tests themselves; F12 original byte-sets must be uploaded through the application (tied to IF-02/IF-07 triage).

---

## Corrections applied this session (audit trail)

1. **Dev stack was down** (ports 3100–3104/4100 not listening) — restarted via `npm run dev`; all 6 services healthy, flags verified.
2. **DB under-migrated:** `matanho_nexus` had 1/43 migrations and 6 tables — applied all 43 via `prisma migrate deploy`, then base seed (17 roles/281 grants) and UAT seed (personas + dataset). Prior handoff status "54 migrations applied, seeded" did not match live state.
3. **Plan Section 6 (Fixture & Oracle Management) was absent** from `UAT_Execution_Plan.md` despite handoff status — written together with Sections 7–11; Section 1.4 structure table and Section 4.5 identity map added.

**Gates G01–G06: 5 passed, 1 conditional (G03).** G07 remains passed from Section 3.4 (re-verified: portals HTTP 200, API health ok).

**Next:** Phase 1 flag triage (IF-01–IF-15), then Wave 1 (DEP, IAM, DAT).
