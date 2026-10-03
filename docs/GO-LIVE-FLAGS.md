# Go-live flags (live data for every portal)

Four API env flags decide whether a portal calls the live API or keeps its demo fixtures behind the "Demo data" ribbon.
They are read from `/opt/matanho-nexus/.env.production` by the `api` service and published (no secrets) at
`GET /api/v1/platform/flags`, which every portal reads.

| Flag | Live value | Portal |
|---|---|---|
| `LP_LIVE_DOMAINS` | `all` (or a comma list of the 12 LP domains) | investor-web |
| `INVESTEE_LIVE_ACTIONS` | `all` (or comma list of action keys, see `portals/company-web/src/lib/investee/api.ts`) | company-web |
| `CUSTODIAN_LIVE` | `true` | custodian-web |
| `ONBOARDING_LIVE` | `true` | onboarding-web |

`deploy/.env.production.example` now carries the live values as template defaults. Nothing is changed on the server by
committing it.

## Turning it on (operator, on the server)

1. Run `tools/uat/contract-harness.ts` and `tools/uat/smoke.ts` (see `docs/VERIFY.md`); flip only domains reporting PASS.
2. Edit `/opt/matanho-nexus/.env.production`: set the four lines above. Keep a copy of the old file.
3. `docker compose -p matanho-nexus -f deploy/docker-compose.prod.yml up -d --no-deps api`
4. Confirm: `curl -s https://api.nexus.matanho.com/api/v1/platform/flags` shows every `lp` domain true,
   `investee.liveActions` = `["all"]`, `custodian.live` and `onboarding.live` true.

## Rollback

`bash deploy/rollback.sh --flags-off <release> api` blanks the lists and sets the booleans to false (backup copy kept),
then restarts the API. No data migration is involved; flags only choose the code path in the portals.
