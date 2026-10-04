# Fixes log: browser-QA issues and automated-test findings

Consolidated from `docs/issues/ISSUES-*.md` (115 issues), `FIXES-F1..F9.md` (first pass plus "Rework round" sections, newest copies on branches `worktree-wf_d54a6a52-6a6-1..9`, all merged into `feat/admin-recon-nav`), `REVIEW-F1..F9.md` (supervisor verdicts), `docs/test-runs/TRIAGE-T1..T3` (T1 to T3 live on unmerged branches, see section 3), `docs/test-runs/FE-*.md` and `git log`. Nothing here is invented: where a source is silent the cell says `unclear: see <file>`.

Severity: critical = blocker, major = major, minor = minor or polish. Statuses: **Fixed**, **Not a defect**, **Partially fixed**, **Open** (not fixed), **Needs decision** (owner call).

Verification key (every row is NOT browser-verified: the owner dropped browser re-testing, so the column lists the extra evidence only):
- **FE-A** = Vitest suite `tests/frontend/admin-web/a` (328 tests, 0 failed), id listed in `docs/test-runs/FE-admin-a.md`.
- **FE-B** = Vitest suite `tests/frontend/admin/b` (477 tests, 0 failed), id listed in `docs/test-runs/FE-admin-b.md`.
- **API:name** = backend flow script `backend/api/scripts/<name>.ts`, updated by triage to expect the fixed behaviour (T1/T2/T3 branches, not yet merged).
- **tsc/build** = `tsc --noEmit` plus `next build --webpack` by the fix agent (Turbopack cannot build in a worktree junction). Every row has this at minimum; it is not repeated.
- **-** = nothing beyond tsc/build.

<!--SUMMARY-->
## 1. Summary (115 issues)

| state | count |
|---|---|
| Fixed | 95 |
| Not a defect | 10 |
| Partially fixed | 8 |
| Open | 1 |
| Needs decision | 1 |

| severity | total | Fixed | Not a defect | Partially fixed | Open | Needs decision |
|---|---|---|---|---|---|---|
| critical | 3 | 2 | 1 | 0 | 0 | 0 |
| major | 39 | 35 | 2 | 2 | 0 | 0 |
| minor | 73 | 58 | 7 | 6 | 1 | 1 |

| group | total | Fixed | Not a defect | Partially fixed | Open | Needs decision |
|---|---|---|---|---|---|---|
| F1 | 9 | 7 | 0 | 2 | 0 | 0 |
| F2 | 9 | 8 | 0 | 1 | 0 | 0 |
| F3 | 23 | 17 | 3 | 2 | 1 | 0 |
| F4 | 4 | 4 | 0 | 0 | 0 | 0 |
| F5 | 12 | 12 | 0 | 0 | 0 | 0 |
| F6 | 8 | 7 | 0 | 1 | 0 | 0 |
| F7 | 24 | 22 | 1 | 1 | 0 | 0 |
| F8 | 12 | 10 | 1 | 1 | 0 | 0 |
| F9 | 14 | 8 | 5 | 0 | 0 | 1 |

## 2. Per-group tables

Rework column: supervisor verdict, then the result. "OK" = no rework requested. All requested reworks were done in the rework commits (`184c74c`, `6837f0a`, `c0ed442`, `967de92`, `86f10d6`, `a4f85c1`, `eb13203`, `2158bd7`, `f71b746`), none re-reviewed by a supervisor after the rework: result is from the FIXES "Rework round" text.

### F1 Fund ops, cash, capital calls, notices, reconciliation display

