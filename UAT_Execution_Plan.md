# Matanho Nexus — UAT Execution Plan
**Version:** 1.0  
**Date:** 11 October 2026  
**Baseline:** V33-era source + V57-V66 conversation requirements (target acceptance criteria)  
**Environment:** Local development stack (ports 3100–3104, 4100) — all live flags enabled

---

## 1. Introduction

### 1.1 Purpose
This document provides a structured, step-by-step execution plan for running the Matanho Nexus End-to-End User Acceptance Testing (UAT). It aligns the governance, procedures, and cross-team journeys defined in the **Matanho_Nexus_End_to_End_UAT_Manual.docx** with the atomic test cases, fixtures, oracles, and execution fields in the **Matanho_Nexus_UAT_Execution_Workbook.xlsx**.

### 1.2 Scope of This Plan
- **In scope:** All 31 control areas (DEP, IAM, ONB, CLI, POR, CON, RES, ORD, REC, OPS, CSH, CA, NAV, ACC, PM, FIN, PER, RPT, DOC, LP, CST, CMP, BI, RSK, REG, DAT, MOD, AI, AUD, NFR, E2E) covering 18 cross-module journeys (J01–J18) and 166+ atomic module test cases.
- **Out of scope:** Live regulatory filing, production market data feeds, broker-native API contracts, legal/tax/compliance certification.
- **Baseline limitation:** Supplied source is V33-era; V57-V66 requirements (custodian portal, Analytics & BI, Accounting V66, premium LP features) are **target acceptance criteria** — not yet verified in runtime. Execution must flag where runtime is absent.

### 1.3 Key Principles (from Manual §01, §04)
| Principle | Requirement |
|-----------|-------------|
| **Real deployed app** | Execute against full hosted portals + API; no standalone harnesses or screenshot-only checks |
| **Business state over UI** | A passing step proves: expected business state exists, underlying record/calculation is correct, source can be opened, correct user had authority, result survives persistence boundary |
| **Distinct authenticated identities** | No client-side role switching, typed names, or same-session tab reuse — each role = separate browser profile/login |
| **Evidence standard** | ID format `EV-<Case>-<Step>-<Seq>`; include build, tester, time, account/portfolio, source file/request ID, business object ID, SHA-256 where relevant |
| **Fail/Blocked precedence** | Case outcome: Fail > Blocked > In progress > Evidence gap > Pass. N/A requires approved waiver. |

### 1.4 Document Structure
| Section | Content |
|---------|---------|
| 1. Introduction & Scope | This section |
| 2. Scope & Baseline Alignment | 31 control areas, 18 journeys, golden controls, inspection flags |
| 3. Environment & Entry Criteria | Local dev stack, live flags, gates G01–G07, partitions, credentials |
| 4. Roles & Test Identities | 22 synthetic identities (Role Matrix), separation of duties, browser profiles |
| 5. Execution Sequence | Phase 0 gates, Phase 1 flag triage, Phase 2 module waves, Phase 3 journeys |
| 6. Fixture & Oracle Management | F00–F15 isolation, OR-001–OR-044 independent calculations |
| 7. Daily Execution Workflow | Step recording, evidence capture, defect triage, review sampling |
| 8. Defect & Retest Process | Lifecycle, severity S1–S4, regression scope, retest log |
| 9. Evidence & Sign-off | Register fields, sampling rules, 8-authority matrix, waivers |
| 10. Source Inspection Flags | IF-01–IF-15 triage before execution |
| 11. Appendix | Quick-reference tables, command cheatsheet |

---

## 2. Scope & Baseline Alignment

### 2.1 Control Areas & Case Counts (from Workbook "Requirements" sheet)

| Control Area | Code | Cases | Priority | Source | Status |
|--------------|------|-------|----------|--------|--------|
| Deployment & Navigation | DEP | 8 | P0 | S01,S03,S08,C03 | Open |
| Access & Segregation | IAM | 8 | P0 | S03,S05,P01 | Open |
| Onboarding & KYC | ONB | 11 | P0 | S02,S04,C04 | Open |
| Client Accounts & Servicing | CLI | 6 | P1 | S03,C01 | Open |
| Portfolios & Positions | POR | 5 | P1 | S03,S09 | Open |
| Portfolio Construction | CON | 4 | P1 | S02,S09 | Open |
| Research & Investment Decisions | RES | 3 | P1 | S02,S03 | Open |
| Orders & Execution | ORD | 14 | P0 | S02,S03,C03 | Open |
| Reconciliations | REC | 17 | P0 | S02,S09,C01 | Open |
| Operations Control | OPS | 4 | P1 | S02,S09 | Open |
| Cash & Client Funding | CSH | 7 | P0 | S03,C01 | Open |
| Corporate Actions | CA | 4 | P1 | S03 | Open |
| NAV & Valuation | NAV | 7 | P0 | S02,S03 | Open |
| Accounting & Close | ACC | 13 | P0 | S03,C03 | Open |
| Private Markets & Liquidity | PM | 5 | P0 | S03,C01,C04 | Open |
| Collateral & Financing | FIN | 4 | P0 | S02,S03 | Open |
| Performance & Attribution | PER | 4 | P1 | S02,S03,C04 | Open |
| Reports & Distribution | RPT | 9 | P0 | S02,S03,C01 | Open |
| Documents & Evidence | DOC | 6 | P0 | S02,S04,S05,C01 | Open |
| LP / Investor Portal | LP | 6 | P0 | S05,C04 | Open |
| Custodian / Counterparty Portal | CST | 5 | P0 | C01 | **Blocked — runtime not in V33 source** |
| Portfolio-Company Portal | CMP | 3 | P0 | S06 | Open |
| Analytics & BI | BI | 5 | P1 | C02,S03 | **Target — runtime not supplied** |
| Risk & Compliance | RSK | 5 | P1 | S02,S03,C02 | Open |
| Regulatory Reporting | REG | 3 | P0 | S02,S03 | Open |
| Data & Integrations | DAT | 5 | P0 | S02,S03,C01 | Open |
| Model Governance | MOD | 3 | P1 | S02,S09 | Open |
| AI / OCR / Copilot | AI | 3 | P1 | S03,S04,C04 | **Target — runtime not supplied** |
| Audit & Data Lineage | AUD | 3 | P0 | S03,S09 | Open |
| Responsive, Resilience & Recovery | NFR | 9 | P0 | C02,C03,P01 | Open |
| Cross-Module Journeys | E2E | 18 | P0 | S01-S09,C01-C04,P01 | Open |

**Total atomic cases:** ~166  
**Total journey steps:** 18 journeys × ~8–9 steps = ~150+ journey steps

### 2.2 Cross-Module Journeys (J01–J18) — Execution Dependencies

