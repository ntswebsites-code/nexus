# Build status and hand-over (1 Oct 2026; UAT cut prepared locally, not deployed)

## 0. Checkpoint — 3.1 through 3.6 (done locally). 3.7 not deployed.

3.1 re-verify of merged `dev` stays green (see the table below). After that, on disposable MySQL `nexus_uat`:

| Step | Result |
|---|---|
| 3.2 UAT seed + LP contract harness (`lp_a_manager`, values on) | all 12 domains PASS. `LP_LIVE_DOMAINS` set locally to every domain. Rollback is clearing that env var and restarting the API. |
| 3.3 Ops console | Term-sheet create now sends `company` (the company ref). Capital, distribution and dealing bodies already matched. J3 on the API: operations drafted and submitted, the maker's approve was `403 permission_denied`, the investment director's approve was `401 step_up_required` until a fresh code, then `200 APPROVED`, and the same Idempotency-Key replayed. Operations then issued the call. |
| 3.4 Investee adapter | Sign sends `consentTextVersion`. New threads send `{title, text}`. Letterhead save requires street, city and country. `INVESTEE_LIVE_ACTIONS` set locally to every action except `reports.template` (still 501). |
| 3.5 LP browser | Signatory login on port 3191, live dashboard with no Demo data ribbon, capital call 13 acknowledged. Step-up dialog appeared once the login MFA window had expired; the same call then acknowledged. DEF-374: the acknowledge and payment-confirmation keys are kept until the call succeeds. |
| 3.6 | Idempotency completion is written before the response is sent (notice acknowledge replay returned `Idempotent-Replayed`). The other gaps below are accepted for this cut. |
| 3.7 | Not deployed. SSH to 207.180.234.151 answered `Permission denied (publickey)`. No tag `uat-rc1` was pushed. |

Flags live only in the gitignored local `.env` (API port 4150). On the UAT host, set the same lists in `/opt/matanho-nexus/.env.production` before `up`:

`LP_LIVE_DOMAINS=session,dashboard,capital,activity,dealing,performance,documents,notices,requests,organisation,settings,reports`

`INVESTEE_LIVE_ACTIONS=dashboard,profile,company,reports.schedule,reports.history,reports.detail,reports.draft,reports.upload,reports.submit,kpis.submit,termSheets.list,termSheets.view,termSheets.sign,termSheets.decline,settings.profile,settings.company,settings.letterhead,threads.start`

The UAT seed rolls an issued-but-unpaid capital call's due date to five days ahead when the machine clock has passed the snapshot date, so the open call stays due-soon. Historical activity dates are not moved.

## 0a. Checkpoint — 3.1 re-verify merged `dev` (done)

Re-run on merged `dev` (`ee87cc4` plus the resume-view fix) against a disposable MySQL 8 schema (`prisma migrate deploy` of the three existing migrations, `prisma/seed.ts`). API on port 4150. No new migration.

| Check | Result |
|---|---|
| `npm ci`, `npm run typecheck`, `tsc --noEmit` in all five portals | green |
| `npm run build -w @matanho/api` and `next build` for admin, investor, onboarding, company, custodian | green (investor-web included) |
| `scripts/test-ws2.ts` (run first; LP step-up) | all passed |
| `scripts/smoke-ws0.ts` | all passed |
| `scripts/test-ws1.ts` | 128 passed |
| `scripts/test-ws3.ts` | all passed |
| `scripts/test-ws4.ts` | all passed after one integration fix |
| `scripts/e2e-phase1.ts` with `SEED_DEMO=1` | all passed |

Integration fix: the public onboarding resume view read `beneficial_owners` without an order, so `ownerDetails[1]` was not the second owner the applicant entered. The view now follows the order stored on the draft. Schema unchanged.

3.2–3.6 continued the same day. See section 0. Nothing is deployed.

