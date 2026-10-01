# Portals

How the five Matanho Nexus portals are structured, built and deployed. For the API, data model and
security design see [`ARCHITECTURE.md`](ARCHITECTURE.md) and [`SRD.md`](SRD.md).

## At a glance

| Portal | Package | Port | Production host | UI source | Login | Data |
| --- | --- | --- | --- | --- | --- | --- |
| Admin workspace | `@matanho/admin-web` | 3100 | `nexus.matanho.com` | V56 `index.html` (legacy) | required, admin role | live API via bridge |
| LP portal | `@matanho/investor-web` | 3101 | `investor.nexus.matanho.com` | LP portal (native React + Tailwind, 10 screens under `/lp-portal`) | required, investor role | hard-coded demo data |
| Public onboarding | `@matanho/onboarding-web` | 3102 | `onboarding.nexus.matanho.com` | V65 `public-onboarding.html` (legacy) | public | prototype, browser-local draft |
| Investee portal | `@matanho/company-web` | 3103 | `company.nexus.matanho.com` | Investee portal (13 pages, runtime script hosted in React) | required; investor accounts are turned away | hard-coded demo data |
| Custodian | `@matanho/custodian-web` | 3104 | `custodian.nexus.matanho.com` | V65 `custodian-portal.html` (legacy) | public (no custodian role yet) | prototype, browser-local submissions |

Every portal is its own Next.js 16 app under `portals/`, and they all talk to the one Express API
(`backend/api`, port 4100). Login is shared: the API sets one `httpOnly` session cookie on the parent
domain, so a user signed in on one portal is signed in on the others.

## Repository layout

```
portals/
  admin-web/        legacy UI + data bridge
  investor-web/     LP portal: React + Tailwind, demo data
  onboarding-web/   legacy UI (bridge disabled)
  company-web/      Investee portal: runtime script hosted in React, demo data
  custodian-web/    legacy UI (no bridge, no auth routes)
packages/
  shared/           portal registry (PORTAL_IDS), zod schemas, DTOs, typed API client
  legacy-runtime/   renders prototype markup and runs its scripts in the original order
  portal-kit/       shared login / invite / reset-password screens and the auth proxy
tools/
  extract-legacy.mjs  splits a prototype HTML page into a portal's CSS, JS and markup
  legacy-bridge.mjs   installs the data bridge into extracted portals
legacy-static/        original prototypes (V56 at the root, V65 pages in legacy-static/v65)
```

## Two kinds of portal

### 1. Legacy portals (admin, onboarding, custodian)

The prototypes are large imperative-DOM pages whose scripts patch each other at run time. Rewriting
them in React would change the UI, so they're mounted unchanged:

```
portals/<name>-web/
  public/legacy/css/*.css        extracted stylesheets, in document order
  public/legacy/js/*.js          extracted scripts, in document order
  public/legacy/js/bridge/*.js   bridge scripts (only when the bridge is enabled)
  public/assets/                 de-duplicated logo, when the page has one
  src/legacy/manifest.ts         GENERATED: title, <html> attributes, style/script list, fragments
  src/legacy/markup/*.html       GENERATED: lossless body markup fragments
  src/legacy/bridge/*.js         hand-written bridge sources (copied to public/ by legacy-bridge.mjs)
  src/app/(legacy)/layout.tsx    <LegacyRootLayout manifest>   -> <html>, <head>, stylesheets
  src/app/(legacy)/page.tsx      <LegacyPortalPage portalId manifest fragments>
  src/app/(auth)/...             /login, /invite, /reset-password from portal-kit
  src/proxy.ts                   auth gate (createPortalProxy)
```

The custodian portal is the minimal variant: it has no `(auth)` routes and no `proxy.ts`, so its
layout and page sit directly in `src/app/`.

At run time:

1. `LegacyRootLayout` writes the page's `<html>` attributes, title and stylesheets.
2. `LegacyHtml` renders the markup fragments on the server inside a `display: contents` wrapper, so
   no extra layout box is added.
