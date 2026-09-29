# Architecture

```
                         ┌────────────────────────────── browser ──────────────────────────────┐
                         │                                                                     │
        http://localhost:3100   :3101            :3102             :3103                       │
   ┌────────────┐  ┌──────────────┐  ┌────────────────┐  ┌──────────────┐                     │
   │ admin-web  │  │ investor-web │  │ onboarding-web │  │ company-web  │   Next.js 16 apps   │
   │ (legacy UI)│  │ (legacy UI)  │  │ (legacy UI)    │  │ (React)      │   one per portal    │
   └─────┬──────┘  └──────┬───────┘  └───────┬────────┘  └──────┬───────┘                     │
         │  /login (shared LoginForm)  ·  credentialed fetch, httpOnly session cookie          │
         └───────────────┬──────────────────┴──────────────────┴────────────────┘
                         ▼
               ┌────────────────────┐   http://localhost:4100
               │  backend/api       │   Express 5 + TypeScript
               │  /api/health       │   helmet · CORS allow-list · origin guard · rate limit
               │  /api/auth/*       │   zod validation · central error handler
               └─────────┬──────────┘
                         │ Prisma (only the API talks to the database)
                         ▼
                    MySQL 8  (matanho_nexus)
```

## Repository layout

```
backend/api/            Express + TS API, Prisma schema, migrations, seed, smoke test
packages/shared/        Portal registry, zod schemas, DTO types, typed API client
packages/legacy-runtime Renders the original prototype markup + runs its scripts in order
packages/portal-kit     Shared login screen, auth layout and optional route protection (proxy)
portals/admin-web       Next.js portal  :3100  (original `index.html`)
portals/investor-web    Next.js portal  :3101  (original `client-portal.html`)
portals/onboarding-web  Next.js portal  :3102  (original `public-onboarding.html`)
portals/company-web     Next.js portal  :3103  (original `company-portal.html`, native React)
tools/extract-legacy.mjs Regenerates the legacy CSS/JS/markup from the first git commit
legacy-static/          Archive of the original static prototype (see docs/CLEANUP-NOTES.md)
docs/                   This documentation
```

## How the UI is preserved exactly

The prototypes are ~3 MB of imperative-DOM HTML/CSS/JS (35 patch layers, v33-v56)
that mutate each other at run time. Re-writing them as React components would
change the UI. Instead:

1. `tools/extract-legacy.mjs` reads the original files from git and splits each
   page into ordered stylesheets, ordered scripts and lossless markup fragments.
   The 279 KB base64 logo that was duplicated six times is stored once as
   `/assets/matanho-logo.png`.
2. `LegacyHtml` renders the markup on the server (`display: contents` wrapper, no
   extra layout box).
3. `LegacyScripts` loads the original scripts sequentially and reproduces the
   original start-up order (`readyState = loading` -> `DOMContentLoaded` -> `load`).
4. The tiny company portal was converted to real React components.

Verification against the original pages, same viewport, headless Chrome:

* admin: first paint 0 px difference; all 28 sidebar pages compared, max 25 px (0.002 %) of 1.3 M.
* investor: 9/9 pages identical. onboarding and company: identical, interactions identical.

### One documented defect fix

`v53-client-portal.js` (investor) freezes the browser tab in the **original**
prototype: a `MutationObserver` on `document.body` re-runs `simplify()`, which
unconditionally assigns `textContent`, which mutates the DOM again - an endless
microtask loop. The extractor applies a minimal patch (`setText`: write only if
the value differs). The resulting text/layout is unchanged. See `PATCHES` in
`tools/extract-legacy.mjs`.

## Authentication

* `POST /api/auth/register`, `POST /api/auth/login`, `POST /api/auth/logout`, `GET /api/auth/me`.
* Passwords: bcrypt (cost 12, configurable), min length 10. A dummy hash is compared for
  unknown emails so timing does not reveal which accounts exist. Credential endpoints are rate limited.
* Sessions: 256-bit random token in an `httpOnly`, `SameSite=Lax` cookie (`Secure` in production).
  Only the SHA-256 of the token is stored (`sessions` table). Logout deletes the row.
* The frontend never receives passwords, hashes or tokens; `/me` returns id, email, name, roles and permissions.
* CSRF: state-changing requests must come from an allow-listed `Origin`; CORS is a credentialed allow-list.
* Cookies ignore ports, so one login on `localhost` is shared by all four portals. In
  production set `COOKIE_DOMAIN=.matanho.com` and serve the portals on sibling sub-domains.
* Authorisation: roles + permissions come from the prototype (see `DOMAIN-ENTITIES.md`).
  `requireAuth`, `requirePortalAccess(portal)` and `requirePermission(code)` are available for future routes.
* Portal protection is opt-in (`REQUIRE_AUTH_PORTALS=admin,investor`), so the default remains a
  browsable UI mock-up. Protected portals redirect to `/login?next=...`.

## Environment

See `.env.example`. Only `NEXT_PUBLIC_API_URL` reaches browsers. `DATABASE_URL` is read by the API only.