| id | sev | title | root cause | what changed | files | rework | verified | status |
|---|---|---|---|---|---|---|---|---|
| ADA-015 | critical | Cash tabs crash | `api.get` strips `data`; 5 tabs read `r.data` | those calls use `apiRequest('GET')` | `ops/cash/page.tsx`, `ops/CashJournalForm.tsx` | OK (other `api.get(...).data` pages not audited) | FE-A | Fixed |
| ADA-017 | minor | Seed journals same maker/checker | `seed-cash` used one user as maker and poster | poster = other active admin user holding `cash.journal.approve`; fills-do-not-move-cash is by design (Settle creates PENDING journals) | `seed-cash.ts` | REWORK (poster not filtered) -> done | FE-A | Fixed |
| ADA-021 | major | Blank PAID/COMMITTED | API sent `paid`/`totalCommitment`, UI reads `amountPaid`/`totalCommitted` | API sends both names | `ops/capital.*`, `funds.routes.ts` | OK (dual fields) | FE-A | Fixed |
| ADA-022 | major | UUIDs/blanks in call detail, notices | API lacked name/snapshot fields | names and snapshots added | `capital.service.ts`, `notices.routes.ts`, `notices/page.tsx` | OK (allocationMethod inferred, not stored; left) | FE-A | Fixed |
| ADA-023 | minor | Reference numbering inconsistent | notices used `c.ref`; old `CC-AGFI-0xx` refs exist in DB | display uses `c.ref`; existing refs untouched, no migration | notices page/routes | OK (partial) | FE-A | Partially fixed |
| ADA-026 | minor | Reporting packs filter/overdue | default filter hides new periods; no overdue mark | overdue marker, status switch; `isOverdue` uses `due.slice(0,10)` | `reporting/page.tsx` | OK (partial); period-label inconsistency orphaned, not done | FE-A | Partially fixed |
| ADA-027 | minor | Day-end trade counts disagree | label ambiguity; seeded DAY-DEMO1 MV 0.00 | `executionsReceived` shown; seed package gets file, hash, computed MV | day-end routes, `seed-recon.ts` | OK (partial) -> seed done in rework (existing DBs keep old row) | FE-A | Fixed |
| ADA-030 | minor | Break drawer overlap, "8 open 8 high" | layout, severity folded | layout CSS, `bySeverity` tile | `recon/common.tsx`, `BreakDetail.tsx` | OK (Today "high" tile still folds critical) | FE-A (CSS part NBV) | Fixed |
| ADA-031 | minor | Seed dates/wording | weekend dates, no past-dated confirmed dividend | seed dates and wording | `seed-corporate-actions.ts` | REWORK (format, entitlements check, marker) -> done | FE-A | Fixed |

### F2 Orders, NAV, accounting, risk, Today, portfolios

| id | sev | title | root cause | what changed | files | rework | verified | status |
|---|---|---|---|---|---|---|---|---|
| ADA-006 | minor | Today "Orders working" counts Awaiting approval | `WORKING_ORDERS` included AwaitingApproval | excluded; separate `awaitingApproval` hint | `wiring/control.service.ts`, `command/page.tsx` | OK | FE-A | Fixed |
| ADA-007 | major | Risk breaches 0 while limits exceeded | Today counted only recorded breach rows | `countUnrecordedExceedances`; Today = open + unrecorded; portfolio shows risk limits | `risk.service.ts`, `control.service.ts`, portfolio pages | OK w/ notes (swallowed error) -> rework: "check unavailable" flag, 3 queries | FE-A | Fixed |
| ADA-009 | minor | Breaches only after manual Run monitor | no scheduler | exceedances visible without action; no scheduler added | same as ADA-007 | OK (partial, acknowledged) | FE-A | Partially fixed |
| ADA-011 | major | NAV maker-review 500 after commit | read-back after commit hit transient DB drop | read-back retry; rework: mutations answer 200 with `readBackFailed`; UI reloads | `nav.routes.ts`, `nav/[id]/page.tsx` | REWORK (minor, hides fault) -> done; root DB drop environmental, not reproduced | FE-A | Fixed |
| ADA-012 | minor | NAV MV 0.01 off Portfolio | sum of rounded lines vs round once | uses snapshot `securitiesValueBase`; fallback removed in rework | `nav.service.ts` | OK w/ note | FE-A | Fixed |
| ADA-013 | minor | Stale age 27d vs 38 days | NAV calendar days, Securities business days | NAV uses business days | `nav.engine.ts`, `nav.service.ts` | OK w/ note | FE-A, API:test-nav | Fixed |
| ADA-016 | minor | NAV release creates 4-account chart | `accountIds()` created only needed accounts | installs full standard chart on first auto-posting | `wiring/autojournals.ts` | OK | FE-A | Fixed |
| ADA-018 | minor | Journal posted with no period | posting did not require a period | posting opens the month's period (audited); rework: journal period derives from entry date, so linkage point is not a defect | `accounting.routes.ts` | REWORK -> resolved as not-a-defect on the linkage | FE-A, API:test-accounting | Fixed |
| ADA-020 | minor | Orders validation gaps | no lot / ADV bound, default zod text | 400 on non-board-lot or >10x ADV; clear rationale/reason text | `orders.routes.ts`, `orders.checks.ts` | OK w/ note (new hard rejection) | FE-A, API:test-orders | Fixed |

### F3 Personas, auth, sessions, shell, shared UI, roles, validation