| Journey | ID | Dependencies (Module Cases Must Pass First) |
|---------|----|---------------------------------------------|
| Applicant → funded client → first report | J01 (E2E-001) | ONB, CLI, CSH, DOC, RPT, LP, IAM |
| Golden buy → settlement → NAV → reporting | J02 (E2E-002) | POR, ORD, REC, CSH, NAV, ACC, PER, RPT, LP, AUD |
| Broker API → reconciliation evidence | J03 (E2E-003) | DAT, REC, ORD, AUD, NFR |
| Manual import → exception → checker sign-off | J04 (E2E-004) | REC, DOC, DAT, AUD |
| Custodian intraday → day-end reconciliation | J05 (E2E-005) | **CST, REC, IAM, DOC, AUD** (CST blocked) |
| Bank fee → journal → reconciled cash | J06 (E2E-006) | REC, ACC, CSH, NAV, AUD |
| Sell/cancellation/withdrawal no over-alloc | J07 (E2E-007) | ORD, CSH, REC, CLI, RPT, LP, IAM |
| Stale valuation → NAV → performance → reports | J08 (E2E-008) | NAV, PER, RPT, DOC, LP, AUD |
| Research → construction → OMS instructions | J09 (E2E-009) | RES, CON, MOD, RSK, ORD, AUD |
| Private commitment → call → distribution → LP metrics | J10 (E2E-010) | PM, CSH, ACC, LP, RPT, DOC |
| Company pack → valuation → LP publication | J11 (E2E-011) | CMP, PM, NAV, MOD, DOC, LP, IAM |
| Margin shortfall → collateral → accounting | J12 (E2E-012) | FIN, RSK, CSH, REC, ACC, AUD |
| Model governance → risk/limit control | J13 (E2E-013) | MOD, RSK, BI, CON, ORD, AUD |
| Accounting close → locked period → restatement | J14 (E2E-014) | ACC, REC, NAV, RPT, AUD, IAM |
| Report scheduling → failed delivery → retry | J15 (E2E-015) | RPT, CLI, DOC, LP, DAT, IAM, NFR |
| Regulatory population → sandbox filing → receipt | J16 (E2E-016) | REG, NAV, ACC, DAT, DOC, AUD, IAM |
| Failure/recovery/upgrade no lost records | J17 (E2E-017) | DEP, NFR, DAT, REC, ACC, IAM, AUD |
| Release acceptance across roles/devices | J18 (E2E-018) | DEP, IAM, NFR, DOC, AUD, E2E (all P0/P1 done) |

### 2.3 Golden Financial Controls (Manual §07) — Non-Negotiable Assertions
| Control | Oracle | Expected | Tolerance |
|---------|--------|----------|-----------|
| Buy-to-NAV bridge (golden buy) | OR-001 to OR-011 | Gross 1,000 → obligation 1,010 → available 98,990 → holdings 1,100 @ 12 = 13,200 → NAV 112,090 → 1.1209/unit | Zero |
| Separate sell branch | OR-012 to OR-015 | Sell 50 @ 12, fee 5 → net 595 → cash 99,585 → withdrawal 500 → 99,085 | Zero |
| Bank-fee branch | OR-017 to OR-018 | Book 100,000 vs bank 99,850 → Dr Fees 150 / Cr Cash 150 → 99,850 | Zero |
| Mixed reconciliation | OR-033, OR-034 | 2 exact matches / 7 internal = 28.57%; 8 external – 1 dup = 7 unique | Zero |
| Performance (external-flow) | OR-020 to OR-023 | Subperiod 1: 2%, Subperiod 2: 3%, TWR 5.06%, Active return 1.06pp | 1e-8 |
| Private fund metrics | OR-024 to OR-029 | Unfunded 600k, DPI 0.25x, RVPI 1.25x, TVPI 1.50x; call 200k → paid-in 600k | Zero |
| Facilities/collateral | OR-030 to OR-032 | Interest 82.19; eligible 80k (20% haircut); shortfall 5k | Zero |

### 2.4 Source Inspection Flags Requiring Early Triage (Manual §11)
| Flag | Priority | Theme | Must Verify Before Execution |
|------|----------|-------|------------------------------|
| IF-01 | P0 | Baseline mismatch | Freeze deployed candidate; reconcile manifest |
| IF-02 | P0 | Evidence collection | Upload all 8 originals; verify counts/bytes |
| IF-03 | P0 | Shared onboarding queue | Prove real app→manager hand-off (separate session) |
| IF-04 | P0 | Connection test simulates | Capture genuine sandbox request/response |
| IF-05 | P0 | Reconciliation seeded | Trace original bytes from new import |
| IF-06 | P0 | Hard-coded approval IDs | Enforce authenticated immutable identities |
| IF-07 | P0 | Original preview not proved | Verify original binary bytes, versions, scoped downloads |
| IF-08 | P0 | Company submission = toast | Require durable package ID + files in reviewer queue |
| IF-09 | P0 | NAV calculation not proved | Recalculate changed input; block stale approvals |
| IF-10 | P0 | Construction promotion not proved | Invalidate prior runs; prove real OMS draft IDs |
| IF-13 | P0 | UI entitlements ≠ server controls | Verify backend enforcement + cross-client denial |

---

**End of Introduction and Scope.**  
Say **"proceed"** for Section 3: Environment & Entry Criteria.

---

## 3. Environment & Entry Criteria

### 3.1 Local Development Stack (Current Running State)

| Service | URL | Port | Process | Status |
|---------|-----|------|---------|--------|
| **Backend API** | http://localhost:4100/api | 4100 | `tsx watch src/server.ts` | ✅ Running |
| **Admin Portal** | http://localhost:3100 | 3100 | `next dev -p 3100` | ✅ Ready |
| **Investor/LP Portal** | http://localhost:3101 | 3101 | `next dev -p 3101` | ✅ Ready (live) |
| **Onboarding Portal** | http://localhost:3102 | 3102 | `next dev -p 3102` | ✅ Ready (live) |
| **Company/Investee Portal** | http://localhost:3103 | 3103 | `next dev -p 3103` | ✅ Ready (live) |
| **Custodian Portal** | http://localhost:3104 | 3104 | `next dev -p 3104` | ✅ Ready (live) |

**Background process:** `bgp_12c1f4078001dhEa7FN0WugCCy` (PID 6788) — managed by `concurrently`

### 3.2 Live Feature Flags (Verified Active)

```json
GET /api/v1/platform/flags
{
  "lp": {"session":true,"dashboard":true,"capital":true,"activity":true,"dealing":true,"performance":true,"documents":true,"notices":true,"requests":true,"organisation":true,"settings":true,"reports":true},
  "investee": {"liveActions":["all"]},
  "custodian": {"live":true},
  "onboarding": {"live":true},
  "storage": {"backend":"local"}
}
```

### 3.3 Database & Infrastructure

| Component | Connection | Status |
|-----------|------------|--------|
| MySQL (Prisma) | `mysql://matanho_app:***@127.0.0.1:3306/matanho_nexus` | ✅ Connected, 54 migrations applied |
| Shadow DB | `mysql://matanho_app:***@127.0.0.1:3306/matanho_nexus_shadow` | ✅ Available |
| MinIO (S3) | Local (if configured) | ⚠️ Verify bucket `matanho-nexus` exists |
| Email (ZeptoMail SMTP) | `smtp.zeptomail.com:587` | ⚠️ `INTEGRATION_EMAIL=live` set; API restart needed for full activation |

### 3.4 Entry Gates (Manual §03 — G01–G07)

| Gate | Criterion | Verification Method | Status |
|------|-----------|---------------------|--------|
| **G01** | Candidate frozen: URL, commit, build, archive digest recorded | Record in Evidence Register (EV-DEP-001) | ⬜ Pending |
| **G02** | Environment approved: isolated test partitions, backups, reset procedure | Confirm DB partitions per fixture (F00–F15); document reset | ⬜ Pending |
| **G03** | Concurrency/response-time targets approved | Define p95 targets in F00; record in Release Gates | ⬜ Pending |
| **G04** | Timezone, policy references, recovery objectives documented | Capture in F00_environment_template.json | ⬜ Pending |
| **G05** | 22 test identities provisioned via normal test-access process | Map Role Matrix to actual authenticated IDs (see Section 4) | ⬜ Pending |
| **G06** | Fixture contracts mapped to sandbox schema (economic values, external IDs, record counts preserved) | Verify each F01–F15 loaded in isolated partition | ⬜ Pending |
| **G07** | All portals + API healthy; CORS origins configured | `GET /api/health` → 200; portals return 200 | ✅ Passed |

### 3.5 Test Data Partitions (Manual §06 — Isolation Rules)

