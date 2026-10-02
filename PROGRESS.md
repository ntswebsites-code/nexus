# Progress

`dev` @ **`c56fadd`** (pushed to `origin/dev`). Nothing deployed to UAT.

## Cloud agent session — 2 Oct 2026 (Matanho Nexus takeover)

### What was done

1. **Repository sync (STEP 0)**  
   - `git fetch origin`, checkout `dev`, `git pull --ff-only origin dev`.  
   - Started from `a565741`; ended at `c56fadd` after two commits (see below).

2. **HANDOVER plan §3.1 — re-verify merged `dev` (blocking)**  
   - `npm ci`; `npx prisma generate` in `backend/api`; `npm run typecheck`; `tsc --noEmit` in all five portals.  
   - `npm run build -w @matanho/api`; `next build` for admin, investor, onboarding, company, custodian.  
   - Fresh disposable DB: drop/create `matanho_nexus`, `prisma migrate deploy` (3 migrations), `prisma/seed.ts`.  
   - API started on port **4150** with `CUSTODIAN_LIVE=true` and `ONBOARDING_LIVE=true` (required by `test-ws4.ts` header).  
   - Integration scripts (in order): `test-ws2.ts` → `smoke-ws0.ts` → `test-ws1.ts` → `test-ws3.ts` → `test-ws4.ts`, each with `E2E_CONFIRM=throwaway-db` and `E2E_API=http://127.0.0.1:4150`.  
   - `SEED_DEMO=1 npm run db:seed`, then `e2e-phase1.ts` with `E2E_CONFIRM=throwaway-db` — all checks passed.

3. **Code changes (integration breakages only; schema unchanged)**  
   - **`backend/api/src/modules/investee-portal/investee.service.ts`:** added `flattenReportingKpis()`; `reportingRequestView` now returns numeric KPI maps only (flatten `AUTO_KPI_FLAT`, drop nested buckets per BR-204).  
   - **`backend/api/src/modules/investee-portal/investee.routes.ts`:** `GET /kpis` period `values` uses the same flatten helper.  
   - **`backend/api/scripts/test-ws3.ts`:** removed assertion that expected HTTP 400 when compliance file was missing before submit; behaviour changed when `attachGeneratedPackFiles` auto-generates required uploads on pack submit (`e1f225d`).

4. **Documentation**  
   - **`docs/HANDOVER-STATUS.md`:** new §0 cloud checkpoint (3.1 results, fixes, blocked 3.2/3.7); prior 1 Oct notes kept as §0 archive.  
   - **`PROGRESS.md`:** this session log.

5. **Git**  
   - Branch used: `cursor/ws3-reporting-kpis-flatten-78f1`, fast-forward merged into `dev`.  
   - Commits on `dev`:  
     - `c541bc1` — Fix investee reporting KPI flattening for live hydration payload.  
     - `c56fadd` — Document cloud 3.1 re-verify and blocked 3.2/3.7 steps.  
   - Pushed: `origin/dev`, `origin/cursor/ws3-reporting-kpis-flatten-78f1`.

### What was not done (blocked)

| HANDOVER step | Reason |
| --- | --- |
| 3.2 UAT seed + `tools/uat/contract-harness.ts` | No out-of-band `SEED_USERS_FILE` / `secrets/users.json` on the cloud VM. |
| 3.3–3.5 Browser journeys | Not re-run; 1 Oct local verification remains authoritative until personas file + portals are configured here. |
| 3.7 Deploy, tag `uat-rc1`, smoke S1–S12 on host | SSH to `207.180.234.151` fails (`Permission denied (publickey)` / no deploy key). |

### Artifact paths (cloud run)

- `/opt/cursor/artifacts/api-4150.log` — API on 4150  
- `/opt/cursor/artifacts/e2e-phase1.log` — e2e after demo seed  

### Next actions (when unblocked)

1. Mount or inject `SEED_USERS_FILE` → `SEED_UAT_CONFIRM=1 npx tsx prisma/seed-uat.ts` → contract harness → set `LP_LIVE_DOMAINS` only when green.  
2. Provision UAT SSH key → runbook §8 (`pack-release` + `deploy.sh`) → tag `uat-rc1` → smoke S1–S12 on host.

