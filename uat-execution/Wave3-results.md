# Wave 3 Execution Results — CON, MOD, REG, RPT (11 October 2026)

**Cycle:** UAT-2026-10-A | **Build:** `730f3cd` + working-tree deltas
**Method:** API lifecycle probes with segregated identities (`wave3-probe.ts`, `wave3b-probe.ts` + PowerShell completions; outputs in `uat-execution/wave3*-probe-output.json`). Evidence IDs `EV-<Case>-<Step>-<Seq>`.

## Module Results

| Module | Status | Evidence (actual outcomes) |
|--------|--------|----------------------------|
| **CON** | **Pass** | Research: 3 cases (RSC-1002 PUBLISHED, RSC-1003 IN_REVIEW). IC decision on published case → **ICD-1006 created (201)**; decision on IN_REVIEW case correctly blocked (409 "take only published research to the committee"). Seeded promotion chain verified: ICD-1002 → ORD-001009 (real linked OMS draft). Rebalance: RBL-00001 created (201); promotion to orders → **409 "breaches the mandate after the trades: Maximum cash"** — mandate constraint gate blocks OMS promotion (CON-002/003 control working). |
| **MOD** | **Pass** | Models live: PMD-1001 ACTIVE, PMD-1002 draft. Lifecycle: create (201) → revise (200, version incremented) → **self-activation 403 "A model must be activated by someone other than its author (maker-checker)"** → independent activation by operations identity (200, ACTIVE) → **post-activation change returns model to DRAFT** (prior approval invalidated) → retire gated. |
| **REG** | **Pass** | 4 filings (SECZ/FIU) + 4 templates. populate (200) → evidence upload (201, real PDF) → submit-review (200, IN_REVIEW) → **preparer self-approve 403 "The preparer cannot approve their own filing (maker-checker)"** → independent approval by second compliance identity (200, **APPROVED**) → export (200). Sysadmin (no regulatory.approve) → 403 (RBAC). |
| **RPT** | **Pass** | Catalogue 5 definitions (CASH, FACT_SHEET, HOLDINGS, NAV_PACK, TRANSACTIONS). Run create HOLDINGS (201); NAV_PACK run for fund-linked portfolio PF-1002 (201, COMPLETED) → **distribute to LP portal (200, COMPLETED)** — now visible to investors with active commitments. Distribution permission-gated (403 for creator/client_services; only reports.approve roles). HOLDINGS distribution correctly rejected (400 — only fact sheets/NAV packs go to LP portal). |

## Controls Verified in Wave 3

1. **Maker-checker on model activation and filing approval** — same-actor approval blocked with explicit messages.
2. **Mandate enforcement on construction→OMS promotion** — rebalance that would breach mandate limits cannot create orders.
3. **Evidence requirement on filings** — cannot send for review without attached evidence.
4. **Research publication gate** — only published research reaches committee decisions.
5. **Model invalidation on change** — post-approval edits return the model to draft (no stale approvals).
6. **Report distribution scoping** — only fact sheets/NAV packs for fund-linked portfolios publish to the LP portal.

## Remaining Wave 3 Notes

1. NFR-001–009 not executed — G03 p95/concurrency targets still PROPOSED pending business-owner approval (blocks NFR execution only).
2. UI-level verification of CON/MOD/REG/RPT pages deferred (Playwright unavailable this session); API lifecycles fully verified — recommend browser confirmation before sign-off.

**Wave 3 summary: 4/4 modules Pass on P0 lifecycles.**