| Partition | Fixtures | Purpose | Reset Rule |
|-----------|----------|---------|------------|
| **Golden Buy** | F02, F03, F04, F07 | J02, J07, J14 | Reset to 100k cash + 1k shares @ 10 before each branch |
| **Reconciliation** | F05, F13 | J03, J04, J05 | Fresh partition per journey; no API/portal ingestion cross-contamination |
| **Cash & Journals** | F06 | J06, J07, J14 | Isolated 150 bank fee, 10k sub, 500 withdrawal; use partition column |
| **NAV & Valuation** | F07 | J02, J08, J14 | Golden closing follows settled buy; FX row separate |
| **Performance** | F08, F11 | J08, J15 | Separate partition; do not reuse golden no-flow 1.90% |
| **Private Markets** | F09 | J10, J11 | Reset actual paid-in 400k before call test; forecasts don't post |
| **Facilities** | F10 | J12 | Test assumptions only; no real credit instruction |
| **Documents** | F12 | J01, J04, J08, J11, J15 | Exact hashes; never replace originals with generic previews |
| **Models** | F14 | J09, J11, J13 | Invalidate approvals after input changes |
| **Environment** | F00, F01 | All | Snapshot before each journey; distinct immutable user IDs |

### 3.6 Browser & Device Matrix (Manual §12)

| Viewport | Browser | OS | Required For |
|----------|---------|-----|--------------|
| 1366×768 | Chromium (Chrome/Edge) | Windows 10/11 | Primary critical flow |
| 1280×800 | Chromium | Windows/macOS | Laptop secondary |
| 768×1024 | Safari/WebKit | iPadOS | Tablet |
| 390×844 | Chrome Mobile / Safari | Android / iOS | Phone |

**Record:** Exact browser/OS/version in evidence for each session.

### 3.7 Test Credentials (from `secrets/uat-users.json`)

| Portal | User | Email | Password | Role |
|--------|------|-------|----------|------|
| Admin | System Admin | `admin@local.matanho.test` | `tFXaDgMWFv0R#9a` | `system_admin` |
| Investor/LP | LP A Manager | `lp_a_manager@uat.matanho.test` | `67s3rfJ_kSqX#9a` | `investor_manager` |
| Custodian Submitter | Custodian A | `custodian_submitter@uat.matanho.test` | `hDMDmM6fTORt#9a` | `custodian_submitter` |
| Custodian Approver | Custodian A | `custodian_approver@uat.matanho.test` | `pVVGa9YKM_PP#9a` | `custodian_approver` |
| Onboarding | Public (no auth initially) | — | — | Applicant |

> **Note:** Each role requires **separate browser profile/incognito window** — no shared sessions.

---

**End of Section 3: Environment & Entry Criteria.**

---

## 4. Roles & Test Identities

### 4.1 Role Matrix (from Workbook "Role Matrix" sheet — 22 Synthetic Identities)

| Test User Ref | Role | Scope / Relationship | Permitted Test Purpose | Placeholder Email |
|---------------|------|---------------------|------------------------|-------------------|
| UA-APP-A | Applicant A | UAT Horizon Trust | Public application | applicant-a@example.invalid |
| UA-CS-01 | Client Services | Manager | Onboarding/client servicing | cs@example.invalid |
| UA-COMP-01 | Compliance Checker | Manager | Independent KYC disposition | compliance@example.invalid |
| UA-PM-01 | Portfolio Manager | Manager | Portfolio construction | pm@example.invalid |
| UA-DEAL-01 | Dealer / Order Maker | Manager | Create/routable orders | dealer@example.invalid |
| UA-OC-02 | Order Checker | Manager | Independent order approval | order-checker@example.invalid |
| UA-OP-01 | Operations Maker | Manager | Source intake and reconciliation | ops-maker@example.invalid |
| UA-OP-02 | Operations Checker | Manager | Independent reconciliation sign-off | ops-checker@example.invalid |
| UA-FA-01 | Fund Accountant Maker | Manager | Journal preparation | accountant@example.invalid |
| UA-FA-02 | Accounting Checker | Manager | Approval/posting/close as assigned | accounting-checker@example.invalid |
| UA-NAV-02 | NAV Checker | Manager | Independent NAV release | nav-checker@example.invalid |
| UA-RPT-01 | Report Preparer | Manager | Generate investor output | report-maker@example.invalid |
| UA-RPT-02 | Report Checker | Manager | Approve publication | report-checker@example.invalid |
| UA-INV-A | Investor A | UAT Horizon Trust | Only Investor A records | investor-a@example.invalid |
| UA-INV-B | Investor B | UAT Cedar Assurance | Only Investor B records | investor-b@example.invalid |
| UA-CUST-A | Custodian A | Test Custodian A | Only assigned A accounts | custodian-a@example.invalid |
| UA-CUST-B | Custodian B | Test Custodian B | Only assigned B accounts | custodian-b@example.invalid |
| UA-COMPANY-A | Portfolio Company A | UAT Payments Company | Only own reporting pack | company-a@example.invalid |
| UA-MOD-01 | Model Developer | Manager | Draft model/data/method | model-dev@example.invalid |
| UA-MOD-02 | Independent Validator | Manager | Validate others' models | model-validator@example.invalid |
| UA-ADMIN-01 | Integration Administrator | Manager | Sandbox configuration only | admin@example.invalid |
| UA-AUD-01 | Read-only Auditor | Manager | Scoped immutable history | audit@example.invalid |

### 4.2 Separation of Duties (Manual §03, §04 — Enforced)

| Incompatible Pair | Rule | Verification |
|-------------------|------|--------------|
| Maker vs Checker (any domain) | Same person cannot create AND approve | IAM-004: Attempt approve as same session → denied |
| Admin vs Trade/NAV approval | Administrative rights ≠ trade/NAV authority | IAM-005: Confirm incompatible duties prohibited |
| Investor A vs Investor B | Zero cross-visibility of accounts/docs | IAM-003: Use other's object ID → server denies |
| Custodian A vs Custodian B | Zero cross-visibility of records/KYC | IAM-006: Attempt view other's records → denied |
| Portfolio Company vs Internal | Company sees only own pack; no internal commentary | IAM-006: Attempt view internal → denied |

### 4.3 Browser Profile Mapping (Mandatory)

| Test User | Browser Profile | Portal Access | Notes |
|-----------|-----------------|---------------|-------|
| UA-ADMIN-01 | Profile 1 (Chrome) | Admin (3100) | System admin |
| UA-PM-01 | Profile 2 | Admin (3100) | Portfolio Manager in admin |
| UA-DEAL-01 | Profile 3 | Admin (3100) | Dealer in admin |
| UA-OC-02 | Profile 4 | Admin (3100) | Order Checker in admin |
| UA-OP-01 | Profile 5 | Admin (3100) | Ops Maker in admin |
| UA-OP-02 | Profile 6 | Admin (3100) | Ops Checker in admin |
| UA-FA-01 | Profile 7 | Admin (3100) | Fund Accountant Maker |
| UA-FA-02 | Profile 8 | Admin (3100) | Accounting Checker |
| UA-NAV-02 | Profile 9 | Admin (3100) | NAV Checker |
| UA-RPT-01 | Profile 10 | Admin (3100) | Report Preparer |
| UA-RPT-02 | Profile 11 | Admin (3100) | Report Checker |
| UA-COMP-01 | Profile 12 | Admin (3100) | Compliance Checker |
| UA-CS-01 | Profile 13 | Admin (3100) + Onboarding (3102) | Client Services |
| UA-INV-A | Profile 14 | Investor (3101) | Investor A only |
| UA-INV-B | Profile 15 | Investor (3101) | Investor B only |
| UA-CUST-A | Profile 16 | Custodian (3104) | Custodian A only |
| UA-CUST-B | Profile 17 | Custodian (3104) | Custodian B only |
| UA-COMPANY-A | Profile 18 | Company (3103) | Portfolio Company A only |
| UA-MOD-01 | Profile 19 | Admin (3100) | Model Developer |
| UA-MOD-02 | Profile 20 | Admin (3100) | Independent Validator |
| UA-AUD-01 | Profile 21 | Admin (3100) | Read-only Auditor |
| UA-APP-A | Profile 22 | Onboarding (3102) | Public applicant flow |

