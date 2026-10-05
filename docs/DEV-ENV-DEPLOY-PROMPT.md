# Prompt: deploy the finished work to a NEW dev environment (never to the current one)

Paste everything below the line to the agent that is doing the original-UI wiring work. Give it to the agent now, but it applies only when the work is finished and verified.

---

When your work (original UI wired to the backend, branch `feat/original-ui-wiring`) is finished and verified, **deploy it to a brand-new, separate DEV environment, and give me the links so I can test it myself.**

## The one rule that matters
**The environment that exists today on the server (`207.180.234.151`, `/opt/matanho-nexus`, docker compose project `matanho-nexus`, domains `nexus.matanho.com`, `investor.nexus.matanho.com`, `onboarding.nexus.matanho.com`, `company.nexus.matanho.com`, `custodian.nexus.matanho.com`) is the live one. Treat it as production. You must NOT deploy to it, restart it, change its config, change its database, or reload its nginx blocks.** Other projects also live on that server (for example `nts-property-os`); do not touch them either.

## DANGER: the existing deploy tooling is hard-wired to production
`deploy/deploy.sh`, `deploy/rollback.sh` and `deploy/docker-compose.prod.yml` hard-code the compose project name `matanho-nexus`, the lock file `/var/lock/matanho-nexus-deploy.lock`, the image names `matanho-nexus-<service>`, the volume and network names, and the host ports **3100 (admin), 3101 (LP), 3102 (onboarding), 3103 (investee), 3104 (custodian), 4100 (API), 8625 (mail UI)**. Changing only `APP_DIR` would still deploy onto the production project. **Never run these scripts as they are for the dev environment.** Do this instead:
1. Create a dev copy of the deployment files: `deploy/docker-compose.dev.yml` (compose `name: matanho-nexus-dev`), `deploy/deploy-dev.sh` and `deploy/rollback-dev.sh`, derived from the prod ones but with **every** production-specific value replaced: project `matanho-nexus-dev`, app dir `/opt/matanho-nexus-dev`, backups `/root/nexus-backups-dev`, lock file `/var/lock/matanho-nexus-dev-deploy.lock`, images `matanho-nexus-dev-<service>`, its own MySQL container and volume (its own database; never connect to the production database), its own MinIO or local storage volume, and **different free host ports** (check with `ss -ltn`; for example 13100 to 13104, 14100, 18625, all bound to 127.0.0.1). Add a guard at the top of `deploy-dev.sh` that aborts if `PROJECT` or `APP_DIR` is not the dev one. Do not edit the production scripts' behaviour.
2. Do not run `docker compose down`, `docker system prune`, `docker volume prune` or any wildcard container or image removal: they can destroy production. Only ever name dev resources explicitly.

## Environment settings (dev)
- Its own `/opt/matanho-nexus-dev/.env.production`-style file with new random secrets (generate them on the server; never copy production secrets; never print or commit any secret). Domains of the dev environment, `COOKIE_DOMAIN`, `NEXT_PUBLIC_API_URL`, `*_PORTAL_URL` and CORS origins must all use the dev domains.
- Flags on: `LP_LIVE_DOMAINS=all`, `INVESTEE_LIVE_ACTIONS=all`, `CUSTODIAN_LIVE=true`, `ONBOARDING_LIVE=true`; `REQUIRE_AUTH_PORTALS=admin,investor,company`; `ALLOW_FAKE_INTEGRATIONS=1` (the placeholder adapters stand in for vendors); MFA not required for test users.
- Seed fresh demo and UAT data into the dev database (`SEED_UAT=1`, the UAT personas). Never copy or restore production data.

## Domains and links (needs one thing from me)
Use these dev hostnames (all A records pointing to `207.180.234.151`): `dev.nexus.matanho.com` (admin), `investor.dev.nexus.matanho.com`, `onboarding.dev.nexus.matanho.com`, `company.dev.nexus.matanho.com`, `custodian.dev.nexus.matanho.com`. Before doing the server work, **tell me exactly which DNS records to create** and wait until they resolve (`nslookup`/`dig`). Do not continue to TLS until they do. Then add **new** nginx server blocks as **new files** (for example `/etc/nginx/sites-available/matanho-nexus-dev.conf`, proxying to the dev ports), run `nginx -t`, reload nginx only if the test passes, and obtain certificates with certbot **only for the five dev hostnames**. Do not edit or remove any existing production nginx file or certificate.

## Procedure
1. Pre-flight: check free disk and memory (`df -h`, `free -m`) and the free ports. **Record the production state** (container names, image IDs, `docker compose -p matanho-nexus ps`) so you can prove afterwards that it did not change.
2. Build the release from the finished branch with `tools/uat/pack-release.ps1 -Ref <branch> -Release dev-1` (run it through the PowerShell tool; it fails from Git Bash), upload it to `/root/nexus-releases-dev/`, extract to `/opt/matanho-nexus-dev`, run `deploy-dev.sh`. Watch its log with a background poll.
3. Run the smoke suite against the dev stack only, and confirm the API health and each of the five portals on their dev hostnames over HTTPS.
4. **Prove production is untouched**: the same containers, the same image IDs, no restarts (`docker inspect` start times), `curl` of the production URLs returns what it did before.
5. Write the dev test logins to a local file on my machine, `C:\Users\lysp\Downloads\nexus-dev-credentials.txt` (persona, email, password), and tell me the path. Never paste passwords into the chat or into any repo file.

## What to send me when done
- The five dev links (admin, LP, onboarding, investee, custodian) and the login file path.
- The release name, the commit it was built from, and how to redeploy and roll back the dev environment (the exact commands).
- Confirmation, with the evidence from step 4, that production was not touched.
- Anything that needs me (DNS records not yet created, a decision).

## Rules (same as before)
No browser testing or browser actions; keep outputs short; never push to GitHub unless I ask; never commit `.env*`, `secrets/` or credentials; if anything would affect production or delete data, stop and ask me first.