| id | sev | title | root cause | what changed | files | rework | verified | status |
|---|---|---|---|---|---|---|---|---|
| ADA-001 | major | No persona can approve/route orders | one persona created and approved; nobody routes | test personas `test_portfolio_manager/approver/dealer`; SoD-clean roles; rework: role seeding additive | `seed-uat.ts`, `role-catalog.json`, `seed.ts` | OK w/ REWORK on role changes (destructive retire on every seed) -> done, retire only with `SEED_APPLY_ROLE_RETIREMENTS=1` | - | Fixed |
| ADA-002 | major | local_admin view-only | by design (SoD) | documented in `docs/LOCAL-STACK.md` | docs | OK (not a defect) | - | Not a defect |
| ADA-003 | minor | Step-up silently skipped | by design when no factor enrolled | documented bypass | docs | OK w/ note | - | Not a defect |
| ADA-004 | major | Shared session cookie across portals | cookie not port-scoped | `nexus_session_<port>` outside production (`cors.ts`, `portal-kit` proxy) | `config/cors.ts`, `portal-kit/src/proxy.ts` | OK w/ notes (no-Origin requests fall back) | - (real cookies NBV) | Fixed |
| ADA-005 | minor | Slow hard nav, two 401s | dev-mode compile, cookie clash | no code change | - | OK (not fixed, justified) | - | Open |
| ADA-010 | minor | Generic "Validation failed" | `validate.ts` forwarded raw zod; envelope hid details | readable field phrases, `fieldErrors`; rework: catch-all rewrite removed, message stable | `middleware/validate.ts`, `errorHandler.ts` | REWORK -> done | FE-A, FE-B | Fixed |
| ADA-014 | minor | Native `window.confirm` on money actions | `ActionButton` used `confirm` | shared in-app `ConfirmDialog`; security page and recon tabs converted | `ops/ui.tsx`, `security/page.tsx`, `recon/*` | OK; other callers converted in rework | FE-A, FE-B | Fixed |
| ADA-024 | major | Seeded records owned by only persona able to progress | seed ownership | term sheets authored by PM persona; second approver persona | `seed-uat.ts` | OK w/ note | - | Fixed |
| ADA-025 | minor | 501 with stack trace | `details.stack` leaked | removed in `errorHandler`; also `lp.http.ts` (F8), `investee.http.ts` (F7) | `errorHandler.ts` and two module handlers | OK w/ note -> other handlers done in rework | - | Fixed |
| ADA-028 | minor | Sidebar not permission-filtered | already dims links; Accounting named wrong permission | no F3 change; F2 rework fixed no-access text | `accounting/page.tsx` | OK (not a defect) | FE-A, FE-B | Not a defect |
| ADA-029 | minor | Dead footer link, "Welcome, UAT" | footer link; unowned page | footer link removed; rework: greeting uses full name | `Shell`, `ops/page.tsx` | REWORK (partial) -> done | FE-B | Fixed |
| ADB-012 | major | Gated actions silently absent | no disabled-with-reason pattern | `ActionButton requires`; F5 local pattern; FE-B added onboarding scoring Edit and clients cash-account Approve | `ops/ui.tsx`, F5/F6 pages, `clients/page.tsx`, `onboarding/page.tsx` | OK (mechanism) | FE-B | Partially fixed (clients drawer hold/owner/review-date, New client still hidden, see section 4) |
| ADB-014 | minor | Generic validation toasts | same as ADA-010 | shared layer | as ADA-010 | REWORK -> done | FE-B | Fixed |
| ADB-020 | major | Shipped roles violate SoD | 21 role-level conflicts | role catalogue cleaned (0 conflicts); seeding additive in rework | `role-catalog.json`, `seed.ts`, `seed-admin-shell.ts` | REWORK (rollout risk) -> done | FE-B (SoD report) | Fixed |
| ADB-021 | minor | Settings copy and raw values | copy | humanised values and footer | `settings/page.tsx` | OK | FE-B | Fixed |
| ADB-026 | major | Mobile sidebar | no drawer | off-canvas drawer, hamburger, scrim | `Shell.tsx`, `ops.css` | OK | FE-B (toggle logic only; CSS NBV) | Fixed |
| ADB-027 | minor | Password change feedback | UI only | device labels; weak-password reason via ADA-010 | `profile/page.tsx` | OK | FE-B | Fixed |
| ADB-028 | minor | Shell details | multiple | (a) dropdown wrap, (c) hidden internal fields fixed; (b) works as reported, (d)(e) dev-mode | `ops.css`, `search/registry.ts` | OK w/ note (hides all `*Count`/uuid `*Id`) | FE-B (c only) | Partially fixed |
| INO-026 | major | No Forgot-password entry | dead ends in reset flow | links and form fixes in shared forms | `portal-kit` LoginForm/ResetPasswordForm | OK | - | Fixed |
| LPC-001 | major | Portals share cookie | as ADA-004 | as ADA-004 | as ADA-004 | OK w/ notes | - | Fixed |
| LPC-005 | minor | E-sign error envelope differs | different envelope | superset envelope (`success:false`, `code`, `message`, `fieldErrors`) | `errorHandler.ts` | OK w/ note | - | Fixed |
| LPC-006 | minor | Invalid enum/date inputs accepted | LP endpoints unvalidated | F3 shared layer plus F8 rework `dateQuery`/`enumQuery` | `validate.ts`, `lp-portal/services/common.ts` | REWORK -> done | - | Fixed |
| LPC-015 | minor | Missing required fields, generic errors | custodian validations | F3 shared layer, F9 required messages and bulk `declaredCount` text | `validate.ts`, `custodian.schemas.ts`, `custodian.ops.ts` | OK (partial) -> bulk text done in rework | - | Fixed |

