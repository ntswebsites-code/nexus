# Prompt for the cleanup agent: put the ORIGINAL admin UI back and wire it to the backend

Paste everything below the line to the agent. Read `docs/ORIGINAL-UI-WIRING-PLAN.md` first; this prompt is the order, that file is the analysis.

---

You are taking over a mistake and fixing it. **Matanho Nexus** is an investment-management platform (npm-workspaces monorepo: `backend/api` Express 5 + Prisma 6 + MySQL 8; `portals/admin-web` Next 16; `packages/legacy-runtime`; `tools/`). Repo: `C:\Users\lysp\Downloads\matanho-nexus-v56-deployment` (Windows; Git Bash and PowerShell).

## 1. What went wrong (read this twice)

The owner supplied an **original admin UI**: the V56 prototype (the single file `C:\Users\lysp\Documents\matanho-nexus-v56-deployment-20260908T041240Z-1-001\matanho-nexus-v56-deployment\index.html`, "Investment OS": Today dashboard with KPI tiles, charts, scope chips, role switcher, Focus mode, 28 pages). The instruction was: **keep that UI exactly as it is, and connect it to the backend so its controls do real work.**

That instruction was misread. Instead a **new generic React console** was built under `portals/admin-web/src/app/(ops)/ops/**` (with `src/ops/*.tsx`), the real logic was put there, `next.config.ts` was made to redirect `/` to `/ops`, the prototype was pushed to `/classic`, and in commit `61b44ff` the prototype sidebar was cut from 28 pages to 8 and 23 hash routes were redirected to `/ops/*` by `admin-01-retired.js`. The owner never asked for a new UI and does not want it.

**Your job: undo that, without losing the working backend.** The original UI is the admin portal again, pixel for pixel; every page of it is wired to the real API; the `/ops` console stops being the product.

## 1b. The target, exactly (look at the pictures first)

Open these images with your image viewer (reading an image file is not browser activity) before you write any code:
- `docs/reference/ORIGINAL-UI-today-system-administrator.png`: **the target.** The original UI as the System Administrator sees it.
- `docs/reference/ORIGINAL-UI-today-investment-director.png`: the target for another role, to see how the sidebar changes with the role.
- `docs/reference/LIVE-after-rollback-with-extra-console-item.png`: the live server after the rollback. It is identical to the target **except** for one wrong extra sidebar item, "Operations Console / New" (already removed on the server by hand; the code that injected it, `admin-99-boot.js`, must be fixed in the repo too).
- `docs/reference/WRONG-native-console-do-not-build.png`: the generic console that was built by mistake. **Never produce anything that looks like this.**

What the target looks like (so you can check your own work with DOM assertions, since you cannot look at it):
- **Sidebar:** logo "matanho"; a workspace card "Investment OS / Institutional platform"; a row "All workspaces  28 available" (the toggle); a "YOUR WORKSPACE" section whose items depend on the role (focus mode, see 1c) each with its icon and, where the prototype has one, a count badge on the right (Today 4, Data 3, Models 2); at the bottom "All services operational / Last sync just now" and a collapse chevron. For the System Administrator the focused items are exactly: **Today, Data, Models, Access control, Settings, Audit.** Nothing else may appear in that list (no "Operations Console", no "New" pill, no extra links).
- **Top bar:** search box "Search anything..." with the ⌘K hint; a ⌘K button; a "Focus" pill; "ZSE market open / time CAT"; the notification bell with a count; "VIEWING AS" with the role dropdown ("System Administrator"); the "m" avatar button; the user card (initials, name, role).
- **Today page ("Global Investment Office"):** eyebrow "GLOBAL INVESTMENT OFFICE · date · time CAT"; buttons "Run scenario", "My work" and the blue "Investment pack"; "PORTFOLIO SCOPE" chips (Whole portfolio, Listed equity, Fixed income, Private markets, Liquidity) and "Books synchronized" with a time; six KPI tiles (ASSETS UNDER MANAGEMENT, ACTIVE RETURN, ONE-DAY RISK, LIQUIDITY COVER, PRIVATE NAV, APPROVAL QUEUE) each with a sparkline; tabs Overview / Performance / Risk & liquidity / Decisions & controls (with a count); the dark "TODAY AT A GLANCE" strip plus four stat cells (ORDER APPROVALS, NAV / VALUATION, PRIVATE CASHFLOWS, CLIENT ACTIVATION); the "WHOLE PORTFOLIO PULSE" card (Composite/Benchmark/Active/Volatility summary, 1M/3M/YTD/1Y buttons, the performance-vs-benchmark chart with the April drawdown band) and the "DECISION PULSE" card (capital affected, bar, ranked decisions with severity).
- The numbers in the picture are the prototype's demo numbers. **Keep every element and layout; make the numbers come from the real API** (section 5, W1). Elements that have no real data must show an honest empty state, never invented figures.

