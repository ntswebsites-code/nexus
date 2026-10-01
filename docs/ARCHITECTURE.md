# Architecture

> Current-state architecture. The target design and full requirements live in [`SRD.md`](SRD.md).
> Portal-by-portal structure is in [`PORTALS.md`](PORTALS.md).

```
                         ┌────────────────────────────── browser ──────────────────────────────┐
                         │                                                                     │
        http://localhost:3100   :3101            :3102             :3103                       │
   ┌────────────┐  ┌──────────────┐  ┌────────────────┐  ┌──────────────┐                     │
   │ admin-web  │  │ investor-web │  │ onboarding-web │  │ company-web  │   Next.js 16 apps   │
   │ (legacy UI)│  │ (LP, React)  │  │ (legacy UI)    │  │ (Investee)   │   one per portal    │
   └─────┬──────┘  └──────┬───────┘  └───────┬────────┘  └──────┬───────┘                     │
         │  /login (shared LoginForm)  ·  credentialed fetch, httpOnly session cookie          │
         └───────────────┬──────────────────┴──────────────────┴────────────────┘
                         ▼
               ┌────────────────────┐   http://localhost:4100
               │  backend/api       │   Express 5 + TypeScript
               │  /api/health       │   helmet · CORS allow-list · origin guard · rate limit
               │  /api/auth/*       │   zod validation · central error handler
               │  /api/v1/*         │   domain API (Phase 1) · audit chain · outbox → worker
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
portals/investor-web    Next.js portal  :3101  (LP portal, React + Tailwind, demo data)
portals/onboarding-web  Next.js portal  :3102  (original `public-onboarding.html`)
portals/company-web     Next.js portal  :3103  (Investee portal, demo data)
portals/custodian-web   Next.js portal  :3104  (V65 `custodian-portal.html`)
tools/extract-legacy.mjs Regenerates the legacy CSS/JS/markup (git history or legacy-static/v65)
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
* Portal protection is opt-in (`REQUIRE_AUTH_PORTALS=admin,investor,company`). Protected portals
  redirect to `/login?next=...`. Onboarding stays public: applicants have no account, and a draft
  belongs to whoever holds its `X-Draft-Token` (the creating browser or the emailed resume link).
* MFA (SRD 7.1): TOTP enrol/verify under `/api/auth/mfa/*`. When the `mfa_required` policy is on,
  admin and investor sign-ins must enrol. Sensitive writes use `requireStepUp` (a code within the last
  5 minutes); the legacy bridge prompts for it automatically on `step_up_required`.
* Idle timeout = the admin policy `session_idle_minutes`, capped by `SESSION_IDLE_MINUTES`.
* Password reset and invitations: single-use hashed tokens (`/api/auth/password/*`, `/api/auth/invitations/*`).

## Phase 1 domain API (`/api/v1`)

| Mount | Who | What |
| --- | --- | --- |
| `/public/applications` | anonymous (draft token) | onboarding drafts, evidence upload, submit |
| `/kyc/cases` | admin `onboarding.*` | KYC state machine, evidence review, screening, compliance decision (dual control), activation |
| `/clients`, `/cash-accounts`, `/investor-users` | admin `clients.*`, `cash.*` | client master, mandates, cash-account maker/checker, investor invitations |
| `/snapshots`, `/capital-events`, `/documents`, ... | admin (staff publish flows) | valuation snapshots, capital notices, document approval/publication |
| `/investor/*` | investor portal membership (`client_users`) | bootstrap, documents + signed downloads, signing, capital events + funding evidence, requests, threads, users |
| `/company/*` | company portal membership (`company_users`, no roles) | reporting packs, file uploads, KPIs, questions, library |
| `/private-markets/*` | admin `portfolio.view` / `research.edit` | company review queue, accept/return packs, questions, covenants, company users |
| `/admin/*` | admin `admin.rbac`, `admin.settings`, `audit.view` | users/roles/permissions, access policy, SoD scan, access-review CSV, settings, audit search/CSV/chain verify |
| `/notifications`, `/files` | any signed-in user | in-app notifications, HMAC-signed file downloads |

Conventions: every write runs in a transaction that also appends a hash-chained `audit_events` row
(`writeAudit`) and, for side effects (email, notifications, screening), an `outbox_events` row that
`dist/worker.js` delivers. Human references (`CL-`, `ONB-`, `KYC-`, `REQ-`, `Q-`, ...) come from the
`sequences` table. Optimistic concurrency uses `version` + `If-Match`. Files are AES-256-GCM encrypted
at rest (`FILE_ENCRYPTION_KEY`) and downloaded through short-lived signed URLs (`DOWNLOAD_SIGNING_SECRET`).

### Legacy data bridge

The prototype UIs stay pixel-identical; only their data sources change.

* `tools/legacy-bridge.mjs` rewrites hard-coded arrays in the extracted scripts to
  `window.__mxData && window.__mxData.<key> || <original literal>` (`DATA_HOOKS`). Run it after
  `extract-legacy.mjs`; `--check` fails CI when the generated scripts are stale.
* `packages/legacy-runtime/bridge/mx-core.js` fetches data before the prototype scripts start and
  provides `mx.api`, `mx.wrapGlobal`, `mx.intercept`, `mx.modal`, `mx.download` and `mx.mfaSetup`.
* Per-portal bridge files (`portals/<portal>/src/legacy/bridge/*.js`) replace localStorage writes and
  simulated actions with API calls, re-rendering through the prototype's own functions.
* The company portal is native React; `src/lib/store.tsx` loads `/api/v1/company/workspace`.

## Seed

`npm run db:seed -w @matanho/api` (also run by the `migrate` container on every deploy):

* Role catalog (`prisma/seed/role-catalog.json`): new roles and newly added catalog permissions are
  applied once (tracked in `settings.role_catalog_applied`), so permission edits made in the RBAC
  screen survive redeploys. `system_admin` is locked to the catalog bundle.
* Users from `SEED_USERS_FILE`: created with their password; existing users keep theirs unless
  `SEED_RESET_PASSWORDS=1`.
* `SEED_DEMO=1`: the V56 prototype data (client `CL-00418` Horizon Pension Fund, company `PC-100`
  Africa Payments Holdings) from `prisma/seed/demo-*.json`, with placeholder PDFs. Created once;
  skipped when the records exist.

## Tests

* `npm run smoke -w @matanho/api`: authentication, portal access, CORS/CSRF.
* `E2E_CONFIRM=throwaway-db npm run e2e -w @matanho/api`: cross-portal journey (onboarding ->
  KYC -> activation -> invitation -> investor, demo investor documents, company pack submit ->
  staff accept, RBAC guards, audit search/CSV/chain, TOTP MFA). It writes records, so run it only
  against a disposable database.

## Environment

See `.env.example` and `deploy/.env.production.example`. Only `NEXT_PUBLIC_API_URL` reaches browsers.
`DATABASE_URL`, `FILE_ENCRYPTION_KEY` and `DOWNLOAD_SIGNING_SECRET` are read by the API only.