> **Critical:** Use **separate browser profiles** (Chrome: `chrome --user-data-dir=/tmp/uat-profile-N`) or **incognito/private windows** — never reuse cookies/sessions across roles.

### 4.4 Journey Actor Mapping (Manual §09)

| Journey | Actors (Handoffs) | Required Profiles |
|---------|-------------------|-------------------|
| J01 | Applicant A → Client Services → Compliance Checker → Operations → Report Checker → Investor A | 22, 13, 12, 5, 11, 14 |
| J02 | Portfolio Manager → Dealer → Order Checker → Broker → Custodian → Operations → NAV Checker → Report Checker | 4, 3, 4, (stub), 16, 5, 9, 11 |
| J03 | Integration Admin → Broker Sandbox → Ops Maker → Ops Checker | 19, (stub), 5, 6 |
| J04 | Ops Maker → Source Owner → Ops Checker | 5, (source), 6 |
| J05 | Custodian A → Operations → Custodian Checker → Ops Checker | 16, 5, (custodian checker), 6 |
| J06 | Ops Maker → Fund Accountant Maker → Accounting Checker → Ops Checker | 5, 7, 8, 6 |
| J07 | Dealer → Order Checker → Broker → Operations → Cash Checker → Investor | 3, 4, (stub), 5, (cash), 14 |
| J08 | Valuation Maker → NAV Checker → Performance Analyst → Report Checker → Investor | (valuation), 9, (perf), 11, 14 |
| J09 | Analyst → IC → Portfolio Manager → Order Checker → Dealer | (analyst), (IC), 4, 4, 3 |
| J10 | Private Markets → Investor Services → Operations → Accounting Checker → LP | (PM), (IS), 5, 8, 14 |
| J11 | Company A → PM Reviewer → Valuation Checker → Report Checker → LP | 18, (reviewer), 9, 11, 14 |
| J12 | Treasury → Risk → Independent Checker → Custodian → Operations → Fund Accountant | (treasury), (risk), (checker), 16, 5, 7 |
| J13 | Model Dev → Independent Validator → Model Committee → Risk Officer → Dealer | 19, 20, (committee), (risk), 3 |
| J14 | Fund Accountant Maker → Accounting Checker → Operations → NAV Checker → Auditor | 7, 8, 5, 9, 21 |
| J15 | Report Maker → Report Checker → Scheduler → Sandbox Mail → Investor | 10, 11, (scheduler), (mail), 14 |
| J16 | Compliance Prep → Finance Attestor → Authorised Filer → Regulator Sandbox → Auditor | (comp), (finance), (filer), (sandbox), 21 |
| J17 | UAT Lead → Platform Owner → Operations → Security → Accounting Checker | (lead), (platform), 5, (security), 8 |
| J18 | UAT Lead → Business Owners → Security → Operations → Sponsor | (lead), (owners), (security), 5, (sponsor) |

---

### 4.5 Provisioned Identity Map (G05 Evidence — 11 Oct 2026)

All 24 personas in `secrets/uat-users.json` were provisioned through the normal test-access process (base seed + UAT loader) and **authenticated against the running API**; each returned the server-side subject shown below (never a typed name). Role Matrix refs map to personas as follows; where one matrix ref has no 1:1 persona, the nearest provisioned identity is used and the difference is noted.

| Role Matrix Ref | Persona | Authenticated User ID (subject) | Granted Roles | Matches Matrix Role? |
|-----------------|---------|----------------------------------|----------------|----------------------|
| UA-ADMIN-01 | sysadmin | `ec89196f-4678-4fe2-96d2-c5eed783bf34` | admin:system_admin | ✅ |
| UA-PM-01 | test_portfolio_manager | `61b76f9d-0c71-436c-b848-3a75938c9fa6` | admin:portfolio_manager | ✅ |
| UA-DEAL-01 | test_dealer | `9cdc56a8-7108-424d-8e98-10a134496613` | admin:dealer | ✅ |
| UA-OC-02 | test_approver | `82e138a1-f8df-4a69-9bfa-2387c1ee0398` | admin:investment_director | ⚠️ Approver rights = investment_director (no separate order-checker persona) |
| UA-OP-01 | operations | `9b2c4afc-dda1-4d44-b4e0-f8a90dea7b14` | admin:operations | ✅ |
| UA-OP-02 | analyst | `4482ef78-bc86-4f32-8229-a28c6829441f` | admin:analyst | ⚠️ Used as independent checker where checker rights required |
| UA-FA-01 | test_fund_accountant | `eb3ea0d8-40db-44bd-a880-f12ab0ca5b98` | admin:fund_accountant | ✅ |
| UA-FA-02 | investment_director | `ca643759-25e6-4300-929c-7547e1c3fa69` | admin:investment_director | ⚠️ Accounting checker rights via investment_director |
| UA-NAV-02 | test_approver | `82e138a1-f8df-4a69-9bfa-2387c1ee0398` | admin:investment_director | ⚠️ NAV release rights via investment_director (see IF-06 enforcement) |
| UA-RPT-01 | client_services | `e85a50cd-e954-4451-bfa6-1997a3757279` | admin:client_services | ✅ |
| UA-RPT-02 | compliance | `a9a4df8e-9102-4dfb-9e9d-b52dda3a08ee` | admin:compliance | ⚠️ Report approval via compliance rights |
| UA-COMP-01 | compliance | `a9a4df8e-9102-4dfb-9e9d-b52dda3a08ee` | admin:compliance | ✅ |
| UA-CS-01 | client_services | `e85a50cd-e954-4451-bfa6-1997a3757279` | admin:client_services | ✅ |
| UA-INV-A | lp_a_manager | `3639063c-ef0b-4fc0-a31a-0a67d14ae06e` | investor:admin (CL-00418 Horizon) | ✅ |
| UA-INV-B | lp_b_signatory | `a99b2edc-e20a-46a5-a4aa-ef554e16a4c6` | investor:finance (CL-90001 Kariba) | ✅ |
| UA-CUST-A | custodian_submitter | `d6e0228c-9deb-40ad-b3d8-bd5e1b414eee` | custodian:submitter (CP-001) | ✅ |
| UA-CUST-B | custodian_approver | `b65c0953-38cb-4f37-a2df-c74f6264f822` | custodian:approver (CP-001) | ✅ |
| UA-COMPANY-A | investee_101_approver | `ac4c49fa-a639-4e4c-a484-fdeaa527034a` | company user PC-101 executive_approver | ✅ |
| UA-MOD-01 | test_settings_admin | `a8a22835-e02e-4f67-abba-1e76139e8e48` | admin:settings_admin | ⚠️ Model dev rights via settings admin |
| UA-MOD-02 | test_compliance | `8f6ff38e-c781-4cd1-b1c8-3d526476f61e` | admin:compliance | ⚠️ Independent validator via compliance rights |
| UA-AUD-01 | lp_a_viewer | `a3e83c9f-6e1f-4d11-aa39-b4b129b343f6` | investor:auditor | ⚠️ Read-only auditor (LP scope); admin-side auditor = admin:auditor (analyst persona fallback) |
| UA-APP-A | *(public applicant — no login)* | — | onboarding portal public form | ✅ |

