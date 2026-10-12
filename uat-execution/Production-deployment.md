# Production Deployment Record — 11/12 October 2026

**Release:** `uat-2026-10-b` (commit `3ebffe0`) | **Deployed:** 2026-10-12 00:22:36Z | **Result:** ✅ SUCCESS
**Host:** 207.180.234.151 (`/opt/matanho-nexus`, compose project `matanho-nexus`) | **Smoke:** 50 pass, 0 fail, 0 warn, 6 skip (write-mode steps skipped in readonly mode by design)

## Release contents

UAT Wave 1–3 defect closures and verify-suite fixes (committed as `3ebffe0`):
- Data Fabric tab state, real server-side connection test, authenticated nav gating, audit envelope, company hub, clients live splice, favicons, CSP/logo noise, cash/CAMT/readiness typecheck fixes, SMS test-script cleanup, F00 template, UAT records.

## Deploy sequence (all executed)

1. **Gate:** `npm run verify` green (db:validate, typecheck API+portals, offline tests, shell syntax) and `npm run build` all 6 workspaces — run after fixing 24 pre-existing API typecheck errors and a `.env` BOM that failed the suite.
2. Commit `dc33fe2` → tarball `uat-2026-10-a` uploaded → deploy started.
3. **First deploy attempt rolled back automatically:** smoke S12 failed — a password-reset mail never reached Mailpit within 60s. Root cause found in the shipped diff: the email adapter had been hardcoded to an external ZeptoMail relay (with an embedded credential in `emailConfig.ts`) instead of the environment's SMTP config, so the worker sent (or tried to send) through the wrong relay and the smoke catcher saw nothing.
4. **Fix:** transport restored to env-driven SMTP (`SMTP_HOST/PORT/USER/PASSWORD`, `MAIL_FROM`); the credential was removed from source and purged from the local commit (amended, never pushed); identities are now branding-only.
5. Re-verify + rebuild → commit `3ebffe0` → tarball `uat-2026-10-b` → **deploy OK**.

## Deploy evidence

| Check | Result |
|-------|--------|
| Pre-deploy backup | `db.sql.gz` (184K) + file-store snapshot,保存在 `/root/nexus-backups/uat-2026-10-b/` |
| Rollback point | images tagged `:pre-uat-2026-10-b` |
| Migrations | 43 applied (18 new: ops_health → platform_ops_s8) |
| Services | api, worker, admin, investor, onboarding, company, custodian, mailpit all recreated and healthy |
| Smoke suite | S1–S13: 50 pass / 0 fail / 6 skip |
| S12 mail | password-reset mail delivered via outbox worker (env relay → Mailpit) |
| Live portals | 3100-admin (307→login), investor (307), onboarding (200), company (307), custodian (200) — via nexus.matanho.com et al. |
| API health | `{"status":"ok","environment":"production","uptimeSeconds":103}` |
| RELEASE marker | `/opt/matanho-nexus/RELEASE` = `uat-2026-10-b` @ 2026-10-12T00:22:36Z |

## Rollback (if ever needed)

```bash
ssh root@207.180.234.151 "bash /root/nexus-backups/uat-2026-10-b/rollback.sh uat-2026-10-b api worker admin investor onboarding company custodian mailpit"
```

## Outstanding actions for the owner

1. **Rotate the ZeptoMail API key** that was embedded in `backend/api/src/config/emailConfig.ts` in the working tree (and visible in dev logs from the earlier email work). It was removed from the code and from git history, but the key itself must be considered compromised — issue a new key and update the production relay config.
2. Push the repo to GitHub is deliberately NOT done (local commit `3ebffe0` on top of `730f3cd`); tell me if you want the branch pushed.
3. J18 sign-off (8 authorities) still gates production *acceptance* — this deploy makes the release available for acceptance testing on production.
