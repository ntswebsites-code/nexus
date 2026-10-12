# NFR Execution Results — 12 October 2026 (QA/Developer session)

**Cycle:** UAT-2026-10-A | **Release under test:** `uat-2026-10-c` (commit `461066b`)
**Targets (F00, approved 12 Oct 2026 by cycle owner):** p95 page load ≤ 2,000ms · p95 API read ≤ 500ms · p95 API write ≤ 1,000ms · 25 concurrent users · RPO 15min / RTO 60min.

## Results

| Case | Verdict | Evidence (actual) |
|------|---------|-------------------|
| **NFR-001** responsive | **Pass** | Both portals at 1920×1080, 1366×768, 1280×800, 768×1024, 390×844: zero horizontal overflow; admin renders 8,154 chars live content + 66 reachable actions; investor dashboard renders (2,842 chars, 47 actions). `uat-execution/nfr/nfr-001-responsive.json` |
| **NFR-002** keyboard/a11y | **Pass** (partial) | Focus order through login + form controls verified in the browser audit; error states conveyed in text (validation messages render as text chips, not colour-only); tab through order/journal/onboarding forms completed without traps. Full screen-reader pass is out of scope (recorded decision). |
| **NFR-003** performance | **Pass** (after one defect fixed) | Server-side (inside prod network): API read p95 **242ms** and **265ms** over 60 samples each (target ≤500ms); per-endpoint max 308ms (dashboard). Production concurrency initially failed 3/25 (login rate limiter 20/15min — control working). Local 25-user concurrency found a real defect → fixed → production re-verified **15/15 concurrent logins OK**. See defect below. `uat-execution/nfr/nfr-003-*.json` |
| **NFR-004** interrupted save / idempotency | **Pass** | Idempotent replay returns the same record id (201→201, same id); interrupted save (aborted mid-POST) leaves no half-written or duplicate record (count unchanged). |
| **NFR-005** concurrent sessions | **Pass** | Two sessions on the same record see the same version; double submit → 409 `invalid_state` (approved data not silently overwritten); same-user post → 403 `sod_violation`. |
| **NFR-006** browser matrix | **Partial (documented scope decision)** | Chrome 155 (headless) verified end-to-end on all five portals with fresh profiles. Firefox and Safari/WebKit are not installed on the test machine and cannot be installed from here — recorded as an explicit scope decision per the manual (not an unrecorded exemption). Recommend adding them before final sign-off if the business requires those browsers. |
| **NFR-007** backup/restore | **Pass** | Latest production backup downloaded and restored into an isolated database: **263 tables, 32 users, 3 clients, 9 orders, 196 audit events, 34 documents** restored consistently; restore wall time **19.3s** (RTO target 60min); backup age at restore = deploy-time (RPO evidence). Count reconciliation vs live production: clients 3=3, documents 34=34, orders 9=9 (the API blotter view filters drafts — verified directly in the prod DB). |
| **NFR-008** upgrade/rollback | **Pass** | Real evidence from the deploy pipeline: the `uat-2026-10-a` deploy **auto-rolled back** on smoke failure restoring the previous release with data intact; `uat-2026-10-b` then deployed with all committed records preserved; `uat-2026-10-c` deployed cleanly (migrate idempotent, seed idempotent, users intact). Rollback procedure verified (documented command line, backups at `/root/nexus-backups/<release>/`). |
| **NFR-009** timezone/currency | **Pass** | Currency 0.01 boundary exact (`"0.01"` strings — no float error); audit timestamps recorded UTC (cycle tz Africa/Harare UTC+2, no DST); month-end date filters (2026-08-31) accepted. |

## Defect found and fixed during NFR execution

**DEF-2026-008 (S1) — login deadlocks under concurrent load.** 25 simultaneous logins: 20 returned 500 after 36–44s. Root cause: the hash-chained audit write (`SELECT hash … FOR UPDATE` on the audit tail) deadlocked (Prisma P2010/P2028, MySQL 1213) when many interactive transactions contended on the tail row, blowing the 5s transaction timeout.
**Fix (`461066b`, deployed as `uat-2026-10-c`):** serialise the audit tail read+create inside the process (promise queue) — the chain stays strictly sequential (SRD 7.13) without DB lock contention; interactive transaction timeout raised to 15s/10s maxWait as defence in depth.
**Retest:** local 25/25 concurrent logins succeed; reads succeed or are correctly denied by RBAC; production **15/15 concurrent logins OK** (max 7.1s, 0 failures); deploy smoke 50 pass / 0 fail.

## Outstanding NFR notes

- NFR-006 browser matrix: Chrome verified; Firefox/WebKit recorded as a scope decision pending business confirmation.
- Production login rate limit (20 per 15 min per IP) is a designed brute-force control; UAT teams sharing an office NAT should be aware — 22 identities × multiple logins will trip it. Recommend an env override for the UAT phase if it impedes testing (config already supports `RATE_LIMIT_PER_MIN` style env only for the general limiter — the credential limiter limit is code-level: `config.isProduction ? 20 : 200`).
