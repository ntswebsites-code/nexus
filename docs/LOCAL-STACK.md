# Local stack for browser testing

Everything runs on this machine against a local MySQL 8.4 (`127.0.0.1:3306`, database `matanho_local_stack`).
Integrations are fake/native/local (no external calls), mail is printed to the worker log, MFA is not required.
Runtime flags are live: `LP_LIVE_DOMAINS=all`, `INVESTEE_LIVE_ACTIONS=all`, `CUSTODIAN_LIVE=true`, `ONBOARDING_LIVE=true`,
`REQUIRE_AUTH_PORTALS=admin,investor,company`.

## URLs

| Service | URL |
|---|---|
| API (health: `/api/health`, flags: `/api/v1/platform/flags`) | http://localhost:48211 |
| Admin (staff) | http://localhost:48221 |
| Investor / LP | http://localhost:48222 |
| Onboarding (public application, no sign-in) | http://localhost:48223 |
| Company / Investee | http://localhost:48224 |
| Custodian | http://localhost:48225 |

Use `localhost` (not `127.0.0.1` for the first visit) so the session cookie and CORS origins match; both hosts are allowed by CORS.

## Credentials

Passwords are random and are NOT in this document. They are in the git-ignored file `secrets/uat-users.json`
(repo root), one entry per persona: `persona`, `email`, `password`. Look up the persona you need, for example
`node -e "console.log(require('./secrets/uat-users.json').find(u=>u.persona==='lp_a_manager'))"`.
Sign in with email and password; there is no MFA step.

Personas (email is `<persona>@uat.matanho.test` unless noted):

- Admin: `local_admin` (admin@local.matanho.test, system admin), `sysadmin`, `client_services` (maker), `compliance`, `investment_director` (approver), `operations`, `analyst`
- Investor / LP: `lp_a_manager` (Jane Smith, all funds), `lp_a_signatory` (one fund), `lp_a_viewer`, `lp_b_signatory` (a second client)
- Company / Investee: `investee_101_approver`, `investee_101_contributor`, `investee_101_viewer` (company PC-101), `investee_102_admin` (PC-102)
- Custodian: `custodian_submitter`, `custodian_approver`
- Onboarding: public; start an application without signing in.

## Data

Seeded with `prisma/seed.ts` (SEED_DEMO=1) plus seed-uat, portfolio, nav, accounting, cash, corporate-actions, orders, orders-pm,
risk, reports, research-privates, market-data, ibor-performance, integrations, admin-core, admin-shell, clients-onboarding,
investee-workspace, custodian-ops, recon, recon-ops, esign and wiring. All seeds are idempotent.

## Start / stop

Config is `secrets/local-stack.env` (git-ignored; also holds the local DB credentials). Logs are in `secrets/logs/`.

- Start everything (Git Bash, repo root): `bash secrets/start-stack.sh` (portals use `next dev`; the first hit of each page compiles it, so allow a few seconds)
- Stop everything (PowerShell): `powershell -File secrets/stop-stack.ps1`
- Re-run migrations/seeds: `set -a; . ../../secrets/local-stack.env; set +a` from `backend/api`, then `npx prisma migrate deploy` and `npx tsx prisma/<seed>.ts`

Requires the Windows MySQL 8.4 service to be running.