## 1c. The role and permission model (RBAC) the UI is built on

The prototype is role-focused: **the user's role decides which pages are in focus in the sidebar**, an "All workspaces" toggle (`nav.dataset.expanded`) reveals all 28, and the "Viewing as" dropdown switches the role. These are the exact focus sets from the prototype's own code (`public/legacy/js/07-v16-focus-script.js`, `rolePrimary`); the page keys are the `data-page` values:

| Role (label) | Focused sidebar pages, in order |
|---|---|
| investment_director (Investment Director) | command, portfolios, private-markets, risk, performance, investor-services, reports, operations, reconciliations |
| portfolio_manager (Portfolio Manager) | command, portfolios, portfolio-lab, orders, research, risk, performance |
| dealer (Dealer / Trader) | command, orders, ibor, cash, operations, reconciliations, corporate-actions |
| analyst (Investment Analyst) | command, research, portfolios, private-markets, portfolio-lab, performance |
| compliance (Compliance Officer) | command, risk, onboarding, regulatory, audit, clients |
| operations (Operations) | command, ibor, cash, operations, reconciliations, corporate-actions, valuation, investor-services |
| fund_accountant (Fund Accountant) | command, cash, operations, reconciliations, valuation, accounting, regulatory, reports |
| client_services (Client Services) | command, clients, investor-services, onboarding, reports, vault |
| auditor (Auditor) | command, reports, regulatory, audit, operations, reconciliations, accounting |
| system_admin (System Administrator) | command (Today), data, model-governance (Models), rbac (Access control), settings, audit |

Page keys map to labels: command=Today, model-governance=Models, rbac=Access control, and so on (see the sidebar fragment). The prototype's `rolePermissions` (coarse codes like `orders.view`, `orders.create`, `orders.approve`) decides what a page lets the role do.

**How this meets the real backend (already built, do not rebuild):** the ten prototype roles are real admin roles in the backend (`backend/api/prisma/seed/role-catalog.json`, portal `admin`) with fine-grained permission codes; a real user can hold several roles and gets the **union** of their permissions; maker-checker and segregation of duties are enforced on the server (a user cannot approve their own item: show the server's `segregation_of_duties` message); `GET /api/auth/me` gives the identity and `permissions[]`, `GET /api/v1/admin/access-context` gives `{roles, role, roleLabels, rolePermissions}`, and `GET/PUT /api/v1/shell/me/role-focus` stores the user's chosen "hat". The bridge `admin-60-access.js` already rewires `hasPermission` to the union and fills the "Viewing as" list with the roles the user really holds plus read-only "Preview · role" entries. **Rules for you:**
- The sidebar focus for a signed-in user = the `rolePrimary` set of the role they are currently viewing as (default: their primary real role). A System Administrator sees exactly the six items in the table. "All workspaces" shows all 28, minus any page the user's permissions forbid (hidden or disabled with the prototype's own "Access restricted" behaviour).
- "Preview · role" entries are read-only previews: they change what is in focus and shown, never what the API allows.
- Buttons the real permission does not allow are disabled with a reason (`mx.gate`), never silently missing and never shown as working.
- Do not add roles, permissions, nav items or pages to the original UI. Missing permission codes the prototype already uses (`dashboard.view`, `orders.view`, ...) are added **to the catalogue only, additively**.