Supporting identities also provisioned: `investee_101_contributor` `88335b47-5913-4f82-b171-16e6eeeb9cbf`, `investee_101_viewer` `2f93b293-43ee-4c62-a4a3-94212c4f0229`, `investee_102_admin` `1a77381d-329c-4671-a05a-50956e9f8007`, `lp_a_signatory` `9da8bcf5-debf-4a8b-8e95-1caa067eb708`, `test_custodian_approver` `47cf4868-fd9d-48c7-b39a-6abdb7d33e90`, `local_admin` `0116b5fd-b685-4633-8e78-32858ce26c0e`.

> Maker/checker enforcement relies on the authenticated subject (IAM-004); where two matrix refs share one persona (UA-OC-02/UA-NAV-02), incompatible-pair testing uses distinct personas (e.g. test_dealer creates, test_approver approves).

---

**End of Section 4: Roles & Test Identities.**

---

## 5. Execution Sequence

### 5.1 Phase 0 — Pre-Execution Gates (Must Complete Before Any Test)

| Step | Action | Owner | Evidence | Gate |
|------|--------|-------|----------|------|
| 0.1 | Freeze candidate: record URL, commit SHA, build number, archive digest | UAT Lead | EV-DEP-001-01 | G01 |
| 0.2 | Verify DB partitions exist for F00–F15; document reset procedures | Platform Owner | EV-DEP-001-02 | G02 |
| 0.3 | Define p95 response-time targets, concurrent user volume in F00 | UAT Lead / Platform | EV-DEP-001-03 | G03 |
| 0.4 | Document timezone, policy refs, recovery objectives in F00 | UAT Lead | EV-DEP-001-04 | G04 |
| 0.5 | Provision 22 test identities; map to actual authenticated IDs | System Admin | EV-IAM-001-01 | G05 |
| 0.6 | Load fixtures F01–F15 into isolated partitions; verify counts/hashes | Data Owner | EV-DAT-001-01 | G06 |
| 0.7 | Confirm all portals + API healthy; CORS configured | Platform Owner | EV-DEP-001-05 | G07 |

> **Rule:** No test execution until all G01–G07 = ✅ Passed.

### 5.2 Phase 1 — Source Inspection Flag Triage (Manual §11)

| Flag | Action | Owner | Evidence | Must Complete Before |
|------|--------|-------|----------|----------------------|
| IF-01 | Reconcile deployed manifest vs V33 source | UAT Lead / Platform | EV-DEP-002 | All execution |
| IF-02 | Upload all 8 onboarding originals; verify bytes/counts | Client Services | EV-ONB-004 | J01, ONB cases |
| IF-03 | Prove real app→manager hand-off (separate session) | Client Services / Ops | EV-E2E-001-02 | J01 |
| IF-04 | Capture genuine sandbox request/response (not boolean) | Integration Admin | EV-DAT-001 | J03, DAT cases |
| IF-05 | Trace original bytes from new import (not seeded) | Ops Maker | EV-REC-001 | J03, J04, REC cases |
| IF-06 | Verify maker/checker uses authenticated IDs (not names) | System Admin | EV-IAM-004 | All maker/checker |
| IF-07 | Verify original binary bytes, versions, scoped downloads | Doc Owner | EV-DOC-001 | J01, J04, J08, J11, J15 |
| IF-08 | Require durable package ID + files in reviewer queue | Company User / PM | EV-CMP-001 | J11, CMP cases |
| IF-09 | Recalculate NAV on changed input; block stale approvals | Valuation Maker | EV-NAV-001 | J02, J08, NAV cases |
| IF-10 | Invalidate prior construction runs; prove real OMS draft IDs | Portfolio Manager | EV-CON-003 | J09, CON cases |
| IF-13 | Verify backend enforcement + cross-client URL/API denial | System Admin | EV-IAM-002, EV-IAM-003 | All IAM, LP, CST |

### 5.3 Phase 2 — Module Test Cases (Priority Order)

**Execution Rule:** Filter Test Cases by module → Read prerequisites → Execute steps in order → Capture actual result + business IDs → Record evidence. Do not skip failed step.

#### Wave 1: Foundation (P0 — Run First)

| Module | Cases | Prerequisites | Estimated Duration |
|--------|-------|---------------|---------------------|
| **DEP** | DEP-001 to DEP-008 | G01–G07 passed | 2 hrs |
| **IAM** | IAM-001 to IAM-008 | DEP done; 22 profiles ready | 3 hrs |
| **DAT** | DAT-001 to DAT-005 | IF-04 triaged; sandbox configured | 2 hrs |

#### Wave 2: Core Business (P0 — Parallel After Wave 1)

| Module | Cases | Prerequisites | Estimated Duration |
|--------|-------|---------------|---------------------|
| **ONB** | ONB-001 to ONB-011 | IF-02, IF-03 triaged; KYC sandbox | 4 hrs |
| **ORD** | ORD-001 to ORD-014 | F02, F03 loaded; market master mapped | 4 hrs |
| **REC** | REC-001 to REC-017 | IF-05 triaged; F05, F13 loaded | 5 hrs |
| **CSH** | CSH-001 to CSH-007 | F02, F06 loaded; partitions isolated | 3 hrs |
| **NAV** | NAV-001 to NAV-007 | IF-09 triaged; F07 loaded | 3 hrs |
| **ACC** | ACC-001 to ACC-013 | F04, F06, F07 loaded | 4 hrs |
| **LP** | LP-001 to LP-006 | IF-13 triaged; Investor A/B profiles | 2 hrs |

#### Wave 3: Extended Business (P1 — After Wave 2)

| Module | Cases | Prerequisites | Estimated Duration |
|--------|-------|---------------|---------------------|
| **CLI** | CLI-001 to CLI-006 | ONB done; client data exists | 2 hrs |
| **POR** | POR-001 to POR-005 | ORD, CSH, NAV done | 2 hrs |
| **CON** | CON-001 to CON-004 | IF-10 triaged; F02, F03, F14 | 3 hrs |
| **RES** | RES-001 to RES-003 | Research data available | 1.5 hrs |
| **OPS** | OPS-001 to OPS-004 | REC done | 1.5 hrs |
| **CA** | CA-001 to CA-004 | F15 loaded | 1.5 hrs |
| **PM** | PM-001 to PM-005 | F09 loaded; private markets config | 2.5 hrs |
| **FIN** | FIN-001 to FIN-004 | F10 loaded | 2 hrs |
| **PER** | PER-001 to PER-004 | F08, F11 loaded | 2 hrs |
| **RPT** | RPT-001 to RPT-009 | NAV, ACC, CLI done | 3 hrs |
| **DOC** | DOC-001 to DOC-006 | IF-07 triaged; F12 loaded | 2 hrs |
| **RSK** | RSK-001 to RSK-005 | F14 loaded | 2 hrs |
| **REG** | REG-001 to REG-003 | Sandbox channel approved | 2 hrs |
| **MOD** | MOD-001 to MOD-003 | IF-11 triaged; F14 loaded | 2 hrs |
| **AUD** | AUD-001 to AUD-003 | All maker/checker cases done | 1.5 hrs |
| **NFR** | NFR-001 to NFR-009 | All portals running; device matrix | 3 hrs |

#### Wave 4: Target/Blocked (Conditional)

| Module | Cases | Condition |
|--------|-------|-----------|
| **CST** | CST-001 to CST-005 | **Blocked** — custodian portal runtime not in V33 source |
| **BI** | BI-001 to BI-005 | **Target** — runtime not supplied (C02) |
| **AI** | AI-001 to AI-003 | **Target** — runtime not supplied (C04) |
| **CMP** | CMP-001 to CMP-003 | IF-08 triaged; company portal deployed |

### 5.4 Phase 3 — Cross-Module Journeys (J01–J18)

**Rule:** All supporting module cases for a journey must Pass before journey execution.