## Phases

| Phase | Status | What was built | Verification |
| --- | --- | --- | --- |
| P0 Decisions and plumbing | Complete (earlier) | Idempotency, envelopes, flags, role catalogue, live routers | Prior API typecheck and local smoke |
| P1 LP read-only | Complete (earlier) | Documents, notices, session, IDOR fix for document reads | Clicked in the investor portal |
| P2 Capital and distributions | Complete (earlier) | Capital call to paid. Maker issues after the checker approves | CC-00002 paid in the browser |
| P3 Dealing | Complete | Subscription submit now sends `bankAccountId` and `requestedDealingDate`. The queue shows Process on Awaiting funds / Under review and Approve on Awaiting NAV | LP manager submitted DLR-00001 (subscription, bank stored) and DLR-00002 (redemption, 100 units). Operations accepted and processed both. The investment director approved both. Both are `COMPLETED`. No Demo data ribbon |
| P4 Performance, service desk, organisation | Complete (earlier) | Performance PDF, bank-instruction verify, colleague flows | Prior local checks |
| P5 Investee reporting | Complete (earlier) | Staff open a period, company submits, staff accepts | PC-101 2026-10 accepted in the browser |
| P6 Term sheets | Complete | Compliance can countersign (`term_sheets.approve`). Company sign, countersign, and execute | TS-1004 is `EXECUTED`. Compliance countersigned. The director, who issued it, marked it executed |
| P7 Cap table and governance | Complete within the schema freeze | Register, forecast, and governance live on the existing `Setting` store | Cap CSV and round simulate clicked earlier. Seven new GL tables were not added |
| P8 Requests, data room, messages, forecast | Complete (earlier) | Capital request, vault, threads, forecast | REQ-2055 approved in the browser. The decision does not move cash |
| P9 Custodian | Complete | Day-end submit, second-user approve, staff accept. Server SHA-256 | Execution `TR-3987788` received. Package `CDE-10001` is `Accepted` with a stored SHA-256. Trade count 1 |
| J1B Public onboarding | Complete | Live public wizard (already wired) | `ONB-104830` submitted with the nine required evidence files. Staff Onboarding page shows `KYC-1001`, stage Screening, 9/11 evidence. No Demo data ribbon on the public form |
| P10 Hardening | Local checks done. Host items skipped | Auth smoke follows the configured portal origins | API, admin, and investor typechecks passed. Root typecheck passed. `npm run smoke -w @matanho/api` passed (26 checks) |

## Assumptions

- The schema stays frozen. Cap table, governance, forecast, and capital requests keep using the `Setting` JSON store.
- Sanctions screening stays the advisory stub `stub-screening-v1`. No external vendor was selected.
- An open-ended fund is available when the LP has an active commitment, even if the commitment amount is 0. The position lives on the holding (184,233.4821 units).
- Compliance is the second term-sheet approver, so the issuer is not the only person who can countersign.
- The LP manager can subscribe and redeem because that role ranks at or above signatory.
- Host deploy stays forbidden. Production object storage and a malware scanner were not added.

## Blockers

- **UAT deploy / `uat-rc1`:** no SSH private key on the cloud agent VM (2 Oct attempt).
- **3.2 harness:** no `SEED_USERS_FILE` on the cloud agent VM.
- UAT host deploy was not run on the original local machine either (forbidden / no key).
- No penetration test, k6 load test, or backup restore drill.
- Mailpit is not running locally, so mail smoke (S12) still skips on API-only runs.
- Workstream scripts require `E2E_CONFIRM=throwaway-db` and a disposable DB (used correctly on 2 Oct cloud 3.1).

## Manual follow-up

- Leave the local API and portals running if you want to click the same journeys. Sign-in details stay in the secrets file and are not written here.
- A worker process is not running, so queued notification emails are not delivered until a worker starts.
- Do not deploy this branch to the UAT host.
