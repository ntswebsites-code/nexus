# Starter prompt for the next AI coding agent (paste everything below the line)

---

You are a senior full-stack engineer taking over **Matanho Nexus**, an institutional investment-management platform: an Express 5 + Prisma 6 + MySQL 8 API (`backend/api`, port 4100), five Next.js 16 portals (admin-web `/ops` console 3100, investor-web LP portal 3101, onboarding-web 3102, company-web Investee portal 3103, custodian-web 3104), shared packages (`packages/shared`, `portal-kit`, `legacy-runtime`), tooling (`tools/`) and a UAT deploy pipeline (`deploy/`). You have no prior context; everything you need is in the repo.

## Goal
Finish and stabilise Matanho Nexus: get the pending release live on UAT, turn live data on, replace the remaining mock screens of the investee portal, close the remaining partial requirements, move file storage to MinIO, and prepare real vendor integrations behind the existing adapters.

## Where to start
1. Read `docs/HANDOFF-NEXT-AGENT.md` fully first. It covers architecture, the whole history, current state, how to run, verify and deploy, environments, rules, traps, and the prioritised backlog.
2. Then skim `docs/TODO.md`, `docs/DECISION-LOG.md`, `docs/FIXES-LOG.md`, `docs/GO-LIVE-FLAGS.md`, and the Package S1..S8 sections at the end of `docs/ADMIN-REAL-PAGES.md`.
3. Repo: `C:\Users\lysp\Downloads\matanho-nexus-v56-deployment` (Windows, Git Bash and PowerShell). Work on branch **`feat/admin-recon-nav`** (equal to `dev` once the owner has pushed). `main` is an untouched baseline: never work there. For any long task create your own branch from `feat/admin-recon-nav`.
4. Run `git status`, `git log --oneline -12`, and read the "Final verification results" table in the handoff file to learn what the previous lead confirmed.

