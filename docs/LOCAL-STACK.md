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

Use `localhost`. Each portal keeps its own session cookie outside production (`nexus_session_<port>`, e.g. `nexus_session_48221` for admin), so
you can be signed in to the admin and LP portals as different users in one browser at the same time. Signing in to one portal no longer ends
the session in another. Do not use `127.0.0.1` or `*.localhost` for browser testing: Next dev blocks cross-origin dev resources there and the
pages never hydrate. For two personas on the same portal, use a second browser profile or a private window.

## Credentials

Passwords are random and are NOT in this document. They are in the git-ignored file `secrets/uat-users.json`
(repo root), one entry per persona: `persona`, `email`, `password`. Look up the persona you need, for example
`node -e "console.log(require('./secrets/uat-users.json').find(u=>u.persona==='lp_a_manager'))"`.
Sign in with email and password; there is no MFA step.

Personas (email is `<persona>@uat.matanho.test` unless noted):

- Admin: `local_admin` (admin@local.matanho.test, system admin), `sysadmin`, `client_services` (maker), `compliance`, `investment_director` (approver), `operations`, `analyst`
  - `local_admin` and `sysadmin` hold the System Administrator role, which is deliberately view-only on operations and cannot change platform settings: separation of duties forbids an administrator who grants access from also moving money or approving. Use the test personas below for operations flows.
  - The shipped roles satisfy the separation-of-duties catalogue (RBAC & Controls > Segregation of duties shows no warnings): the Investment Director approves and closes but no longer creates orders, posts journals or manages financing; Dealer routes but no longer creates orders; Operations prepares cash journals, Fund Accountant approves and closes them; Compliance approves but no longer creates or submits reports.
- Admin test personas (test-only, passwords in `secrets/uat-users.json`, email `<persona>@uat.matanho.test`; created by `seed-uat.ts`, re-run it after pulling):
  - `test_portfolio_manager` creates orders and authors term sheets (maker); the seeded draft term sheets are authored by it.
  - `test_dealer` routes orders and records fills.
  - `test_approver` (Investment Director role, a second person from `investment_director`) approves orders, releases NAV, closes and reopens accounting periods, processes corporate actions.
  - `test_fund_accountant` posts accounting journals, approves and closes cash journals, runs reconciliations, processes corporate actions.
  - `test_compliance` approves term sheets and cash, signs off reconciliations.
  - `test_settings_admin` (Platform Settings Administrator) is the only role that changes Settings (kept apart from the System Administrator).
  - Orders already seeded before this change keep their original maker; create a new order as `test_portfolio_manager` to walk create > approve > route > fill with three different people.
- Step-up: no persona has an authenticator enrolled and `mfa_required` is off, so step-up prompts are skipped by design. To exercise them, enrol an authenticator from Profile, or run seed-uat with `SEED_UAT_MFA_REQUIRED=1`.
- Production: set `mfa_required` on (Settings, or `SEED_UAT_MFA_REQUIRED=1` for UAT); without it step-up passes for accounts with no authenticator.
- Role changes are additive: seeding (`prisma/seed.ts`, `seed-admin-shell.ts`) never revokes a permission from an existing database, so System Administrator keeps `admin.settings` there. Roles shipped SoD-clean in the catalogue only on fresh databases. To retire the legacy grants on an existing database, assign `admin:settings_admin` to someone first, then run `SEED_APPLY_ROLE_RETIREMENTS=1 npx tsx prisma/seed-admin-shell.ts` (it logs each role it trims and keeps `admin.settings` if nobody holds the settings role).
- Investor / LP: `lp_a_manager` (Jane Smith, all funds), `lp_a_signatory` (one fund), `lp_a_viewer`, `lp_b_signatory` (a second client)
- Company / Investee: `investee_101_approver`, `investee_101_contributor`, `investee_101_viewer` (company PC-101), `investee_102_admin` (PC-102)
- Custodian: `custodian_submitter`, `custodian_approver`, `test_custodian_approver` (a second approver, so a day-end package submitted by another custodian user can be approved)
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