## 1d. How not to get lost (tripwires)

Stop and re-read this prompt if any of these happens:
- You are about to create a new component, page, stylesheet, layout, colour, icon or wording that is not in the prototype. (Allowed: nothing. Reuse `openDrawer`, `mx.modal`, `toast`, existing classes.)
- You are editing a file under `src/legacy/markup/`, `public/legacy/css/` or `public/legacy/js/` other than the sidebar restore in W0.
- You are working inside `src/app/(ops)`/`src/ops` for anything except moving it to `/ops-native` in W0 and reading it for API usage.
- A page you "finished" looks, in the DOM, different from the prototype's fragment (extra sections, missing sections, renamed labels, different nav items).
- You are tempted to "decide what looks better". The only decision rule for UI is: identical to the original.
Keep these checks as automated jsdom assertions in `tests/frontend/legacy/` (W0 builds the harness, W9 runs them for every page): (1) for every role in the table above, the focused sidebar items equal `rolePrimary[role]` exactly and "All workspaces" shows 28 minus forbidden; (2) no element with id `mxOpsLink` or text "Operations Console" or a link to `/ops` exists anywhere; (3) the topbar contains the elements listed in 1b; (4) the Today page contains the sections listed in 1b; (5) `git diff 0adef6f -- portals/admin-web/src/legacy/markup portals/admin-web/public/legacy` shows no change other than the intended W0 ones; (6) no page keeps demo numbers beside live ones when signed in.

## 2. What is already done and must be reused

- **The backend is real and tested.** All modules under `backend/api/src/modules/*` (orders, risk, recon, nav, accounting, cash, corporate-actions, ibor, performance, research, private-markets, portfolio-lab, financing, clients-onboarding, reports, regulatory, data-fabric, model-governance, admin-core, wiring/operations, opsctl, esign, market-data, etc.), permissions, maker-checker, audit, idempotency. Do not rewrite it. Fix or add routes only where a prototype control has no backend (see section 6).
- **The `/ops` screens are your reference for how to call the API.** Each page already has working client code (request shapes, response shapes, error handling, Idempotency-Key, If-Match, step-up, field errors) in `portals/admin-web/src/ops/*.tsx` and `portals/admin-web/src/app/(ops)/ops/<page>/**`. Copy the **functionality** (which endpoint, what body, how errors map) into the bridge scripts; never copy the look.
- **Bridge machinery exists**: `packages/legacy-runtime/bridge/mx-core.js` (`window.mx`: request/get/post/put/patch/del/upload/download, toast, fail, intercept, interceptSubmit, wrapGlobal, replace, boot, loadMe, can), `portals/admin-web/src/legacy/bridge/admin-00..99-*.js`, `tools/legacy-bridge.mjs` (`DATA_HOOKS` text patches), `tools/extract-legacy.mjs`. Working bridges today: clients, cash accounts, investor-services queue, onboarding/KYC, vault (partial), private-markets company-reporting card, RBAC/settings/audit. Study `admin-20-clients.js` and `admin-60-access.js` as the pattern to follow.
- The analysis is in **`docs/ORIGINAL-UI-WIRING-PLAN.md`**: how the prototype is assembled, a table per page (controls, endpoints, gaps, effort), the wiring architecture, work packages W0..W9 with disjoint files, and 16 risks. Follow it. Where this prompt and the plan disagree, this prompt wins.

## 3. Iron rules (breaking any of these means the work is rejected)