### F4 Market data, securities, integrations

| id | sev | title | root cause | what changed | files | rework | verified | status |
|---|---|---|---|---|---|---|---|---|
| ADA-008 | minor | Stale prices valued without warning | no warning in snapshots | `staleWarnings`/`stalePrices`; banner; rework: F2 renders on portfolio and Today, single stale constant | `portfolio.service.ts`, `market-data.tsx` | OK w/ note | FE-A, FE-B | Fixed |
| ADA-019 | major | Wild VENDOR prices accepted | Run feed called unvalidated `/admin-core/.../sync` | fake provider steps at most 2%; `POST /market-data/simulate`; old route delegates to `refreshMarketData`; simulate refuses (409) for non-fake provider | `integrations/market-data/*`, `admin-core/integrations.routes.ts` | REWORK (partial) -> done | FE-B | Fixed |
| ADB-022 | minor | Integrations screen | raw JSON toast | readable text | `integrations/page.tsx` | OK | FE-B | Fixed |
| ADB-024 | major | Simulated feed absurd prices, no undo | no bounds, no reverse | sanity bounds, exceptions, run undo; rework: undo refuses if run superseded, price in use, not verified | `market-data/service.ts`, `routes.ts`, `market-data.tsx` | REWORK -> done | FE-A, FE-B | Fixed |

### F5 IBOR, performance, portfolio lab, private markets, research, financing

| id | sev | title | root cause | what changed | files | rework | verified | status |
|---|---|---|---|---|---|---|---|---|
| ADB-001 | major | IBOR Refresh/Reconcile not visible | gated by perms sysadmin lacks | always rendered, disabled with reason | `ibor/page.tsx` | OK | FE-B | Fixed |
| ADB-002 | minor | Book state tile reads like pass | wording | "need attention" wording | `ibor/page.tsx` | OK | FE-B | Fixed |
| ADB-003 | major | Headline MV mixes currencies | summed base amounts across currencies | single reporting currency via FX resolver; rework: missing FX flagged `kpis.fxMissing`, never 0 | `ibor.service.ts`, `ibor.tsx` | REWORK (`fx ?? 0`) -> done | FE-B | Fixed |
| ADB-004 | minor | Breadcrumb raw "position" | `Breadcrumbs.tsx` raw segments | label map (F3 rework) | `shell/Breadcrumbs.tsx` | OK (F3 file) | FE-B | Fixed |
| ADB-005 | major | Official-return controls all green | recon check ignored; missing NAV passed | controls require holdings recon and released NAV | `perf.service.ts` | OK w/ note (demo periods cannot lock until NAV) | FE-B, API:test-ibor-performance | Fixed |
| ADB-006 | minor | Performance data stale, blank dates | prices end 26 Aug | stale banner, date hints, "No composition"; data load not done | `performance/page.tsx` | OK (disclosure only) | FE-B | Fixed (disclosure; price data still ends 26 Aug) |
| ADB-007 | major | Portfolio construction no controls | gated by perms | controls always rendered, disabled with reason | `portfolio-lab/page.tsx` | OK | FE-B | Fixed |
| ADB-008 | minor | What-if verdicts inconsistent | whole-book vs per-trade | relabelled tile, Trade checks tile, banner | `portfolio-lab/page.tsx` | OK | FE-B | Fixed |
| ADB-009 | minor | Private Markets "By client" empty | only owner-client portfolios | look-through to LP holdings pro rata | `pm.routes.ts`, `private-markets/page.tsx` | OK w/ note | FE-B | Fixed |
| ADB-010 | major | Research form errors not per field | shared modal | local `CaseFormModal` with per-field errors | `research/page.tsx` | OK | FE-B | Fixed |
| ADB-011 | minor | "Awaiting ratification" counts 0 votes | counted all VOTING | counts only quorum-reached | `research.routes.ts` | OK | FE-B | Fixed |
| ADB-023 | minor | Model ID clash MDL-1001/1002 | same prefix | Portfolio Construction uses `PMD-`; seed re-prefix (skips existing); F3 label | `lab.routes.ts`, `seed-research-privates.ts`, `refs.ts` | OK w/ note -> seed guard done | FE-B | Fixed |

### F6 Clients, services, vault, reports, regulatory, data, e-sign, onboarding review