Hand-over from the local build agent to Cursor cloud agents. Read with `docs/HANDOFF.md` (guardrails),
`docs/DEV-PLAN-1DAY.md` (THE plan), `docs/BUILD-PLAN.md` sections 3, 4, 12, `docs/SRD.md` + `docs/srd/*`,
and `docs/DECISIONS-NEEDED.md` (D-01 to D-32: interim choices awaiting confirmation).

## 1. Where things stand

Branch `dev` contains everything. All eight workstream branches are merged; nothing is pending on a side branch.

| Commit | What |
|---|---|
| `116d4a7` | WS0: additive migration `20261001100000_day1_fund_ops` (schema frozen), LP contract types + zod (`packages/shared/src/lp-portal*.ts`), role catalogue (lp.* bundles, staff fund-ops codes, custodian roles), `/api/v1/platform/flags`, LP facade (`modules/lp-portal`), `lib/idempotency.ts`, stub mounts |
| `22da7b8` | ws/3-investee: `/api/v1/investee-portal/*`, reporting loop (J5), term sheets issue + sign (J6), `/ops/term-sheets` |
| `ef3cabf` | ws/2-capital: LP capital calls, distributions, dealing; `/ops/funds`, `/ops/capital-calls`, `/ops/distributions`, `/ops/dealing` (J3, J4) |
| `5616c2c` | ws/4-custodian: custodian API + day-end (J7), public onboarding field/evidence mapping (J1B), custodian-web + onboarding-web live scripts, `/ops/custodian` |
| `dad201a` | ws/8-deploy-qa: Mailpit, `deploy/deploy.sh` + `rollback.sh` (plan section 8 runbook), `tools/uat/*` (pack-release, mock seed exporter, contract harness, smoke S1-S12), `prisma/seed-uat.ts` |
| `1ef4288` | ws/6-investee-ui: company-web investee adapter, live-action allowlist, Demo data ribbon |
| `1bdf272` | ws/1-lp-core: all LP domains except capital/dealing live (session, dashboard, activity, performance, documents/vault/e-sign, notices, requests/messages, organisation, settings, reports), `/ops/notices` |
| `6904ffe`, `54a3b34`, `a921f4d` | Integration fixes: custodian in `MFA_PORTALS`; step-up on LP acknowledge / payment confirmation / subscribe / redeem; ignore `backend/api/storage/` |
| `79cea34` | ws/5-lp-ui: credentialed LP client, flags from API, Demo data ribbon, step-up dialog, idle timeout |
| `b095351` | ws/7-ops-console: native React ops console at `/ops` in admin-web (`src/app/(ops)`, `src/ops/*`), legacy sidebar link |

### Verified
- On each workstream branch before merge: API typecheck + `tsup` build; per-workstream API test scripts green
  against a disposable DB: `scripts/smoke-ws0.ts` (18), `test-ws1.ts` (128), `test-ws2.ts` (~110), `test-ws3.ts` (118),
  `test-ws4.ts`; WS8 seed (idempotent x3), harness, smoke (read-only 0 fail; full 15 pass / 0 fail / 12 skip).
- On `dev` after merges: API typecheck green; `tsc --noEmit` green for company-web, custodian-web, investor-web and
  admin-web (onboarding-web was green on ws/4).
- Portal builds: `next build --webpack` green on ws/4 (custodian, onboarding), ws/6 (company), ws/7 (admin).
  Turbopack fails ONLY in worktrees whose `node_modules` is a junction outside the folder; not expected in Docker.

### Not verified yet (do these first)
- The functional test scripts have NOT been re-run on merged `dev` (only per branch). Especially `test-ws2.ts`, edited
  for the LP step-up change (54a3b34) and never run.
- No portal has been checked in a real browser end to end (WS7 rendered `/ops` headless; WS5 login landed on
  `/lp-portal` but the live session render was not observed).
- `next build` for investor-web on dev.
- Nothing is deployed to UAT for this build. No flags are flipped.

## 2. Journeys (UAT cut line)

