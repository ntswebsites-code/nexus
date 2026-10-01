# 9.5 (from the backend draft)

### 9.5 Deployment topology

**As built [O]**. A single host runs Docker Compose (`deploy/docker-compose.prod.yml`, project `matanho-nexus`).

| Service | Image | Port (host bind) | Volumes | Notes |
| --- | --- | --- | --- | --- |
| mysql | `mysql:8.4` | none (internal only) | `mysql-data` | utf8mb4_unicode_ci; healthcheck `mysqladmin ping` |
| migrate | `matanho-nexus-api` (Dockerfile.api) | none | `file-storage`; `secrets/users.json` (read-only) | Runs `prisma migrate deploy` and then the seed (roles, users file, optional demo) on **every deploy**. Waits for mysql to be healthy; runs once. |
| api | `matanho-nexus-api` | 127.0.0.1:4100 | `file-storage` | Starts after migrate succeeds; HTTP healthcheck on `/api/health` |
| worker | `matanho-nexus-api` | none | `file-storage` | `node dist/worker.js`; no healthcheck; single instance |
| admin, investor, onboarding, company, custodian | `matanho-nexus-<portal>` (Dockerfile.portal, build arg `PORTAL`, `NEXT_PUBLIC_API_URL` inlined at build) | 127.0.0.1:3100–3104 | none | `next start`; server-side calls use `API_INTERNAL_URL` |

- **Images**: `node:22-bookworm-slim`. `npm ci` runs over the whole workspace, then each workspace is built. Images contain source and dev dependencies.
- **Network**: the Compose default bridge network (none declared). MySQL is not exposed to the host.
- **Configuration**: `.env.production` on the host (`chmod 600`) and `secrets/users.json`.
- **Reverse proxy**: host nginx. All six hosts listen on port 80, have `client_max_body_size 25m` and set the `X-Forwarded-*` headers. Portals also get WebSocket upgrade headers.

| Host | Target |
| --- | --- |
| `nexus.matanho.com` | admin, 127.0.0.1:3100 |
| `investor.nexus.matanho.com` | 127.0.0.1:3101 |
| `onboarding.nexus.matanho.com` | 127.0.0.1:3102 |
| `company.nexus.matanho.com` | 127.0.0.1:3103 |
| `custodian.nexus.matanho.com` | 127.0.0.1:3104 |
| `api.nexus.matanho.com` | 127.0.0.1:4100 |

- **TLS**: `issue-certs.sh` checks that each hostname resolves to the host's IP, then runs certbot `--nginx --redirect` to issue one Let's Encrypt SAN certificate for all six names. Certbot rewrites the nginx config (HTTP→HTTPS redirect) and reloads nginx. HSTS comes from the API only.
- **Session sharing**: `COOKIE_DOMAIN` (parent domain) lets one session cookie serve every portal subdomain.
- **Legacy**: the old static-prototype deployment (`docker-compose.yml` behind Traefik on `lms_lms-network` for `nexus.matanho.com`, plus the GitHub Pages workflow) is still in the repository and conflicts with the new stack on the same hostname.

**Remaining [P]**:
- CI/CD pipeline (typecheck, tests, image build and push, staged deploy, manual approval), plus registry images instead of on-host builds.
- Slim production images (no dev dependencies or source).
- dev and staging environments.
- MySQL backups with point-in-time recovery and a restore test.
- Off-host (S3-compatible) object storage replacing the disk volume.
- Worker healthcheck and a safe multi-instance worker.
- More than one instance per service behind the proxy.
- Security headers (CSP, frame-ancestors, permissions policy) at nginx.
- Retire the legacy static stack (Q-19).
- Decide whether host nginx replaces Traefik (Q-18 is now answered in practice by Compose + host nginx).
- Hostnames differ from the earlier proposal (`app.`, `onboard.`, `companies.`); the as-built `*.nexus.matanho.com` names should be confirmed.
