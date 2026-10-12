# Production Migration Record — 12 October 2026 (updated 14:00 UTC)

**Migration:** production moved from `207.180.234.151` (hard down: no SSH, no HTTPS) to **`109.199.123.21`**
**Release:** `uat-2026-10-d` (commit `2812db5`) | **Result:** stack live on HTTPS with the full production dataset restored; smoke **50 pass / 0 fail / 6 skip**; live browser audit of all five portals clean.

## Status after DNS + SSL (completed this session)

- **DNS flipped** by the owner to `109.199.123.21` (verified resolving first; the GoDaddy parking addresses still trail every record — worth deleting at the DNS host so clients don't round-robin to parking).
- **TLS issued**: Let's Encrypt certificates for all six hostnames (nexus, investor, onboarding, company, custodian, api.nexus.matanho.com), deployed to nginx with `--redirect`, auto-renewal scheduled. `issue-certs.sh admin@matanho.com` completed at 14:05 UTC.
- **CORS verified**: preflight from `https://nexus.matanho.com` → 204 with `Access-Control-Allow-Origin` echoed + credentials; unlisted origin → no ACAO (blocked).
- **One defect found and fixed on this host (DEF-2026-009)**: clicking a Data Fabric tab while the module's boot data was still loading was silently dropped (the click listener returned early when `mx.live` was false), leaving the panel blank — on this server's slower API responses users hit it constantly. Fixed in `admin-84-data.js` (tab selection records a pending render, fired when the load/boot completes), committed as `2812db5`, deployed as **`uat-2026-10-d`** (smoke 50/0), re-verified live: raced clicks render, all five tabs render distinctly, 0 console errors.
- **Credential fix**: the migrated DB kept the old password hashes; a seed reset initially wrote to the wrong emails (`@uat.matanho.test` strays). Corrected by mapping the personas to the production `uat.*@nexus.matanho.com` addresses, re-running the reset, and deleting the strays — user count restored to the exact production baseline of **32 users / 3 clients / 9 orders / 34 documents / 216 audit events**.

## Live verification (14:00–14:30 UTC, real browser over HTTPS)

| Portal | Result |
|--------|--------|
| admin (nexus.matanho.com) | ✅ login → 27/28 workspaces render live; Today hydrates; audit trail 101 rows; clients "3 live from client master"; Data tabs all render; nav follows permissions (28, 0 hidden); 0 console errors |
| investor (investor.nexus.matanho.com) | ✅ login → Horizon Pension Fund LP dashboard, Total Commitment $5.00M; documents (26), performance, capital activity, notices, reports, settings all live |
| company (company.nexus.matanho.com) | ✅ login → "Live portfolio status for Zambezi Pay Technologies", Invested 100%, $28M requested/approved |
| custodian (custodian.nexus.matanho.com) | ✅ login → Stanbic Custodial Services CP-001, CUST-CL-00418, received 5 |
| onboarding (onboarding.nexus.matanho.com) | ✅ public application form renders |

Smoke on the deployed release: **50 pass, 0 fail, 0 warn, 6 skip**. `RELEASE` marker: `uat-2026-10-d` @ commit `2812db5` (latest on the branch).

## Earlier sections

## What was done (migration, 12 Oct morning)

1. **Assessed the disaster:** old server unreachable on 22/443; latest complete DB backup was the local copy from the NFR-007 test (the `uat-2026-10-b` deploy-time dump, 02:22 UTC 12 Oct).
2. **New server:** Ubuntu 24.04, 6 cores, 12 GB RAM, 96 GB disk; Docker 29.9 + Compose v5.6 installed.
3. **Deployed the identical release:** uploaded `uat-2026-10-c.tar.gz` (checksum verified), generated a fresh `.env.production` (new MySQL passwords, new `FILE_ENCRYPTION_KEY`, new `DOWNLOAD_SIGNING_SECRET`; SMTP via the Mailpit relay as before; all five live flags on).
4. **Worked around two fresh-server deploy issues:**
   - First attempt failed at the backup step (`SKIP_BACKUP=1` for a fresh install).
   - Second failed because `migrate` ran before MySQL finished first-run initialization — MySQL was started and health-waited first, then the deploy re-ran.
5. **Restored the data:** dropped the freshly-seeded DB and restored the production backup — verified **32 users / 3 clients / 9 orders / 34 documents / 216 audit events** (matches the backup exactly; the 9th order exists in the DB — the API blotter view filters drafts, as verified earlier).
6. **Reconstructed the file store:** the old server's encrypted file store was unreachable, so 32 of 34 document binaries were regenerated hash-exact from their deterministic seeds (13 UAT dataset docs + 19 demo/company-library docs) and written encrypted through the app's own storage adapter with the new key. **2 documents are unrecoverable** — both were generated at runtime with timestamps embedded (DOC-3001 capital-call acknowledgement, DOC-3002 policy approval); their DB records (metadata, versions, hashes) are intact, only the binaries are gone.
7. **Reset credentials:** the restored DB carried the old password hashes, so the seed reset re-keyed all UAT personas to the repo's canonical `secrets/uat-users.json` passwords (documented reset procedure, `SEED_RESET_PASSWORDS=1`).
8. **Smoke:** initially 49/50 (document download on a then-missing binary); after file reconstruction **50 pass / 0 fail / 6 skip**.
9. **Nginx:** installed, the production vhost (`deploy/nginx/matanho-nexus.conf`) enabled, default site removed; all six hostnames verified through the proxy (admin/investor/company → 307 to login, onboarding/custodian → 200, api → 200 health).

## DNS — owner action required

The domains still resolve to the dead server. Point these A records at **109.199.123.21** at your DNS host:

```
nexus.matanho.com             A  109.199.123.21
api.nexus.matanho.com         A  109.199.123.21
investor.nexus.matanho.com    A  109.199.123.21
onboarding.nexus.matanho.com  A  109.199.123.21
company.nexus.matanho.com     A  109.199.123.21
custodian.nexus.matanho.com   A  109.199.123.21
```

Once DNS has propagated, issue the TLS certificates (script is already on the server):

```
ssh root@109.199.123.21 "bash /opt/matanho-nexus/deploy/issue-certs.sh <contact-email>"
```

The script refuses to run until every hostname resolves to this server, then rewrites the vhost with `--redirect` (HTTP→HTTPS). The portals call `https://api.nexus.matanho.com` by configuration, so https must be live before normal use; http works meanwhile.

## Rollback / ops notes

- Rollback images for this migration are tagged `:pre-uat-2026-10-c`; rollback script at `/root/nexus-backups/uat-2026-10-c/rollback.sh`.
- Backups directory: `/root/nexus-backups/uat-2026-10-c/` (db dump + file-store snapshot + logs).
- Prod credentials file: `/opt/matanho-nexus/secrets/users.json` (chmod 600); env at `/opt/matanho-nexus/.env.production` (chmod 600).
- **Rotate when convenient:** the ZeptoMail API key + the previous `users.json` passwords (both were exposed in dev logs earlier this cycle; this server uses fresh generated values for everything else).
- The J05 test execution `UAT-BROWSER-MV50RASH` and UAT probe records from this cycle are part of the restored dataset (inert test data).