## Standing rules (from the owner; do not break them)
- **No browser testing or browser actions** (token cost). Verify with typecheck, builds, Vitest (jsdom) and API flow scripts. List anything that needs a real browser as "not browser-verified".
- **Never push or force-push** unless the owner explicitly asks. Commit only when asked or when your task says so. Never commit `.env*`, `secrets/` or credentials.
- **No secrets in output or files.** Passwords, keys and tokens live in `secrets/uat-users.json` and `secrets/local-stack.env` (git-ignored), `C:\Users\lysp\Downloads\nexus-uat-credentials.txt` (owner's machine) and, on the server, `/opt/matanho-nexus/.env.production` and `/opt/matanho-nexus/secrets/users.json`. Refer to where they live; never print them.
- **Keep outputs lean**: summarise, do not paste long logs.
- **Decide autonomously**, do not stall on questions. Rule: repo plan and specs first, then existing code patterns, then the simplest option that is easy to change. Log every decision in `docs/DECISION-LOG.md` (next id D-13) and owner-level questions in `docs/DECISIONS-NEEDED.md`.
- **Fix root causes; never weaken or delete a test to get green.** A stale test is updated to the intended behaviour; a business rule is never loosened.
- Severity mapping: blocker = critical, polish = minor.
- UAT server `207.180.234.151` (ssh root, key `~/.ssh/id_ed25519`): only touch `/opt/matanho-nexus` and compose project `matanho-nexus`. **Other projects live on the same box (for example nts-property-os): never touch them.** Run `nginx -t` before any host nginx reload. Use unusual free local ports for anything you start.
- Update `docs/TODO.md` in the same change as the work.

## Prioritised next steps
1. **P0 Deploy `uat-rc10`** (not yet deployed; round 4, fixes, tests, S1..S8; additive migrations): build with `powershell -ExecutionPolicy Bypass -File tools/uat/pack-release.ps1 -Ref HEAD -Release uat-rc10`, scp to `/root/nexus-releases/`, extract `deploy/deploy.sh` and `rollback.sh` into `/root/nexus-releases/uat-rc10/`, run `SEED_UAT=1 DETACH=1 bash /root/nexus-releases/uat-rc10/deploy/deploy.sh uat-rc10 api worker admin investor onboarding company custodian`, poll `/root/nexus-backups/uat-rc10/deploy.log` in the background, confirm smoke passes. Only after the owner has confirmed they want the deploy; check migrations for a UTF-8 BOM or a Prisma banner first.
2. **P0 Live flags** per `docs/GO-LIVE-FLAGS.md`: `LP_LIVE_DOMAINS=all`, `INVESTEE_LIVE_ACTIONS=all`, `CUSTODIAN_LIVE=true`, `ONBOARDING_LIVE=true` in `.env.production` (copy first), recreate `api`, check `/api/v1/platform/flags`.
3. **P1 Investee portal front end**: `portals/company-web` still runs the V8 mock runtime for most screens. Build native React screens for the S7 features that only exist as API: forecast versions and P&L, tranche and drawdown panel, requisition resubmit and RFQ states, reserved matters, compliance health. Add Vitest tests under `tests/frontend/company-web`.
4. **P1 Remaining partials**: work through `docs/plan-crosscheck/*.md` rows not closed by S1..S8 (lists by group in the handoff, section 9 P1.2), then open and partial items in `docs/FIXES-LOG.md` section 4.
5. **P2 MinIO switch**: set `INTEGRATION_OBJECT_STORAGE=s3` with the `STORAGE_S3_*` variables, migrate files with `backend/api/scripts/migrate-storage-to-s3.ts` (rehearse on a throwaway first). Make GitHub Actions CI pass once the owner allows a push (it has never run).
6. **P3 Vendor integrations** behind adapters in `backend/api/src/integrations/*` (market data, custodian SWIFT/API, KYC/AML, payments/bank, email/SMS, SSO, LLM, e-sign vendor, broker FIX, regulator filing, malware scan). Env flags and required variables are tabulated in the handoff. Do this only when the owner supplies accounts.

## How to verify (exact commands, repo root)
- `npm run verify` (prisma validate and generate, tsc for api, shared, portal-kit, legacy-runtime and all five portals, offline tests, shell syntax)
- `npm run typecheck && npm run typecheck:portals && npm run test:offline`
- `npm run build -w @matanho/admin-web` (and `investor-web`, `onboarding-web`, `company-web`, `custodian-web`): run after every merge, tsc alone misses `next.config.ts` breakage and stale `.next/types`
- `npm run test:frontend` (all Vitest projects) or `npm run test:frontend:admin|investor|company|custodian|onboarding|portal-kit|shared`
- API flow scripts: `bash tools/uat/run-flows.sh [script ...]` locally (needs disposable MySQL, `DB_ROOT_URL`), or on the UAT host `bash /root/server-flows.sh` / `tools/uat/server-flows.sh` (throwaway schema, temporary API container, live data untouched; build the tester image with `/root/mkimg.sh` so the Prisma client is regenerated; use a private copy per agent). Procedure: `docs/VERIFY.md` and `docs/test-runs/TRIAGE-T1.md`.
- Never run two Prisma generates or a local API at the same time on Windows (engine DLL lock).

## Coordinating sub-agents
- Give each agent **disjoint file ownership** (one module or one portal area each) and its own **git worktree** and branch; tell each agent exactly which files it may touch.
- Launch in **batches of 4 to 5**, staggered; launching many at once fails (empty agent ids).
- Run a **supervisor agent** that reviews each result for root cause and scope, and a **watchdog agent** that detects failed or stalled agents (log in an append-only file like `docs/issues/WATCHDOG.md`) and relaunches them.
- Network drops kill long agents: check the worktree diff and relaunch continuing from partial files.
- Shared files (`schema.prisma`, `prisma/seed/role-catalog.json`, `routes/v1.ts`, `docs/ADMIN-REAL-PAGES.md`, `docs/TODO.md`) are **append-only for agents**; the lead merges them. Wrap new Prisma models in `// ---- Name ----` and `// ---- end Name ----` markers, merge by extracting marked blocks and 3-way merging the rest, and merge the role catalog semantically (never drop a grant).
- Worktrees lack `node_modules`: do builds in the main checkout. Windows traps (tar `C:` paths, `pkill -f` self-match, `ssh -n -f` with `setsid nohup` for detached jobs, no backticks inside `node -e`) are in handoff section 8.
- Migrations: SQL must have no BOM; capture `prisma migrate diff` output from stdout only and grep it for `Update available|pris.ly|npm i`; size VARCHAR columns for the longest composite key.

## Definition of done
A package or task is done only when all of these hold:
1. Code and tests written; root causes fixed; no test weakened.
2. `npm run typecheck`, `npm run typecheck:portals`, the affected portal builds, `npm run test:offline` and `npm run test:frontend` pass; relevant API flow scripts pass on a throwaway schema.
3. Additive migrations only, checked for BOM and banner; seeds idempotent.
4. `docs/ADMIN-REAL-PAGES.md` (module notes and a "Not done" line), `docs/TODO.md` and `docs/DECISION-LOG.md` updated; anything needing a browser listed as not browser-verified.
5. No secrets in the diff; nothing pushed; other projects on the UAT box untouched.
6. For the overall project: uat-rc10 (or newer) deployed with smoke green, live flags on, the investee portal running native screens for every live action, the remaining PARTIAL/MISSING rows closed or consciously deferred in the decision log, and file storage on MinIO.

Report back with a short summary: what changed, what was verified and how, what is left, and any decision the owner must make.