| Journey | Backend | UI | State |
|---|---|---|---|
| J0 access and security | done (MFA, step-up, roles, IDOR tests) | portal-kit login per portal | needs browser pass + UAT-18 |
| J1A staff-assisted onboarding to LP first login | done (invite -> accept -> /session); see D-14 | LP login wired (WS5) | needs browser pass |
| J2 LP documents, notices, requests | done (WS1) | LP portal wired via flags | flip `documents,notices,requests` after harness green |
| J3 capital call to paid | done (WS2) incl. ops endpoints | ops console screens (WS7), LP capital screens | align ops console bodies (3.3), run with maker + checker |
| J5 investee reporting loop | done (WS3) | company-web adapter (WS6) | align paths (3.4), set `INVESTEE_LIVE_ACTIONS` |
| J4 dealing | done (WS2) | LP dealing screens + ops dealing queue | test after J3 |
| J6 term sheets | done (WS3) | ops + company-web terms | align paths (3.4) |
| J1B public onboarding | done (WS4) | onboarding-web live scripts | `ONBOARDING_LIVE` |
| J7 custodian day-end | done (WS4) | custodian-web live scripts | needs counterparty users in seed / enrolment |
| J8, J9 | not started | | cut per plan order |

Nothing has been cut yet. Plan cut order if behind: J8, J7, J9, J1B, J6, J4, then reduce J3, then J5.

## 3. Next steps (in order)

### 3.1 Re-verify merged dev (blocking)
1. `npm ci` (cloud) then `npm run typecheck`; `npx tsc --noEmit -p tsconfig.json` in every `portals/*`.
2. `npm run build -w @matanho/api`; `npx next build` in every portal.
3. Fresh MySQL 8 schema: `npx prisma migrate deploy; npx tsx prisma/seed.ts` (backend/api), start API, then with
   `E2E_CONFIRM=throwaway-db E2E_API=http://localhost:<port>` run `scripts/smoke-ws0.ts`, `test-ws1.ts`,
   `test-ws2.ts`, `test-ws3.ts`, `test-ws4.ts`, `e2e-phase1.ts`. Read each script header for env (CORS origins must
   include every portal origin). Fix integration breakages only.

### 3.2 Contract harness and flags (checkpoint 2)
- Seed UAT personas into a disposable DB (`SEED_UAT_CONFIRM=1 SEED_USERS_FILE=<out-of-band json> npx tsx prisma/seed-uat.ts`),
  run `tools/uat/contract-harness.ts` (env in its header). Earlier the `reports` domain failed on shape against the WS0
  stub; WS1 replaced it - confirm green.
- Flip domains only when green: `LP_LIVE_DOMAINS=session,documents,notices,requests,...` (API env) - rollback = edit and
  restart API. Never fall back silently to demo data.

### 3.3 Ops console vs backend (WS7 built against the contract before the backend merged)
Check `portals/admin-web/src/ops/types.ts` + request bodies against `backend/api/src/modules/ops/*.routes.ts`:
cancel/reject send `{reason}`; distribution create sends `{fundId, distributionDate, type, grossAmount, carryAmount,
adjustmentsAmount, notes?, allocationMethod, allocations?}`; dealing process sends `{dealingNavPerUnit, unitsAllocated?, notes?}`;
term sheet create uses company **ref**; Idempotency-Key on every write; responses unwrapped from `{data}`. Confirm status names
(notices/term sheets `PENDING_APPROVAL`/`APPROVED`, dealing per schema). Then run J3 in the browser: operations maker drafts
and submits, investment director approves (step-up) and issues, record payment; check SoD error and same-key retry.
Confirm the `/ops` link shows in the legacy sidebar.

### 3.4 Investee UI vs backend
WS6 guessed some paths (`termSheets.view/sign/decline`, `settings.letterhead`, `threads.start`, `reportingPeriod` format);
compare `portals/company-web/src/lib/investee/*` with `backend/api/src/modules/investee-portal/investee.routes.ts`
(endpoint list at top) and `investee.contract.ts`; align the UI to the backend. Then set `INVESTEE_LIVE_ACTIONS`.