3. `LegacyScripts` loads the scripts one at a time and replays the browser start-up sequence
   (`readyState = loading`, then `DOMContentLoaded`, then `load`) so the prototype code runs exactly
   as it did in the static page. Scripts under `/legacy/js/bridge/` run first.

**Don't edit generated files** (`manifest.ts`, `markup/`, `public/legacy/`). Change the source HTML
and re-run the extractor.

#### Regenerating a legacy portal

```bash
node tools/extract-legacy.mjs --only custodian   # admin | onboarding | custodian
node tools/legacy-bridge.mjs --check             # confirms bridge output is up to date
```

The source of each portal is configured in `PORTALS` in `tools/extract-legacy.mjs`:

| Portal | Source file | Read from |
| --- | --- | --- |
| admin | `index.html` + patch layers | git history (V56) |
| onboarding | `public-onboarding.html` | `legacy-static/v65` |
| custodian | `custodian-portal.html` | `legacy-static/v65` |

The extractor applies documented fixes for prototype defects that stop a page running (`PATCHES`)
and then calls `applyBridge`.

#### The data bridge

The bridge swaps a legacy page's hard-coded data for API data without touching its markup:

* `packages/legacy-runtime/bridge/mx-core.js` loads data into `window.__mxData` before the prototype
  starts and provides helpers (`mx.api`, `mx.intercept`, `mx.modal`, `mx.download`, ...).
* `DATA_HOOKS` in `tools/legacy-bridge.mjs` rewrite a prototype literal to
  `window.__mxData && window.__mxData.<key> || <original literal>`, so the demo data remains the fallback.
* Per-portal files in `src/legacy/bridge/` replace localStorage writes and simulated actions with
  API calls.

Current state: only **admin** has the bridge enabled. `onboarding` and `custodian` are in
the `DISABLED` set because their V65 markup is new. Their old bridge sources are kept in
`src/legacy/bridge/` so they can be rewritten against the new layouts.

### 2. React portals on demo data (LP and Investee)

Both were brought over from the NVCCZ codebase and run on **hard-coded demo data**: the only thing
read from the API is the signed-in user (`GET /api/auth/me`, via `@matanho/portal-kit/session`), shown in
the topbar/profile, plus the Sign out action. Sign-in uses the shared `(auth)` screens (`/login`,
`/invite`, `/reset-password`) and the `proxy.ts` gate.

**LP portal** (`portals/investor-web`, React + Tailwind v4 + shadcn/Radix):

```
src/app/(lp)/layout.tsx        root layout: fonts, Tailwind (globals.css), toaster
src/app/(lp)/lp-portal/        10 screens: dashboard, performance, account-activity, capital-activity,
                               subscriptions-redemptions, documents, requests, notices, organisation, settings
src/components/lp-portal/      screens/ and the LpPortalProvider context
src/components/layout/         sidebar, topbar, shell
src/components/ui/             shadcn primitives
src/lib/lp-portal/mock-store.ts   the seeded demo data (Horizon Pension Fund LP, Matanho Growth Fund I, ...)
src/lib/lp-portal/mock-api.ts     answers every lpPortalApi method from the store
src/lib/api/lp-portal-api.ts      types + the lpPortalApi proxy (always routed to mock-api)
next.config.ts                 redirects: / -> /lp-portal, plus the screens merged in the design
```

To make the LP portal live later, restore a real `apiClient` (`src/lib/api/api-client.ts` is a stub) and
route methods back through `isLpDomainLive` in `lib/lp-portal/config.ts`.

**Investee portal** (`portals/company-web`):