| Order | Journey | ID | Required Module Passes | Estimated Duration |
|-------|---------|----|------------------------|---------------------|
| 1 | Applicant → funded client → first report | J01 (E2E-001) | ONB, CLI, CSH, DOC, RPT, LP, IAM | 3 hrs |
| 2 | Golden buy → settlement → NAV → reporting | J02 (E2E-002) | POR, ORD, REC, CSH, NAV, ACC, PER, RPT, LP, AUD | 4 hrs |
| 3 | Broker API → reconciliation evidence | J03 (E2E-003) | DAT, REC, ORD, AUD, NFR | 3 hrs |
| 4 | Manual import → exception → checker sign-off | J04 (E2E-004) | REC, DOC, DAT, AUD | 3 hrs |
| 5 | Custodian intraday → day-end reconciliation | J05 (E2E-005) | **BLOCKED** — CST not available | — |
| 6 | Bank fee → journal → reconciled cash | J06 (E2E-006) | REC, ACC, CSH, NAV, AUD | 3 hrs |
| 7 | Sell/cancellation/withdrawal no over-alloc | J07 (E2E-007) | ORD, CSH, REC, CLI, RPT, LP, IAM | 3 hrs |
| 8 | Stale valuation → NAV → performance → reports | J08 (E2E-008) | NAV, PER, RPT, DOC, LP, AUD | 3 hrs |
| 9 | Research → construction → OMS instructions | J09 (E2E-009) | RES, CON, MOD, RSK, ORD, AUD | 3 hrs |
| 10 | Private commitment → call → distribution → LP metrics | J10 (E2E-010) | PM, CSH, ACC, LP, RPT, DOC | 3 hrs |
| 11 | Company pack → valuation → LP publication | J11 (E2E-011) | CMP, PM, NAV, MOD, DOC, LP, IAM | 3 hrs |
| 12 | Margin shortfall → collateral → accounting | J12 (E2E-012) | FIN, RSK, CSH, REC, ACC, AUD | 3 hrs |
| 13 | Model governance → risk/limit control | J13 (E2E-013) | MOD, RSK, BI, CON, ORD, AUD | 3 hrs |
| 14 | Accounting close → locked period → restatement | J14 (E2E-014) | ACC, REC, NAV, RPT, AUD, IAM | 3 hrs |
| 15 | Report scheduling → failed delivery → retry | J15 (E2E-015) | RPT, CLI, DOC, LP, DAT, IAM, NFR | 3 hrs |
| 16 | Regulatory population → sandbox filing → receipt | J16 (E2E-016) | REG, NAV, ACC, DAT, DOC, AUD, IAM | 3 hrs |
| 17 | Failure/recovery/upgrade no lost records | J17 (E2E-017) | DEP, NFR, DAT, REC, ACC, IAM, AUD | 3 hrs |
| 18 | Release acceptance across roles/devices | J18 (E2E-018) | **ALL P0/P1 module cases + J01–J17** | 4 hrs |

### 5.5 Journey Execution Protocol (Manual §09)

For each journey:
1. **Snapshot** all fixture partitions before start (EV-E2E-XXX-00)
2. **Execute steps sequentially** using mapped browser profiles (Section 4.4)
3. **Capture evidence** at every step: `EV-E2E-XXX-STEP-N`
4. **Record business object IDs** (application ID, order ID, break ID, journal ID, report ID, etc.)
5. **Verify persistence** — reopen from another session/profile
6. **On failure:** Stop journey → log defect → Block dependent work → Do not pass
7. **On completion:** Snapshot final state → reset partition for next journey (retain evidence)

---

**End of Section 5: Execution Sequence.**  
Sections 6–11 follow without interruption (no further "proceed" checkpoints).

---

## 6. Fixture & Oracle Management

### 6.1 Fixture Catalogue & Loading Status (Workbook "Test Data" sheet, F00–F15)

Fixtures are **canonical schemas, not promised import contracts**: each is mapped into the sandbox through the approved loader (UAT seed `backend/api/prisma/seed-uat.ts` + dataset `tools/uat/seed-data/uat-seed.json`) without changing economic facts. Execution-time records (recon runs, NAV runs, journals, postings) are created by the tests themselves against the loaded inputs.

| Fixture | Purpose | Isolation / Partition Rule | Loader Status (11 Oct 2026) | Business Owner Approval |
|---------|---------|----------------------------|------------------------------:|---|
| **F00** | Environment & baseline: frozen release, approved policy, role identities, partitions | Blank execution results; snapshot before each journey | ✅ Frozen candidate recorded (Section 3.4 G01); `tools/uat/fixtures/F00_environment_template.json` created | ⬜ Pending |
| **F01** | 22 test identities; investor/custodian isolation | Distinct immutable user IDs; never share credentials | ✅ 24 personas provisioned & authenticated (Section 4.5) | ⬜ Pending |
| **F02** | Accounts & portfolio master (Golden Investor A, isolated B/control) | Reset balances per scenario; never combine fee/NAV/performance partitions | ✅ 2 clients (CL-00418 Horizon = Investor A; CL-90001 Kariba = Investor B), 2 funds, 6 portfolios, 84 positions, 13 portfolio-cash rows | ⬜ Pending |
| **F03** | Synthetic security master (USD equity @ 10, closing 12) | UAT symbol mapped to test service; DLTA/INN browsing separate | ✅ 13 securities, 806 price rows (seeded; treat as illustrative per IF-14) | ⬜ Pending |
| **F04** | Golden order lifecycle (100-share buy, 2 fills; duplicate/cancel/oversell branches) | Reset golden account to 100,000 cash / 1,000 settled shares before each branch | ✅ 9 orders, 5 fills loaded | ⬜ Pending |
| **F05** | Mixed trade reconciliation (7 internal, 8 external, 1 duplicate, 2 exact matches) | Independent partition; duplicate/corrected bytes retain prior runs | ⚠️ Input statement + trade feed loaded (1 statement/5 lines; 1 feed/3 lines); recon runs created by execution | ⬜ Pending |
| **F06** | Cash & journals (150 bank fee; 10k subscription; 500 withdrawal) | Partition column; never post all branches into golden account | ✅ 6 cash journals, 1 statement import/5 lines | ⬜ Pending |
| **F07** | NAV & currency valuation (golden closing; separate ZWG→USD FX row) | Golden closing follows settled buy; FX row separate | ⚠️ Valuation inputs loaded; NAV runs created by execution | ⬜ Pending |
| **F08** | External-flow adjusted performance (2% + 3% → TWR 5.06%; benchmark 4%) | Separate partition; do not reuse golden no-flow 1.90% | ⚠️ Performance periods created by execution | ⬜ Pending |
| **F09** | Private fund & liquidity (opening + forecast-only cashflows) | Reset actual paid-in 400k before call test; forecasts never post | ✅ 4 PM funds, 4 commitments, 4 capital calls, 3 distributions | ⬜ Pending |
| **F10** | Facilities & collateral (10k interest 82.19; 100k less 20% haircut = 80k eligible; 85k required) | Test assumptions only; no real credit instruction | ✅ 2 facilities, 2 risk limits | ⬜ Pending |
| **F11** | Reporting date boundaries (weekly 24–30 Aug, monthly Aug; exclusions) | Fixed dates; schedules under controlled clock | ⚠️ Report definitions/schedules loaded; runs under controlled execution | ⬜ Pending |
| **F12** | Original document & extraction evidence (8 PDF categories; 2-page original, v2 replacement, corrupt, low-clarity) | Exact hashes; never replace originals with generic previews | ⚠️ 15 documents/versions + 24 file objects loaded as one-page placeholder PDFs — eight original byte-sets per categories still required (see IF-02/IF-07 triage) | ⬜ Pending |
| **F13** | Sandbox connector responses (page1/page2, failures, receipts) | Approved real-sandbox contract; never assert broker-native API | ✅ 16 data sources, 60 integration calls, 20 outbox events, 1 trade feed | ⬜ Pending |
| **F14** | Construction, models & risk (target 100%, invalid 99.5%; 1m NAV/91k issuer/10% limit) | Invalidate approvals after changes; scenario toggles ≠ executed tests | ✅ 3 governance models, 2 risk limits, 1 term sheet | ⬜ Pending |
| **F15** | Other control families & corporate actions | Normalised comparisons; dividend/split terms | ✅ 7 corporate-action events | ⬜ Pending |