### 3.5 LP UI
Browser pass with an MFA-enrolled SIGNATORY: login, live session (no ribbon), step-up dialog on capital-call acknowledge,
same Idempotency-Key on retry. DEF-374 is closed for capital-call acknowledge and payment confirmation: the key is kept until that attempt succeeds.

### 3.6 Known gaps to close or accept
- Idempotency (`lib/idempotency.ts`) now marks COMPLETED before the response is sent. Closed.
- Identity invitation accept does not copy LP role/fund scope or un-revoke a re-invited member (D-14 workaround in place).
- No staff screen to verify LP bank-instruction changes (they stay "Pending verification").
- Custodian: no counterparty-user invitation/enrolment flow; if `mfa_required` is on they cannot enrol themselves.
- Investee: BR-252 revenue variance rule, fund countersignature, report templates, team management (501).
- WS2: subscription attachments not stored; XLSX export served as CSV; no holiday calendar.
- Screening stub ignores applicant sanctions declarations.
- `tools/legacy-bridge.mjs --check` reports manifests out of date (pre-existing).
- Mailpit image uses `latest` - pin before go-live. Plan data counts differ slightly from mock-derived seed.
- Credential hygiene: a local `DATABASE_URL` (user `matanho_app`) from a gitignored `.env` was printed in an agent's
  local tool output once. Never committed. Rotate if it is shared with any real environment.

### 3.7 Deploy (code freeze) - plan section 8 runbook only
WS8 tooling: `tools/uat/pack-release.ps1 -Ref <frozen commit> -Release <rel>` -> upload as printed ->
`SEED_UAT=1 DETACH=1 bash /root/nexus-releases/<rel>/deploy/deploy.sh <rel> api worker admin investor onboarding company custodian mailpit`
-> `tail -f /root/nexus-backups/<rel>/deploy.log` -> rollback `bash /root/nexus-backups/<rel>/rollback.sh [--flags-off] <rel> <services>`.
Before the first deploy, on the server only: add `SMTP_HOST=mailpit`, `SMTP_PORT=1025`, `SMTP_SECURE=false`,
`CUSTODIAN_PORTAL_URL`, custodian origin in `CORS_ORIGINS`, and `LP_LIVE_DOMAINS`, `INVESTEE_LIVE_ACTIONS`,
`CUSTODIAN_LIVE`, `ONBOARDING_LIVE` to `/opt/matanho-nexus/.env.production`; persona entries to
`/opt/matanho-nexus/secrets/users.json` (600). Never commit these. UAT host 207.180.234.151, `/opt/matanho-nexus`;
do not touch other projects on that server; restart host nginx only after `nginx -t` and only for config changes.

## 4. Guardrails (unchanged)
Schema frozen (one additive migration for the day). Every query scoped by client/company/counterparty with IDOR tests.
Money actions: permission + step-up + maker/checker + audit (`writeAudit` inside a transaction) + Idempotency-Key.
Never fall back silently to demo data; non-live screens show the "Demo data" ribbon. Never commit `.env*`, secrets,
users files or `backend/api/storage/`. Never force-push or rewrite history. NVCCZ repos are reference only; do not copy
their defects (letterhead IDOR, unguarded cap-table list, unfiltered company update, logged temporary password).

## 5. Local environment notes (for anyone continuing on the original machine)
Private MySQL 8.4 on 127.0.0.1:43306 (data in `%LOCALAPPDATA%\nexus-mysql\data`, user `nexus_dev`, schemas
`nexus_dev`, `nexus_e2e`, `nexus_ws1`..`nexus_ws8`). Workstream worktrees under `C:\Users\lysp\Downloads\nx-ws\ws1..ws8`
(branches `ws/*`, all merged; safe to remove with `git worktree remove`). Local ports used: API 41xx, portals 42xx.