```
src/app/(portal)/layout.tsx    root layout; mounts <InvesteePortal/>
src/app/(portal)/<page>/       13 routes (/, /kpis, /reports, /forecasts, /terms, /cap-table, /governance,
                               /signatures, /requests, /data-room, /messages, /team, /settings)
src/components/InvesteePortal.tsx  starts the runtime with liveOnly:false and syncs it with the URL
src/components/investee-portal-v8-mock/
  matanho-investee-portal-runtime.js   draws the whole UI and holds the demo data (Zambezi Pay, Matanho Venture Fund I)
  shell.ts, investee-portal-v8*.css    page shell and scoped styles
src/lib/nav.ts                 page id <-> route map
```

The runtime is a generated file from the NVCCZ repo; edit demo data there rather than reformatting it here.

## Authentication and access

* `src/proxy.ts` calls `createPortalProxy(portal, { requirePortalRole })` from `@matanho/portal-kit/proxy`.
  It does nothing unless the portal is listed in `REQUIRE_AUTH_PORTALS`. Admin, LP (`investor`), Investee
  (`company`) and onboarding each have a `proxy.ts`. The LP proxy needs a role on the investor portal;
  the Investee proxy accepts any signed-in account (`requirePortalRole: false`) except one holding an investor
  role, which is sent to `/access-denied` (`turnAwayPortals: ['investor']`); staff accounts can still open it.
* A gated portal checks the session with `GET /api/auth/me` and redirects to `/login?next=...` when
  the user is signed out. When `requirePortalRole` is true (admin, investor), the user also needs a
  role for that portal.
* The API still has the investor and company modules (`/api/v1/investor`, `/api/v1/company`) and
  their membership checks; the current LP and Investee UIs simply don't call them.
* Onboarding is public by design: an applicant's draft belongs to whoever holds its `X-Draft-Token`.
* Custodian is public for now. It isn't in `PORTAL_IDS` (`packages/shared/src/portals.ts`) and the
  role catalogue has no custodian role. Adding one is a later decision.
* The API enforces authorisation on every request. The proxy only decides where to send the browser.

## Running locally

```bash
npm install
npm run dev              # API + all five portals
npm run dev:custodian    # a single portal (dev:admin, dev:investor, ...)
npm run build            # API + every portal
```

All portals read the single root `.env` (`next.config.ts` calls `loadEnvConfig('../..')`). Only
`NEXT_PUBLIC_API_URL` is exposed to the browser.

## Deployment

One server runs everything with Docker Compose (`deploy/docker-compose.prod.yml`) behind the host
nginx:

* **Images:** `deploy/Dockerfile.portal` builds any portal from the `PORTAL` build arg. Each
  portal's `package.json` is copied explicitly in its deps stage, as it is in `Dockerfile.api`.
* **Containers:** one service per portal (`admin`, `investor`, `onboarding`, `company`, `custodian`),
  each bound to `127.0.0.1:310x`, plus `api`, `worker`, `migrate` and `mysql`.
* **nginx:** `deploy/nginx/matanho-nexus.conf` has one server block per hostname, proxying to that
  port. Certbot edits the live copy in place, so change the server's file by hand.
* **TLS:** `deploy/issue-certs.sh` requests certificates for the hosts in `HOSTS`. A hostname must
  resolve (DNS A record to the server) before its certificate can be issued.

## Adding a new portal

1. Put the source HTML in `legacy-static/` and add an entry to `PORTALS` in `tools/extract-legacy.mjs`.
2. Create `portals/<name>-web` (copy `custodian-web` for a public page, or `onboarding-web` for a
   page with login routes). Choose the next free port.
3. Add the portal to `PORTAL_DIRS` in `tools/legacy-bridge.mjs`, and to `DISABLED` until it has a bridge.
4. Run `node tools/extract-legacy.mjs --only <name>` and `npm install`.
5. If it needs login, add it to `PORTAL_IDS`, add a `proxy.ts` and `(auth)` routes, and assign roles
   in the role catalogue.
6. Add it to the root `package.json` scripts, both Dockerfiles, the compose file, the nginx config
   and `issue-certs.sh`. Then add its DNS record.