1. **The original UI stays byte-identical.** Do not edit `src/legacy/markup/*.html` (except restoring the sidebar, below) or `public/legacy/css/*` or the prototype scripts `public/legacy/js/*.js`. No new design, no new components, no restyling, no "improvements". Wiring only: replace demo data with live data and attach real behaviour. When you need UI the prototype does not have (an error, a confirmation, a form), reuse the prototype's own widgets: `openDrawer`, `mx.modal` (the V34 modal), `toast()`, existing table/chip/detail classes.
2. **No browser use of any kind** (owner's rule: token cost). Verify with typecheck, builds, jsdom tests and API flow scripts. List anything that really needs a browser as "not browser-verified".
3. **Never push or force-push** unless the owner says so. Work on a new branch `feat/original-ui-wiring` created from `dev`. Commit per package. Never commit `.env*`, `secrets/` or credentials; never print passwords.
4. **Decide autonomously**, log every decision in `docs/DECISION-LOG.md` (what was unclear, what you chose, why). Priority: the plan and specs, then existing code patterns, then the simplest reversible option. Stop only for something irreversible or data-deleting.
5. **Fix root causes; never weaken or delete a test.** Keep outputs short.
6. **Do not touch** the LP and investee portals (they use the designs the owner supplied). The onboarding and custodian portals were ALSO rewritten as new React apps in an earlier round (branch dev, not on the server) without the owner asking; do not extend them: report in your final notes which of the two the owner should decide to restore from their original HTML (originals are in git history before commit range `R4-6`/`R4-7`: `git log --oneline -- portals/onboarding-web portals/custodian-web`), the database content, or other projects on the UAT server. UAT is at `207.180.234.151`, project `/opt/matanho-nexus`; it has been **rolled back to release `uat-rc1`** (original UI + supplied portals) by the owner's order; do not deploy anything without being told.

## 4. Order of work

**Package W0 first, alone** (it owns the shared files: `packages/legacy-runtime/**`, `tools/legacy-bridge.mjs`, `tools/extract-legacy.mjs`, `next.config.ts`, `src/legacy/markup/03-sidebar.html`, `admin-00-common.js`, `admin-01-retired.js`, `admin-99-boot.js`, `src/proxy.ts`, the `(ops)` route folder). Then packages W1..W8 in parallel on disjoint files, then W9 (QA sweep). Use sub-agents for W1..W8 (batches of 4-5; each in its own git worktree; give each its package text from section 5 and the matching rows of the plan; launching many worktrees at once fails, so stagger them; a supervisor agent reviews each package for rule violations, a watchdog agent relaunches failed or stalled ones continuing from partial files). No two agents edit the same file. Shared files get append-only edits through per-package hook files `tools/hooks/<pkg>.mjs` that W0's installer imports.

### W0: shared runtime and entry (do these exact things)
1. `next.config.ts`: remove the `'/' -> '/ops'` redirect; the prototype is served at `/` (keep `/classic` as an alias that redirects to `/`). Fix `src/proxy.ts` matcher and the login `next` default so signed-in staff land on `/`.
2. Restore the full 28-item sidebar: `git show 0adef6f:portals/admin-web/src/legacy/markup/03-sidebar.html`; confirm with `git diff 0adef6f -- portals/admin-web/src/legacy/markup` that markup is otherwise unchanged. Remove the "Open the new workspace" link.
3. Delete `admin-01-retired.js` (it redirects 23 routes to `/ops/*`). In `admin-99-boot.js` remove the "Operations Console" link (added in commit `2f7f6e0`) that points to `/ops`; nothing in the original UI may link to the native console.
4. Move `app/(ops)/ops/**` and `src/ops/**` to `/ops-native` (rename the route folder and every internal `'/ops'` link prefix; keep a redirect `/ops/* -> /ops-native/*` for bookmarks; no link to it from the UI except an unlisted entry in the profile drawer for staff with `admin.settings`). Do this in ONE commit; typecheck and build admin-web afterwards. The native screens remain only as a reference until all pages are wired, then they can be deleted in a later task (do not delete now).
5. Extend `mx-core.js` (do not create a second client): envelope unwrap (`{data}`), `mx.list` returning `{rows,total,page,pageSize}`, **Idempotency-Key on every POST/PUT/PATCH** (reused on step-up retry), `If-Match` from `row.version` (on `409 version_conflict` show the server message and refetch), **step-up through a prototype-styled modal instead of `window.prompt`**, `mx.fail(err)` mapping `fieldErrors` to messages (never a bare "Validation failed"), `501` rendered as "Not available yet", toasts through the prototype `toast()`, `mx.hydrate(page, fn)` (runs when the page is first opened, and on refresh), `mx.refresh(page)`, `mx.gate(el, perm)` (hide or disable controls the real permission does not allow, with the reason), `mx.badge(page, n)`, `mx.strict(page)` (live and permitted: demo seeds and the prototype's `localStorage` domain state are switched off for that page), `mx.table(el, rows, cols)` re-rendering a `<tbody>` with the existing row classes. Staff lists page server-side: search and filter ids call the API with `q`/filter params (debounced), never silently truncate ("showing n of total").
6. Hook loader: make `tools/legacy-bridge.mjs` import `tools/hooks/*.mjs` so packages add their `DATA_HOOKS` without editing it; keep `--check` mode working and idempotent.
7. Permission catalogue: verify every coarse permission code the prototype gates pages with (`dashboard.view`, `portfolio.view`, `orders.view`, ...) exists in `backend/api/prisma/seed/role-catalog.json`; add missing codes additively (never revoke).
8. Test harness **without a browser**: build `tests/frontend/legacy/_harness.ts` (Vitest + jsdom with `runScripts: 'dangerously'`) that loads a page fragment, `mx-core.js`, the page bridge and the needed prototype scripts with a mocked `fetch` (reuse `tests/frontend/_helpers/mockApi.ts`), so each package can test its page: data hydrated from mocked API responses, no demo text left, every wired control sends the right request. Document it in `tests/frontend/README.md`.
9. Run `npm run build -w @matanho/admin-web`, `npx tsc --noEmit` (admin-web and legacy-runtime), `node tools/legacy-bridge.mjs --check`, `npm run test:frontend:admin`. Commit.

### Rules for every page package (W1..W8)
- One new bridge file per page (names in the plan, `admin-7x..9x-*.js`, loaded after `admin-60-access.js` because it relies on its `hasPermission` wrapper). Keep existing bridges untouched; depth additions go in new sibling files.
- Hydration pattern: summary counts via `mx.onLoad(perm, fn)` only; heavy data lazily through `mx.hydrate(page, fn)` (boot has a 15 s budget). Replace the prototype's demo arrays through `DATA_HOOKS` (`live('key')`) or in place with `mx.replace(array, rows)`, then call the prototype's own render function. Row mapping lives in a `toProto(apiRow)` per bridge (the prototype row shape is the contract, not the API shape); carry the real id in `data-id`.
- Writes: `mx.intercept('[data-action="x"]', apiCall, {thenNative:true})` where the prototype's own UI update is safe, otherwise refresh after the call. Respect maker-checker: surface `segregation_of_duties` and `forbidden` as toasts; gate buttons with `mx.gate`.
- No static numbers may remain next to live ones (sidebar badges, KPI tiles, chart axes, "28 available"): compute them or hide them. When live, never read or write the prototype's `localStorage` domain keys (listed in plan risk R3).
- If a prototype control has no backend: implement the missing route in the right module (with permission, audit, idempotency, test) when the SRD requires it (`docs/srd/5A-admin.md` page section); otherwise render an honest "Not available yet" state; never fake success. Record each in `docs/DECISIONS-NEEDED.md`.
- Tests: a jsdom test per page with the W0 harness (hydration, no demo text, one write round trip per main action, error and permission cases), plus run the existing API flow script for the module if you touched its backend (UAT-host private harness: see `docs/VERIFY.md` and `docs/test-runs/TRIAGE-T1.md`). Typecheck and build every touched workspace.

## 5. What to do on each page

Endpoint paths are under `/api/v1` unless noted. "Reference" = the native screen to read for working request/response code.

**W1: command (Today), operations, topbar and shell** (`06-page-command`, `21-page-operations`, `05-header-topbar`, `38-detaildrawer`, `34-page-detail`)
- Today: KPI tiles, alert rows, decision pulse, task links and badges from `GET /dashboard/today`, `/dashboard/panels`, `/operations/workload`, `/operations/calendar`, `/ops-controls/close-gates`, `/performance/summary`, `/nav/history`. The "Investment pack" button: `POST /reports/runs` then `GET /reports/runs/:id/link` (reference `src/ops/investment-pack.tsx`). Charts: redraw the prototype's own chart from API series (compose AUM from nav history plus performance; no new chart library).
- Operations: task list (create, start, complete, block, reopen, cancel, comments, generate), calendar, workload, close gates, settlement fails (`/operations/*`, `/ops-controls/*`). Respect `operations.task.manage` and the creator-cannot-complete rule.
- Topbar: global search `GET /shell/search`; notifications `GET /notifications` (+ mark read); profile `GET /shell/me`; role switcher with `PUT /shell/me/role-focus`; record drawer `GET /shell/record/:kind/:id`; badge counts live.

**W2: portfolios, ibor, portfolio-lab** (`07`, `19`, `09`)
- Portfolios: list with search/filters/saved views (`GET /portfolios`, `/portfolios/facets`, `/views`), row drawer (`GET /portfolios/:id`, `PATCH`, evidence upload `POST /portfolios/:id/evidence`), positions from `GET /ibor/positions`. "Create portfolio": the wizard needs `POST /portfolios`; the plan found no such route, so verify, then implement it in `modules/portfolio` per FR-PORT-011 (permission `portfolio.manage`, audit, idempotent) with the prototype's wizard fields.
- IBOR: positions table, asset/state filters, search (server side), snapshot, column chooser persisted per user, **Refresh IBOR** (async job `POST /ibor/refresh`, poll `/ibor/refresh-jobs/:id`), **Reconcile positions** (`POST /ibor/reconcile`), lots, events, settlement ladder, health.
- Portfolio lab: models (list/create/activate/retire/clone), what-if (`POST /portfolio-lab/whatif`; map the prototype inputs to the API body, see `src/ops/pm-depth.tsx`), rebalance create/discard/send to orders.

**W3: orders** (`10-page-orders`, broker modal `43`)
- Replace the three `localStorage` order stores (`matanho-v37-orders`, `-v53/-v56-submitted-orders`, `-order-draft`) with the API when live. List/filters/export (`GET /orders`, `/orders/export`), new order ticket (`POST /orders`, `/orders/precheck` for lot, price tolerance, STOP_LIMIT, override reason), drafts (resume), then the lifecycle: validate, submit, approve/reject (maker-checker with step-up), route, fills, settle, cancel (`/orders/:id/...`), post-trade and slippage (`GET /orders/:id/post-trade`), broker instruction modal (`/orders/:id/broker-instruction/preview` + `route`), FIX feeds and contract notes (`/trading-feeds/*`). Reference: `src/ops/orders*.tsx`, `ops/orders/**`.

**W4: research, risk, performance** (`11`, `12`, `13`)
- Research: cases, valuation model inputs `PUT /research/cases/:id/valuation` (+ apply target), notes and catalysts, issuers/financials/filings, IC meetings and decisions (open voting, vote, ratify, orders) via `/research/*`; "Investment pack" as in W1.
- Risk: limits (create, submit, approve, reject, retire) `POST /risk/limits`, scenario form `POST /risk/scenarios/preview` + run, VaR, breaches (acknowledge), monitor, cases, issuer headroom `GET /risk/portfolios/:id/limits`, compliance report `GET /risk/compliance-report`; show maker-checker status with existing chip classes.
- Performance: returns, attribution (+ CSV/XLSX export), periods (prepare, recompute, lock with step-up, correct), benchmarks and benchmark points (fills the `liveBench` hook: `__mxData.benchSets`), chart range buttons and event markers; methodology action: honest "Not available yet" unless a route exists.

**W5: cash, reconciliations, financing, corporate actions** (`20`, `22`, `25`, `26`)
- Cash: ledgers, balances and explain, context selects (client/portfolio/account/currency/as-of), journals (create, submit, post, reverse, return, reject), reservations, expectations, statement imports (CSV/JSON/CAMT.053/MT940: upload, commit by a checker, match/ignore lines), period close pre-check. Hook `cashJournals`, `cashReservations`, `cashExpectations`, `statementImports`.
- Reconciliations: runs, breaks (assign, investigate, resolve, approve, reject, evidence, query, escalate, reopen, candidates, accept-candidate), overview, signoffs, tolerances, account map, custody positions, counterparty imports and feeds; replace `matanho-recon-v12` and `matanho-v53-counterpart-imports` localStorage state.
- Financing: facilities (submit, approve, return, suspend, reactivate, close, draw, repay, check), collateral pools, margin calls (acknowledge, dispute, resolve with independent checker, waive, cancel), monitor; replace `matanho-v52-financing`.
- Corporate actions: events, upcoming, confirm, entitlements, elections, process (step-up), instruct, reconcile, reverse, cancel, client entitlements.

**W6: valuation (NAV), accounting, regulatory, reports** (`23`, `24`, `27`, `17` + `40`/`41` modals)
- NAV: runs, run detail, inputs, exceptions, recalculate, external NAV vs ABOR, maker review, release (step-up), history and policy.
- Accounting: chart of accounts, journals (create, submit, post, reverse, return, discard), trial balance, ledger, periods (start close, close, reopen), pre-check, basis and report actions via `/reports/runs`.
- Regulatory: templates, calendar (generate), filings (populate, evidence, export, submit for review, approve, return, submit, waive); render the real filings with the prototype table class.
- Reports: catalogue and lookups, runs (create, preview link, email, distribute), schedules (LP delivery, run now); the report editor modal maps to a run with a preview link; PDF/CSV downloads through signed URLs.

**W7: clients depth, investor-services, onboarding, vault depth**
- Clients (extend `admin-20`): client 360 (`GET /clients/:id/360`), mandates, cash-account identifier reveal (audited), change requests (list, approve, reject, withdraw), dealing hold, relationship owner, review date, investor users, CSV export, client report via `/reports/runs`.
- Investor services (extend `admin-30`): SLA policy editor, assign/status/note/sla on requests, summary tiles.
- Onboarding (extend `admin-10`): queue, work-up, checks, risk proposal approve/reject (maker-checker), AI triage notes, assign, configurable risk factors.
- Vault (extend `admin-40`): holds (place, release), retention schedules (apply), change approvals, access log, PM evidence, links, summary tabs.

**W8: private markets, data, model governance** (`08`, `28`, `29`)
- Private markets: funds, commitments, J-curve, cashflows, marks (submit, approve, return, reject), pipeline stages, diligence cases, scenarios, look-through (+ export), by-client.
- Data: connections/sources (ingest, upload, schema, staged), pipelines/jobs and schedules, quality rules (run, schedule) and exceptions (acknowledge, resolve, waive, assign), lineage and impact, market-data and custodian-feed panels; "products" tab maps to datasets.
- Model governance: models and versions (submit, validations, approve, reject, retire), reviews, usage, bindings, summary.

**W9: copilot, rbac/settings completion, audit extras, final QA**
- Copilot: form and chips call `POST /admin-core/copilot/ask`, `GET /suggestions`, `GET /history`; render answers and citations in the prototype's bubble markup; show the integration banner state when the LLM adapter is a placeholder.
- RBAC (extend `admin-60`): access requests (`/admin-core/rbac/requests*`), access reviews, SoD, step-up policy. Settings: numbering and retention cards under existing cards (`/admin-core/settings*`, `/admin-core/retention*`). Audit: facets and event drill-down; chain verify.
- QA sweep (last): a jsdom scan of every page for leftover demo text and static numbers; a scan that no wired page reads or writes the listed `localStorage` keys when live; a role-matrix test (permission union, preview roles read-only); `node tools/legacy-bridge.mjs --check`; full builds and `npm run test:frontend`.

## 6. Known risks and decisions (from the plan; resolve and log them)
Prototype `const`/`let` globals are not `window` properties (use `DATA_HOOKS` or `mx.replace`); prototype uses one role at a time while the backend uses a permission union and enforces segregation of duties (a user approving their own item gets `segregation_of_duties`: show it); preview roles are read-only; static numbers in markup; pagination; CSP only allows the API origin; do not re-run `extract-legacy.mjs` casually (it overwrites fragments). Open decisions with these defaults: serve the prototype at `/` and keep `/classic` as alias; keep the native console at `/ops-native`, unlinked; for backend gaps implement the route if the SRD requires it, else honest "Not available yet".

## 7. Definition of done
- `/` serves the original UI with the full 28-item sidebar; nothing in it links to the native console; the prototype markup and CSS are byte-identical to the original (prove it: `git diff 0adef6f -- portals/admin-web/src/legacy/markup portals/admin-web/public/legacy/css` shows only the intended W0 changes, ideally none).
- Every one of the 28 pages is hydrated from the API and every control in section 5 works against the real backend, with maker-checker, permissions, idempotency, step-up and field-level errors; no demo numbers remain next to live data; no `localStorage` domain state when live.
- Tests: the jsdom page tests pass (`npm run test:frontend`), admin-web builds, `npx tsc --noEmit` is clean in `backend/api` and `portals/admin-web`, `node tools/legacy-bridge.mjs --check` passes, API flow scripts for any backend you touched pass.
- Docs: `docs/ADMIN-REAL-PAGES.md` and `docs/TODO.md` updated; decisions in `docs/DECISION-LOG.md`; the "not browser-verified" list written; a final report listing per page: wired controls, controls shown as "Not available yet" with the reason, files changed, tests.
- Nothing pushed; one commit per package on branch `feat/original-ui-wiring`.

Start by reading `docs/ORIGINAL-UI-WIRING-PLAN.md`, `docs/HANDOFF-NEXT-AGENT.md` (how to run, test and deploy; traps) and `docs/DECISION-LOG.md`, then do W0.

## 8. Hotfixes already applied directly to the live server (2026-10-05): MIRROR THEM INTO THE REPO in W0

The owner needed these immediately, so they were patched into the running admin image on the UAT server (image tags from before each patch: `matanho-nexus-admin:pre-no-opslink` and `matanho-nexus-admin:pre-defaults`). The repo does not have them yet, and the next release built from the repo would silently undo them. In W0, make the same changes in the source files (`portals/admin-web/src/legacy/bridge/*.js`, which `tools/legacy-bridge.mjs` copies to `public/legacy/js/bridge/`):

1. `admin-99-boot.js`: the injected "Operations Console / New" sidebar item (id `mxOpsLink`) is removed (section 1b requires this anyway).
2. `admin-99-boot.js`: the sidebar shows **all workspaces by default**: on the `matanho:legacy-ready` event (and again after 600 ms, because the toggle button is created late) set `#sideNav`.dataset.expanded to `'true'` and call `applyRoleNav()`. The "All workspaces / My workspace" toggle still works and collapses to the role's focus set (table in 1c).
3. `admin-60-access.js`: in the `renderRoleSwitcherV8` wrapper, a System Administrator (holds role `system_admin` or permission `admin.rbac`) gets **every role of the prototype** in the "Viewing as" dropdown: the keys of `rolePrimary` that exist in `roleLabels`; roles the user really holds are plain, the others are labelled "Preview · role". Selecting one switches the workspace exactly as the prototype does (focus set, page permissions from `rolePermissions[role]`, the mock pages stay mock); selecting the user's own role returns to the real context. Previews are read-only: the API still authorises with the user's real permissions.

Add matching jsdom assertions to the tripwire tests in 1d: no `mxOpsLink`; `sideNav.dataset.expanded === 'true'` after boot; the system_admin switcher lists all prototype roles; other roles' switchers still list only the roles they hold.