| id | sev | title | root cause | what changed | files | rework | verified | status |
|---|---|---|---|---|---|---|---|---|
| ADB-013 | major | Client 360 contradicts list | list used denormalised fields | rework: `clientView` counts real rows; seed reconciles | `co.clients.routes.ts`, `modules/clients`, `seed-clients-onboarding.ts` | REWORK (partial) -> done; hard-coded holder in new cash accounts: `unclear: see FIXES-F6.md` | FE-B | Fixed |
| ADB-015 | minor | SLA "Waiting on you" counted breached | clock kept running; no policy rows | "Waiting on client" state, aliases, policy rows | `co.services.routes.ts`, `co.service.ts` | OK w/ note | FE-B | Fixed |
| ADB-016 | minor | Vault small issues | several | (a)-(e) done | `co.vault.routes.ts`, `vault/page.tsx` | OK w/ note -> import order fixed | FE-B | Fixed |
| ADB-017 | minor | Reports scheduling/format | date format | date format; "Run now" keeps next run by design | `reports/page.tsx` | OK | FE-B | Fixed |
| ADB-018 | minor | Stale red hint | ActionButton kept old error | button keyed on payload state; F3 clears error | `regulatory/page.tsx` | OK | FE-B | Fixed |
| ADB-019 | minor | Data Fabric rules never run, raw JSON | seed, display | rules run at seed; plain text; 12 missing ISINs not fixed (no verified real ISINs) | `seed-reports.ts`, `data/page.tsx` | OK w/ note | FE-B | Partially fixed |
| ADB-025 | major | Staff signers cannot sign | no Sign action | Sign button, banner; F3 shows nav entry | `ops/esign.tsx`, `shell/nav.ts` | OK w/ note | FE-B | Fixed |
| INO-025 | minor | Onboarding case Clear/Low with zero checks | no-checks read as Low | provisional flag; F9: holder-mismatch exception and wording in KYC screening | `co.onboarding.routes.ts`, `kyc/screening.ts` | OK (partial) -> F9 rework done | FE-B | Fixed |

### F7 Investee portal

All 24 rows: first pass on branch, tsc and `next build --webpack` clean; no frontend test project for `company-web` yet (see section 5); UI rows are `OK (unverified UI)` in REVIEW-F7.

| id | sev | title | root cause | what changed | files | rework | verified | status |
|---|---|---|---|---|---|---|---|---|
| INO-001 | major | Shell renders for unlinked user | no handling of `no_company_access` | "not linked" panel; F3: login Continue link turn-away | `InvesteePortal`, portal-kit `LoginForm` | OK | - | Fixed |
| INO-002 | major | Submit modal uses demo data | demo lists | live periods/owners, blank inputs | company-web reporting | OK (unverified UI) | - | Fixed |
| INO-003 | major | Validate & submit fails on prefilled sheet | check after post | balance check before posting, inline error | same | OK (unverified UI) | - | Fixed |
| INO-004 | minor | Draft/Templates tabs static | mock | live drafts and templates | same | OK (unverified UI) | - | Fixed |
| INO-005 | minor | Shell chrome hard-coded | demo | live company/fund/health | same | OK (unverified UI) | - | Fixed |
| INO-006 | major | No company switcher | `?company=` never sent | `/profile` `companies[]`, switcher | `investee.routes.ts`, UI | OK | - | Fixed |
| INO-007 | major | Cap table cannot record/decide | dead form | pending banner, `locked`, list replaces form | `capTableView`, UI | OK | - | Fixed |
| INO-008 | minor | Maker cannot withdraw own pending tx | no endpoint | `POST /cap-table/transactions/:ref/withdraw` (maker, audited); rework: idempotent | `workspace.routes.ts` | REWORK (minor) -> done | - | Fixed |
| INO-009 | major | KPI Centre raw ids, no units | demo ids; seed units | KPI definitions, drawer, export columns; F3 seed units and labels | KPI page, `uat-seed.json`, `seed-uat.ts` | OK w/ note -> F3 seed rework done | - | Fixed |
| INO-010 | minor | Forecast accepts negative revenue | no check | `forecastSchema` and host reject; seed totalRevenue (F3) | `investee.contract.ts`, `seed-uat.ts` | OK | - | Fixed |
| INO-011 | minor | Silent no-ops, generic messages | UI | named missing fields | company-web | OK (unverified UI) | - | Fixed |
| INO-012 | minor | Public e-sign accepts any typed name | no compare | name must match invited signer | `workspace/sharing.ts` | OK w/ note | API:test-investee-workspace | Fixed |
| INO-013 | minor | "Nothing recorded yet" flash | no loading state | Loading state | company-web | OK | - | Fixed |
| INO-014 | minor | Share link raw API URL | no landing page | `/sign/share/<token>` landing page | `(tools)/sign/share/[token]` | OK | API:test-investee-workspace, test-investee-remainders | Fixed |
| INO-015 | minor | Request drawer fabricated info | mock drill-down | live record only | company-web | OK (unverified UI) | - | Fixed |
| INO-016 | major | Overview falls back to demo data | flags failure started demo mode | 3 retries then Retry panel; grep shows no demo company left | `lib/investee` | OK | - | Fixed |
| INO-017 | major | Term sheets cannot be signed (MFA) | no in-portal enrol | enrolment entry points in Settings, Signatures, profile | company-web | OK w/ note (needs e2e test, not run) | - | Fixed |
| INO-018 | minor | Signatures ignores workspace requests | static | live requests and members | company-web | OK (unverified UI) | - | Fixed |
| INO-019 | major | Settings save not atomic | letterhead field | validate all, then write; http(s) only | `investee.contract.ts` | OK | - | Fixed |
| INO-020 | minor | Pending invitations invisible | not listed | `/team` lists invites; rework: profile/title from grant, `invitationId` | `investee.routes.ts` | REWORK (minor) -> done | - | Fixed |
| INO-021 | minor | Vault spoofed types, raw ids | no byte check | `assertFileContentMatches`; rework: also logo, attachments, signature image; download/preview/delete not built | `investee-workspace.ts` | OK (partial) -> uploads extended | - | Partially fixed |
| INO-027 | minor | Notifications static | demo | live `/notifications` | company-web | OK | - | Fixed |
| INO-028 | minor | Governance date defaults past | stale default | today+14, min, server rejects past | `records.ts` | OK (UTC edge) | - | Fixed |
| INO-030 | minor | Slow session hydration, redirect to login | dev compile; proxy behaviour | none | - | OK (not a defect) | - | Not a defect |