**Reset procedure (approved):** re-run the UAT loader with `SEED_UAT_CONFIRM=1 SEED_USERS_FILE=secrets/uat-users.json SEED_UAT_RESET=1` (rewrites workflow records; reference data is idempotent). Backups: MySQL dump before each journey (see Appendix 11.4). Never reset mid-journey.

### 6.2 Oracle Reference (OR-001–OR-044 — Independent Calculations, Zero Tolerance unless noted)

| Group | Oracles | Golden control | Assertion |
|-------|---------|----------------|-----------|
| Buy-to-NAV bridge | OR-001–OR-011 | Gross 1,000 → obligation 1,010 → available 98,990 → holdings 1,100 @ 12 = 13,200 → NAV 112,090 → 1.1209/unit | Zero tolerance |
| Sell branch | OR-012–OR-015 | Sell 50 @ 12, fee 5 → net 595 → cash 99,585 → withdrawal 500 → 99,085 | Zero |
| Bank-fee branch | OR-017–OR-018 | Book 100,000 vs bank 99,850 → Dr Fees 150 / Cr Cash 150 → 99,850 | Zero |
| Mixed reconciliation | OR-033, OR-034 | 2 exact matches / 7 internal = 28.57%; 8 external − 1 duplicate = 7 unique | Zero |
| Performance (external-flow) | OR-020–OR-023 | Subperiod 1 = 2%, subperiod 2 = 3%, TWR = 5.06%, active return = 1.06pp | 1e-8 |
| Private fund metrics | OR-024–OR-029 | Unfunded 600k, DPI 0.25x, RVPI 1.25x, TVPI 1.50x; 200k call → paid-in 600k | Zero |
| Facilities/collateral | OR-030–OR-032 | Interest 82.19; eligible 80k (20% haircut); shortfall 5k | Zero |
| Supporting | OR-016, OR-019, OR-035–OR-044 | FX, tax/fees, allocations, distributions, reporting boundaries | Per oracle row |

**Rule:** an oracle mismatch is a **Fail** — never adjust the oracle to match the app. Record the app value, expected value, and both derivations in evidence.

### 6.3 Fixture Loading Verification (G06 Evidence)

1. Loader run is idempotent and ref-matched; counts recorded in `uat-execution/G01-G06-entry-gates.md` §G06.
2. Economic values preserved: commitment amounts, holdings units, NAV per unit, order prices — verified against dataset on load (loader asserts; no manual edits).
3. Isolation: Investor A (CL-00418 / Horizon) and Investor B (CL-90001 / Kariba) never share accounts, documents, or notices; cross-partition contamination check runs before Wave 2.
4. Originals: F12 byte-sets must be uploaded through the application (IF-02/IF-07) — loader placeholders are not originals.

---

## 7. Daily Execution Workflow

### 7.1 Daily Agenda (per UAT day)

| Time | Activity | Owner |
|------|----------|-------|
| 09:00 | Stand-up: yesterday's results, today's cases, blockers | UAT Lead |
| 09:15 | Environment health check (API/portals/flags), snapshot due partitions | Platform Owner |
| 09:30–12:30 | Execution block 1 (module cases / journeys) | Testers |
| 12:30 | Evidence upload + EV-ID register update | All testers |
| 13:30–16:30 | Execution block 2 | Testers |
| 16:30 | Defect triage (business owner + tech lead) | Defect board |
| 17:00 | Status update to workbook Dashboard/Release Gates | UAT Lead |

### 7.2 Step Recording Template (per workbook Test Steps row)

| Field | Rule |
|-------|------|
| Status | Pass / Fail / Blocked / In progress / Evidence gap / N-A (waiver ref) — precedence Fail > Blocked > In progress > Evidence gap > Pass |
| Actual Result | What the system actually did, with business object IDs |
| Evidence ID | `EV-<Case>-<Step>-<Seq>` (e.g. `EV-DEP-001-1-01`) |
| Tester / Date / Build | Authenticated tester + freeze commit `730f3cd` (+ working-tree deltas) until next freeze |
| Notes | Business IDs, fixture refs, defect IDs |

### 7.3 Evidence Capture Standard (Manual §04)

- Every step that asserts business state needs an EV-ID entry: build, tester, UTC time, account/portfolio, source file/request ID, business object ID, SHA-256 where a file is involved.
- Screenshots alone never pass a step; a linked record/export must show the asserted state.
- Evidence lives in the controlled repository (`uat-execution/evidence/`), not chat; originals hashed SHA-256.

### 7.4 Defect Triage (Daily)

1. Capture: one defect per failed step, linked EV-IDs, reproduction steps, business impact.
2. Triage board (business owner + tech lead): severity S1–S4, owner, fix target build.
3. Decide: fix-forward vs waive; waivers need business-owner approval recorded in the Waivers sheet.

### 7.5 Review Sampling Rules

- **100% review** of: all P0 steps, all gold financial-control (oracle) evidence, all Fail→Fixed retests, all cash/NAV/ledger checkpoints.
- **50% sample** of P1 steps with Pass status (evidence completeness only).
- Any Evidence gap found in a sample escalates the sampled module to 100% review.

---

## 8. Defect & Retest Process

### 8.1 Lifecycle

`Capture → Triage → Assign (severity/owner/fix target) → Fix build → Retest → Close` — a defect closes only on a named fix build, never on "works now".

### 8.2 Severity Matrix

| Severity | Definition | Examples | Retest |
|----------|-----------|----------|--------|
| **S1** | Financial/controls integrity broken; wrong money, wrong authority, data loss | Oracle mismatch; cross-client leak; NAV approved on stale input | Full linked journey regression |
| **S2** | Control inoperative but no wrong financial value | Missing evidence original; no durable package ID; sandbox handshake simulated | Case + linked journey steps touching shared logic |
| **S3** | Functional defect with workaround | Wrong label, sort, filter default | Case retest |
| **S4** | Cosmetic | Alignment, wording | Opportunistic |

### 8.3 Regression Scope Rule

If the fix touches **shared cash, matching, source ingestion, authentication, or NAV logic**, the regression scope is the **entire linked journey** (Workbook Journeys sheet), not only the failing case.

### 8.4 Retest Log Requirements

Retest Log row: defect ID, fix build (commit + time), tester, environment, original EV-IDs, new EV-IDs, result, regression scope executed, release-gate impact.

### 8.5 Fix Build Identification

The executing build is identified by commit `730f3cd` + working-tree delta hash (Section 3.4). A fix build must record a new commit SHA; retests run only on the new freeze.

---

## 9. Evidence & Sign-off

### 9.1 Evidence Register Fields

`EV-ID | Type (screenshot/linked record/export/harness output) | Path | Correlation IDs (request/business object) | SHA-256 (originals) | Build | Tester | Captured (UTC)`

### 9.2 Sampling Rules

As Section 7.5. Evidence without a business object ID or correlation ID is an automatic Evidence gap for that step.

### 9.3 Sign-off Authority Matrix (Manual §14 — 8 authorities)

