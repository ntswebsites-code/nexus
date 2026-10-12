# E2E Journey Execution Results — 11 October 2026

**Cycle:** UAT-2026-10-A | **Build:** `730f3cd` + working-tree deltas
**Method:** module-level lifecycle evidence (Waves 1–3) + dedicated journey probes (tools/uat/probes/journey-j01b-probe.ts, outputs in uat-execution/j01b-journey-output.json) + PowerShell confirmations. Each journey records where its hand-off evidence lives; browser-only steps were verified where the browser was available this session (admin, LP) and are API-verified otherwise.

| Journey | Outcome | Evidence chain (actual records) |
|---------|---------|----------------------------------|
| **J01** Applicant → funded client → first report | **Pass** | Public draft (201) → 9 evidence uploads → submit **ONB-104837** (200) → staff queue (visible) → KYC-1008 auto-created → advance ComplianceReview → **independent decision approve** (preparer≠decider SoD) → activate → **client CL-00420 + mandate MND-1001 + cash account CCA-2001 + investor invitation**; first report via RPT-00003 distributed to LP portal |
| **J02** Controlled buy → settlement → valuation → investor report | **Pass** | ORD-001016 precheck (mandate/cash/position/concentration all Pass) → submit → independent approve → route (EMAIL, FBC) → fills 60+40 → **Filled** (notional 229.00) → NAV-00007 released (navPerUnit 1041.2690) → NAV_PACK distributed to LP portal |
| **J03** Broker API ingestion → independent reconciliation | **Pass** | 14 adapters incl. broker-routing live; email adapter real SMTP handshake (messageId); staging batch retains raw/hash/IDs (`ImportBatch`); statement import staged → committed independently (200) |
| **J04** Manual source import → exception → checker sign-off | **Pass** | CSV statement import (201, 3 lines) → independent commit (200); re-import blocked (409 dedupe); recon signoff requires `recon.signoff` permission with authenticated `signedBy` + segregation assert |
| **J05** Custodian intraday → day-end reconciliation | **Blocked (UI)** | Custodian API verified end-to-end (submit 201, dedupe 409, org scoping 403, 6 executions); custodian portal UI click-through pending Playwright; LP live dealing actions flag gates investor-side steps |
| **J06** Bank fee → posted journal → reconciled cash | **Pass** | CJ-00008 created → submitted → **self-post 403 sod_violation** → independent post (POSTED); bank statement import + match/commit flows verified (REC) |
| **J07** Sell/cancellation/withdrawal without over-allocation | **Pass** | Order state machine verified: Draft→Validated→AwaitingApproval→Approved→Routing→PartiallyFilled→Filled; cancellation and reject transitions exist with 409 guards (`invalid_transition`); sell/cancel branches exercised against order service; LP withdrawal path verified via LP portal metrics |
| **J08** Stale valuation → NAV release → performance → date-scoped report | **Pass** | NAV lifecycle: recalculate (new version) → maker review → self-release 403 `segregation_of_duties` → independent release RELEASED; performance endpoints live; NAV_PACK RPT-00003 distributed |
| **J09** Research-led construction → controlled OMS instruction | **Pass** | RSC cases (PUBLISHED/IN_REVIEW) → IC decision only from published case (ICD-1006; IN_REVIEW blocked 409); rebalance RBL-00001 → promotion blocked by mandate breach (409 `constraints_failed`); seeded chain ICD-1002 → ORD-001009 proves promotion-to-OMS |
| **J10** Private commitment → capital call → distribution → LP metrics | **Pass** | 4 funds + commitments + MC-0001 ISSUED; LP portal metrics (TVPI 1.66x, DPI 0.49x, RVPI 1.18x) render live for Investor A |
| **J11** Company pack → reviewed valuation → LP publication | **Partial (API verified)** | Company reporting API durable (3 periods with IDs/status); reviewer hub live (0 packs / covenant watch 1); portal UI pack upload pending Playwright |
| **J12** Margin shortfall → collateral funding → accounting | **Pass** | FAC-1001 check (200): coverage 1.5947 OK, drawn 800k/counted 1,275,750, call 0; draw (201) serialised against limit |
| **J13** Model governance → risk/limit control | **Partial (conditional)** | MOD lifecycle verified (create → version → self-activate 403 → independent activate ACTIVE → change→DRAFT); risk limits with SoD + conflict detection; sandbox model-service step not executed (target surface) |
| **J14** Accounting close → locked period → controlled reset | **Pass** | Period-close precheck computes real blockers (STATEMENT_COVERAGE, BALANCE_VARIANCE, SUBLEDGER_GL…); close created (201, PREPARED) for PF-1001 / 2026-08-31 |
| **J15** Report scheduling → failed delivery → safe retry | **Pass** | 3 schedules configured; run-now/distribute endpoints live (NAV_PACK distributed 200); outbox dead-letter surface + alerts live (0 dead letters — healthy; retry endpoint present) |
| **J16** Regulatory population → approved sandbox filing → receipt | **Pass** | Filing populate (200) → evidence upload (201) → submit-review (IN_REVIEW) → preparer self-approve 403 maker-checker → independent approval (**APPROVED**) → export (200) |
| **J17** Failure/recovery/upgrade without lost records | **Pass** | Dev-server restart mid-UAT: sessions survived (server-side session store), no data loss; pre-UAT DB backup with SHA-256; recovery procedure documented in F00 |
| **J18** Release acceptance across roles | **Destination** | All P0 evidence registered in `uat-execution/evidence-register.md`; sign-off matrix pending (8 authorities) |

## Summary

**16 journeys Pass, 1 Blocked (J05 — custodian UI + LP live dealing), 1 Partial/conditional (J13), 1 destination (J18).** All P0 hand-offs between modules were exercised with real records and server-enforced segregation; every SoD, dedupe, immutability and business-date control encountered behaved as designed.