### F8 LP portal

| id | sev | title | root cause | what changed | files | rework | verified | status |
|---|---|---|---|---|---|---|---|---|
| LPC-002 | major | POST /requests returns wrong request | `findRequest` spread fund-scope `OR` over reference `OR` | combined under `AND` | `services/requests.ts` | OK | - | Fixed |
| LPC-003 | major | Payment confirmation any amount | no bounds | reject zero/over outstanding; rework: amount format check | `services/capital.ts` | OK w/ note -> 500 on non-numeric fixed | - | Fixed |
| LPC-004 | major | E-sign typed name need not match | `signRequest` only checks length | F3 UI hint; F6 rework API check (case/accent-insensitive) | `esign.service.ts`, `EsignSigner.tsx` | REWORK (orphaned) -> done by F6/F3 rework | - | Fixed |
| LPC-007 | minor | Out-of-scope fund handling | `getDashboard` ignored fund | `assertFund`, dealing overview validation; F3 removed stray membership | `dashboard.ts`, `dealing.ts`, `seed-uat.ts` | OK | - | Fixed |
| LPC-008 | minor | Documents outside fund scope | fund-less docs label other funds | rework: label filter removed, seed links documents to fund | `documents.ts`, `seed-demo.ts` | REWORK (stopgap) -> done | - | Fixed |
| LPC-009 | minor | KPIs do not reconcile with lists | opening balances added by design | card labels explain coverage | dashboard screen | OK (not a defect, with note) | - | Not a defect |
| LPC-010 | minor | Pending invitations not editable, colleague exposure | `updateColleague` ignored invites | PATCH on invite; list restricted by role | `organisation.ts` | OK w/ notes | - | Fixed |
| LPC-022 | critical | Request detail/reply always REQ-2017 | same as LPC-002 | same one-line fix; unknown ref 404 | `services/requests.ts` | OK | - | Fixed |
| LPC-023 | major | Capital activity types/totals | re-bucketing, YTD vs all-time | API types shown; paid-calls sum from Paid rows | `mappers.ts`, capital activity screen | OK | - | Fixed |
| LPC-024 | major | Dashboard contradictory figures | NAV minus distributions etc | Remaining Value = NAV; labels; legacy "Signature required" actions remain | dashboard screen/service | OK w/ note | - | Partially fixed |
| LPC-025 | minor | "2 Commitments" dead link | link to missing page | removed; sidebar renders after funds load | dashboard, sidebar | OK | - | Fixed |
| LPC-026 | minor | Payment UI no amount/note | no dialog | dialog with amount, notes, validation | capital activity screen | OK | - | Fixed |

### F9 Custodian and onboarding portals

(LPC-015 is counted under F3; F9 added its required-field messages.)

