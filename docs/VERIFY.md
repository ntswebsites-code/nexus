# Verification: how to prove the build

| What | Command | Needs |
|---|---|---|
| Everything static (prisma validate + generate, tsc for shared/api/legacy-runtime/portal-kit, tsc for all five portals, offline rule tests, shell syntax) | `npm run verify` (root) | `npm ci` only |
| Offline rule tests (nav engine arithmetic, admin-core rules, clients-onboarding rules) | `npm run test:offline` | nothing |
| API flow scripts, one fresh MySQL schema per script | `DB_ROOT_URL=mysql://root:pw@127.0.0.1:3306 bash tools/uat/run-flows.sh [script ...]` | disposable MySQL 8 and the `mysql` client |
| Same scripts on the UAT host, throwaway schema + temp API container, live data untouched | `bash tools/uat/server-flows.sh` (as root in `/opt/matanho-nexus`) | the compose stack running |
| Read-only smoke S1-S13 (S13 = GET sweep of every `/ops` family) against a running stack | `tools/uat/smoke.ts` (see header) | `SMOKE_API`, persona users file |

CI (`.github/workflows/ci.yml`): job `verify` runs the first two rows plus the UAT harness typecheck; job `flows` starts a
MySQL 8.4 service and runs `run-flows.sh`.

## Rules for the flow scripts

* Run them with `NODE_ENV=development` (the production login rate limit is 30 attempts per 15 minutes per IP and a script
  signs in many throwaway users) and restart the API between scripts so the in-memory limiter resets.
* Give the API and the script the same `STORAGE_DIR` and `PUBLIC_API_URL`, otherwise signed download URLs point at the wrong
  host and uploaded files are not visible to the API.
* A fresh schema per script: several scripts assume no leftovers (for example the risk script and firm-level seeded limits).
* `test-local-gaps` and `test-investee-workspace` need the seeded UAT personas (`seed-uat.ts`, `SEED_UAT_CONFIRM=1`) and a
  users file at `secrets/uat-users.json` with emails `<persona>@uat.matanho.test`; `server-flows.sh` generates that file
  from the server secrets at run time and deletes nothing it did not create.
* Step-up: enrolling MFA counts as a fresh step-up, so a "post without step-up" check must age the session first
  (`prisma.session.updateMany({ ... mfaVerifiedAt: now - 10 min })`), as `test-nav.ts` does.

## Result of the 3 Oct 2026 run (UAT host, image `uat-rc7` plus the fixes in this branch, throwaway schema)

All 23 scripts pass: test-accounting 95, test-admin-core 30, test-cash 93, test-clients-onboarding 20,
test-corporate-actions 89, test-ibor-performance 71, test-investee-workspace 24, test-local-gaps 31, test-nav 134,
test-orders 153, test-portfolio 80, test-recon 168, test-reports 114, test-research-privates 148, test-risk 168,
test-wiring 91, test-ws1 130, test-ws2 111, test-ws3 113, test-ws4 69, smoke-ws0 18, e2e-phase1 60 (all migrations apply
cleanly to a fresh MySQL 8.4). Read-only smoke against the live API: S1-S12 pass, S13 sweep passes except
`/data/datasets` which returned 500 on the deployed image (fixed here: dataset table name).

## Bugs the scripts exposed and the fixes

| Area | Defect | Fix |
|---|---|---|
| data-fabric | `/data/datasets` 500: registry pointed at table `portfolio_positions`, the table is `positions` | `data.engine.ts` table name |
| corporate-actions | read-only auditor could create, edit, confirm and cancel events (only `operations.view` was required) | new permission `corporate_actions.manage` on the write routes, granted in `role-catalog.json` to every role that could write before except auditor |
| roles | auditor could not read Research (no `research.view`) although read-only on every other area | `research.view` added to auditor |
| scripts (stale, not product bugs) | step-up negative checks after MFA enrolment, scrip/rights deadline after pay date, 4 dp money rounding, entitlement total, merger pay date after scrip, IBOR reconcile needs a mapped custodian account, datasets row count, investee flag `all`, LP bank change needs an enrolled factor | edited in the scripts |
