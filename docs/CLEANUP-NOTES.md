# Repository cleanup notes

Nothing was deleted blindly. The original files are also preserved in git history
(first commit `8bf1571`), which is what `tools/extract-legacy.mjs` reads.

## Moved (kept, not deleted)

| From | To | Reason |
| --- | --- | --- |
| `index.html`, `client-portal.html`, `public-onboarding.html`, `company-portal.html` | `legacy-static/` | Replaced by the Next.js portals. |
| `v33-*` ... `v56-*` `.js` / `.css`, `v35-public-onboarding.js`, `v53-client-portal.*` | `legacy-static/` | Now served from each portal's `public/legacy/`. |
| `samples/*.csv` | `legacy-static/samples/` | Sample bank / broker / custodian files. Not referenced by any code. Flagged: decide whether to keep as fixtures. |
| `START_HERE.md`, `DEPLOYMENT_MANIFEST.txt` | `legacy-static/` | Describe the old drag-and-drop static package. |

## Rewritten

* `README.md` - now describes the monorepo.
* `.gitignore` - secrets, dependencies, build output, database artefacts.
* `.dockerignore` - keeps `node_modules`, build output and `.env*` out of the build context.

## Kept, needs an owner decision (FLAGGED)

These files still target the **old static hosting**. They were minimally repointed so the
existing deployment keeps serving the archived prototype, but production for the new
stack (Next.js x4 + Express + MySQL) has not been defined and was not invented.

| File | Status |
| --- | --- |
| `Dockerfile`, `nginx.conf` | Now `COPY legacy-static/` into nginx. Still deploys the *old* static prototype. A production image for the new stack is still needed. |
| `docker-compose.yml` | Traefik route for `nexus.matanho.com` -> the nginx container above. Unchanged. |
| `.github/workflows/pages.yml` | Publishes `legacy-static` instead of `.`. |
| `vercel.json` | Static-hosting config. Root directory is now empty of static files; set the Vercel project root to `legacy-static` or replace with per-portal Vercel projects. Unchanged. |
| `.nojekyll` | Only relevant for branch-based GitHub Pages. Unchanged. |

## Removed

Nothing was removed beyond the local-only artefacts created during the migration.