| id | sev | title | root cause | what changed | files | rework | verified | status |
|---|---|---|---|---|---|---|---|---|
| LPC-011 | major | Day-end with wrong trade count | `totalsMismatch` ignored count | count included; enforced at submit | `custodian.service.ts`, `custodian.routes.ts` | OK (older/seeded packages can still be approved) | - | Fixed |
| LPC-012 | minor | DAY-DEMO1 no file/hash | seed in `seed-recon.ts` | F1 rework: file, sha256, MV, submitter-role preparer | `seed-recon.ts` | REWORK (orphaned) -> done by F1 (existing DBs keep old row) | - | Fixed |
| LPC-013 | major | CSV formula injection | text stored verbatim | `safeText` rejects formula prefixes and HTML | `custodian.schemas.ts` | OK w/ note (rejects leading +/-) | - | Fixed |
| LPC-014 | minor | Ambiguous timestamps | lenient parsing | strict ISO 8601 with offset | `custodian.schemas.ts` | OK | - | Fixed |
| LPC-016 | minor | Two Draft day-ends coexist | no warning | API `warnings`; rework: UI shows warning | `custodian.routes.ts`, `day-end/page.tsx` | REWORK (minor) -> done | - | Fixed |
| LPC-017 | critical | Amend dialog strips trailing zeros | legacy `custodian-live.js` gone; native Amend pre-fills raw quantity | none (not a defect) | - | OK (not a defect, "with doubt") | - (NOT browser-verified, critical) | Not a defect |
| LPC-018 | minor | Form pre-filled demo values | native form starts empty | none | - | OK (code not fully inspected) | - | Not a defect |
| LPC-019 | minor | No reaction to expired session | stale shell | 401 `unauthorized` redirects to `/login?next=`; rework keeps query, excludes MFA codes | `custodian-web/src/lib/api.ts` | OK w/ note -> done | - | Fixed |
| LPC-020 | minor | Orphan Draft on failed submit | native flow separate | none | - | OK (not a defect) | - | Not a defect |
| LPC-021 | minor | "prototype"/"Demo" copy | removed in native rewrite | none (grep) | - | OK (not a defect) | - | Not a defect |
| INO-022 | major | Step 5 Continue blocked | legacy handler gone | none | - | OK (not a defect) | - | Not a defect |
| INO-023 | minor | Evidence upload trusts declared type | no sniffing | `assertContentMatches` (magic bytes, executables refused) | `kyc/public.routes.ts` | OK w/ note (third duplicate helper) | API:test-onboarding | Fixed |
| INO-024 | minor | Onboarding accepts invalid values | no checks | client and server checks on amounts, SWIFT, account | onboarding wizard, `kyc` | OK | - | Fixed |
| INO-029 | minor | Onboarding copy, resume | mostly gone with rewrite | "Resume returns to step 1" not fixed | - | OK (mostly not a defect) | - | Needs decision |

## 3. Fixes found by automated testing

API flow-test run `RUN-2026-10-04` against the UAT host (`docs/test-runs/RUN-2026-10-04-fails.txt`), triaged in T1 to T3. Of the failures, most were stale tests (updated); these are the real product bugs. Merge-time defects found when assembling the groups are listed after.

| # | Defect | Found by | Root cause | Fix | Where |
|---|---|---|---|---|---|
| 1 | Recon reopen returned 409 for a reopen that succeeded | test-recon-ops (T1) | `expectVersion(req, fresh.version)` ran after the transition bumped the version | removed post-commit check (pre-write check and `updateMany` on id/version/status remain) | `recon/recon.ext.routes.ts`, commit `32e8be4` on `worktree-agent-a1fbd0c9587acd05a` (not merged) |
| 2 | Command Centre allocation weights sum to 110.58% (cash counted twice) | test-recon-ops (T1) | `allocationPanel` added cash though `byAssetClass` already has a Cash row | removed duplicate add | `wiring/insights.service.ts`, same commit (not merged) |
| 3 | Every staff investee-review endpoint answered 501 | test-investee-remainders (T2) | `/investee-review` mounted after the 501 catch-all in `ops.routes.ts` | mounted before the catch-all | `ops/ops.routes.ts`, commit `ca2bb80` on `worktree-agent-ac90c282d5f7b2fb3` (not merged) |
| 4 | AI triage rated PEP without source of funds as MEDIUM | test-ai-reporting (T3) | `ruleTriage` returned HIGH only for failed check, High score or high-risk jurisdiction | HIGH when PEP declared and no source of funds (decision recorded in triage; SRD silent) | `integrations/llm/fake.ts`, commit `e3d9dda` on `worktree-agent-ac77757b9e003e5f2` (not merged) |
| 5 | F3/F4 market-data sync route duplicate after merge | merge | both groups edited the route | kept fake-only guarded version; then restored `isRealMarketMode` helper | commits `c7a16e8`, `f65aa0b` (merged) |
| 6 | MySQL rejected `ops_controls` migration | deploy | UTF-8 BOM at file start | BOM stripped | commit `4340a55` (merged) |
| 7 | PM evidence duplicate column | merge | duplicate column in schema/migration/seed | deduped (also `.env.example`, mailer, CA routes, worker) | commit `96b1a3c` (merged) |
| 8 | Admin `next.config.ts` broken after merge | merge | `headers()` left unclosed | closed | commit `2b4cfea` (merged) |
| 9 | IBOR `source_id` too narrow | run | opening event key is `portfolioId:securityId` | widened to 80, new migration | commit `675a402` (merged) |
| 10 | `lp-performance-screen.tsx` invalid UTF-8 byte broke investor-web build | F8 build | CP1252 ellipsis byte | replaced | F8 (merged) |
| 11 | `nextRef` import missing in `seed-research-privates.ts` | F5 first pass | lost import | restored | commit `86f10d6` (merged) |