| # | Authority | Signs for | Required before signature |
|---|-----------|-----------|---------------------------|
| 1 | UAT Lead | Cycle completeness | All P0 cases dispositioned; gates G01–G07 passed; evidence register complete |
| 2 | Investment Director | Orders/construction/valuation decisions | ORD/CON/RES/NAV P0 passes; J02, J08, J09 |
| 3 | Operations Lead | Reconciliation/custody/cash ops | REC/CSH/OPS P0 passes; J03–J06; IF-04/IF-05 closed |
| 4 | Finance / Fund Accounting | Journals, close, financial statements | ACC/NAV P0 passes; J02, J06, J14; oracle evidence |
| 5 | Compliance / Risk | KYC, limits, breaches, filings | ONB/RSK/REG P0 passes; J01, J12, J16 |
| 6 | Security / Platform | IAM, secrets, isolation, resilience | IAM/DAT/NFR/DEP P0 passes; IF-13 closed; J17, J18 |
| 7 | Investor Services Owner | LP portal & client journeys | LP P0 passes; J01, J07, J15 |
| 8 | Release Sponsor | Production authorisation | All above + exit gates; unresolved risk statement |

**Rule:** Prototype/UI-only acceptance ≠ production authorisation. Each signature must identify exact build, tested scope, unresolved risk, and supporting evidence.

### 9.4 Waiver Process

N/A outcomes and Blocked modules (CST) require a Waivers-sheet entry: scope, reason, compensating control, approver, expiry. Unapproved waiver = step remains Blocked.

---

## 10. Source Inspection Flags (IF-01–IF-15) — Triage Checklist

**Rule (Manual §11):** these are V33-era source observations, not executed defects. Each flag is triaged by (a) verifying the source locator on the frozen candidate, (b) reproducing on the running stack where the runtime claim applies, (c) assigning owner + disposition. Dispositions: **Closed–Not Present** (verified fixed/absent in candidate), **Confirmed–Open** (raise defect), **Accepted–Documented** (limitation recorded, e.g. demo data labelling), **Target–Runtime Missing** (V57–V66 requirement without runtime).

Full triage record with evidence: `uat-execution/IF-triage-record.md`. P0 flags block their dependent cases (Section 5.2) when disposition is Confirmed–Open.

---

## 11. Appendix

### 11.1 Case ID Lookup Quick Reference

| Module | Case range | Wave | Blocking flags |
|--------|-----------|------|----------------|
| DEP | DEP-001–008 | 1 | IF-01, IF-15 |
| IAM | IAM-001–008 | 1 | IF-06, IF-13 |
| DAT | DAT-001–005 | 1 | IF-04 |
| ONB | ONB-001–011 | 2 | IF-02, IF-03 |
| ORD | ORD-001–014 | 2 | IF-14 |
| REC | REC-001–017 | 2 | IF-05 |
| CSH | CSH-001–007 | 2 | — |
| NAV | NAV-001–007 | 2 | IF-09 |
| ACC | ACC-001–013 | 2 | V66 gap |
| LP | LP-001–006 | 2 | IF-13 |
| CON | CON-001–004 | 3 | IF-10 |
| MOD | MOD-001–003 | 3 | IF-11 |
| REG | REG-001–003 | 3 | IF-12 |
| RPT | RPT-001–009 | 3 | IF-12 |
| CST | CST-001–005 | 4 | **Blocked** |
| BI / AI | BI-001–005 / AI-001–003 | 4 | **Target** |
| CMP | CMP-001–003 | 4 | IF-08 |

### 11.2 Oracle Formulas (for manual recomputation)

- **Buy→NAV:** NAV_after = 100,000 − 1,010 + (1,000 + 100) × 12 = 112,090; units = 100,000; NAV/unit = 1.1209
- **Sell branch:** cash = 96,090 + (50 × 12 − 5) = 96,685 → withdrawal 500 → 96,185 (see OR-012–015 for fixture-specific bases)
- **Bank fee:** balance_after = 99,850; journal Dr Fees expense 150 / Cr Cash 150
- **TWR:** (1 + 0.02) × (1 + 0.03) − 1 = 0.0506; active = 5.06% − 4.00% = 1.06pp
- **DPI** = distributions 250k / paid-in 1,000k = 0.25x; **RVPI** = 1,250k / 1,000k = 1.25x; **TVPI** = 1.50x
- **Collateral:** eligible = 100,000 × (1 − 0.20) = 80,000; shortfall = 85,000 − 80,000 = 5,000

### 11.3 Browser Profile Commands (22 profiles)

```bash
# Chrome: one profile per identity (never share cookies/sessions across roles)
chrome --user-data-dir="$TEMP/uat-profile-01" http://localhost:3100   # UA-ADMIN-01
chrome --user-data-dir="$TEMP/uat-profile-02" http://localhost:3100   # UA-PM-01
chrome --user-data-dir="$TEMP/uat-profile-03" http://localhost:3100   # UA-DEAL-01
chrome --user-data-dir="$TEMP/uat-profile-04" http://localhost:3100   # UA-OC-02
chrome --user-data-dir="$TEMP/uat-profile-05" http://localhost:3100   # UA-OP-01
chrome --user-data-dir="$TEMP/uat-profile-06" http://localhost:3100   # UA-OP-02
chrome --user-data-dir="$TEMP/uat-profile-07" http://localhost:3100   # UA-FA-01
chrome --user-data-dir="$TEMP/uat-profile-08" http://localhost:3100   # UA-FA-02
chrome --user-data-dir="$TEMP/uat-profile-09" http://localhost:3100   # UA-NAV-02
chrome --user-data-dir="$TEMP/uat-profile-10" http://localhost:3100  # UA-RPT-01
chrome --user-data-dir="$TEMP/uat-profile-11" http://localhost:3100  # UA-RPT-02
chrome --user-data-dir="$TEMP/uat-profile-12" http://localhost:3100  # UA-COMP-01
chrome --user-data-dir="$TEMP/uat-profile-13" http://localhost:3102  # UA-CS-01 (+3100)
chrome --user-data-dir="$TEMP/uat-profile-14" http://localhost:3101  # UA-INV-A
chrome --user-data-dir="$TEMP/uat-profile-15" http://localhost:3101  # UA-INV-B
chrome --user-data-dir="$TEMP/uat-profile-16" http://localhost:3104  # UA-CUST-A
chrome --user-data-dir="$TEMP/uat-profile-17" http://localhost:3104  # UA-CUST-B
chrome --user-data-dir="$TEMP/uat-profile-18" http://localhost:3103  # UA-COMPANY-A
chrome --user-data-dir="$TEMP/uat-profile-19" http://localhost:3100  # UA-MOD-01
chrome --user-data-dir="$TEMP/uat-profile-20" http://localhost:3100  # UA-MOD-02
chrome --user-data-dir="$TEMP/uat-profile-21" http://localhost:3100  # UA-AUD-01
chrome --user-data-dir="$TEMP/uat-profile-22" http://localhost:3102  # UA-APP-A
```

### 11.4 API Health & Environment Checks

```bash
curl http://localhost:4100/api/health          # {"status":"ok",...}
curl http://localhost:4100/api/v1/platform/flags  # live flags
curl -X POST http://localhost:4100/api/auth/login -H 'content-type: application/json' \
  -d '{"email":"<identity>","password":"<from secrets/uat-users.json>","portal":"admin"}'
mysqldump matanho_nexus > uat-execution/backups/matanho_nexus_$(date +%Y%m%d_%H%M).sql   # pre-journey backup
```

### 11.5 Credential References

Credentials: `secrets/uat-users.json` (never commit; never print in evidence). Authenticated subject IDs for the 24 provisioned personas: Section 4.5.

### 11.6 Sources Register

S01–S09 (delivered source artefacts), C01–C04 (V57–V66 conversation requirements), P01 (platform prototype) — mapped per module in Section 2.1 Source column and the Workbook Sources sheet.

---

**End of UAT Execution Plan (v1.0 complete — Sections 1–11).**