Frontend-test findings (`FE-admin-b.md`): three product fixes made by the tester, uncommitted in the working tree: onboarding risk-scoring Edit control gated for users without `onboarding.approve`, clients cash-account Pending-approval had no Approve control, e-sign inbox called the API for signers without `esign.view` (files: `ops/clients/page.tsx`, `ops/onboarding/page.tsx`, `ops/esign.tsx`). `FE-admin-a.md`: no product bug; observation that Operations task Block/Cancel/Reopen still use `window.prompt`. `FE-*.md` for company, investor, custodian, onboarding portals and portal-kit: not present yet.

Stale API tests updated by triage (no product change, all on the T1/T2/T3 branches): T1 test-accounting, test-cash, test-nav, test-orders, test-orders-pm-wiring, test-opsctl, test-recon-ops, test-recon (re-run results `unclear: see TRIAGE-T1.md`); T2 test-custodian-ops (32 pass), test-ws4 (69 pass), test-onboarding (30 pass), test-investee-workspace, test-investee-remainders (harness fixes included); T3 test-ibor-performance, test-wp6, test-ws1, test-admin-shell.

## 4. Open items and needs-decision

| item | why | status |
|---|---|---|
| ADA-005 slow hard navigation | dev-mode compile; no code change; re-check 401s after cookie fix | Open |
| INO-029 resume returns to step 1 | declared low value, not fixed | Needs decision |
| ADA-009 scheduled monitor | no background scheduler in codebase; adding one declared out of scope | Needs decision |
| ADB-019 12 securities without ISIN | no verified real ISINs; fabricating identifiers rejected | Needs decision |
| ADA-023 existing `CC-AGFI-0xx` refs | needs data migration in environments that have them | Needs decision |
| ADA-022 store allocation method on call | `allocationMethod` is inferred (heuristic); schema change not done | Needs decision |
| ADA-026 period-label inconsistency | orphaned: labels come from `company.service.ts` and demo JSON | Open |
| ADB-006 stale price history | disclosure banner only; loading newer prices is data work | Open |
| ADB-012 `/ops/clients` drawer actions and "New client" hidden for users without `clients.edit` | named in FE-admin-b as still open | Open |
| ADB-028 (b)(d)(e) | works as reported or dev-mode behaviour | Not a defect |
| LPC-024 legacy "Signature required" actions | legacy `SignatureRequest` rows have no native inbox entry | Open |
| INO-021 vault download, preview, delete | no API; new feature | Open |
| Vault numbering `LP-DOC-` vs `DOC-` | not fixed; renaming risks existing databases (F3 rework) | Needs decision |
| ADB-013 hard-coded account holder `Matanho Managed Funds` in `modules/clients/clients.routes.ts` | unassigned file, F6 note | Open (`unclear: see FIXES-F6.md`) |
| Existing databases keep old rows | DAY-DEMO1 (ADA-027, LPC-012) and NAV-00001 (ADA-012) unchanged until reseed or recalculation | Needs decision |
| T1, T2, T3 triage branches | real bugs 1 to 4 above are not in `feat/admin-recon-nav`; merge needed | Open |
| Review points not re-reviewed | no second supervisor pass after the rework commits | Open |
| Tester product fixes uncommitted | `ops/clients/page.tsx`, `ops/onboarding/page.tsx`, `ops/esign.tsx` and others in working tree | Open |

## 5. Not browser-verified

Owner rule: no browser activity. All 115 issues are unverified in a real browser. Specifically:
- Visual and CSS: ADA-030 break drawer overlap, ADB-026 mobile drawer, ADB-028(a) dropdown wrap, ADA-026 overdue colouring, charts (FE-admin-a/b "Cannot be verified" lists).
- Real cookies across portals: ADA-004, LPC-001, session redirect (ADA-005, LPC-019).
- Native widgets: file chooser and downloads (ADB-016, INO-014, INO-021, INO-023), date pickers, `window.prompt`.
- Critical items by code reading only: LPC-017 (not a defect, "with doubt" per REVIEW-F9), LPC-022 (API fix, no UI test), ADA-015 (FE-A covers render with mocked API).
- Investee portal (F7), LP portal (F8), custodian and onboarding portals (F9), portal-kit: no frontend test project output yet; INO-017 (MFA enrol then sign) needs an end-to-end test, not run.
- Real-API behaviour with the fixes: only the stale-test re-runs on the T1 to T3 branches; ADA-011 root cause (DB drop) cannot be reproduced.
