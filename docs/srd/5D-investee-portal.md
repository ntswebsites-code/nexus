# 5.D Investee Portal (port 3103)

**[O]** Since 30 Sep 2026 the Portfolio Company Portal is the **Investee Portal V8**: a vanilla-JS single-page runtime imported from the sibling PE/VC fund-ERP product (Arcus, repository "NVCCZ") and hosted by a thin Next.js 16 wrapper (`InvesteePortal.tsx`). It replaces the native React company portal (8 pages on `/api/v1/company/*`) and the older one-page prototype. Thirteen pages share one shell, one overlay system (right drawer, centred modal, command palette, toasts) and a light/dark theme.

Portal-wide facts:
- **[O]** The runtime is started with `liveOnly:false`, i.e. **mock mode**. Every figure, status, name, document, thread, workbook cell and chart on all 13 pages is a fixture of a fictional company ("Zambezi Pay Technologies", fund "Matanho Venture Fund I", CFO "Tariro Moyo"). The signed-in user supplies only the profile-button name, e-mail, role line (`roles[0].label`, else "Portfolio company user") and initials, plus the *Sign out* action. No page calls the API. The runtime contains no network code at all; `MATANHO_CONFIG.apiPrefix` (`/api/v1/investee-portal`) is declared and never read, and no `investee-portal` route exists in `backend/api`.
- **[O]** The runtime also contains a complete **live mode** (`liveOnly:true`, data supplied by a host calling `window.MatanhoInvesteeUI.hydrate(payload)` and writes handled by a host listening to the cancelable `matanho:before-action` window event). The NVCCZ host does this against the NVCCZ API. The Nexus host does neither, so the live branches are dormant. Throughout 5.D "mock" means the behaviour of the running Nexus portal and "NVCCZ live" means the dormant live branch plus the NVCCZ host and backend.
- **[P]** Evidence-label convention for this section: a behaviour that exists only in NVCCZ code (not in the Nexus runtime, not in the Nexus API) is **[P]** for Nexus and is tagged "NVCCZ ref". Target API paths are `/api/v1/company/...` (Nexus convention; guard *session + company context*, section 4.4) and are consolidated in the API contract of the backend sections.
- **[O]** Access: investor-role accounts are turned away to `/access-denied` by `proxy.ts` (`turnAwayPortals:['investor']`); sign-in is enforced only when `company` is listed in `REQUIRE_AUTH_PORTALS`; the login form omits the `portal` parameter (`enforcePortalAccess={false}`) because company users have no roles. No company-scope check exists on the page path: any signed-in non-investor account reaches the pages and sees the fixtures (DEFECT, section 5.D.0 gaps).
- **[O]** Page `<title>` "Matanho \| Investee Portal"; description "Reporting, KPIs, term sheets and capital requests for Matanho portfolio companies."; auth pages "Sign in \| Matanho Investee Portal" and "Access denied \| Matanho Investee Portal".
- **[O]** Routes (root of `company.nexus.matanho.com`): `/` Overview, `/kpis`, `/reports`, `/forecasts`, `/terms`, `/cap-table`, `/governance`, `/signatures`, `/requests`, `/data-room`, `/messages`, `/team`, `/settings`; any other path renders Overview. Each Next route component returns `null`; routing only drives `setPage`.
- **[O]** Status pills: green when the status text matches `accepted, submitted, resolved, above, on track, connected, approved, complete, active`; amber for `review, progress, watch, draft, pending, open`; red for `overdue, blocked, rejected, at risk, high`; blue for `medium, info`; grey otherwise (tested in that order, case-insensitive). Money is shown as `$` plus compact notation with one decimal (`$28M`, `$186K`); percentages with one decimal; dates `dd Mon yyyy`.
- **[O]** Responsive: sidebar 258 px, 78 px collapsed (≥ 761 px); ≤ 760 px the sidebar is an off-canvas drawer opened by the menu button; Governance and Document Vault render card lists instead of tables ≤ 760 px; print styles exist (Document preview *Open print view*).
- **[O]** localStorage keys used by the runtime (all reads/writes wrapped in try/catch): `matanho-investee-theme` (read and written), `matanho-investee-collapsed` (written, never read), `matanho-forecast-close-day` (read, never written, value unused), `matanho-forecast-lock-past` (read, never written), `matanho-report-actuals` (written on report submit, replayed into the workbook on start), `matanho-report-draft` (written, never read).

#### 5.D.0 Shell (all routes, `company scope`)

| Attribute | Value |
| --- | --- |
| Purpose | Frames the 13 pages with grouped navigation, company identity, global search, theme, notifications, profile, help and the overlay system (drawers, modals, command palette, toasts). |
| Access | Signed-in session (when `REQUIRE_AUTH_PORTALS` includes `company`); investor-role accounts → `/access-denied`. **[P]** Production: session + `company_users` link for every page; no link → 403 `no_company_access` screen. |
| Prototype layer | `InvesteePortal.tsx` (host), `shell.ts` (HTML), `matanho-investee-portal-runtime.js` (behaviour), `investee-portal-v8.css`, `investee-portal-v8-overrides.css`, `runtime-auth.js` (session bridge). |
| Wiring status | Prototype for everything except identity: name, e-mail, initials and role text come from the session (`GET /api/auth/me` via `useSessionUser`); *Sign out* → `signOut()`. Navigation is Next routing (`onNavigate` → `router.push`). |
| Entry points | Any route; login/invite/reset-password redirect; admin Private Markets "Open company portal" **[P]**. |
| Exit points | Sidebar items to 5.D.1–5.D.13; *Sign out* → `/login`. |

##### Layout
1. **[O]** Sidebar: brand (logo + "Investee Portal"); company card; navigation (4 groups); footer (*Help & Support*, *Collapse menu*, "All systems operational").
2. **[O]** Topbar: mobile menu button (≤ 760 px), search trigger, period select, theme toggle, notifications, profile.
3. **[O]** Workspace: the routed page (scrolls to top on every render).
4. **[O]** Scrim, right drawer, centred modal, command palette, toast stack (all closed by default).

##### Elements
| # | Element | Type | Content / behaviour | Data source (current → target) | Label |
|---|---|---|---|---|---|
| 1 | Logo | image | `/investee-portal-v8/assets/matanho-logo-transparent.png`, alt "Matanho" | Static | [O] |
| 2 | Module name | text | "Investee Portal" | Static | [O] |
| 3 | Company card | button (`company-menu`) | Avatar "ZP", name "Zambezi Pay", fund "Matanho Venture Fund I", up/down chevron; opens the Company workspace drawer. Only the live `hydrate` rewrites name (first two words of `company.name`) and initials | Prototype `shell.ts` → API `GET /api/v1/company/workspace` (`company.name`, `relationship.fund`) | [O] |
| 4 | Group *Workspace* | nav group | *Overview* (`dashboard`), *KPI Centre* (`kpis`), *Reporting Centre* (`reports`), *Forecast Model* (`forecasts`) | Static | [O] |
| 5 | Group *Investment* | nav group | *Term Sheet*, *Cap Table*, *Governance*, *Signatures* | Static | [O] |
| 6 | Group *Collaboration* | nav group | *Capital & Procurement Requests*, *Document Vault*, *Messages* | Static | [O] |
| 7 | Group *Administration* | nav group | *Team & Access*, *Settings* | Static | [O] |
| 8 | Nav count badge | pill | Mock: KPI Centre 6, Reporting Centre 5, Term Sheet 1, Governance 4, Signatures 4, Capital & Procurement Requests 5, Document Vault 8, Messages 3 (fixture array lengths). Live: counts of KPI rows, reports (reporting requests else financial reports), term sheets, signature rows, requisitions, application documents, cap-table rows; no badge while loading or when the page has no count | Prototype arrays → **[P]** API `workspace.counts` | [O] |
| 9 | Active nav item | style | The item for the current page is highlighted | Router | [O] |
| 10 | *Help & Support* | nav button | Opens Help drawer | Static | [O] |
| 11 | *Collapse menu* | nav button | Toggles icon-only sidebar (78 px); writes `matanho-investee-collapsed` | localStorage | [O] |
| 12 | System health | text | Green dot + "All systems operational" (static, ≥ 761 px expanded) | Static → **[P]** `GET /api/health` | [O] |
| 13 | Mobile menu | icon button | aria "Open menu"; toggles the off-canvas sidebar; closed on navigation | Client | [O] |
| 14 | Search trigger | button (`command`) | Magnifier + "Search reports, requests, documents and pages" + chip "Cmd K"; fills the free width of the topbar | Client | [O] |
| 15 | Period select | select `#periodSelect` | Options *Q2 2026*, *Q1 2026*, *FY 2025*; **no handler, no page reads it** | Static → **[P]** `workspace.periods` | [O] |
| 16 | Theme toggle | icon button | aria "Toggle theme"; moon icon in light, sun in dark; persists `matanho-investee-theme` | localStorage | [O] |
| 17 | Notifications | icon button | aria "Notifications"; opens drawer; no unread badge | Static → **[P]** `GET /api/v1/notifications` | [O] |
| 18 | Profile | button (`profile`) | Avatar initials, name, role line, chevron; opens Profile drawer. Name, initials and role overwritten from the session | Session `/api/auth/me` | [O] |
| 19 | Toasts | stack | Title + message, check icon (success) or alert icon on red (danger); auto-removed after 3,900 ms; several can stack | Client | [O] |
| 20 | Skeleton page | placeholder | Live mode only while loading: page header with "Loading live records from your portfolio workspace." (Overview, Governance, Signatures, Requests), "Loading investor-agreed metrics." (KPI Centre), "Loading records." (Reporting, Term Sheet, Cap Table, Document Vault, Team), "Loading conversations." (Messages), "Loading forecast model." (Forecast), otherwise "Loading."; shimmer cards; header gains " · Loading" | Client | [O] |

##### Tables
None.

##### Inputs & validation
| Field | Control | Required | Options / default / placeholder | Validation today (code) | Target validation | Error message |
|---|---|---|---|---|---|---|
| Command input | text `#commandInput` | No | Placeholder "Type a page, report, action or document…"; autocomplete off; "Esc" chip | None. **DEF-492** digit keys 1-9 pressed while the palette is open select the Nth result even when typed into this input | Digits must be ignored while the input is focused (shortcut only with Alt or when input empty) | — |
| Reporting period | select | No | *Q2 2026* (default), *Q1 2026*, *FY 2025* | None; no listener | **[P]** Options from the company's reporting periods; selection scopes Overview, KPI Centre, Reporting Centre, Forecast and Governance | — |

##### Actions
| Control | Enabled when | Permission | Effect (state change, toast text, navigation) | Wiring / API | Label |
|---|---|---|---|---|---|
| Nav item | Always | company scope | Navigates to the page route, closes overlays and the mobile menu | Router | [O] |
| *Collapse menu* | ≥ 761 px | company scope | Toggles `.collapsed`; stores preference (not restored on reload: DEFECT) | localStorage | [O] |
| Search trigger / Ctrl+K / Cmd+K | Always | company scope | Opens command palette, clears input, focuses it | Client | [O] |
| Esc | Always | — | Closes drawer, modal, palette and scrim | Client | [O] |
| Theme toggle | Always | — | Flips `data-theme` on the root and `document.body` | localStorage | [O] |
| Notifications | Always | company scope | Opens Notifications drawer | Prototype | [O] |
| Profile | Always | company scope | Opens Profile drawer | Session | [O] |
| Company card | Always | company scope | Opens Company workspace drawer | Prototype | [O] |
| *Refresh* (live pages) | Live mode | company scope | Sets loading state, fires `investee:reload-request`, toast "Refreshing" / "Loading live data from the API." | Host → NVCCZ loaders (8 parallel GETs) | [O] (dormant) |
| Any `[data-action]` control | Always | — | First fires cancelable `matanho:before-action` (detail `{action,dataset}` plus `report` or `request` snapshot); if prevented the runtime does nothing | Host | [O] |
| Generic stub controls (27 ids) | Always | — | Toast "Interactive control" / "{label or action} opened successfully in the prototype." | Prototype | [O] dead |
| Download stub controls (6 ids) | Always | — | Toast "Download prepared" / "A secure, watermarked export has been generated." | Prototype | [O] dead |

##### Modals & drawers
**Drawer — Command palette** [O]: overlay under the topbar. Items are always the 13 pages (sub-label = nav group), the 5 fixture reports ("Report · {period}"), 5 fixture requests ("Request · {status}") and 8 fixture documents ("Document · {folder}") — fixtures even in live mode (DEFECT). Filter: case-insensitive substring over label + sub-label; first 10 shown; items 1–9 carry a numeric shortcut chip. Choosing an item navigates (page) or opens the report drawer, request drawer or document drawer. Empty: "No results" / "Try a report, funding request, signature, page or document." **[P]** Target: results from a company-scoped search endpoint (reports, requests, vault documents, term-sheet clauses, threads, team) limited to the user's entitlements.

**Drawer — Notifications** [O]: title "Notifications", sub "Portfolio company alerts and reminders"; three static rows — "Procurement-request drill-down due soon / POS terminal quotations are due 09 Aug." [New, red] (opens REQ-204), "Q2 report validation completed / Two items need attention before submission." [Today, amber] (→ Reporting Centre), "Consent request updated / Namibia market-entry budget is under review." [Yesterday, blue] (→ Governance). No read state, no unread count.

**Drawer — Your profile** [O]: sub "{name} · {role}"; large initials; name; role; detail rows Email, *Last sign-in* ("Today · 04:48 CAT"), *MFA* ("Enabled"), *Approval role* ("Executive approver") — the last three are static for every user (DEFECT). Footer *Sign out* (closes overlays, calls the host sign-out) and *Edit profile* (stub toast).

**Drawer — Company workspace** [O]: sub "Select an authorised portfolio-company workspace"; one row (ZP, "Zambezi Pay Technologies", "{fund} · Active investment", pill *Current*); notice "One authorised workspace" — "Additional entities and subsidiaries can be configured by your fund administrator." **[P]** Lists every company in the user's `company_users` links and switches company context (the Nexus API today resolves only the first link).

**Drawer — Help & Support** [O]: sub "Guidance for portfolio-company teams"; rows *Reporting guide* ("How to prepare and submit an investor report"), *Capital and procurement requests* ("Request funding or procurement support and answer drill-downs"), *Contact Matanho support* ("Open a secure support request"); all stub toasts. **[P]** Guide opens the library guide document; Contact support opens a request to the investment team (a Messages thread).

##### States
- Empty: counts hidden when absent; command palette "No results".
- Loading: mock — none (instant). Live — page skeletons and `is-hydrating` class until `hydrate`.
- Error: live `hydrate` records `errors[]` in `state.liveLoadError` (not displayed); NVCCZ host action failures toast "Request failed" / `{error}` in red. No page-level error screen exists (DEFECT).
- Disabled / read-only: none.
- Conditional: *Collapse menu* has no effect ≤ 760 px (the sidebar is off-canvas there); the label text is hidden when collapsed.

##### Business rules & calculations
- **[O]** Theme default light; persisted choice wins on start.
- **[O]** Navigation re-renders the target page and resets workspace scroll to the top.
- **[P]** BR-196: every page and drawer is scoped to one *active company*; changing company reloads all data and clears client state (drafts excluded).
- **[P]** BR-197: the period selector defines the *reporting period in focus* for every period-aware page (YYYY-MM keys as in the Nexus API).

##### Edge cases
- **[O]** The host overwrites the avatar and role text in the DOM after render and re-renders the page when the session user changes, so a slow `useSessionUser` briefly shows "TM / Chief Financial Officer".
- **[O]** Ctrl/Cmd+K is captured on `document` even inside inputs.
- **[O]** Opening any overlay closes the previous one without hiding the scrim.
- **[O]** Unknown path renders Overview but the URL is unchanged.

##### Gaps, defects & open questions
- **DEF-493** mock mode presents another company's data (company name, fund, KPIs, reports, cap table, term sheet) to real signed-in users as if it were theirs.
- **DEF-494** `#periodSelect` is inert; *Collapse* preference is never restored; command palette digit shortcut fires while typing and searches fixtures only; Profile drawer shows static sign-in time, MFA and approval role; Greeting is always "Good morning".
- **DEF-495** the portal path performs no company-scope check; an admin-only staff account (non-investor) can open it.
- FR-CMP-008: Every investee page loads only data of the active company and returns 403 `no_company_access` otherwise — AC: a user without a `company_users` link sees an access screen, never fixtures.
- FR-CMP-009: Remove the mock mode from production builds — AC: `liveOnly:false` cannot be enabled when `NODE_ENV=production`; a visible "Demo data" ribbon is shown whenever any fixture is rendered.
- FR-CMP-010: Notifications drawer lists the user's in-app notifications with read state and an unread badge — AC: a staff action that notifies company users (e.g. period opened, report accepted/returned, term sheet issued, request decision) appears within 60 s.
- FR-CMP-011: Global search is company-scoped and live — AC: results contain only the company's reports, requests, vault documents, term-sheet sections and threads.
- Q-169: Should the portal support users linked to several companies (company switcher)? — default: yes, the Company drawer becomes a switcher; the API honours `?company=<ref>` for members only.
- Q-170: What is the Help & Support destination (guide document, support thread, external URL)? — default: guide = library document; support = new Messages thread to the investment team.

#### 5.D.1 Overview (`dashboard`, route `/`, `company scope`)

| Attribute | Value |
| --- | --- |
| Purpose | Landing page: headline operating metrics, reporting readiness, upcoming submissions, the fund relationship snapshot, work needing attention and recent activity. |
| Access | Company scope (5.D.0). |
| Prototype layer | `matanho-investee-portal-runtime.js` `dashboardPage()` (mock branch and a dormant live branch). |
| Wiring status | Prototype (all figures are fixtures; greeting name from the session). NVCCZ live branch: API via `GET /applicant/dashboard`, `/applicant/company`, `/applicant/profile`, `/term-sheets/my`, `/applicant/reporting/requests`, `/applicant/financial-reports`. Nexus target: **[P]** `GET /api/v1/company/overview?period=`. |
| Entry points | `/`, any unknown path, sidebar *Overview*, Command palette, post-login redirect. |
| Exit points | *Submit report* (report builder modal), *New request* (request modal), *Open forecast*, *View all*, *View investment terms*, action rows, report rows (report drawer), Reporting/Requests/Governance links. |

##### Layout
1. **[O]** Page header: eyebrow "INVESTEE PORTAL", H1 "Good morning, {first word of session name, else Tariro}", subtitle "Your reporting, operating performance and investor obligations for Zambezi Pay.", actions *Submit report* (primary, upload icon) and *New request* (plus icon).
2. **[O]** Metric row: five cards.
3. **[O]** Main column (left): *Operating performance* chart card; two cards side by side (*Reporting readiness*, *Cash runway outlook*); *Upcoming submissions* table.
4. **[O]** Side column (right): *Investment snapshot*, *Action centre*, *Recent activity*.

##### Elements
| # | Element | Type | Content / behaviour | Data source (current → target) | Label |
|---|---|---|---|---|---|
| 1 | Greeting | H1 | "Good morning, {name}" (the word "morning" is fixed, not time-aware) | Session → same | [O] |
| 2 | Metric *Revenue · Q2* | KPI tile | `$3.42m`; foot "+18.6% vs Q2 2025"; up arrow; sparkline `[42,48,54,57,65,74]`; icon trending | Prototype `metrics[0]` → **[P]** KPI `TOTAL_REVENUE` for the period, comparison to the same period of the prior year | [O] |
| 3 | Metric *Gross margin* | KPI tile | `72.4%`; "+2.1 pts vs plan"; up; sparkline `[55,57,59,60,65,69]`. Value is overwritten with `gross/revenue×100` (1 dp) after a structured report submit in the session | Prototype `metrics[1]` → **[P]** derived KPI `GROSS_PROFIT_MARGIN × 100`; variance = actual − plan | [O] |
| 4 | Metric *Cash available* | KPI tile | `$2.84m`; "At 31 Jul 2026"; sparkline falling `[80…49]` | Prototype → **[P]** cash from balance sheet/cash flow (`CASH_CLOSING`) as at the period end | [O] |
| 5 | Metric *Cash runway* | KPI tile | `15.6 mo`; "Base case forecast"; up | Prototype → **[P]** `CASH_RUNWAY_MONTHS` (derived) or forecast base case | [O] |
| 6 | Metric *Monthly burn* | KPI tile | `$182k`; "7.2% below budget"; up | Prototype → **[P]** `MONTHLY_BURN_OPERATING` | [O] |
| 7 | *Operating performance* | line chart | Sub "Revenue and gross profit · trailing six quarters"; x labels Q1 25…Q2 26; revenue `[1.86,2.12,2.45,2.76,3.08,3.42]`, gross profit `[1.23,1.43,1.69,1.93,2.19,2.48]` (US$ m); legend "Revenue" (brand) and "Gross profit" (green); no tooltip | Prototype → **[P]** accepted period KPI series | [O] |
| 8 | *Reporting readiness* | progress card | Pill "In review"; large "82%"; "9 of 11 sections complete"; bar 82%; action rows "Q2 investor report / 2 validation items need attention" (→ Reporting Centre) and "Revenue cohort drill-down / Due 07 Aug · high priority" (→ request drawer REQ-204) | Prototype → **[P]** readiness of the current period pack (sections opened / total, validation failures) | [O] |
| 9 | *Cash runway outlook* | card | Sub "Base case · months remaining"; "15.6 months"; sparkline `[16.8,16.4,15.9,15.6,15.8,15.6]`; notice "No financing required in base case" / "Minimum cash remains above the board-approved $1.0m threshold."; link *Open forecast* | Prototype → **[P]** forecast base case and minimum cash policy | [O] |
| 10 | *Upcoming submissions* | table | Sub "Required by your fund and board"; link *View all* → Reporting Centre; see Tables | Prototype `reports[]` → **[P]** open reporting periods and items | [O] |
| 11 | *Investment snapshot* | detail list | Sub "Current relationship with Matanho Venture Fund I"; pill Active; rows Total invested `$28M`, Fund ownership "16.7% fully diluted", Last valuation `$72.3M` + "Internal fair value · 30 Jun 2026", Governance "Board observer", Portfolio lead "Nyasha Moyo"; button *View investment terms* (→ Term Sheet) | Prototype `company` → **[P]** `workspace.company.relationship` + cap table + latest valuation | [O] |
| 12 | *Action centre* | action list | Sub "Work requiring your attention"; pill "3 actions" (red); rows "Complete Q2 report / 2 sections and 1 attachment outstanding" (opens report builder), "Complete supplier drill-down / 120 smart POS terminals · quotations required" (REQ-204 drawer), "Board approval required / Namibia market-entry budget" (approval modal) | Prototype → **[P]** computed work items: open period items, drill-downs, signatures awaiting you, consents awaiting company input | [O] |
| 13 | *Recent activity* | timeline | "Management accounts accepted / Matanho Portfolio Team completed its review. / Today · 09:42"; "Forecast v6 uploaded / 18-month base, upside and downside cases. / 01 Aug · 16:20"; "New value-creation resource / Regional sales compensation benchmark shared. / 31 Jul · 11:05" | Prototype → **[P]** audit/notification feed for the company | [O] |
| 14 | Live header | H1 | "Good morning, {profile.firstName}" or "Overview"; subtitle "Live portfolio status for {company}."; actions *Submit report*, *New request*, *Refresh* | NVCCZ ref | [O] dormant |
| 15 | Live card *Application stage* | KPI tile | `summary.applicationStage` (else `application.currentStage`, else "—"); pill Active/None from `summary.hasApplication`; foot "{n}% progress" (0–100 clamp) | NVCCZ `GET /applicant/dashboard` | [O] dormant |
| 16 | Live card *Requested* | KPI tile | `fmt.money(summary.requestedAmount)` else application requested amount else "—"; foot "Approved {fmt.money(approvedAmount)}" | NVCCZ | [O] dormant |
| 17 | Live card *Portfolio company* | KPI tile | `portfolioCompany.status` or `summary.companyStatus`; pill Live (green) / Pending (amber); foot company name | NVCCZ | [O] dormant |
| 18 | Live card *Unsigned term sheets* | KPI tile | Count of term sheets not signed; pill count; foot "{n} open reporting requests" | NVCCZ `GET /term-sheets/my`, `GET /applicant/reporting/requests` | [O] dormant |
| 19 | Live *Reporting obligations* / *Financial reports* | tables | Period/Due/Status of reporting requests (first 6; row → Reporting Centre) and Report/Period/Status of financial reports (first 6); empty rows "—" | NVCCZ | [O] dormant |
| 20 | Live *Investment snapshot* / *Recent activity* | cards | Company, Industry, Funding stage, "Term sheets: {n} on file · {m} awaiting signature"; activity = last 6 `recentActivities` (title or event or type; description or message; first 16 chars of createdAt) else "No recent activity yet" / "Updates from your application and reporting will appear here." | NVCCZ | [O] dormant |

##### Tables
**Upcoming submissions** (mock)
| Column | Format | Sortable | Notes |
|---|---|---|---|
| Submission | name + "{id} · {version}" | No | |
| Period | text | No | |
| Due | `dd Mon yyyy` | No | |
| Owner | text | No | |
| Progress | bar (width = progress %) | No | |
| Status | pill | No | |

- Rows: first three fixture reports whose status is not *Accepted* (RPT-026 *In review*, RPT-025 *Submitted*) plus a hard-coded fourth row "August KPI update — Monthly operating scorecard — Aug 2026 — 08 Sep 2026 — Function owners — 14% — Open".
- Row click opens the report drawer (5.D.3); the hard-coded row has no handler.
- Status colours: In review amber; Submitted green; Open amber; Accepted green.
- No filters, search, sorting or pagination.

##### Inputs & validation
None.

##### Actions
| Control | Enabled when | Permission | Effect (state change, toast text, navigation) | Wiring / API | Label |
|---|---|---|---|---|---|
| *Submit report* | Always | company scope (**[P]** profile may submit) | Opens report builder modal (5.D.3) | Client | [O] |
| *New request* | Always | company scope | Opens new request modal (5.D.9) | Client | [O] |
| *Open forecast* | Always | company scope | Navigates to Forecast Model | Router | [O] |
| *View all* / Reporting readiness action row 1 | Always | company scope | Navigates to Reporting Centre | Router | [O] |
| Readiness action row 2, Action-centre row 2 | Always | company scope | Opens request drawer for REQ-204 | Client | [O] |
| Action-centre row 1 | Always | company scope | Opens report builder | Client | [O] |
| Action-centre row 3 | Always | company scope | Opens governance approval modal | Client | [O] |
| *View investment terms* | Always | company scope | Navigates to Term Sheet | Router | [O] |
| Upcoming-submissions row | Always | company scope | Opens report drawer | Client | [O] |
| *Refresh* (live) | Live mode | company scope | Reload payload; toast "Refreshing" / "Loading live data from the API." | Host | [O] dormant |

##### Modals & drawers
Uses the report builder modal (5.D.3), request modal and drawer (5.D.9) and approval modal (5.D.7).

##### States
- Empty: live — "No recent activity yet" card; mock — none.
- Loading: live — Overview skeleton (4 metric tiles + table).
- Error: none rendered.
- Disabled / read-only: none.
- Conditional: live header name falls back to "Overview" when no profile first name.

##### Business rules & calculations
- **[O]** Variance chips and progress bars are presentation only; no computation exists in the runtime for the Overview metrics.
- **[P]** BR-198: Overview metrics are read from the **latest accepted** period (not drafts); a metric without an accepted value shows "—" and never a sample value.
- **[P]** BR-199: Reporting readiness = sections opened / sections required for the selected report type, as defined in 5.D.3.
- **[P]** BR-200: Action-centre items: (a) period items with status Due and due date within 14 days or overdue; (b) drill-down questions awaiting company response; (c) signature requests awaiting this user; (d) governance requests in status "Information requested".

##### Edge cases
- **[O]** The *Gross margin* tile and KPI register value change after a mock structured submit (see 5.D.3) but revert on reload (the actuals ledger in localStorage re-applies only workbook rows).
- **[O]** The Reporting-readiness numbers (82%, 9 of 11) disagree with the 8-section Draft workspace list in 5.D.3.

##### Gaps, defects & open questions
- **DEF-496** all values are fictional fixtures; "Good morning" is not time-aware; the period selector does not affect this page.
- FR-CMP-012: Overview aggregates are served by one company-scoped endpoint — AC: response contains metrics, readiness, upcoming submissions, investment snapshot, action items and the last six activities for the selected period, all derived from stored records.
- Q-171: Which five headline metrics are mandatory (Revenue, Gross margin, Cash available, Runway, Burn)? — default: those five, each tied to an investor-agreed KPI key.
- Q-172: Is "Last valuation" shown to the company? — default: yes when the fund has published a valuation; otherwise "—".

#### 5.D.2 KPI Centre (`kpis`, route `/kpis`, `company scope`)

| Attribute | Value |
| --- | --- |
| Purpose | Shows the investor-agreed KPIs with current value, target, variance, owner and status; lets the company submit period KPIs. |
| Access | Company scope. **[P]** Submitting KPIs: access profiles *KPI owner*, *Finance editor*, *Executive approver*, *Workspace administrator*. |
| Prototype layer | Runtime `kpisPage()`, `kpiDetail()`, `submitKpiModal()`. |
| Wiring status | Prototype (6 fixture KPIs). **Defect:** the Submit-KPIs modal button has no handler in the Nexus build. NVCCZ live: `POST /applicant/financial-reports/period-kpis`; KPI values read from `GET /applicant/company` `financialKpis`. Nexus today: `company_kpis` + `PUT /api/v1/company/periods/:period` (`kpis` record). |
| Entry points | Sidebar *KPI Centre*; Command palette. |
| Exit points | KPI card/row → KPI drawer; *Submit period KPIs* → modal; *Open KPI dictionary* (stub). |

##### Layout
1. **[O]** Header "KPI Centre" / "Track investor-agreed metrics, definitions, evidence and performance against plan." with *Submit period KPIs* (primary) and *Export scorecard*.
2. **[O]** KPI card grid (3 columns).
3. **[O]** Two-column row: *Investor KPI register* table (left); *Data quality* and *Definitions & governance* cards (right).

##### Elements
| # | Element | Type | Content / behaviour | Data source (current → target) | Label |
|---|---|---|---|---|---|
| 1 | KPI card | button (`kpi-detail`) | Name; "{category} · {frequency}"; status pill; current value (`$` compact for money, 1-dp % for percent, grouped number otherwise); variance chip `+x.x%` green or `-x.x%` red; line "Approved target" + target; owner; "View history ›"; opens KPI drawer | Prototype `kpis[]` → **[P]** `GET /api/v1/company/kpis?period=` | [O] |
| 2 | Variance chip | chip | `(value − target) / max(target,1) × 100`, one decimal, class positive when ≥ 0 | Computed | [O] |
| 3 | Register table | table | See Tables | Prototype → **[P]** same endpoint | [O] |
| 4 | Category select | select | "All categories / Financial / Commercial / Operations" (no handler; Customer and People KPIs exist but are not options) | Static | [O] dead |
| 5 | *Data quality* | card | Large "94%" (green) with green bar; rows Freshness "6 of 6 current", Evidence "5 of 6 attached", Definitions "6 of 6 approved" | Static → **[P]** computed from KPI records (current period value present, evidence file linked, definition approved) | [O] |
| 6 | *Definitions & governance* | card | Notice "Investor-agreed definitions are locked" / "Changes require approval from the company CFO and Matanho portfolio lead."; button *Open KPI dictionary* (stub toast) | Static → **[P]** library document | [O] |
| 7 | Live KPI card | button | From `company.financialKpis` latest period (see Business rules): name, "{category} · {frequency or period}", pill (default "Submitted"), value (grouped number or text, "—" when null), owner "Company", "Live record" | NVCCZ | [O] dormant |
| 8 | Live empty card | notice | "No data" / "No KPI values are on file yet. Submit period KPIs to populate this centre." | NVCCZ | [O] dormant |

##### Tables
**Investor KPI register**
| Column | Format | Sortable | Notes |
|---|---|---|---|
| KPI | name + "{category} · Definition locked" | No | |
| Current | money / % / number | No | monospace |
| Target | same unit | No | |
| Variance | signed % 1 dp | No | `(value−target)/target×100`; green ≥ 0, red < 0 |
| Frequency | text | No | Monthly, Weekly, Quarterly |
| Owner | text | No | role title |
| Status | pill | No | On track (green), Above target (green), Watch (amber) |
| (action) | more icon | — | opens KPI drawer |

- Filters: none functional. Search: none. Row click: only the action icon opens the drawer. Pagination: none.
- Fixtures (`kpis`): *Annual recurring revenue* (Commercial, Monthly, 32,100,000 vs 30,000,000, trend 18.4, On track, Chief Revenue Officer, series 18…32.1), *Net revenue retention* (Customer, Monthly, 141 vs 125, Above target, VP Customer Success), *Gross margin* (Financial, Monthly, 72.4 vs 70, Above target, Chief Financial Officer), *Monthly active merchants* (Operations, Monthly, 6,420 vs 6,800, Watch, Chief Operating Officer), *Payment success rate* (Operations, Weekly, 96.8 vs 97.5, Watch, Chief Technology Officer), *Employee engagement* (People, Quarterly, 81 vs 80, On track, Head of People).

##### Inputs & validation
(Submit period KPIs modal)
| Field | Control | Required | Options / default / placeholder | Validation today (code) | Target validation | Error message |
|---|---|---|---|---|---|---|
| Period start | date | Yes | Default: first day of the current UTC month | Runtime none; NVCCZ host: required | **[P]** must be the first day of a reporting period that has an open request | "Period start and end are required" (NVCCZ host) |
| Period end | date | Yes | Default: today | same | **[P]** ≥ start; must equal the period's end date | same |
| Total revenue | number step 0.01 | No | 0 | None | **[P]** finite number | "Invalid Input: Please enter a numerical value for this KPI." (NVCCZ backend text) |
| Net profit | number step 0.01 | No | 0 | None | same | same |
| Cash flow net | number step 0.01 | No | 0 | None | same | same |

##### Actions
| Control | Enabled when | Permission | Effect (state change, toast text, navigation) | Wiring / API | Label |
|---|---|---|---|---|---|
| *Submit period KPIs* | Always | **[P]** KPI owner / Finance editor / Executive approver / Workspace administrator | Opens modal | Client | [O] |
| *Submit KPIs* (modal) | Always | same | **Mock: nothing happens (no handler; modal stays open) — DEFECT.** NVCCZ live: validates dates, `POST /applicant/financial-reports/period-kpis` `{periodStart,periodEnd,totalRevenue,netProfit,cashFlowNet}`, closes modal, toast "Period KPIs submitted" / "Workspace refreshed from API." and reloads | Host; Nexus target **[P]** `PUT /api/v1/company/periods/{period}` (existing `kpis` map) | [O]/[P] |
| *Export scorecard* | Always | company scope | Mock: toast "Download prepared" / "A secure, watermarked export has been generated." (no file) | **[P]** `GET /api/v1/company/kpis/export?format=xlsx` | [O] dead |
| KPI card / row action | Always | company scope | Opens KPI drawer | Client | [O] |
| *Open KPI dictionary* | Always | company scope | Stub toast "Interactive control / view kpi library opened successfully in the prototype." | **[P]** library document | [O] dead |
| *Refresh* (live) | Live | company scope | Reload | Host | [O] dormant |

##### Modals & drawers
**Drawer — KPI detail** [O]: title = KPI name; sub "{category} KPI · {frequency}"; two stat cards *Current value* and *Approved target*; 6-point line chart labelled Mar, Apr, May, Jun, Jul, Aug (series fixed per KPI, not date-aware); "Definition" text "This KPI uses the investor-agreed calculation and source hierarchy. Values are reported consistently across periods and any restatement remains visible in the audit trail."; rows Owner, Frequency, Source ("Power BI operating dataset" + "Last synchronised today at 08:30 CAT"), Evidence ("Source workbook attached"); footer *Export history* (download stub). **[P]** Source and evidence come from the KPI definition and linked evidence documents; history from stored period values.

**Modal — Submit period KPIs** [O]: title "Submit period KPIs", sub "Send total revenue, net profit and net cash flow for the reporting period."; fields above; footer *Cancel*, *Submit KPIs* (send icon).

##### States
- Empty: live — "No KPI values are on file yet…"; mock — none.
- Loading: live skeleton (3 cards + table), subtitle "Loading investor-agreed metrics."
- Error: none rendered.
- Disabled / read-only: **[P]** read-only profiles see no *Submit period KPIs* button.
- Conditional: live cards omit target, variance and register table; live drawer wrongly opens the fixture KPI by index (DEFECT).

##### Business rules & calculations
- **[O]** Variance = `(value − target) / max(target,1) × 100` (cards) and `(value − target) / target × 100` (register); positive style when ≥ 0 regardless of "lower is better" semantics.
- **[P]** BR-201: KPI definitions (name, category, unit, frequency, owner, target, direction higher/lower-is-better, evidence requirement) are **investor-agreed**: staff-managed, locked for the company; a change requires CFO (company) and portfolio-lead (fund) approval (as the UI copy states). Variance sign must respect direction (Nexus `company_kpis.invert`).
- **[P]** BR-202: Derived KPIs computed server-side from accepted statements (NVCCZ ref `utils/reportingDerivedKpis.ts`, formulas version 1): `TOTAL_REVENUE_COMPUTED = grossSales − returns + otherRevenue`; `COGS = goodsPurchased + materials + labour + overhead`; `GROSS_PROFIT = revenue − COGS`; `GROSS_PROFIT_MARGIN = GP/revenue`; `NET_PROFIT_MARGIN = net income / revenue` where `net income = operating income + non-operating − interest − |income tax| + below-the-line`; `EBITDA = operating income + D&A`, `EBITDA_MARGIN = EBITDA/revenue`; `CURRENT_RATIO = current assets / current liabilities`; `QUICK_RATIO = (cash + receivables)/current liabilities`; `DEBT_TO_EQUITY = total liabilities / equity`; `INTEREST_COVERAGE = EBIT/|interest|` (only when interest > 0); `ROA = net income / total assets`; `ROE = net income / equity`; `WORKING_CAPITAL = current assets − current liabilities`; `CASH_OPERATING_NET_APPROX = operating receipts − operating payments`; `MONTHLY_BURN_OPERATING = |operating net| / months` when operating net < 0, `months = max(1, (end − start + 1 days)/30)`; `CASH_RUNWAY_MONTHS = (cash if > 0 else ending cash) / burn` when burn > 0; `CASH_CONVERSION_RATIO = operating net / EBITDA` (EBITDA ≠ 0); `REVENUE_GROWTH_RATE = (revenue − prior)/prior` when prior > 0; `INVENTORY_TURNOVER = COGS / average inventory`. Operational: `CUSTOMER_RETENTION_RATE = 1 − churn`; `LTV = ARPU / churn`; `CAC = S&M spend / new customers` (S&M = operator input, else advertising + R&D lines); `LTV_CAC_RATIO = LTV/CAC`; `CONVERSION_RATE = customersFromLeads / leads`; `UNIT_CONTRIBUTION = price − variable cost`; `NET_DOLLAR_RETENTION = revenue from existing customers this period / same cohort prior period`. Division by zero yields null (shown "—").
- **[P]** BR-203: Churn entered above 1 is interpreted as a percentage (5 → 0.05).
- **[P]** BR-204: The latest-period live view excludes `manualEntries`, `derived` and object-valued entries and flattens `AUTO_KPI_FLAT`; derived rows are tagged "Financial (derived)".

##### Edge cases
- **[O]** A KPI with target 0 uses `max(target,1)` on cards and divides by 0 (Infinity/NaN) in the register.
- **[O]** The KPI drawer chart labels (Mar–Aug) are static.
- **[O]** Data-quality figures are not derived from the table (the table shows 6 current KPIs but evidence "5 of 6").

##### Gaps, defects & open questions
- **DEF-497** Mock Submit KPIs is dead; category filter is dead; Export and Open KPI dictionary are stubs; drawer series/source/evidence are static.
- DEFECT (NVCCZ live): KPI card drawer reads fixture KPIs by index; target, variance, frequency, owner and status do not exist in the NVCCZ data (only numeric values), so live cards cannot show variance.
- FR-CMP-013: KPI register is built from staff-maintained KPI definitions plus accepted period values — AC: each row shows value, target, direction-aware variance, owner, frequency, status (On track / Above target / Watch) and evidence flag; changing a definition is rejected for company users with `permission_denied`.
- FR-CMP-014: *Submit period KPIs* stores revenue, net profit and cash flow net for a period that has an open request and recomputes derived KPIs — AC: success toast "Period KPIs submitted"; no open request → 409 with message "No open reporting request found for reportingPeriod {date}. Matanho must open a request before KPI/file submission."
- BR-205: KPI status vocabulary — *On track* (value within tolerance of target), *Above target* (beats target in the favourable direction), *Watch* (adverse variance beyond tolerance), *Submitted* (value present, no target).
- Q-173: What is the tolerance for *Watch* (per-KPI or global)? — default: per KPI, default 5% adverse.
- Q-174: Are KPIs reported monthly only (Nexus period model) or at the frequencies shown (Weekly, Monthly, Quarterly)? — default: stored per period key with `frequency` metadata; weekly values roll up to the month.

#### 5.D.3 Reporting Centre (`reports`, route `/reports`, `company scope`)

| Attribute | Value |
| --- | --- |
| Purpose | Calendar and workspace for every report the investors require: schedule, draft workspace, submission history and templates; hosts the structured **report builder** (income statement, balance sheet, cash flow, KPIs, narrative, evidence) and the submit bundle. |
| Access | Company scope. **[P]** Prepare/submit: *Report contributor*, *Finance editor*, *Executive approver*, *Workspace administrator*; read-only profiles see all tabs without *Submit report*. |
| Prototype layer | Runtime `reportsPage()`, `reportTabBody()`, report-builder functions (`reportTypeSchemas`, `renderReportBuilder`, `updateReportCalculations`, `postFinancialActuals`), `reportDetail()`. |
| Wiring status | Prototype (5 fixture reports; builder mutates fixtures and `localStorage`). NVCCZ live (dormant): schedule from `GET /applicant/reporting/requests`, history from `GET /applicant/financial-reports`, templates `GET /applicant/financial-reports/template/{type}`, builder → draft endpoints + `POST …/period-kpis` + bundle submit. Nexus today: `reporting_periods`/`reporting_items`/`reporting_submissions` via `/api/v1/company/periods/*` (checklist files, not statements). |
| Entry points | Sidebar; Overview *Submit report*, readiness rows, upcoming submissions; Notifications drawer; Command palette (reports). |
| Exit points | Report drawer; report builder modal; template download; Requests drawer is not linked. |

##### Layout
1. **[O]** Header "Reporting Centre" / "Prepare, validate, submit and track every report required by your investors." with *Submit report* (primary) and *Download template*.
2. **[O]** One card "Portfolio reporting" / "Reporting calendar and submission workspace": right side badge (mock "2 active" amber; live "{n} records" blue) and text ("Next deadline: 12 Aug" mock, "Live totals" live).
3. **[O]** Tab strip: *Reporting schedule* (default), *Draft workspace*, *Submission history*, *Templates*; tab body below. The active tab is kept in page state only (resets to *Reporting schedule* on reload).

##### Elements
| # | Element | Type | Content / behaviour | Data source (current → target) | Label |
|---|---|---|---|---|---|
| 1 | Schedule table | table | See Tables | Prototype `reports[]` → **[P]** `GET /api/v1/company/periods` + reports | [O] |
| 2 | History table | table | Same table filtered to status *Accepted* or *Submitted* | same | [O] |
| 3 | Draft workspace notice | notice (amber) | "Two validation items need attention" / "Revenue bridge is missing a source file and one covenant response is incomplete." | Static → **[P]** validation results of the current draft pack | [O] |
| 4 | Draft section rows (8) | action rows | 1 *Executive summary*, 2 *Financial performance*, 3 *Commercial & customers*, 4 *Operations & product*, 5 *People & organisation*, 6 *Governance, risk & ESG* (each "Complete · last updated 01 Aug", green check, pill *Complete*); 7 *Forecast & liquidity* ("Draft · 3 assumptions changed", pencil, pill *Draft*); 8 *Supporting documents* ("1 required attachment missing", pencil, pill *Action*); click → stub toast | Static | [O] dead |
| 5 | *Q2 readiness* card | card | "Investor report v3", "82%", bar; Sections "9 / 11", Attachments "7 / 8", Approvals "1 / 2"; button *Continue preparation* (stub) | Static → **[P]** computed | [O] |
| 6 | Automatic-checks notice | notice | "Automatic checks enabled" / "Matanho compares totals to uploaded management accounts and flags unexplained variances." | Static → **[P]** rules in Business rules | [O] |
| 7 | Template cards (5) | tiles (`download-template`) | Download icon, name, description, grey tag; see Tables | Static → **[P]** library templates | [O] |
| 8 | Live schedule table | table | Reporting period, Due date, Status, upload icon (opens builder); empty row "No requests yet" | NVCCZ | [O] dormant |
| 9 | Live history table | table | Report (title + id), Period, Type, Status; empty row "No submissions yet" | NVCCZ | [O] dormant |

##### Tables
**Reporting schedule / Submission history** (mock)
| Column | Format | Sortable | Notes |
|---|---|---|---|
| Report | name + id | No | e.g. "Q2 2026 Investor Report / RPT-026" |
| Period | text | No | "Apr – Jun 2026" |
| Due date | `dd Mon yyyy` | No | |
| Owner | text | No | |
| Completion | bar + "{n}% complete" | No | |
| Version | text | No | v3, v2, Final |
| Status | pill | No | *In review* amber, *Submitted* green, *Accepted* green |
| (action) | more icon | — | opens report drawer |

- Fixtures: RPT-026 "Q2 2026 Investor Report" (Apr – Jun 2026, due 12 Aug 2026, Tariro Moyo, 82%, v3, In review); RPT-025 "June 2026 Management Accounts" (Jun 2026, 15 Jul 2026, Finance Team, 100%, v2, Submitted); RPT-024 "Q1 2026 Investor Report" (Jan – Mar 2026, 10 May 2026, Tariro Moyo, Final, Accepted); RPT-023 "FY 2025 Annual Report Pack" (FY 2025, 31 Mar 2026, Executive Team, Final, Accepted); RPT-022 "ESG & Impact Questionnaire" (FY 2025, 15 Mar 2026, Rudo Ncube, Final, Accepted).
- Filters/search/sort/pagination: none. Row click: none (only the action icon).

**Templates**
| Template | Format tag | Description | Report type sent to host |
|---|---|---|---|
| Quarterly investor report | DOCX + XLSX | Standard reporting pack | INCOME_STATEMENT |
| Monthly management accounts | XLSX | Trial balance and operating schedules | INCOME_STATEMENT |
| ESG & impact questionnaire | XLSX | Annual data collection template | OPERATIONAL_KPIS |
| Balance sheet template | XLSX | Statement of financial position | BALANCE_SHEET |
| Cash flow template | XLSX | Cash movement schedule | CASHFLOW_STATEMENT |

##### Inputs & validation
(Report builder modal; units USD 000)
| Field | Control | Required | Options / default / placeholder | Validation today (code) | Target validation | Error message |
|---|---|---|---|---|---|---|
| Report type | select `#reportPackType` | Yes | *Monthly management accounts* (default), *Quarterly investor report*, *Income statement*, *Balance sheet*, *Cash flow statement*, *ESG & impact update*; help text = type description | none; changing resets the section list | **[P]** only types enabled for the company's open request | — |
| Reporting period | select `#reportPackPeriod` | Yes | Months from (current − 3) to current of the workbook window, label "{Month YYYY} · {Actual · Locked \| Current actuals}"; future months omitted; default current month; help "Financial values are submitted in USD 000." | none; changing re-seeds all values (edits lost) | **[P]** only periods with an open request; reporting currency from the company record | **[P]** "No open reporting request found for reportingPeriod {date}. Matanho must open a request before KPI/file submission." |
| Submission owner | select `#reportPackOwner` | Yes | *Tariro Moyo · CFO*, *Chipo Banda · Controller*, *Nyasha Chikore · CEO*; help "Owner receives validation tasks." | none | **[P]** members of the company with a preparer profile | — |
| Income lines (8) | number step 0.1 + note text | Yes (checked on submit) | Merchant transaction revenue, Enterprise platform revenue, Other revenue, Processing & network costs, Support, disputes & fraud losses, Sales & marketing, Product & engineering, General & administration; note placeholder "Optional explanation" | finite number (blank → 0) | **[P]** numeric; revenue and cost lines ≥ 0 unless a documented credit | "Invalid Input: Please enter a numerical value for this KPI." |
| Balance lines (11) | number step 0.1 + note | No (not validated) | Cash and cash equivalents, Trade and other receivables, Other current assets, Property and equipment, Other non-current assets, Trade and other payables, Accrued expenses, Borrowings, Other liabilities, Share capital and reserves, Retained earnings | none; red "Balance check" when \|assets − (liabilities + equity)\| ≥ 0.5 | **[P]** blocks submit when \|difference\| > 0.02 | "Accounting Error: Balance Sheet is out of balance by $x.xx. (current period)" |
| Cash lines (4) | number step 0.1 + note | Yes | Opening cash balance, Net cash from operating activities (help "Use a negative value for cash outflow."), Capital expenditure, Financing proceeds | finite number | **[P]** closing cash must equal the balance-sheet cash within 0.02 | **[P]** "Closing cash does not agree to the balance sheet cash." |
| Executive summary / Key achievements / Material risks | textarea | No | placeholders "Summarise the reporting period, major performance drivers and investor-relevant developments." / "Commercial, operational, product or people milestones." / "Risks, mitigations and matters requiring investor attention." | none | **[P]** Executive summary required for the Quarterly investor report | **[P]** "Executive summary is required." |
| Operating KPI fields (6) | number | No | Monthly active merchants (6,420), Payment success rate % (96.8), Net revenue retention % (141), Total employees (196), Women in leadership % (42), Scope 1 and 2 emissions tCO₂e (18.4) | none | **[P]** map to investor-agreed KPI keys; % within 0–100 | — |
| Management commentary / Priorities | textarea | No | placeholders "Explain material movements, exceptional items, restatements and matters requiring investor attention." / "List the most important actions, decisions and forecast assumptions." | none | **[P]** commentary ≥ 20 characters when revenue falls > 50% vs the prior period | **[P]** "Variance validation: Revenue is more than 50% below the prior reporting period. Add an explanation of at least 20 characters." |
| Supporting documents | upload zone | No | Text "Attach ledgers, bank statements and supporting schedules" / "XLSX, CSV, PDF and DOCX · maximum 50 MB per file"; click shows "Files selected successfully / 2 files · 4.7 MB · ready for validation" (simulated, no file input exists) | none | **[P]** `.xlsx .xls .csv .pdf`; core statements Excel only; ≤ 25 MB (platform cap) | **[P]** "Invalid file type. Only .xlsx, .xls, .csv, and .pdf files are allowed"; "Core financial statements must be uploaded in Excel (.xlsx or .xls) format." |

##### Actions
| Control | Enabled when | Permission | Effect (state change, toast text, navigation) | Wiring / API | Label |
|---|---|---|---|---|---|
| *Submit report* | Always | **[P]** preparer profile | Opens builder, seeds values for the selected period | Client | [O] |
| *Download template* (header) | Always | company scope | Mock stub toast "Download prepared…" | **[P]** library template download URL | [O] dead |
| Tab buttons | Always | company scope | Switch tab body | Client | [O] |
| Template card | Always | company scope | Stub toast; NVCCZ host downloads `{type}-template.csv` and toasts "Template downloaded" | NVCCZ `GET /applicant/financial-reports/template/{type}`; **[P]** `GET /api/v1/company/report-templates/{type}/download-url` | [O]/[P] |
| Schedule/History row action | Always | company scope | Opens report drawer | Client | [O] |
| Draft-section rows, *Continue preparation* | Always | company scope | Stub toast | — | [O] dead |
| Live schedule upload icon | Live | preparer | Opens builder | Client | [O] dormant |
| Section tab (builder) | Always | preparer | Saves DOM values, switches section, marks it *visited* (counts to readiness) | Client | [O] |
| *Cancel* | Always | — | Closes modal (edits discarded) | Client | [O] |
| *Save draft* (builder) | Always | preparer | Mock: stores JSON `{type,period,owner,values,notes}` in `matanho-report-draft`, toast "Report draft saved" / "All completed financial fields, notes and evidence references were saved." (never restored). NVCCZ live: creates one draft per statement and attaches optional file; toast "Report draft saved" | Prototype; NVCCZ `POST /applicant/financial-reports/{income-statement\|balance-sheet\|cash-flow}/draft`; **[P]** `PATCH /api/v1/company/reports/{id}` | [O]/[P] |
| *Validate & submit* | Always | preparer; **[P]** approver per route CFO → CEO | Mock: validate (below); on success posts actuals into the forecast workbook (8 income rows → `Operating Plan`, 4 cash rows → `Cash Flow`, selected month), recomputes Gross margin KPI/metric, stores `matanho-report-actuals`, prepends report `RPT-{27+n}` (status *Submitted*, 100%, version "Submitted"), closes modal, toast "Investor report submitted" with message "{type label} was submitted. {Mon YY} income-statement actuals and cash-flow actuals were posted to the forecast workbook." (or "was submitted for investor review." for types posting nothing) and re-renders. NVCCZ live: drafts + optional evidence + `POST …/period-kpis` + bundle submit, toast "Financial report submitted" | Prototype; NVCCZ chain; **[P]** `POST /api/v1/company/periods/{period}/submit` | [O]/[P] |

##### Modals & drawers
**Modal — Submit investor report** [O]: title "Submit investor report", sub "Complete the report-specific forms, validate the financial statements and post approved actuals."; wide modal. Regions: (1) header grid (Report type, Reporting period, Submission owner) and a status strip — calendar icon "{Month YYYY} · {Actual · Locked \| Current actuals}" and lock icon with "System posting is permitted; direct forecast-cell editing remains locked." (locked month) or "Current-period actuals remain open until submission approval."; (2) section tabs per type (complete tab styling once visited): *management* → Income statement, Balance sheet, Cash flow, Commentary & evidence; *quarterly* → Executive summary, Income statement, Operating KPIs, Cash & liquidity (cash-flow form), Risks & attachments (commentary form); *income* → Income statement, Notes & evidence; *balance* → Balance sheet, Notes & evidence; *cashflow* → Cash flow, Notes & evidence; *impact* → Impact indicators (KPI form), Narrative & evidence; (3) form card with title/description per section — Income statement "Enter the period actuals exactly as approved in the management accounts.", Balance sheet "Complete the statement of financial position and resolve any imbalance.", Cash flow statement "Reconcile opening cash, period movements and closing bank position.", Executive summary "Explain what changed, why it matters and what management will do next.", Operating and impact indicators "Complete investor-agreed operating, workforce and impact measures.", Commentary and evidence "Provide explanations, supporting files and management priorities." plus a pill with the period status; (4) red validation notice "Complete the required values" / "One or more required entries are missing." (hidden until a failed submit; the text is replaced by "Complete the required financial statement fields before submission."); (5) *Submission readiness* card: heading `{type label}`, percentage = round(sections visited / sections × 100), bar, rows "Sections opened n / m", "Reporting period {label}", "Approval route CFO → CEO" (static), "Forecast workbook sync" items — "Income statement: Revenue, gross profit and operating-expense actuals." (types with Income statement), "Cash flow: Opening cash, operating cash, capex and financing." (types with Cash flow), or "No direct workbook posting: This report is retained for investor review without changing financial actuals.", always "Historical controls: Approved past months remain locked after system posting."; summary strips: Income (Total revenue, Gross profit, EBITDA), Balance (Total assets, Liabilities + equity, Balance check), Cash (Opening cash, Net movement, Closing cash); calculated rows show "Calculated automatically". Footer *Cancel*, *Save draft*, *Validate & submit*.

**Drawer — Report detail** [O]: title report name, sub "{id} · {period}"; notice (*In review*: amber clock "The Matanho portfolio team is reviewing this submission."; otherwise blue check "Submission is complete and retained in the audit trail." with the status as heading); details Due date, Owner, Completion, Version, Submitted ("31 Jul 2026 · 16:42" when 100%, else "Not yet submitted"); "Submission contents": Narrative report.pdf, Management accounts.xlsx, KPI scorecard.xlsx, Forecast update.xlsx ("Uploaded and validated", pill *Verified*), Supporting evidence.zip ("Optional attachment", pill *Optional*); footer *Download* and, when *In review*, *Message reviewer* (stub). **[P]** Contents list the real submitted files with review status; reviewer comment and return note shown; *Message reviewer* opens a Messages thread.

##### States
- Empty: live — "No requests yet" / "No submissions yet" rows; mock — none.
- Loading: live skeleton with subtitle "Loading records."
- Error: none rendered; NVCCZ host toast "Request failed" / {message}.
- Disabled / read-only: **[P]** read-only profile: builder buttons hidden; locked (accepted/submitted) packs open read-only.
- Conditional: builder shows forecast-sync items by type; balance check colour (green \|diff\| < 0.5 else red); history tab shows only Accepted/Submitted.

##### Business rules & calculations
- **[O]** Builder maths: `totalRevenue = merchant + enterprise + other`; `grossProfit = totalRevenue − processing − support`; `EBITDA = grossProfit − S&M − P&E − G&A`; `totalAssets = Σ5 asset lines`; `totalLiabilities = Σ4`; `totalEquity = share capital + retained earnings`; `liabilitiesEquity = totalLiabilities + totalEquity`; `balanceDifference = totalAssets − liabilitiesEquity`; `netCashMovement = operating − capex + financing`; `closingCash = opening + netCashMovement`. Values shown as `$` + en-US grouping, 0–1 decimals.
- **[O]** Seeding for the selected month index *i*: income and cash lines from the workbook; balance: cash = workbook closing cash, receivables 720, other current assets 185, property 1,240, other assets 360, payables 430, accrued 315, borrowings 0, other liabilities 145, share capital 2,450, retained earnings −835; KPI fields 6,420 / 96.8 / 141 / 196 / 42 / 18.4. These seeds never balance (difference = closing cash).
- **[O]** Readiness % counts sections *opened*, not completed or valid.
- **[O]** Submit validation in the runtime: income lines (when the type has an income section) and cash lines (when it has a cash section) must be finite numbers; blank inputs are coerced to 0 so the check rarely fails; balance, KPIs, narrative and evidence are never validated.
- **[P]** BR-NEW (period rule, NVCCZ ref): a report can be created, edited or submitted only for a reporting period that **staff opened as a reporting request** (exact period date); otherwise "No open reporting request found for reportingPeriod {date}. Matanho must open a request before KPI/file submission."
- **[P]** BR-206: staff open a period with a due date and a mandatory-attachment list (name + allowed formats); a period can be on the calendar only once; opening notifies the company users.
- **[P]** BR-NEW (bundle submit): submitting any report of a period submits **all** DRAFT, NEEDS_REVISION and REJECTED reports of that company and period together (status → PENDING/submitted); statuses already PENDING or ACCEPTED are untouched; nothing to submit → error "No draft, needs-revision, or rejected reports found to submit".
- **[P]** BR-NEW (editable states): data and file replacement allowed only in DRAFT, NEEDS_REVISION, REJECTED; otherwise "Only draft, needs-revision, or rejected reports can be updated".
- **[P]** BR-NEW (numeric strictness): any statement line item that is non-numeric is rejected with "Invalid Input: Please enter a numerical value for this KPI."; blank defaults to 0.
- **[P]** BR-NEW (balance sheet): \|total assets − (total liabilities + equity)\| ≤ 0.02 for the current period (and the prior period when any prior value is non-zero), else "Accounting Error: Balance Sheet is out of balance by $x.xx. (current period)".
- **[P]** BR-NEW (variance): when current-period revenue is below 50% of the prior posted period's revenue, submit requires a variance note of at least 20 characters, or a PDF whose title contains "variance" or "explanation", or a report of type VARIANCE_EXPLANATION; else "Variance validation: Revenue is more than 50% below the prior reporting period. …".
- **[P]** BR-NEW (file rules): allowed extensions `.xlsx .xls .csv .pdf`; core statements (income, balance sheet, cash flow) must be Excel (PDF rejected: "Invalid file type for this reportType: core financial statements must be .xlsx or .xls (PDFs are for narrative/compliance categories only)."); stored name `{YYYY-MM}_{Company}_{ReportType-id8}_v01.{ext}`; upload cap per file = platform `MAX_UPLOAD_MB` (default 25) — the UI's "50 MB" copy must be corrected; NVCCZ applicant uploads are capped at 10 MB.
- **[P]** BR-NEW (review, NVCCZ ref): staff action ACCEPT / NEEDS_REVISION / REJECT with comment; reviewer ≠ submitter (Nexus BR-001); returning requires a comment; ACCEPT of core statements triggers accounting automation (valuation adjustment and/or dividend payload) in NVCCZ — in Nexus ACCEPT syncs KPI values (`TOTAL_REVENUE`, `NET_PROFIT`, `CASH_FLOW_NET`) and recomputes derived KPIs; if the post-accept sync fails the report returns to NEEDS_REVISION with the error appended to the reviewer comment.
- **[P]** BR-NEW (posting to forecast): accepted income and cash-flow actuals post to the matching month of the forecast workbook (5.D.4) and lock it; unaccepted submissions never overwrite actuals (the mock posts immediately on submit — DEFECT).

##### Edge cases
- **[O]** Changing the period re-seeds values and loses typed input; changing the type keeps values but resets visited sections.
- **[O]** The mock replays `matanho-report-actuals` into the workbook on every start, so posted actuals survive reload but the report row and KPI changes do not.
- **[O]** The header *Download template* and template cards download nothing in mock mode.
- **[O]** The 8 Draft-workspace rows (6 complete) disagree with the 82% / 9-of-11 counters.
- **[O]** The report row id numbering `RPT-{27 + current length}` can collide after several submits.

##### Gaps, defects & open questions
- **DEF-498** Balance-sheet seed never balances and the check is not blocking; evidence zone is simulated (no `<input type=file>`; NVCCZ looks up `#reportEvidenceFile`, which does not exist, so no file is ever uploaded); *Save draft* is not restored; mock posts actuals on submit without staff acceptance; Draft workspace tab is entirely static even in live mode.
- DEFECT (NVCCZ wiring): the V8 line-item keys are not the backend's canonical keys, so a live submit stores zeros (income: 33 canonical keys such as `grossSales`, balance sheet: 23 such as `cash`, cash flow: 21 such as `cashReceiptsCustomers`); `reportingPeriod` is sent as the label "Aug 2026" instead of a date; three drafts, one KPI save and a bundle submit are not atomic; host `cashFlowNet = operating + capex + financing` contradicts the UI closing-cash formula (`operating − capex + financing`); `netProfit` sent equals EBITDA; the *impact* type is stored as an income-statement draft.
- DEFECT (NVCCZ wiring): templates are fetched as text and always saved as `{type}-template.csv`; the V8 type ids `INCOME_STATEMENT`, `BALANCE_SHEET` and `CASHFLOW_STATEMENT` resolve to the legacy CSV templates (not the `.xlsx` templates served for `INCOME_STATEMENTS`, `STATEMENT_OF_FINANCIAL_POSITION`, `CASHFLOW_STATEMENTS`), and `OPERATIONAL_KPIS` returns an `.xlsx` binary that the text download corrupts.
- FR-CMP-015: Typed statement reports (income statement, balance sheet, cash flow, operational KPIs, narrative) belong to a reporting period — AC: each has status Draft → Submitted → Accepted / Returned (+ Needs revision), line items stored as numeric JSON with per-line notes, and the period's pack status is derived from them.
- FR-CMP-016: Report builder saves server-side drafts and restores them — AC: reload shows the saved values, owner and notes; two members editing the same draft see "version conflict" (409 `version_conflict`).
- FR-CMP-017: Evidence files upload through a real file control with extension/size validation before submit — AC: invalid extension or size shows the error inline; accepted files appear in the report drawer after submit.
- FR-CMP-018: Template downloads serve the correct `.xlsx` file for each report type via a signed URL — AC: the downloaded workbook opens in Excel and carries the template version.
- FR-CMP-019: Submit is blocked client- and server-side for balance-sheet imbalance, missing mandatory attachments and unexplained > 50% revenue falls — AC: error text as in Business rules.
- Q-175: Reconcile the V8 simplified statements (8/11/4 lines) with the canonical NVCCZ schemas (33/23/21 lines) — default: the server stores canonical keys; the builder shows grouped inputs that map onto them, with an "advanced lines" disclosure.
- Q-176: Is the "Quarterly investor report" a separate pack from monthly management accounts or a roll-up? — default: separate period type (quarter-end key) with its own request.
- Q-177: Do the existing Nexus five checklist items (Management accounts, Operating KPIs, Debt & cash, Board pack, Compliance certificates) remain? — default: yes as the *mandatory attachments* of a period; typed statements are additional.

#### 5.D.4 Actuals & Forecast Model (`forecasts`, route `/forecasts`, `company scope`)

| Attribute | Value |
| --- | --- |
| Purpose | Spreadsheet-style rolling model: closed months lock as actuals, the current month accepts actuals, future months are editable forecasts, with scenario summary and version control. |
| Access | Company scope. **[P]** Edit: *Finance editor*, *Executive approver*, *Workspace administrator*; forecast owner per Team page = CFO. |
| Prototype layer | Runtime `forecastsPage()`, `forecastGrid()`, `forecastWorkbook`, `scenarios`. |
| Wiring status | Prototype only. NVCCZ live shows an empty card; **no forecast API exists in NVCCZ or Nexus** (NVCCZ `ForecastEntity` is a staff planning entity, not an investee model). |
| Entry points | Sidebar *Forecast Model*; Overview *Open forecast*. |
| Exit points | *Submit actuals & forecast* modal; none else. |

##### Layout
1. **[O]** Header "Actuals & Forecast Model" / "Submit {Mon YY} actuals while maintaining editable forecasts for upcoming months. Closed periods lock automatically." with *Submit actuals & forecast* (primary, send icon).
2. **[O]** Scenario strip (3 buttons).
3. **[O]** Stage strip (4 items).
4. **[O]** Workbook shell: toolbar, formula bar, scrollable grid, sheet tabs.
5. **[O]** Insights row: *Period controls*, *Scenario summary*, *Version control*.

##### Elements
| # | Element | Type | Content / behaviour | Data source (current → target) | Label |
|---|---|---|---|---|---|
| 1 | Scenario button *Base case* | toggle | "Board-approved plan"; `$52.8m` Revenue; `15.6 mo` Runway; active style | Prototype `scenarios` → **[P]** `GET /api/v1/company/forecast/scenarios` | [O] |
| 2 | Scenario button *Upside* | toggle | "Accelerated growth"; `$59.7m`; `23.8 mo` | same | [O] |
| 3 | Scenario button *Downside* | toggle | "Liquidity stress case"; `$44.1m`; `10.2 mo` | same | [O] |
| 4 | Stage strip | 4 tiles | "{n} closed actual months / Historical results are locked"; "{Mon YY} current actuals / Open for member submissions"; "{n} forecast months / Editable planning assumptions"; "As at {dd Mon yyyy} / Automatic month classification" | Computed from today's date | [O] |
| 5 | Workbook title | text | "Rolling Actuals & Forecast Model" / "{sheet} · {unit} · current period {Mon YY}" | Prototype | [O] |
| 6 | Name box | readonly input | Active cell address (default B3) | Client | [O] |
| 7 | Formula bar | input | Placeholder "Select an editable cell or inspect a locked actual"; locked cell → read-only, placeholder "Locked historical actual"; current month → "Enter current-month actuals"; forecast → "Enter forecast value or formula" | Client | [O] |
| 8 | Grid | table | See Tables | Prototype `forecastWorkbook` → **[P]** `GET /api/v1/company/forecast/model` | [O] |
| 9 | Sheet tabs | tabs | *Operating Plan*, *Cash Flow*, *Headcount*, *Assumptions*; ‹ › navigation buttons and "+" (inert); status text "Actuals locked automatically · 100%" | Static | [O] |
| 10 | *Period controls* | card | Pill *Active*; Past months "Actuals · locked"; "{current}" "Actuals · open"; Upcoming months "Forecast · editable" | Static | [O] |
| 11 | *Scenario summary* | card | Sub = scenario name; Rolling revenue `$52.8m / $59.7m / $44.1m`; Rolling EBITDA `$6.4m / $9.1m / $1.8m`; Financing need None / None / `$3.5m` | Prototype | [O] |
| 12 | *Version control* | card | Working version "v8 Draft"; Last actual close "{3rd window month} · locked"; Owner "Tariro Moyo" | Static | [O] |
| 13 | Live empty card | notice | "A live actuals & forecast model has not been set up yet — the forecasting API is still pending. See design-refs/investee-portal-v8-backend-asks.md." | NVCCZ | [O] dormant |

##### Tables
**Workbook grid** — columns: A corner, B "Line item", then 12 months (window: current month − 3 … current month + 8, header "{Mon YY}" with caption *Actual · Locked* / *Current actuals* / *Forecast*) and "Rolling 12M" (caption *Calculated*); letter row A–N above; row numbers left.
| Sheet (unit) | Rows (format) |
|---|---|
| Operating Plan (USD 000) | Section *Revenue*: Merchant transaction revenue, Enterprise platform revenue, Other revenue (currency); **Total revenue** = sum of the three (calculated). Section *Gross profit*: Processing & network costs, Support, disputes & fraud losses; **Gross profit** = Total revenue − Processing − Support. Section *Operating expenses*: Sales & marketing, Product & engineering, General & administration; **EBITDA** = Gross profit − S&M − P&E − G&A; **EBITDA margin** = EBITDA / max(Total revenue,1) (percent, annual = average) |
| Cash Flow (USD 000) | Section *Cash movement*: Opening cash balance (annual = last), Operating cash flow, Capital expenditure, Financing proceeds; **Closing cash balance** = Opening + Operating − Capex + Financing (annual = last); Cash runway (months) (number, annual = last; seeded 15.6, 14.8, 14.1, 13.7, 13.4, 13.2, 13.1, 13.3, 13.6, 14.0, 14.4, 14.9); Section *Liquidity policy*: Minimum cash threshold (1,000 each month, annual = last); **Liquidity headroom** = Closing cash − Minimum cash (annual = last) |
| Headcount (Employees) | Section *Headcount plan*: Engineering & product, Sales & partnerships, Operations & customer support, Finance, people & legal (number, annual = last); **Total headcount** = sum of four. Section *People cost*: Monthly payroll (currency); **Average cost per employee** = Payroll / max(Total headcount,1) (annual = average) |
| Assumptions (Drivers) | Section *Commercial assumptions*: Net new merchants (number), Monthly merchant churn (percent), Blended net take rate (percent), Processed-volume growth (percent); Section *Cost assumptions*: Annual salary inflation (percent), Cloud cost per transaction (currency, 3 dp), USD / local-currency FX index (number) — annual column = average for percent, currency and FX rows |

- Seeds (US$ 000): merchant revenue 2,980 → 5,580; enterprise 440 → 850; other 95 → 150; processing 690 → 1,180; support losses 210 → 318; S&M 690 → 995; P&E 940 → 1,285; G&A 620 → 780; opening cash 2,840 → 2,065; operating cash −95 → 180; capex 50 → 62; financing 0; headcount 74/41/58/23 → 96/63/69/28; payroll 1,280 → 1,880 (full 12-value arrays in the runtime).
- Sorting/filters/pagination: none. Row click: select cell. Row actions: none.
- Cell classes: *actual-locked* (month < current month; locked when the lock-past setting is on, default on), *actual-open* (current month), *forecast* (future); formula rows and the annual column are calculated (not editable); locked cells show a lock icon.

##### Inputs & validation
| Field | Control | Required | Options / default / placeholder | Validation today (code) | Target validation | Error message |
|---|---|---|---|---|---|---|
| Grid cell (editable) | text input | No | Display per row format: percent `(n×100).toFixed(1)%`; currency en-US ≤ 1 dp (values with \|n\| < 1 and ≠ 0 show 3 dp); number en-US ≤ 1 dp | On change: strip commas, strip `%` for percent (÷100), `Number(x) \|\| 0`; non-numeric becomes 0; formulas (`=…`) become 0 | **[P]** numeric only; negative allowed for flows; reject text with an inline message | **[P]** "Enter a number." |
| Formula bar | text | No | mirrors the active cell; edits propagate to the cell | same | **[P]** formula syntax not supported; read-only text for calculated cells | — |
| Forecast version (submit modal) | text | Yes | "Rolling Actuals & Forecast v8" | none | **[P]** unique per company | **[P]** "Version name already used." |
| Approved by | select | Yes | *Tariro Moyo · CFO*, *Nyasha Chikore · CEO* | none | **[P]** an *Executive approver* member different from the editor (maker-checker) | **[P]** "Approver must differ from the preparer." |
| Change commentary | textarea | No | pre-filled "Updated merchant acquisition, deferred 18 planned hires and revised infrastructure costs." | none | **[P]** required when a forecast month changes by more than 10% | **[P]** "Explain the change." |
| Model file | upload zone | No | "Attach approved forecast model / XLSX · include scenario and assumption tabs" (simulated) | none | **[P]** `.xlsx` | **[P]** "Upload an .xlsx workbook." |

##### Actions
| Control | Enabled when | Permission | Effect (state change, toast text, navigation) | Wiring / API | Label |
|---|---|---|---|---|---|
| Scenario button | Always | company scope | Sets the scenario; only the *Scenario summary* card changes; the grid does not | Client | [O] |
| Sheet tab | Always | company scope | Switch sheet; active cell reset to B3 | Client | [O] |
| Cell edit (change) | Cell editable | **[P]** editor | Parse + recompute calculated cells (no persistence) | Client | [O] |
| Arrow keys / Enter in a cell | Cell focused | — | Left/Right/Up/Down move the focus; Enter moves right | Client | [O] |
| Locked cell click | Locked/calculated cell | — | Loads formula text into the bar read-only | Client | [O] |
| *Undo* | Always | editor | Toast "Change reverted" / "The last spreadsheet edit was reversed." — **does not revert** | — | [O] dead |
| *Add row* | Always | editor | Appends "New planning line" (currency, 12 zeros) to the active sheet and re-renders; label not editable | Client | [O] |
| *Export XLSX* | Always | company scope | Toast "Excel workbook prepared" / "The complete model, formulas and sheet tabs were exported to XLSX." (no file) | **[P]** `GET /api/v1/company/forecast/versions/{id}/export` | [O] dead |
| *Save version* | Always | editor | Toast "Forecast version saved" / "The spreadsheet model was saved as FY2027 Forecast v7." (no persistence; card says v8) | **[P]** `POST /api/v1/company/forecast/versions` | [O] dead |
| *Submit actuals & forecast* | Always | **[P]** approver | Opens modal | Client | [O] |
| *Submit forecast* (modal) | Always | **[P]** approver | Closes modal, toast "Actuals & forecast submitted" / "Current-month actuals and future forecasts are now available to the investor team." (no persistence) | **[P]** `POST /api/v1/company/forecast/versions/{id}/submit` | [O] dead |
| Sheet ‹ ›, "+" | Always | — | Inert (+ shows the generic stub toast) | — | [O] dead |

##### Modals & drawers
**Modal — Submit actuals & forecast** [O]: title "Submit actuals & forecast", sub "Submit the current month as actuals and all upcoming months as forecast."; fields Forecast version, Approved by, *Scenarios included* notice "Base, upside and downside" / "Current-month actuals plus a rolling forward forecast with monthly liquidity.", Change commentary, upload zone; footer *Cancel*, *Submit forecast*. **[O dead]** A "Create forecast scenario" modal exists in code ("Scenario name" default "Management stretch case", "Start from" Base case/Upside/Downside, "Scenario purpose"; *Create scenario* → toast "Scenario created" / "The new scenario is ready for assumption editing.") but no control opens it.

##### States
- Empty: live — empty card (above).
- Loading: live skeleton "Loading forecast model."
- Error: none.
- Disabled / read-only: locked months (read-only with lock icon); calculated rows/columns; **[P]** read-only profiles see the whole grid read-only.
- Conditional: month classification re-evaluates on every render from the system date (so a month that closes while the page is open locks only after a navigation).

##### Business rules & calculations
- **[O]** Month status: month < current month → *actual-locked*; = current → *actual-open*; > current → *forecast*; the window always shows 3 locked months, the current month and 8 forecast months (when today is in month *m*).
- **[O]** Annual column: SUM for flows, last month for balances/headcount/runway/minimum cash/headroom, AVERAGE for rates, FX and cost-per-employee.
- **[O]** Scenario summary figures are constants; only the Base case is "Board-approved".
- **[P]** BR-207: A month locks when the previous month's actuals are accepted (reporting request closed) or on the *close day* (day 5 of the following month, the unused `forecastCloseDay` default) — whichever is later; the lock can be lifted only by staff.
- **[P]** BR-208: Forecast versions are immutable once submitted; a new working version is created from the latest submitted one; the fund sees only submitted versions.
- **[P]** BR-209: Opening cash of month *n+1* equals closing cash of month *n* (the mock treats opening cash as an independent input).
- **[P]** BR-210: Accepted income-statement and cash-flow actuals (5.D.3) post to the matching month's input rows; month status becomes *actual-locked*.
- **[P]** BR-211: Liquidity alert when forecast closing cash < minimum cash threshold; runway = closing cash / average monthly net burn of the next three forecast months.

##### Edge cases
- **[O]** Reload resets all workbook edits (only report-posted actuals persist in `matanho-report-actuals`).
- **[O]** Percent cells accept "1.9" or "1.9%"; both mean 1.9%.
- **[O]** Rows added with *Add row* have a fixed label and disappear on reload.
- **[O]** The window is anchored on the system date, so the seeded numbers shift under different months.

##### Gaps, defects & open questions
- **DEF-499** Undo, Save, Export, Add sheet, sheet navigation are inert/stubs; formulas are unsupported though the placeholder invites them; scenarios do not drive the grid; opening cash is not chained; `forecastCloseDay` and the lock-past toggle are unused; the scenario modal is unreachable.
- FR-CMP-020: Forecast model is persisted per company with versions, scenarios (Base, Upside, Downside, custom), sheets and cells — AC: reload restores the last working version; submitted versions are read-only and visible to staff in Private Markets.
- FR-CMP-021: Actuals months are populated only from accepted reports and are locked — AC: editing a locked cell is refused server-side with `locked`.
- FR-CMP-022: Export produces an `.xlsx` with all sheets and formulas — AC: file downloads from a signed URL.
- Q-178: Is the forecast model an investor-reviewed deliverable (staff comment/accept like a report) or company-internal? — default: submitted versions are reviewed (accept/return) like reports.
- Q-179: Are scenario definitions (driver overrides) company-defined or fund-defined? — default: company-defined, fund may require named Base/Upside/Downside.
- Q-180: Should cells hold formulas (Excel-like) or only values with calculated rows? — default: values + fixed calculated rows (as built).

#### 5.D.5 Term Sheet (`terms`, route `/terms`, `company scope`)

| Attribute | Value |
| --- | --- |
| Purpose | Plain-language view of the investment terms (commercial terms, rights, covenants, dates, governing documents) and, when a term sheet awaits signature, the entry point to review and e-sign it. |
| Access | Company scope. **[P]** Signing: users whose access profile carries signing authority (*Executive approver*, *Workspace administrator*) and who are named signatories. |
| Prototype layer | Runtime `termsPage()` (mock and live branches), `openSignatureModal()`, `termQuestion` modal. |
| Wiring status | Prototype (executed Series B fixture). NVCCZ live (dormant): `GET /term-sheets/my`; signing `POST /term-sheets/{applicationId}/sign`. Nexus: no term-sheet entity or endpoint. |
| Entry points | Sidebar *Term Sheet*; Overview *View investment terms*; Signatures; Command palette. |
| Exit points | *Download executed copy*, *Request clarification*, governing-document rows (document drawer), *Sign term sheet* (live). |

##### Layout
1. **[O]** Header "Term Sheet & Investment Terms" / "A plain-language, permission-controlled view of your executed investment terms." with *Download executed copy* (primary) and *Request clarification*.
2. **[O]** Hero panel (dark): eyebrow "SERIES B INVESTMENT", company name, execution line, status pill, 5 stat tiles.
3. **[O]** Two columns: left *Commercial terms* and *Rights, covenants & obligations*; right *Key dates*, *Governing documents*, summary notice.

##### Elements
| # | Element | Type | Content / behaviour | Data source (current → target) | Label |
|---|---|---|---|---|---|
| 1 | Hero | panel | "Zambezi Pay Technologies"; "Executed 18 January 2022 · Closed 02 March 2022 · Current governing version"; pill *Executed* (green) | Prototype → **[P]** `GET /api/v1/company/term-sheets` | [O] |
| 2 | Stat tiles | 5 tiles | Investment `$28.0m`; Security *Series B*; Fund ownership `16.7%`; Pre-money value `$140.0m`; Board rights *Observer* | Prototype | [O] |
| 3 | *Commercial terms* | detail list | Pill *Effective*; rows: Security issued "Series B preferred shares" / "1,670,000 shares issued at closing"; Liquidation preference "1.0× non-participating" / "Investor receives the greater of original investment or as-converted proceeds."; Conversion "1:1 voluntary conversion" / "Automatic conversion on a qualified IPO or majority preferred approval."; Anti-dilution "Broad-based weighted average" / "Applies to qualifying down-round issuances, subject to customary exclusions."; Dividend "Non-cumulative, when declared" / "Pari passu with other preferred classes."; Founder vesting "36 months remaining at closing" / "Monthly vesting with agreed good-leaver and bad-leaver provisions." | Prototype → **[P]** structured term fields | [O] |
| 4 | *Rights, covenants & obligations* | clause list | *Information rights* (monthly management accounts within 15 business days; quarterly investor report within 30 days; annual audited financial statements within 120 days) [Current]; *Pro-rata rights* [Active]; *Reserved matters* (new debt above $1.5m, material acquisitions, changes to share capital, executive remuneration changes and annual budget approval require investor consent) [**3 pending**, amber]; *Board rights* (one non-voting board observer seat, full board materials and reasonable access to management) [Current]; *ESG & compliance* (maintain approved policies, report material incidents within 48 hours, annual ESG questionnaire) [Current] | Prototype → **[P]** covenants/terms records | [O] |
| 5 | *Key dates* | timeline | Term sheet executed — Commercial terms agreed — 18 Jan 2022; Investment completed — Conditions precedent satisfied and funds disbursed — 02 Mar 2022; Next annual covenant review — Company and investor legal teams — 02 Mar 2027 | Prototype | [O] |
| 6 | *Governing documents* | action rows | Executed term sheet (PDF · 2.4 MB · Final), Shareholders agreement (PDF · 4.8 MB · Final), Disclosure letter (PDF · 3.1 MB · Final; not in the vault fixtures); click opens the document drawer | Prototype → **[P]** published documents of the deal | [O] |
| 7 | Summary notice | notice | "Plain-language summary" / "This page supports day-to-day operations. Signed legal documents remain authoritative." | Static | [O] |
| 8 | Live hero | panel | Eyebrow = term-sheet title; company = `application.businessName` (else company name, else "Your company"); "Status {status} · Updated {date}"; pill = status with `_` → space, green if signed else amber; stats Investment (`fmt.money(investmentAmount)`), Equity (`{equityPercentage}%`), Pre-money value (`valuation`), Stage (`application.currentStage`) | NVCCZ `GET /term-sheets/my` | [O] dormant |
| 9 | Live *Key terms* card | detail list | Title, Key terms, Conditions, Timeline (free text from the term-sheet record) | NVCCZ | [O] dormant |

##### Tables
None.

##### Inputs & validation
(Request clarification modal)
| Field | Control | Required | Options / default / placeholder | Validation today (code) | Target validation | Error message |
|---|---|---|---|---|---|---|
| Term or clause | select | Yes | *Reserved matters*, *Information rights*, *Anti-dilution*, *Board rights*, *Liquidation preference* | none | **[P]** one of the term sections | — |
| Your question | textarea | Yes | placeholder "Explain the transaction or situation and the clarification required." | none | **[P]** 1–5,000 characters (Nexus question text limit) | **[P]** "Enter your question." |

##### Actions
| Control | Enabled when | Permission | Effect (state change, toast text, navigation) | Wiring / API | Label |
|---|---|---|---|---|---|
| *Download executed copy* | Always | company scope | Mock stub toast "Download prepared…". Live label *Download document* appears only if `documentUrl` exists; also a stub | **[P]** `GET /api/v1/company/term-sheets/{id}/document/download-url` (5-minute signed URL, audited) | [O] dead |
| *Request clarification* | Always | company scope | Opens modal | Client | [O] |
| *Send to legal team* | Always | company scope | Closes modal, toast "Question sent" / "The fund legal team will respond in the secure message thread." (nothing is sent) | **[P]** `POST /api/v1/company/term-sheets/{id}/questions` (creates a Messages thread) | [O] dead |
| Governing-document row | Always | company scope | Opens document drawer (5.D.10) | Client | [O] |
| *Sign term sheet* (live, unsigned only) | Term sheet not signed | signatory | Opens the Review-and-sign modal (5.D.8) | NVCCZ `POST /term-sheets/{applicationId}/sign` | [O] dormant |
| *Refresh* (live) | Live | company scope | Reload | Host | [O] dormant |

##### Modals & drawers
**Modal — Request clarification** [O]: title "Request clarification", sub "Ask a controlled question about an investment term."; fields above; footer *Cancel*, *Send to legal team*. Signing modal: see 5.D.8.

##### States
- Empty: live — "No data" / "No term sheet has been created for your application yet. Your investor will notify you when terms are ready."
- Loading: live skeleton "Loading records."
- Error: none rendered.
- Disabled / read-only: executed term sheets are read-only; **[P]** the *Sign* button is hidden for non-signatories.
- Conditional: *Download document* requires a stored file; *Sign term sheet* requires status not signed; hero pill green only when signed/executed.

##### Business rules & calculations
- **[P]** BR-NEW (NVCCZ ref `TermSheetService`): a deal has **one** term sheet; lifecycle DRAFT → FINAL (finalised) → SIGNED; the company may sign only when the term sheet is FINAL; a signature image (PNG, JPEG, JPG, GIF, WEBP) can be applied once per party and never replaced ("Applicant signature already exists. Signatures cannot be updated once uploaded."); a signed term sheet cannot be edited; the term sheet becomes SIGNED/`isSigned` when **both** the company and the fund have signed.
- **[P]** BR-212: when both parties have signed while the deal is still at stage TERM_SHEET or TERM_SHEET_NEGOTIATION the deal advances to UNDER_BOARD_REVIEW (never regress a deal that already moved on); e-mail and in-app notification to the company; provisioning of the investment memo and deal execution pack.
- **[P]** BR-213: required term-sheet fields: title, investment amount, equity %, valuation (staff-entered); optional key terms, conditions, timeline text and a document (≤ 50 MB; PDF, DOC, DOCX, XLS, XLSX, JPG, JPEG, PNG).
- **[P]** BR-214: pre-money value = valuation field (NVCCZ labels `valuation` as pre-money without a stated rule); post-money = pre-money + investment; ownership % shown to the company = equity % of the term sheet until a cap table exists.
- **[P]** BR-215: the "3 pending" reserved-matters badge counts open governance consent requests (5.D.7).

##### Edge cases
- **[O]** The mock hero is an *executed* historical deal; there is no state for "issued, awaiting my signature" in mock mode.
- **[O]** The live hero omits clause lists, dates and governing documents.
- **[O]** The live *Sign term sheet* button reuses the Signatures modal; applicationId is carried in `data-application-id`.

##### Gaps, defects & open questions
- **DEF-500** mock content is a fixed Series B; both download buttons and the clarification send are stubs; live mode shows only 4 stats and 4 free-text rows.
- DEFECT (NVCCZ): `GET /term-sheets/my` nests signatures (`applicantSignature`, `investorSignature`); the V8 runtime reads flat `applicantSignedAt`, so signed sheets showed "Awaiting your signature" until the host normaliser was added (finding IP8-001).
- FR-CMP-023: Term sheet view shows structured terms (security, liquidation preference, participation, conversion, anti-dilution, dividend, vesting, information rights, reserved matters, board rights, ESG) and key dates from stored records — AC: each section renders only the fields the fund published; unpublished sections are hidden.
- FR-CMP-024: The company can download the executed term sheet and governing documents via signed URLs — AC: URL expires in 300 s; download is audited.
- FR-CMP-025: A clarification question creates a Messages thread to the fund legal team — AC: thread visible to both sides; toast "Question sent".
- Q-181: Do Nexus companies have a deal/application pipeline (application → DD → term sheet) or are companies created directly in Private Markets? — default: companies are created by staff in Private Markets; a term sheet is a record on the company with a signature workflow.
- Q-182: Is the term sheet the same object as the executed SHA (legal documents) shown under *Governing documents*? — default: separate published documents linked to the term sheet.

#### 5.D.6 Cap Table (`cap-table`, route `/cap-table`, `company scope`)

| Attribute | Value |
| --- | --- |
| Purpose | Shows ownership by holder, security classes, option pool and a dilution simulator for a next financing round. |
| Access | Company scope (read). **[P]** Edits are staff/legal/corporate-secretary actions; the company has read-only access plus the simulator. |
| Prototype layer | Runtime `capTablePage()`, `updateDilution()`. |
| Wiring status | Prototype (5 holders, 5 classes). NVCCZ live (dormant): empty card although a cap-table API exists at `/api/cap-table/*` (company owner may view). Nexus: none. |
| Entry points | Sidebar; Command palette; *Model financing round* scrolls to the simulator. |
| Exit points | *Export cap table* (stub); holder row action (stub). |

##### Layout
1. **[O]** Header "Cap Table" / "Understand current ownership, security classes and the effect of future fundraising." with *Model financing round* (primary, forecast icon) and *Export cap table*.
2. **[O]** Left: *Fully diluted ownership* card; *Security classes* card.
3. **[O]** Right: *Dilution simulator* card (`#capSimulator`); *Option pool* card.

##### Elements
| # | Element | Type | Content / behaviour | Data source (current → target) | Label |
|---|---|---|---|---|---|
| 1 | *Fully diluted ownership* | card | Sub "10,000,000 shares and options · as at 31 July 2026"; pill "Verified 31 Jul" (green) | Prototype → **[P]** `GET /api/v1/company/cap-table` (`fullyDilutedShareCount`, as-of date, verification) | [O] |
| 2 | Ownership bar | stacked bar | One segment per holder, width = %, colour per holder, text "{pct}%" only when pct ≥ 11, tooltip "{name}: {pct}%" | Prototype `shareholders[]` | [O] |
| 3 | Holder rows (5) | list | Colour dot; name + class; shares (grouped); % ; more icon | see Tables | [O] |
| 4 | *Security classes* | table | See Tables | Prototype (hard-coded rows) → **[P]** share classes | [O] |
| 5 | Pre-money slider | range | 50–200, step 5, default 100 (US$ m); label "Pre-money valuation · {$100M}" | Client | [O] |
| 6 | Round-size input | number | default 20,000,000, min 1,000,000, step 1,000,000 | Client | [O] |
| 7 | Simulator outputs | detail list | Post-money valuation `$120M`, New investor ownership `16.7%`, Matanho post-round `13.9%`, Founder post-round `39.2%` | Computed | [O] |
| 8 | Simulator warning | notice (amber) | "Illustrative only" / "Excludes option-pool top-ups, anti-dilution adjustments and transaction fees." | Static | [O] |
| 9 | *Option pool* | card | "9.0%" and "900,000 options"; bar 68%; Granted 612,500; Unallocated 287,500; Next refresh "Board review · Sep 2026" | Prototype → **[P]** option grants | [O] |
| 10 | Live empty card | notice | "A live cap table has not been recorded yet — a cap table API is still pending. See design-refs/investee-portal-v8-backend-asks.md." | NVCCZ | [O] dormant |

##### Tables
**Fully diluted ownership (holders)**
| Column | Format | Sortable | Notes |
|---|---|---|---|
| Holder | name + class | No | Founders & management (Ordinary), Matanho Venture Fund I (Series B Preferred), Seed investors (Seed Preferred), Series A investors (Series A Preferred), Employee option pool (Options) |
| Shares | grouped integer | No | 4,700,000 / 1,670,000 / 1,540,000 / 1,190,000 / 900,000 |
| % | 1 dp | No | 47 / 16.7 / 15.4 / 11.9 / 9 (hard-coded, not computed from shares) |
| (action) | more icon | — | stub toast "Interactive control / {holder name} opened successfully in the prototype." |

**Security classes**
| Column | Format | Sortable | Notes |
|---|---|---|---|
| Class | text | No | Ordinary shares, Seed preferred, Series A preferred, Series B preferred, Employee options |
| Outstanding | grouped integer | No | 4,700,000; 1,540,000; 1,190,000; 1,670,000; 900,000 |
| Voting | text | No | "1 vote / share"; "As-converted"; "No vote until exercise" |
| Preference | text | No | None; "1× non-participating"; None |
| Conversion | text | No | n/a; 1:1; Exercise |
| Status | pill | No | *Active* (green); *Open pool* (blue) |

- Filters/search/sort/pagination: none.

##### Inputs & validation
| Field | Control | Required | Options / default / placeholder | Validation today (code) | Target validation | Error message |
|---|---|---|---|---|---|---|
| New capital raised | number `#roundAmount` | No | 20,000,000; min 1,000,000; step 1,000,000 | HTML attributes only; blank/0 → defaults to 20,000,000 in the calculation | **[P]** > 0 | **[P]** "Enter an amount above zero." |
| Pre-money valuation | range `#preMoney` | No | 50–200 ($m), step 5, default 100 | HTML attributes | **[P]** > 0; free numeric input beyond the slider | — |

##### Actions
| Control | Enabled when | Permission | Effect (state change, toast text, navigation) | Wiring / API | Label |
|---|---|---|---|---|---|
| *Model financing round* | Always | company scope | Navigates to Cap Table and smooth-scrolls to the simulator | Router | [O] |
| *Export cap table* | Always | company scope | Stub toast "Download prepared…" | **[P]** `GET /api/v1/company/cap-table/export?format=xlsx` | [O] dead |
| Holder row action | Always | company scope | Stub toast | **[P]** holder drawer (holdings by class, options, certificates) | [O] dead |
| Slider / amount input | Always | company scope | Recomputes the four outputs on every `input` event | Client; **[P]** `POST /api/v1/company/cap-table/simulator` | [O] |

##### Modals & drawers
None in the runtime. **[P]** Holder drawer: holder name, type, shares by class, options granted/vested/exercised, fully-diluted %, certificates (download).

##### States
- Empty: live — empty card; **[P]** a company without a registry shows "No cap table has been published yet."
- Loading: live skeleton "Loading records."
- Error: none.
- Disabled / read-only: all read-only.
- Conditional: bar segment text hidden for holders below 11%.

##### Business rules & calculations
- **[O]** Simulator (client): `post = pre + amount`; `newInvestor% = amount / post × 100`; `Matanho% = 16.7 × pre / post`; `Founder% = 47 × pre / post`; money labels via compact `$` formatting; constants 16.7 and 47 are hard-coded and other holders are ignored.
- **[P]** BR-NEW (NVCCZ ref `CapTableBalanceService`): fully-diluted count `FD = Σ issued shares of ACTIVE classes + Σ authorised shares of OPTION_POOL classes`; holder FD % = `(shares held + options granted − exercised − cancelled) / FD × 100`; issued per class = Σ `quantityDelta` of EXECUTED transaction lines; unissued = authorised − issued.
- **[P]** BR-NEW (NVCCZ ref `CapTableDilutionEngine`): `pricePerShare = preMoney / S_pre`; `newRoundShares = roundInvestment / pricePerShare`; convertible note: `accrued interest = principal × rate × days / 365`; `conversion price = min(valuationCap / S_pre, roundPrice × (1 − discount))`; `note shares = (principal + interest) / conversion price`; `ESOP top-up = (S_pre + newRoundShares + noteShares) × topUpPct / 100`; `postFD = S_pre + newRoundShares + noteShares + ESOP`; `newInvestor% = newRoundShares / postFD × 100`; `postMoney = preMoney + roundInvestment`. (The pool top-up is applied post-round; flag Q-NEW.)
- **[P]** BR-NEW (NVCCZ ref `CapTableWaterfallEngine`): classes sorted by `seniorityIndex`; preferential payout = `min(remaining, issued × originalCostPerShare × liquidationMultiplier)`; remaining proceeds split pro-rata over *common* (class code containing "COMMON" or seniority ≥ 90) and *participating* preferred shares by issued shares; undistributed remainder reported. The engine has no "greater of preference or as-converted" choice although the Term Sheet page states non-participating preferred receives the greater of the two.
- **[P]** BR-NEW (ledger rules): holdings change only through EXECUTED transactions (ISSUANCE, TRANSFER; CONVERSION, REPURCHASE, CANCELLATION, OPTION_EXERCISE, IMPORT reserved); quantity must be positive; transfers need seller balance ≥ quantity at creation and execution; issuances cannot exceed authorised shares at execution; status DRAFT → PENDING_APPROVAL → EXECUTED | REJECTED; execution posts a GL journal (cash / share capital / share premium), generates a stock-certificate PDF with SHA-256, syncs the portfolio cap-table summary and refreshes LP-portal metrics.

##### Edge cases
- **[O]** Holder percentages are typed literals (they happen to equal shares / 10,000,000 and sum to 100%); the option pool row (900,000, 9%) is part of the 10,000,000 fully-diluted total.
- **[O]** The simulator output elements are filled by a `setTimeout(0)` after render; the first paint shows "$100m / $120.0m / 16.7% / 13.9% / 39.2%".

##### Gaps, defects & open questions
- **DEF-501** Mock holders/classes/percentages are fixtures; simulator hard-codes Matanho 16.7% and Founders 47% and ignores other holders, pool top-ups and notes; export and holder actions are stubs; NVCCZ live shows an empty card although the API exists (backend-asks doc is stale).
- DEFECT (NVCCZ backend, do not port): `GET /api/cap-table/registries` and `POST /registries` have no per-company guard; `approve` does not enforce creator ≠ approver; share classes have no conversion-ratio field (the Security classes "Conversion" column has no source).
- FR-CMP-026: Cap table page renders the published register — AC: holders, classes, FD %, option pool and "as at" date come from the registry; shares × price reconcile to the register; unpublished registries show an empty state.
- FR-CMP-027: Dilution simulator uses the server simulator with the company's actual FD count, notes and pool top-up — AC: result equals the NVCCZ formulas above for identical inputs.
- FR-CMP-028: Cap-table export (xlsx) and stock-certificate download (signed URL) — AC: certificate hash (SHA-256) is verifiable.
- BR-216: Only the fund's legal/corporate-secretary and administrator users can configure share classes and stakeholders; only CIO/CFO/administrator roles can approve and execute transactions (NVCCZ matrix).
- Q-183: Who maintains the cap table in Nexus — fund staff (legal), the company, or both with approval? — default: company proposes (draft transaction), fund legal approves and executes.
- Q-184: Is the "Verified {date}" attestation a staff sign-off? — default: yes, set by the fund at each executed transaction batch.
- Q-185: Where does the Series structure (Seed, Series A, Series B) come from — rounds as first-class records? — default: share classes carry round label; add a `rounds` read model.

#### 5.D.7 Governance (`governance`, route `/governance`, `company scope`)

| Attribute | Value |
| --- | --- |
| Purpose | Manage board information: consent/approval requests under reserved matters, board and committee actions, board calendar and a reserved-matters guide. |
| Access | Company scope. **[P]** Requesting approval: *Executive approver*, *Workspace administrator*; actions: any member. |
| Prototype layer | Runtime `governancePage()`, `governanceApprovalModal()`. |
| Wiring status | Prototype only (all fixtures). NVCCZ and Nexus have **no governance backend** (NVCCZ live shows an empty card). |
| Entry points | Sidebar; Overview action centre; Notifications. |
| Exit points | *Request approval* modal; row actions (stubs). |

##### Layout
1. **[O]** Header "Governance" / "Manage board information, consent requests, reserved matters and action tracking." with *Request approval* (primary, plus) and *Prepare board pack*.
2. **[O]** Four metric cards.
3. **[O]** Left: *Approval & consent requests*, *Board & committee actions*. Right: *Board calendar*, *Reserved matters guide*. ≤ 760 px tables become card lists.

##### Elements
| # | Element | Type | Content / behaviour | Data source (current → target) | Label |
|---|---|---|---|---|---|
| 1 | *Next board meeting* | KPI tile | pill "05 Sep"; "33 days"; "Materials due 28 Aug" | Static → **[P]** next meeting from the calendar | [O] |
| 2 | *Consent requests* | KPI tile | pill "3 pending" (amber); "3"; "1 high priority" | Static → **[P]** count of requests not decided | [O] |
| 3 | *Board actions closed* | KPI tile | "14 / 17"; "82% completion" (up arrow) | Static → **[P]** closed / total actions | [O] |
| 4 | *Compliance health* | KPI tile | "96%"; "No critical exceptions" | Static → **[P]** compliance obligations met / due | [O] |
| 5 | Approval table / card list | table | See Tables; sub "Items requiring investor or board decision"; link *New request* | Prototype → **[P]** `GET /api/v1/company/governance/requests` | [O] |
| 6 | Actions table / card list | table | Sub "Actions from the June 2026 board meeting"; link *Add action* (stub) | Prototype → **[P]** `GET /api/v1/company/governance/actions` | [O] |
| 7 | *Board calendar* | date-tile list | 28 AUG "Board materials due" / "Q3 board pack · company secretariat" [pill "25 days", amber]; 05 SEP "Quarterly board meeting" / "Harare + Microsoft Teams" [Confirmed, green]; 15 SEP "August management accounts" / "Investor information right" [Scheduled, blue] | Static → **[P]** `GET /api/v1/company/governance/calendar` | [O] |
| 8 | *Reserved matters guide* | action list | New debt — "Above $1.5m or outside approved facilities"; Share capital — "Issue, transfer, buyback or option-pool change"; Acquisitions — "Any material acquisition or disposal"; Executive changes — "Appointment, dismissal or material remuneration change"; Annual budget — "Initial approval and changes above agreed tolerance"; each row stub toast | Static → **[P]** derived from the term sheet reserved matters | [O] |

##### Tables
**Approval & consent requests**
| Column | Format | Sortable | Notes |
|---|---|---|---|
| Matter | title + "GOV-{154 − index}" | No | |
| Approval basis | text | No | |
| Submitted | `dd Mon yyyy` text | No | |
| Decision due | text | No | |
| Owner | text | No | |
| Status | pill | No | *Investor review* (amber: matches "review"), *Board review* (amber), *Approved* (green) |
| (action) | more icon | — | stub toast "Interactive control / {matter} opened successfully in the prototype." |

- Rows: Namibia market-entry budget — Annual budget variance >10% — 01 Aug 2026 — 09 Aug 2026 — Kuda Ndlovu — Investor review; Working-capital facility · $2.0m — New debt above $1.5m — 29 Jul 2026 — 08 Aug 2026 — Tariro Moyo — Board review; VP Engineering compensation — Executive remuneration change — 27 Jul 2026 — 05 Aug 2026 — Rudo Ncube — Approved; New acquiring-bank contract — Material supplier agreement — 22 Jul 2026 — 31 Jul 2026 — Tawanda Dube — Approved. Mobile card shows Owner, Decision due, Submitted.

**Board & committee actions**
| Column | Format | Sortable | Notes |
|---|---|---|---|
| Action | text | No | |
| Owner | text | No | |
| Due | text | No | |
| Evidence | text | No | "Test report required", "Candidate shortlist", "Policy uploaded", "Board memo required" |
| Status | pill | No | *In progress* amber, *Complete* green, *Open* amber |

- Rows: Complete payment-routing resilience test — Tawanda Dube — 15 Aug 2026 — In progress; Recruit independent audit committee chair — Rudo Ncube — 30 Sep 2026 — In progress; Formalise treasury counterparty limits — Tariro Moyo — 31 Jul 2026 — Complete; Submit Namibia market-entry decision memo — Kuda Ndlovu — 09 Aug 2026 — Open.
- Filters/search/pagination: none.

##### Inputs & validation
(Request governance approval modal)
| Field | Control | Required | Options / default / placeholder | Validation today (code) | Target validation | Error message |
|---|---|---|---|---|---|---|
| Matter requiring approval | text `#approvalTitle` | Yes | placeholder "e.g. Enter into a $2.0m working-capital facility" | none | **[P]** 3–200 characters | **[P]** "Describe the matter." |
| Approval category | select | Yes | *New debt or security*, *Annual budget or material variance*, *Share capital*, *Executive appointment or remuneration*, *Material contract*, *Acquisition or disposal* | none | **[P]** maps to a reserved-matter definition and threshold | — |
| Decision required by | date | Yes | default 2026-08-14 | none | **[P]** not in the past; ≥ notice period of the matter | **[P]** "Choose a future date." |
| Decision memorandum | textarea | Yes | placeholder "Explain the proposal, rationale, financial effect, key risks and requested decision." | none | **[P]** ≥ 50 characters | **[P]** "Add the decision memorandum." |
| Supporting papers | upload zone | No | "Attach board or decision papers" / "Include financial analysis and legal documents where relevant" (simulated) | none | **[P]** `.pdf .docx .xlsx` | — |

##### Actions
| Control | Enabled when | Permission | Effect (state change, toast text, navigation) | Wiring / API | Label |
|---|---|---|---|---|---|
| *Request approval* / *New request* | Always | **[P]** approver profile | Opens modal | Client | [O] |
| *Submit for approval* | Always | same | Closes modal; toast "Approval requested" / "The board and investor approvers have been notified." (nothing saved) | **[P]** `POST /api/v1/company/governance/requests` | [O] dead |
| *Prepare board pack* | Always | company scope | Stub toast | **[P]** `POST /api/v1/company/governance/board-packs` (compiles selected documents) | [O] dead |
| *Add action* | Always | any member | Stub toast | **[P]** `POST /api/v1/company/governance/actions` | [O] dead |
| Row actions, guide rows | Always | company scope | Stub toast | **[P]** detail drawer | [O] dead |

##### Modals & drawers
**Modal — Request governance approval** [O]: title "Request governance approval", sub "Route a reserved matter or board decision for controlled review."; fields above; footer *Cancel*, *Submit for approval*.

##### States
- Empty: none designed (**[P]** "No consent requests" / "No actions yet").
- Loading: live skeleton "Loading live records from your portfolio workspace."
- Error: none.
- Disabled / read-only: none.
- Conditional: tables switch to card lists ≤ 760 px.

##### Business rules & calculations
- **[I]** Reserved matters (from Term Sheet): new debt above $1.5m, material acquisitions, changes to share capital, executive remuneration changes, annual budget approval or variance above tolerance (10% in the first request row) need investor consent.
- **[P]** BR-217: A consent request lifecycle Draft → Submitted → Information requested ↔ Submitted → Investor review / Board review → Approved | Rejected | Withdrawn; decision recorded by fund staff with reason and decision date; the company cannot change a submitted request except to withdraw or respond to an information request.
- **[P]** BR-218: Decision due defaults to submission date + the contractual notice period of the matter (Q-NEW).
- **[P]** BR-219: "Next board meeting" days = meeting date − today; "Materials due" = meeting date − 8 days (28 Aug vs 05 Sep in the fixture).
- **[P]** BR-220: Board actions closed = actions with status Complete / all actions of the latest meeting; completion % = rounded ratio.
- **[P]** BR-221: Compliance health = obligations satisfied on time / obligations due in the last 12 months (definition to confirm).

##### Edge cases
- **[O]** Matter reference numbers are generated by the renderer (`GOV-154 − index`), not stored.
- **[O]** The fixture status "Investor review" and "Board review" are both amber because the word "review" is matched before any other rule.

##### Gaps, defects & open questions
- **DEF-502** Entire page is static; every control after the modal is a stub; 4 metric tiles are literals.
- FR-CMP-029: Governance register stores consent requests, decisions, actions and the board calendar — AC: a submitted request is visible to fund staff in Private Markets with the company, matter, memo and papers, and the decision returns to the company page and notifies the requester.
- FR-CMP-030: Reserved-matter definitions (name, threshold, basis, notice period) are maintained by fund staff per company — AC: the Approval category list and the guide are generated from them.
- Q-186: Who owns the board calendar and board pack — the company secretary (company) or the fund? — default: company secretary creates meetings; the fund is invited.
- Q-187: Are consent requests legally binding records or workflow aids (signed resolutions via 5.D.8)? — default: workflow aids; a formal written resolution is created as a signature request.

#### 5.D.8 Signatures (`signatures`, route `/signatures`, `company scope`)

| Attribute | Value |
| --- | --- |
| Purpose | Review, sign and request signatures for funding, governance and investment documents; signing uses a drawn signature with explicit consent and an audit certificate. |
| Access | Company scope. **[P]** Signing only by named signatories whose authority (matrix below) covers the document type, with step-up MFA. |
| Prototype layer | Runtime `signaturesPage()`, `signatureDrawer()`, `openSignatureModal()`, `requestSignatureModal()`, `initSignaturePad()`. |
| Wiring status | Prototype (4 fixture requests, mutated in memory). NVCCZ live (dormant): requests are **derived from term sheets** (`GET /term-sheets/my`) and signing = `POST /term-sheets/{applicationId}/sign`. Nexus: `signature_requests`/`signatures` exist but are client-scoped (investor documents). |
| Entry points | Sidebar; Term Sheet *Sign term sheet*; Document Vault *Signature centre*, drawer *Review & sign*/*Request signature*. |
| Exit points | Signature drawer; Review-and-sign modal; Request-signatures modal; *Open document vault*. |

##### Layout
1. **[O]** Header "Signatures" / "Review, sign and request signatures for funding, governance and investment documents." with *Request signatures* (primary) and *Open document vault*.
2. **[O]** Four summary cards.
3. **[O]** *Signature requests* card (status filter + list).
4. **[O]** Two cards: *Signing controls* and *Authority matrix*.

##### Elements
| # | Element | Type | Content / behaviour | Data source (current → target) | Label |
|---|---|---|---|---|---|
| 1 | *Awaiting your signature* | stat | Count of requests with status exactly "Awaiting your signature" | Computed from list → **[P]** server count | [O] |
| 2 | *Other signatures pending* | stat | Count of requests whose status matches "Awaiting" but is not "Awaiting your signature" | same | [O] |
| 3 | *Completed this quarter* | stat | Count of Completed (not date-limited despite the label) | same | [O] |
| 4 | *Audit certificates* | stat | "100%" when any request is Completed, else "—" | same | [O] |
| 5 | Request card sub-title | text | Mock: "Native, auditable signing workflow for authorised company and fund users"; live: "Live term sheets awaiting signature" | Static | [O] |
| 6 | Status filter | select | "All statuses / Awaiting my signature / In progress / Completed" — no handler | Static | [O] dead |
| 7 | Request row | button | Icon (check for Completed else pencil); document name; "{id} · {category} · requested by {requestedBy}"; "Recipients: …"; progress bar + "{n}% complete"; status pill (amber if "Awaiting…" else green); "Due {dd Mon yyyy}" or the last-activity text when Completed; chevron; opens the signature drawer | Prototype `signatureRequests` → **[P]** `GET /api/v1/company/signatures` | [O] |
| 8 | *Signing controls* | detail list | Identity verification "MFA + verified company account"; Evidence retained "Timestamp, IP, consent and document hash"; Document integrity "Locked after final signature" | Static | [O] |
| 9 | *Authority matrix* | detail list | Funding documents "CEO + CFO"; Board resolutions "Chair + Company Secretary"; Investor acknowledgements "CEO or CFO" | Static → **[P]** `signing_authorities` per company | [O] |

##### Tables
**Signature requests (list)** — fixtures: SIG-019 *Equipment Finance Facility – Draft.pdf* (Funding document, requested by Matanho Fund Finance, recipients Tariro Moyo, Nyasha Chikore, *Awaiting your signature*, due 08 Aug 2026, 50%, "Today · 08:40"); SIG-018 *Working Capital Facility – Written Resolution.pdf* (Board resolution, Company Secretary, recipients Nyasha Chikore, Tariro Moyo, *Awaiting CEO signature*, due 06 Aug 2026, 50%, "Yesterday · 17:12"); SIG-017 *Information Rights Acknowledgement.pdf* (Investment document, Matanho Legal, recipient Tariro Moyo, *Completed*, 100%, "25 Jul 2026 · 14:06"); SIG-016 *Q2 Board Minutes.pdf* (Governance record, Company Secretary, recipients Board members, *Completed*, 100%, "10 Jul 2026 · 16:32").
| Column | Format | Sortable | Notes |
|---|---|---|---|
| Document | name | No | |
| Reference/category/requester | "SIG-nnn · category · requested by …" | No | |
| Recipients | text | No | |
| Progress | bar % | No | 50% two-party partial, 100% complete |
| Status | pill | No | Awaiting your signature / Awaiting CEO signature (amber), Completed (green) |
| Due / last activity | date or text | No | |

- Filter select, search, pagination: none functional. Empty list: "No signature requests" / "Term sheets issued by your investor will appear here for signing."
- Live mapping per term sheet: id; document = title, else file name, else "Term sheet"; category "Term sheet"; requestedBy = creator name else "Investor"; recipients "Company authorised signatory"; status Completed if signed (`isSigned`, `applicantSignedAt` or status contains signed/executed) else "Awaiting your signature"; progress 100 / 40; due = `updatedAt`/`createdAt` date else 2026-09-30; lastActivity "Signed {date}" / "Awaiting founder signature".

##### Inputs & validation
(Review-and-sign modal)
| Field | Control | Required | Options / default / placeholder | Validation today (code) | Target validation | Error message |
|---|---|---|---|---|---|---|
| Signatory name | text `#signatureName` | Yes | default profile first + last name else "Authorised signatory" | non-empty | **[P]** equals the authenticated user's registered name | "Signature incomplete" / "Enter your name, draw your signature and confirm consent before signing." (toast, red) |
| Draw signature | canvas `#signatureCanvas` | Yes | pointer-drawn (mouse, trackpad, finger); *Clear* button; help "Use a mouse, trackpad or finger. Your signature is encrypted and bound to this document." | at least one stroke (`dataset.signed==='1'`); canvas not cleared on resize | **[P]** minimum stroke length; export PNG (≤ 1 MB) | same toast |
| Consent | checkbox `#signatureConsent` | Yes | "I have reviewed the document and intend to sign it electronically." | must be ticked | **[P]** consent timestamp stored | same toast |

(Request-signatures modal)
| Field | Control | Required | Options / default / placeholder | Validation today (code) | Target validation | Error message |
|---|---|---|---|---|---|---|
| Document | text | Yes | placeholder "Select or upload a document"; prefilled from a vault row | none | **[P]** vault document or upload | **[P]** "Choose a document." |
| Signatories | select | Yes | *CEO + CFO*, *CEO only*, *CFO only*, *Board Chair + Company Secretary*, *Custom routing* | none | **[P]** resolved to named company users per the authority matrix | — |
| Signing order | select | Yes | *Parallel*, *Sequential* | none | — | — |
| Due date | date | Yes | default 2026-08-12 | none | **[P]** future | **[P]** "Choose a future due date." |
| Message to signatories | textarea | No | placeholder "Explain the document and any signing deadline." | none | **[P]** ≤ 2,000 characters | — |
| Upload | zone | No | "Upload document for signature" / "PDF or DOCX · the final signing copy will be locked" (simulated) | none | **[P]** `.pdf .docx` | — |

##### Actions
| Control | Enabled when | Permission | Effect (state change, toast text, navigation) | Wiring / API | Label |
|---|---|---|---|---|---|
| *Request signatures* | Always | **[P]** authority holder | Opens request modal | Client | [O] |
| *Send request* | Always | same | Closes modal; toast "Signature request sent" / "Signatories were notified and the locked signing copy was created." (nothing created) | **[P]** `POST /api/v1/company/signatures` | [O] dead |
| Request row | Always | company scope | Opens signature drawer | Client | [O] |
| *Review & sign* (drawer, awaiting you) | Status "Awaiting your signature" | signatory | Opens signing modal | Client | [O] |
| *Apply signature* | Always | signatory | Validate (above). Mock success: request → *Completed*, 100%, "Today · signed electronically"; closes modal; toast "Document signed" / "The signed copy and completion certificate are now in the document vault." (no vault item). NVCCZ live: host reads name/consent/canvas PNG → `POST /term-sheets/{applicationId}/sign` multipart `signature`; errors toast "Request failed"; success "Term sheet signed" | Prototype; NVCCZ; **[P]** `POST /api/v1/company/signatures/{id}/sign` | [O]/[P] |
| *Clear* | Modal open | — | Clears the canvas and signed flag | Client | [O] |
| *Decline* | Awaiting you | signatory | Stub toast | **[P]** `POST /api/v1/company/signatures/{id}/decline` (reason required) | [O] dead |
| *Send reminder* | Awaiting others | requester | Toast "Reminder sent" / "Pending signatories have been notified." | **[P]** `POST /api/v1/company/signatures/{id}/remind` | [O] dead |
| *Signed copy*, *Certificate* | Completed | company scope | download stub / stub toast | **[P]** signed copy and certificate URLs | [O] dead |
| *Preview* | Always | company scope | Opens the Document preview modal (5.D.10) | Client | [O] |

##### Modals & drawers
**Drawer — Signature request** [O]: title document, sub "{id} · {category}"; notice with status and "{progress}% complete · due {date}" (or last activity when Completed); details Requested by, Recipients, Document type, Integrity "SHA-256 document hash locked"; compact preview card ("Review the full document before signing" + *Preview*); "Signing audit trail": "Signature request issued — {requester} requested signatures." and, when complete, "All signatures completed — Completion certificate and signed copy retained."; footer varies by status (above).

**Modal — Review and sign** [O]: title "Review and sign", sub "{document} · {id}"; document row "Document hash verified · no changes since request" + *Preview*; fields above; notice "Legally auditable record" / "Matanho records your verified identity, consent, timestamp, document hash and completion certificate."; footer *Cancel*, *Apply signature*.

**Modal — Request signatures** [O]: title "Request signatures", sub "Route a document to authorised signatories."; fields above; footer *Cancel*, *Send request*.

##### States
- Empty: "No signature requests" (message above).
- Loading: live skeleton.
- Error: NVCCZ host toast "Request failed" with the server text, e.g. "Failed to sign term sheet: Applicant signature already exists. Signatures cannot be updated once uploaded."
- Disabled / read-only: **[P]** *Review & sign* hidden for non-signatories; completed requests read-only.
- Conditional: footer buttons depend on status (Completed / Awaiting your signature / other).

##### Business rules & calculations
- **[O]** Progress: 50% = one of two signatures; 100% = all; live term sheets 40% / 100%.
- **[P]** BR-NEW (signature record, aligns with Nexus `signatures` table): store signer user, authority, consent timestamp, MFA timestamp, SHA-256 of the signed document, IP, drawn signature image; completion certificate generated when the last signatory signs; the document is locked after the final signature.
- **[P]** BR-222: signature images accepted as PNG, JPEG, JPG, GIF or WEBP; a signature once applied is immutable; a party cannot sign twice.
- **[P]** BR-223: authority matrix — Funding documents: CEO + CFO; Board resolutions: Chair + Company Secretary; Investor acknowledgements: CEO or CFO (display values; enforcement by named-signatory records).
- **[P]** BR-224: signing requires step-up MFA within 5 minutes (Nexus `requireStepUp` semantics) and a verified company account.
- **[P]** BR-225: term-sheet signing by the fund uses an investor-side signatory with permission (NVCCZ: admin or Fund Manager role).

##### Edge cases
- **[O]** The live status string test uses regex `/Awaiting/`; any other label (e.g. "Pending") is not counted in either summary tile.
- **[O]** *Completed this quarter* ignores the quarter.
- **[O]** The canvas does not scale on window resize; drawn strokes remain.

##### Gaps, defects & open questions
- **DEF-503** Filter select is dead; Decline, Certificate, Signed copy are stubs; mock "signed copy in the document vault" is false; Request signatures does nothing; the authority matrix is not enforced.
- DEFECT (NVCCZ): only term sheets appear as signature requests; the NVCCZ `/term-sheets/my` signature shape required a host normaliser (IP8-001).
- FR-CMP-031: General signature requests (funding documents, written resolutions, acknowledgements) are created by fund staff or company authority holders and signed natively — AC: each signatory signs once; the last signature locks the document and issues a certificate; both sides see the audit trail.
- FR-CMP-032: Decline requires a reason and notifies the requester — AC: status Declined; request can be voided and re-issued.
- FR-CMP-033: Signing authorities per company are configurable by fund staff — AC: a user outside the authority sees the request but no *Review & sign* button.
- Q-188: Native drawn signature versus an external e-signature provider (Nexus section 12)? — default: native for internal documents, provider integration for third-party legal documents.
- Q-189: Are company-initiated signature requests in scope (the UI offers them) or only fund-initiated? — default: both, company-initiated limited to company-internal approvals.

#### 5.D.9 Capital & Procurement Requests (`requests`, route `/requests`, `company scope`)

| Attribute | Value |
| --- | --- |
| Purpose | Request financing from the fund or ask the fund procurement team to source and purchase approved goods and services (drawdown against the committed investment), track the request through review, approval and fulfilment, and answer fund drill-down questions. |
| Access | Company scope. **[P]** Create/submit: *Executive approver*, *Workspace administrator*, *Finance editor*; company-side approval route CFO → CEO (displayed, not enforced). |
| Prototype layer | Runtime `requestsPage()` (mock and live branches), `openRequest()`, `newRequestModal()`. |
| Wiring status | Prototype (5 fixtures; create adds an in-memory card). NVCCZ live (dormant): `GET /applicant/procurement/drawdown`, `POST /applicant/procurement/requisitions`, `PUT /applicant/procurement/requisitions/{id}/submit`. Nexus: no equivalent (Nexus `capital_events` are investor-side calls/distributions). |
| Entry points | Sidebar; Overview *New request* and action rows; Notifications; Command palette (requests). |
| Exit points | Request drawer; New request modal; *Export request register* (stub). |

##### Layout
1. **[O]** Header "Capital & Procurement Requests" / "Request financing or ask the fund procurement team to source and purchase approved goods and services." with *New capital or procurement request* (primary) and *Export request register*.
2. **[O]** Four stat cards.
3. **[O]** Toolbar (search + two selects; mock only).
4. **[O]** Kanban: *Draft*, *Under review*, *Approved*, *Fulfilled* with count chips.

##### Elements
| # | Element | Type | Content / behaviour | Data source (current → target) | Label |
|---|---|---|---|---|---|
| 1 | *Capital under review* | stat | `fmt.money(Σ amount of Under-review Capital requests)` — mock `$3.5M`; foot "Across active requests" | Computed → **[P]** server summary | [O] |
| 2 | *Procurement under review* | stat | Count of Under-review Procurement requests — mock 1; foot "Supplier sourcing and purchases" | same | [O] |
| 3 | *Drill-downs required* | stat | Literal "2"; foot "Quotes and financial support" | Static → **[P]** count of requests with an open fund question | [O] |
| 4 | *Approved this quarter* | stat | Literal `$844k`; foot "Capital and procurement fulfilled" | Static → **[P]** Σ approved/fulfilled in the quarter | [O] |
| 5 | Search box | input | placeholder "Search request, supplier or purpose"; no handler | — | [O] dead |
| 6 | Type select | select | "All request types / Capital requests / Procurement requests"; no handler | — | [O] dead |
| 7 | Priority select | select | "All priorities / High / Medium / Low"; no handler | — | [O] dead |
| 8 | Kanban column | column | Title, count chip; cards; empty "No {status} requests" / "Requests at this stage will appear here." | Prototype `requests[]` | [O] |
| 9 | Request card | article (`open-request`) | Type pill (*Capital request* brand / *Procurement request* blue); priority pill (High red, Medium amber, Low grey); title; description; category + "{currency} {amount grouped}"; "Drill-down requested" flag when a drill-down text exists and status is Under review; avatar + owner; "Need by {dd Mon yyyy}" | Prototype → **[P]** `GET /api/v1/company/requests` | [O] |
| 10 | Live summary cards | stats | *Under review* (Σ of all Under-review amounts, "{n} active"), *Procurement under review* ("From live ledger"), *Total requests* ("All statuses"), *Approved / fulfilled* ("Closed and approved") | NVCCZ | [O] dormant |
| 11 | Live card | article | Same layout from live requisitions; no drill-down flag; need-by raw text | NVCCZ | [O] dormant |
| 12 | Live empty card | notice | "No data" / "No capital or procurement requests yet. Create a request to start the drawdown workflow." | NVCCZ | [O] dormant |

##### Tables
**Kanban (list)** — fixtures:
| Id | Title | Status | Priority | Type | Amount | Category | Need by | Fund owner | Drill-down note |
|---|---|---|---|---|---|---|---|---|---|
| REQ-205 | Namibia expansion growth capital | Under review | High | Capital request | USD 3,500,000 | Growth capital | 15 Sep 2026 | Matanho Investment Committee | "Upload the country launch budget, 18-month downside case and regulatory implementation schedule." |
| REQ-204 | 120 smart POS terminals | Under review | Medium | Procurement request | USD 186,000 | Equipment | 01 Sep 2026 | Matanho Procurement Team | "Provide three supplier quotations, warranty terms and deployment allocation by customer." |
| REQ-203 | Merchant settlement working capital | Approved | High | Capital request | USD 750,000 | Working capital | 15 Aug 2026 | Matanho Fund Finance | "Approved subject to executed facility documents and weekly utilisation reporting." |
| REQ-202 | Cloud security and fraud licences | Fulfilled | Medium | Procurement request | USD 94,000 | Software & licences | 01 Aug 2026 | Matanho Value Creation | "Procured items and licence keys delivered. Implementation evidence due with the August KPI pack." |
| REQ-201 | Customer-support equipment refresh | Draft | Low | Procurement request | USD 48,500 | Operational equipment | 20 Sep 2026 | Tariro Moyo | "Complete the asset list and attach supplier quotations before submission." |

- Filters/search/sort/pagination: none functional. Card click opens the drawer. Status → column: Draft, Under review, Approved, Fulfilled (status colours not shown on cards; the drawer pill uses the status text rule).
- Live status mapping (`status` upper-cased): contains PENDING, REVIEW or SUBMIT → Under review; contains APPROV → Approved; contains FULFIL, COMPLETE, CLOSED or AWARD → Fulfilled; contains DRAFT → Draft; **everything else (REJECTED, RETURNED, CANCELLED, RFQ_SENT, CONVERTED_TO_PO) is shown as Draft** — DEFECT.

##### Inputs & validation
(New capital or procurement request modal)
| Field | Control | Required | Options / default / placeholder | Validation today (code) | Target validation | Error message |
|---|---|---|---|---|---|---|
| Request title | text `#newRequestTitle` | Yes | placeholder "e.g. Procurement of 120 POS terminals" | none in runtime (blank becomes "New portfolio request"); NVCCZ host: required | **[P]** 3–200 chars | "Request title is required" (NVCCZ host) |
| Request type | select `#newRequestType` | Yes | *Capital request* (default), *Procurement request* | none; NVCCZ host ignores | **[P]** stored as `type` | — |
| Category | select `#newRequestCategory` | Yes | *Growth capital*, *Working capital*, *Equipment procurement*, *Inventory procurement*, *Software & licences*, *Professional services* | none; NVCCZ sends as `sourcingCategory` | **[P]** category must match the type (capital vs procurement) | — |
| Currency | select `#newRequestCurrency` | Yes | *USD*, *ZAR*, *ZWG* | none; NVCCZ ignores | **[P]** currency of the commitment | — |
| Budget / estimated value | number `#newRequestAmount` | Yes | default 250000; min 0 | none (0 accepted); NVCCZ host: > 0 | **[P]** > 0 and ≤ available tranche for procurement | "Request amount must be greater than zero"; "Drawdown Request Exceeds Available Investment Tranche." |
| Required by | date `#newRequestNeedBy` | Yes | default 2026-09-15 | none; NVCCZ ignores | **[P]** ≥ today | **[P]** "Choose a date in the future." |
| Priority | select `#newRequestPriority` | Yes | *Medium* (default), *High*, *Low* | none; NVCCZ upper-cases (LOW/MEDIUM/HIGH; backend also knows URGENT) | — | — |
| Preferred supplier | text `#newRequestSupplier` | No | placeholder "Optional supplier or leave open for sourcing" | never read | **[P]** stored as suggested vendor text | — |
| Quantity / service scope | text `#newRequestQuantity` | No | placeholder "e.g. 120 units or 12-month licence" | never read; NVCCZ sends a single item `{quantity:1, unit:'lot'}` | **[P]** structured line items (name, quantity > 0, unit, optional estimated unit price ≥ 0) | "Line {n}: quantity must be greater than zero." |
| Business purpose and specification | textarea `#newRequestDescription` | Yes | placeholder "Describe the requirement, technical specification, business benefit, delivery location and impact of delay." | none (blank becomes "Business justification to be completed.") | **[P]** required for submit | **[P]** "Describe the business purpose." |
| Request pack | upload zone | Capital: cash-flow case; Procurement: specifications/quotations | "Attach budget, specifications and available quotations" (simulated; no input) | none | **[P]** use-of-funds / business-case attachment mandatory before fund submission | "Use of funds / business case attachment is required before submit (Suite 02)." |
| Drill-down response | textarea `#requestResponse` (drawer, Under review) | No | placeholder "Answer the fund question and explain the attached evidence." | none | **[P]** non-empty to send | **[P]** "Enter a response." |

##### Actions
| Control | Enabled when | Permission | Effect (state change, toast text, navigation) | Wiring / API | Label |
|---|---|---|---|---|---|
| *New capital or procurement request* | Always | **[P]** requester profile | Opens modal | Client | [O] |
| *Save draft* (modal) | Always | requester | Closes modal; toast "Draft saved" / "The capital or procurement request is available to authorised company users." (nothing saved) | **[P]** `POST /api/v1/company/requests` (status Draft) | [O] dead |
| *Submit request* (modal, `create-request`) | Always | requester | Mock: adds card `REQ-{206+n}` (status Under review, due 18 Aug 2026, fund owner "Matanho Investment Team" or "Matanho Procurement Team" by type, drill-down "Fund review started. Additional questions will appear here if supporting detail is required."), closes modal, toast "Request submitted" / "The request pack has been routed for company and fund review.", navigates to Requests. NVCCZ live: create PR (priority upper-case, `sourcingCategory`, `drawdownRequestAmount`, single lot item, `useOfFundsDocumentUrl:'pending'`, department "Investee") then submit; submit failure swallowed; toast "Request submitted to procurement queue" | Prototype; NVCCZ; **[P]** `POST /api/v1/company/requests` + `POST /requests/{id}/submit` | [O]/[P] |
| Card click | Always | company scope | Opens drawer (live cards do nothing: the drawer reads fixtures) | Client | [O] |
| *Edit draft* (drawer, Draft) | Draft | requester | Stub toast | **[P]** `PUT /api/v1/company/requests/{id}` | [O] dead |
| *Submit request* (drawer, Draft) | Draft | requester | Sets status Under review; toast "Request submitted" / "The request has entered fund review." | **[P]** `POST /api/v1/company/requests/{id}/submit` | [O] |
| *Save response* (drawer, Under review) | Under review | requester | Toast "Response draft saved" / "Only authorised company users can see the draft." (not saved) | **[P]** `PUT /requests/{id}/responses/draft` | [O] dead |
| *Send drill-down response* (drawer) | Under review | requester | Sets drill-down text "Drill-down response submitted and awaiting reviewer confirmation."; closes drawer; toast "Drill-down response sent" / "The fund reviewer has been notified and the evidence is in the audit trail." | **[P]** `POST /api/v1/company/requests/{id}/responses` | [O] |
| *Download request pack* (drawer, others) | Approved/Fulfilled | company scope | Stub toast | **[P]** pack download URL | [O] dead |
| *Export request register* | Always | company scope | Stub toast "Download prepared…" | **[P]** `GET /api/v1/company/requests/export` | [O] dead |
| *Cancel* (modal) | Always | — | Closes modal | Client | [O] |

##### Modals & drawers
**Drawer — Request** [O]: title = request title, sub "{id} · {type}"; header row (status pill, priority pill, "{currency} {amount}"); description; details Request category, Requested by (company name), Fund owner, Required by, Decision target (due date); "Fund drill-down" notice — when Under review: amber alert "Additional support required" with the drill-down text, otherwise blue "Latest decision note"; "Request pack": *Financial model and cash impact* ("Integrated funding case attached" for capital, "Budget allocation attached" for procurement; pill *Attached*), *Investment memorandum* (capital) / *Supplier quotations* (procurement) ("Action required before review can continue" pill *Action* when Under review, else "Supporting document retained" pill *Ready*); Under review adds the response textarea and upload zone ("Attach quotations or supporting analysis" / "PDF, XLSX, DOCX or supplier proposal"). Footers by status (Actions above).

**Modal — New capital or procurement request** [O]: title "New capital or procurement request", sub "Request financing or submit a structured procurement requirement to the fund."; two-column form; *Approval route* notice "Company approval before fund submission" / "The request routes to the CFO and CEO, then to either the investment team or procurement support team."; footer *Cancel*, *Save draft*, *Submit request*.

##### States
- Empty: per column "No {status} requests…"; live: "No capital or procurement requests yet…".
- Loading: live skeleton (4 stat tiles + table), subtitle "Loading live records from your portfolio workspace."
- Error: NVCCZ host toasts ("Request title is required", "Request amount must be greater than zero", server messages).
- Disabled / read-only: **[P]** only Draft requests are editable; Under-review requests accept responses only.
- Conditional: footers and drill-down flag depend on status.

##### Business rules & calculations
- **[P]** BR-NEW (NVCCZ ref `InvesteeDrawdownProcurementService`): **committed tranche** = `investment_implementations.totalCommittedAmount` when > 0, else Σ amounts of fund disbursements with status APPROVED or DISBURSED; **reserved** = Σ `drawdownRequestAmount` of requisitions in PENDING_VC_EXECUTIVE_REVIEW, PENDING_APPROVAL, APPROVED, RFQ_SENT, CONVERTED_TO_PO; **available** = max(committed − reserved, 0). Create and submit both require `reserved (excluding this request) + amount ≤ committed`, else "Drawdown Request Exceeds Available Investment Tranche."
- **[P]** BR-226: Procurement/drawdown requisition lifecycle (NVCCZ): DRAFT → (submit) PENDING_VC_EXECUTIVE_REVIEW → APPROVED (VC CFO or SYSADMIN final gate, auto-RFQ to the top five eligible vendors by rating) → RFQ_SENT → CONVERTED_TO_PO; REJECTED/RETURNED can be resubmitted only by the requester and only after the content changed (content fingerprint); the investee may cancel a DRAFT or PENDING_VC_EXECUTIVE_REVIEW request, which returns it to DRAFT and releases the reservation.
- **[P]** BR-227: required for create: title; ≥ 1 line item with a name and quantity > 0; drawdown amount > 0; use-of-funds / business-case attachment before submit; only the company's portal user may submit (portfolio-owner check); an item estimate may not be negative.
- **[P]** BR-228: status mapping for the Kanban — Draft (DRAFT, REJECTED, RETURNED with a visible reason badge, CANCELLED), Under review (PENDING_VC_EXECUTIVE_REVIEW, PENDING_APPROVAL), Approved (APPROVED, RFQ_SENT), Fulfilled (CONVERTED_TO_PO with goods received / completed); amounts always in the commitment currency, FX shown when different.
- **[P]** BR-229: "Approved this quarter" = Σ `drawdownRequestAmount` where `approvedAt` falls in the current calendar quarter or status is APPROVED/RFQ_SENT/CONVERTED_TO_PO (ledger rule `isApprovedForLedger`).
- **[P]** BR-230: SLA — requests pending fund executive review for more than 48 hours appear in the staff SLA-breached queue.
- **[P]** BR-231: company-side approval (CFO then CEO) is a displayed route; Q-NEW whether it is enforced.
- **[I]** Procurement thresholds: none are encoded for investee requisitions in NVCCZ (the VC CFO gate applies to every amount); Q-NEW.

##### Edge cases
- **[O]** Mock ids are generated as `REQ-{206 + current count}` and can duplicate.
- **[O]** The *Drill-downs required* and *Approved this quarter* tiles are literals unrelated to the cards.
- **[O]** Create ignores supplier, quantity and attachments; NVCCZ create drops type, currency and need-by; a submit failure leaves a Draft while the toast claims "Request submitted to procurement queue".
- **[O]** The drawdown summary (committed, reserved, available) is returned by the NVCCZ API and loaded by the host but is not displayed anywhere (DEFECT/gap).

##### Gaps, defects & open questions
- **DEF-504** toolbar controls dead; Save draft/Save response/Export/Edit draft/Download pack stubs; no validation in the modal; live status mapping mis-buckets five statuses; live card click opens nothing; `useOfFundsDocumentUrl:'pending'` is a placeholder; currency and type are lost.
- FR-CMP-034: Requests persist as Draft, Submitted, Under review, Approved, Fulfilled, Returned/Rejected with reason — AC: refresh shows the same state; rejection reason is visible on the card and drawer; resubmission requires an edit.
- FR-CMP-035: Tranche panel shows committed, reserved, available and approved-to-date and blocks over-draw — AC: submitting an amount above *available* is refused with "Drawdown Request Exceeds Available Investment Tranche."
- FR-CMP-036: Drill-down thread — fund staff ask for evidence (quotations, budgets), the company answers with files, each answer audited — AC: card shows "Drill-down requested" while a question is open.
- FR-CMP-037: Search, type and priority filters work client- or server-side — AC: filtering by *Procurement requests* hides capital cards and updates counts.
- Q-190: Is a "capital request" a different object from a "procurement requisition"? — default: one `requests` table with `type`, capital requests following the investment-committee route and procurement following the VC-CFO/RFQ route.
- Q-191: Currency list (USD, ZAR, ZWG) — are requests allowed in non-commitment currencies with FX at approval? — default: yes, converted at the system rate on the decision date.
- Q-192: Does Nexus (investment OS) contain a procurement module, or are requisitions handed to an external procurement system (NVCCZ proxies to `PROCUREMENT_API_BASE_URL`)? — default: requests are staff-reviewed in Nexus; sourcing is out of scope until a procurement module exists.

#### 5.D.10 Document Vault (`data-room`, route `/data-room`, `company scope`)

| Attribute | Value |
| --- | --- |
| Purpose | Company-controlled document storage: folders, version, access profile, signature state, preview, share, upload and audit history. |
| Access | Company scope. **[P]** Access profile per document: *Investor Reporting*, *Executive & Board*, *Board*, *Company only*; upload requires *Report contributor*+ . |
| Prototype layer | Runtime `dataRoomPage()`, `documentDrawer()`, `previewDocumentModal()`, `uploadDocsModal()`, folder modals. |
| Wiring status | Prototype (8 fixture documents). NVCCZ live (dormant): read-only table of the application's own documents from `GET /applicant/application` (`documents`); no vault API exists (`/applicant/documents` is an open backend ask). Nexus: `/api/v1/company/library` download only (staff-published documents with `companyId`); company upload exists only for reporting-item files. |
| Entry points | Sidebar; Signatures *Open document vault*; Term Sheet governing documents; Command palette (documents). |
| Exit points | Folder drawer, document drawer, preview modal, upload modal, create-folder modal, Signatures. |

##### Layout
1. **[O]** Header "Document Vault" / "Secure, responsive document storage with version control, audit history and native signatures." with *Upload documents* (primary), *Signature centre*, *Create folder*.
2. **[O]** Security banner with storage usage.
3. **[O]** Controls row (search, access select, *View*).
4. **[O]** Folder grid (8 tiles).
5. **[O]** *Recently updated* card: pill, *Upload* button, table (≥ 761 px) or card list.

##### Elements
| # | Element | Type | Content / behaviour | Data source (current → target) | Label |
|---|---|---|---|---|---|
| 1 | Security banner | banner | "Company-controlled secure workspace" / "Files are encrypted, versioned and logged. Document access and signatures follow role-based permissions."; right "18.4 GB" / "of 100 GB used" (static) | Static → **[P]** storage usage and quota | [O] |
| 2 | Search | input `#vaultSearch` | placeholder "Search documents, folders, owners or versions"; no handler | — | [O] dead |
| 3 | Access filter | select | "All access profiles / Investor Reporting / Executive & Board / Company only"; no handler | — | [O] dead |
| 4 | *View* | button | Stub toast (grid/list toggle intent) | — | [O] dead |
| 5 | Folder tile (8) | button (`open-folder`) | Icon, name, description, "{count} documents ›": Investment Documents (8, "Executed legal, funding and investment records"), Financial Reports (24, "Management accounts and investor reports"), Forecasts & Budgets (11, "Approved plans and operating scenarios"), Board & Governance (19, "Board packs, minutes, approvals and resolutions"), Commercial & Operations (15, "Operating plans and business reviews"), ESG & Impact (9, "Policies, metrics and impact evidence"), Tax & Compliance (12, "Tax, licences and regulatory records"), People & Organisation (8, "Organisation plans and key policies"); counts are literals | Prototype → **[P]** `GET /api/v1/company/vault/folders` | [O] |
| 6 | Pill | pill | "2 awaiting signature" (amber; literal) | Static → computed | [O] |
| 7 | Documents table | table | See Tables | Prototype `documents[]` → **[P]** `GET /api/v1/company/vault/documents` | [O] |
| 8 | Mobile document card | button | Icon, name, "{folder} · {type} · {size}", "{owner} · {updated}", status pill (signature status or version) | same | [O] |
| 9 | Live table | table | Document (file name or name + id), Type (`documentType`), Submitted (pill Submitted green / Pending amber), Uploaded (date or "—"); actions *Refresh*, *Signature centre*; sub "{n} on file" | NVCCZ `application.documents` | [O] dormant |
| 10 | Live empty card | notice | "No data" / "No application documents are on file yet. A full document vault API is still pending — see design-refs/investee-portal-v8-backend-asks.md." | NVCCZ | [O] dormant |

##### Tables
**Recently updated** (mock)
| Column | Format | Sortable | Notes |
|---|---|---|---|
| Document | name + "{type} · {size}" | No | |
| Folder | text | No | |
| Owner | text | No | |
| Updated | text date | No | |
| Version | pill | No | *Final* green, others grey |
| Access | text | No | Executive & Board, Investor Reporting, Board |
| Signature | pill | No | request status (amber if Awaiting…, green if Completed) or *Not required* (grey) |
| (action) | more icon | — | opens document drawer |

- Fixtures (name — folder — type, size — updated — owner — access — version): Series B Term Sheet – Executed.pdf — Investment Documents — PDF, 2.4 MB — 18 Jan 2022 — Matanho Legal — Executive & Board — Final; Shareholders Agreement – Executed.pdf — Investment Documents — PDF, 4.8 MB — 02 Mar 2022 — Matanho Legal — Executive & Board — Final; Q2 2026 Management Accounts.xlsx — Financial Reports — XLSX, 1.8 MB — 31 Jul 2026 — Finance Team — Investor Reporting — v4; Zambezi Pay FY2026 Forecast.xlsx — Forecasts & Budgets — XLSX, 3.1 MB — 01 Aug 2026 — FP&A Team — Investor Reporting — v6; Board Pack – June 2026.pdf — Board & Governance — PDF, 6.7 MB — 24 Jun 2026 — Company Secretary — Board — Final; ESG Baseline Assessment.pdf — ESG & Impact — PDF, 2.9 MB — 18 Mar 2026 — Impact Lead — Investor Reporting — v2; Equipment Finance Facility – Draft.pdf — Investment Documents — PDF, 1.9 MB — 02 Aug 2026 — Matanho Fund Finance — Executive & Board — v3 (signature SIG-019, Awaiting your signature); Working Capital Facility – Written Resolution.pdf — Board & Governance — PDF, 1.2 MB — 01 Aug 2026 — Company Secretary — Board — v2 (signature SIG-018, Awaiting CEO signature). Filters/search/sort/pagination: none functional.

##### Inputs & validation
(Upload documents modal)
| Field | Control | Required | Options / default / placeholder | Validation today (code) | Target validation | Error message |
|---|---|---|---|---|---|---|
| Destination folder | select | Yes | *Financial Reports*, *Forecasts & Budgets*, *Board & Governance*, *Investment Documents*, *ESG & Impact* | none | **[P]** one of the company's folders | — |
| Files | drop zone | Yes | "Drop files here or select from your computer" / "PDF, XLSX, DOCX, PPTX and ZIP · up to 100 MB" — click shows "Files selected successfully / 2 files · 4.7 MB · ready for validation" (simulated) | none | **[P]** allow-list `.pdf .xlsx .xls .csv .docx .pptx .zip`; ≤ `MAX_UPLOAD_MB` (25) per file; malware scan | **[P]** "File type not allowed."; "File exceeds 25 MB." |
| Access profile | select | Yes | *Investor Reporting*, *Executive & Board*, *Board only*, *Company only* | none | **[P]** Company-only documents are never visible to fund staff | — |
| Document period | select | No | *Q2 2026*, *July 2026*, *Not period-specific* | none | **[P]** period keys of the company | — |
| Upload note | textarea | No | placeholder "Describe the document or changes in this version." | none | **[P]** ≤ 1,000 chars | — |
(Create folder modal)
| Field | Control | Required | Options / default / placeholder | Validation today (code) | Target validation | Error message |
|---|---|---|---|---|---|---|
| Folder name | text | Yes | placeholder "e.g. Product & Technology" | none | **[P]** unique per company, ≤ 80 chars | **[P]** "Folder name already exists." |
| Default access | select | Yes | *Investor Reporting*, *Executive & Board*, *Company only* | none | — | — |

##### Actions
| Control | Enabled when | Permission | Effect (state change, toast text, navigation) | Wiring / API | Label |
|---|---|---|---|---|---|
| *Upload documents* / *Upload* | Always | **[P]** contributor | Opens upload modal | Client | [O] |
| *Upload documents* (modal) | Always | contributor | Closes; toast "Documents uploaded" / "Files were versioned, permissions applied and the audit trail updated." (nothing stored) | **[P]** `POST /api/v1/company/vault/documents` (multipart) | [O] dead |
| *Create folder* → *Create folder* (modal) | Always | contributor | Toast "Folder created" / "Permissions were inherited from the selected access profile." | **[P]** `POST /api/v1/company/vault/folders` | [O] dead |
| Folder tile | Always | company scope | Opens folder drawer | Client | [O] |
| Document row/card | Always | company scope | Opens document drawer | Client | [O] |
| *Signature centre* / *Open document vault* | Always | company scope | Navigates to Signatures | Router | [O] |
| *Share* (drawer) | Always | contributor | Toast "Secure link copied" / "The link respects the document access policy and expires in seven days." (no link) | **[P]** `POST /api/v1/company/vault/documents/{id}/share-link` (7-day expiry, audited) | [O] dead |
| *Download* (drawer, preview) | Always | company scope | Stub toast "Download prepared…" | **[P]** `GET /api/v1/company/vault/documents/{id}/download-url` (300 s, audited) | [O] dead |
| *Review & sign* / *Request signature* (drawer) | Awaiting you / otherwise | signatory / authority | Opens signing modal / request modal (5.D.8) | Client | [O] |
| *Open full preview* | Always | company scope | Opens preview modal | Client | [O] |
| Preview zoom − / + | Preview open | — | Zoom 70%–150% in 10% steps | Client | [O] |
| *Open print view* | Preview open | — | `window.print()` | Client | [O] |
| *View*, search, filter | Always | — | No effect / stub | — | [O] dead |

##### Modals & drawers
**Drawer — Folder** [O]: title folder name, sub "Secure document-vault folder"; rows of the fixture documents in that folder ("{type} · {size} · {updated}"; click → document drawer); empty "No recent documents" / "Upload a document to populate this folder."; footer *Upload*.

**Drawer — Document** [O]: title name, sub "{folder} · {type}"; preview tile "Secure document preview" with "{type} · {size} · {version}" and *Open full preview*; signature notice when a request exists (status, "{recipients} · due {date}" or last activity); details Owner, Updated, Version, File size, Access; "Audit history": "Current version uploaded — Uploaded by {owner}." and "Viewed by authorised users — 4 views in the last 30 days. / Audit trail available" (static); footer *Share*, *Download*, *Review & sign* or *Request signature*.

**Modal — Document preview** [O]: title "Document preview", sub "{name} · {type} · {version}"; toolbar "{name}" / "Page 1 of 3 · secure preview", zoom controls; fake page "matanho / CONFIDENTIAL", title, "Zambezi Pay Technologies · {folder}", summary (owner, version, last updated), "Executive summary" and "Key information" (Reporting period "Current reporting cycle", Access profile, File integrity "Verified and retained in the audit trail"), bar chart, footer "Secure preview · watermarked for Tariro Moyo · {today dd/mm/yyyy}" (name hard-coded); buttons *Close*, *Download*, *Open print view*. **[P]** Real preview renders the PDF page images with a watermark of the viewer's name and time.

**Modal — Upload documents** and **Modal — Create document-vault folder** [O]: fields above; footers *Cancel* + primary.

##### States
- Empty: folder drawer "No recent documents"; live "No application documents…".
- Loading: live skeleton (header + table).
- Error: none.
- Disabled / read-only: **[P]** read-only profiles see no Upload/Create folder buttons.
- Conditional: signature column/notice only when a request exists for that document name (matched by file name, not id).

##### Business rules & calculations
- **[P]** BR-232: documents are versioned (a new upload to the same name adds version n+1) with SHA-256 per version; classification maps to Nexus Document classification (Public, Client, Internal, Restricted) and to the V8 access profiles (Investor Reporting → Client; Executive & Board and Board → Restricted-to-named-members; Company only → Internal to company, invisible to fund staff).
- **[P]** BR-233: download links are HMAC-signed with 300 s expiry and audited (Nexus FR-DOC-002); share links expire in seven days and respect the access profile.
- **[P]** BR-234: allowed types and size per BR in 5.D.3 (platform cap 25 MB; the UI copy "100 MB" must be corrected or the cap raised for the vault).
- **[P]** BR-235: signed documents are immutable; a signed copy and certificate are added to the same folder automatically.
- **[P]** BR-236: the application documents in NVCCZ live mode are read-only deal documents (type, submitted flag, uploaded date) and are not part of the vault.

##### Edge cases
- **[O]** Folder counts, storage usage and the "2 awaiting signature" pill are literals and disagree with the rows.
- **[O]** Disclosure letter (Term Sheet page) has no vault row; opening it uses a default document record.
- **[O]** Signature match uses document name equality.

##### Gaps, defects & open questions
- **DEF-505** upload, folders, share, download, search, access filter and View are stubs; storage and counts are literals; preview shows a lorem page; watermark name hard-coded; "100 MB" limit contradicts platform caps.
- FR-CMP-038: Company users upload, version, share and download documents with access profiles — AC: uploaded file appears in the folder with version, owner and size; fund staff see it only when the access profile permits; each upload/download/share is an audit event.
- FR-CMP-039: Staff-published documents (term sheet, SHA, board packs, guides, templates) appear in the vault read-only — AC: documents published to the company (Nexus `documents.companyId`, status Published) show with Final version and signature state.
- FR-CMP-040: Folder search and access filter operate on name, folder, owner, version and access — AC: typing filters rows within 200 ms.
- Q-193: Is the company vault the same store as Nexus `documents` (staff vault, 5.A.13) with a `company_id` scope, or a separate company-owned store? — default: same store, new `company_folders` and `access_profile` fields.
- Q-194: Maximum file size — 25 MB (current platform) versus 100 MB shown? — default: 25 MB, correct the copy.

#### 5.D.11 Messages (`messages`, route `/messages`, `company scope`)

| Attribute | Value |
| --- | --- |
| Purpose | Secure conversations between the company and fund teams (portfolio, legal and governance, value creation, fund finance). |
| Access | Company scope. **[P]** Any member can read threads they participate in; *Read only* members cannot post. |
| Prototype layer | Runtime `messagesPage()`, chat form handler, new-conversation modal. |
| Wiring status | Prototype (3 fixture threads; sending mutates memory). NVCCZ live (dormant): empty card; no applicant messaging API (options A reuse deal collaboration, B new thread API, C drop are open). Nexus: `reporting_questions` + messages (staff raises, company replies/resolves) and client-scoped `message_threads`. |
| Entry points | Sidebar; Term Sheet clarification and Reporting drawer *Message reviewer* **[P]**. |
| Exit points | New conversation modal. |

##### Layout
1. **[O]** Header "Messages" / "Secure conversations with your portfolio, legal, governance and value-creation teams." with *New conversation* (primary).
2. **[O]** Two-pane card: thread list (with search) and active conversation (header, messages, compose form).

##### Elements
| # | Element | Type | Content / behaviour | Data source (current → target) | Label |
|---|---|---|---|---|---|
| 1 | Thread search | input | placeholder "Search conversations"; no handler | — | [O] dead |
| 2 | Thread item | row | Avatar initials, name, unread chip (brand pill with number), one-line preview, time; active highlight; click selects thread (no read marking) | Prototype `threads[]` → **[P]** `GET /api/v1/company/threads` | [O] |
| 3 | Chat header | header | Thread name; "Secure workspace conversation · visible to authorised participants"; info button (stub) | Prototype | [O] |
| 4 | Message bubble | bubble | Sender name, text, timestamp; own messages (`Company`) right-aligned style | Prototype | [O] |
| 5 | Compose form | form | Attach (paperclip, stub), text input "Write a secure message…", *Send* | Client | [O] |
| 6 | Live empty card | notice | "No data" / "Messages are not available yet — an applicant messaging API is still pending (see design-refs/investee-portal-v8-backend-asks.md)." | NVCCZ | [O] dormant |

##### Tables
None. Fixture threads: *Matanho Portfolio Team* (MP, unread 1, "Thanks — the June management accounts are now accepted.", 09:42; 3 messages between Nyasha Moyo (Investor) and Tariro Moyo (Company), 2026-08-02 15:14 → 2026-08-03 09:42); *Matanho Value Creation* (VC, unread 1, "We have shared the regional compensation benchmark.", Yesterday; 1 message from Farai Dube); *Legal & Governance* (LG, 0, "The reserved matters checklist was updated.", 30 Jul; 1 message from Sarah Khan).

##### Inputs & validation
| Field | Control | Required | Options / default / placeholder | Validation today (code) | Target validation | Error message |
|---|---|---|---|---|---|---|
| Message text | text `#chatInput` | Yes | placeholder "Write a secure message…" | blank/whitespace ignored silently | **[P]** 1–5,000 characters (Nexus question reply limit) | **[P]** "Enter a message." |
| Recipient team | select | Yes | *Matanho Portfolio Team*, *Matanho Legal & Governance*, *Matanho Value Creation*, *Matanho Fund Finance* | none | **[P]** teams defined by staff | — |
| Subject | text | Yes | placeholder "Conversation subject" | none | **[P]** 1–200 characters | **[P]** "Enter a subject." |
| Message | textarea | Yes | placeholder "Write your message…" | none | **[P]** 1–5,000 characters | **[P]** "Enter a message." |

##### Actions
| Control | Enabled when | Permission | Effect (state change, toast text, navigation) | Wiring / API | Label |
|---|---|---|---|---|---|
| Thread item | Always | company scope | Select thread; list re-renders; message list scrolls to bottom | Client | [O] |
| *Send* / Enter | Text non-empty | **[P]** can post | Mock: appends `[Tariro Moyo, Company, text, "2026-08-03 04:53"]` (hard-coded sender and time), sets preview and time "Now", clears input, toast "Message sent" / "Your secure message has been delivered." | Prototype; **[P]** `POST /api/v1/company/threads/{id}/messages` | [O]/[P] |
| *New conversation* | Always | company scope | Opens modal | Client | [O] |
| *Send message* (modal) | Always | can post | Closes; toast "Message sent" / "A secure conversation was created." (no thread created) | **[P]** `POST /api/v1/company/threads` | [O] dead |
| Attach | Always | — | Stub toast | **[P]** attach vault/uploaded file (same validation as vault) | [O] dead |
| Info button | Always | — | Stub toast | **[P]** participants and thread subject | [O] dead |

##### Modals & drawers
**Modal — New secure conversation** [O]: title "New secure conversation", sub "Start a message thread with an authorised fund team."; fields above; footer *Cancel*, *Send message*.

##### States
- Empty: **[P]** "No conversations yet — start one with the fund team."
- Loading: live skeleton "Loading conversations."
- Error: none.
- Disabled / read-only: **[P]** read-only members cannot post; resolved threads reject replies (Nexus `invalid_state` 409).
- Conditional: unread chip hidden at 0.

##### Business rules & calculations
- **[P]** BR-237: a thread has a subject, a fund team, participants, status Open/Resolved, optional related object (period, request, term sheet); staff and company users post; messages are immutable; unread counts per user via read markers.
- **[P]** BR-NEW (Nexus reuse): reporting questions raised by staff (title ≤ 200, text ≤ 5,000) are threads with `relatedType=period`; replies blocked once resolved; no reopen (Q-NEW).
- **[P]** BR-238: a staff post notifies company members (in-app and e-mail); a company post notifies the owning staff role.
- **[I]** Teams in the recipient list map to staff queues (Portfolio, Legal & Governance, Value Creation, Fund Finance).

##### Edge cases
- **[O]** Selecting a thread never clears its unread chip.
- **[O]** Thread order is fixed; a sent message does not move the thread to the top.
- **[O]** Timestamps are strings, not dates.

##### Gaps, defects & open questions
- **DEF-506** sender name and timestamp hard-coded in mock; search dead; attach and info stubs; new conversation creates nothing; messages lost on reload.
- FR-CMP-041: Company ↔ fund-team threads persist with participants, read state and notifications — AC: a message posted by staff appears for company members within 60 s with an unread count; reload preserves history.
- FR-CMP-042: Search filters threads by subject, participant and text — AC: matching threads only.
- Q-195: Messages vs Q&A questions — one thread model? — default: one model; questions are threads with `type=question` and a Resolve action.
- Q-196: Are attachments allowed in threads? — default: yes via the vault.

#### 5.D.12 Team & Access (`team`, route `/team`, `company scope`)

| Attribute | Value |
| --- | --- |
| Purpose | Control company users, responsibilities, approval roles and document permissions; show MFA coverage, access-review status and external (fund-side) access. |
| Access | Company scope. **[P]** Only *Workspace administrator* manages members. |
| Prototype layer | Runtime `teamPage()`, invite modal. |
| Wiring status | Prototype only. NVCCZ: no team feature (one user per company). Nexus: `company_users` (M:N, no roles), staff invite `POST /private-markets/companies/:ref/users`, invitation accept; no company-side team API. |
| Entry points | Sidebar. |
| Exit points | Invite modal; stubs. |

##### Layout
1. **[O]** Header "Team & Access" / "Control company users, responsibilities, approvals and document permissions." with *Invite team member* (primary) and *Review access*.
2. **[O]** Three metric cards.
3. **[O]** *Company team* table.
4. **[O]** Two cards: *Approval roles*, *External access*.

##### Elements
| # | Element | Type | Content / behaviour | Data source (current → target) | Label |
|---|---|---|---|---|---|
| 1 | *Active company users* | KPI | "12"; foot "6 executive or administrator roles" | Static → **[P]** `GET /api/v1/company/team` summary | [O] |
| 2 | *MFA coverage* | KPI | "100%"; foot "All users protected" | Static → **[P]** members with a verified MFA factor / active members | [O] |
| 3 | *Access review* | KPI | "Current"; foot "Last certified 31 Jul 2026" | Static → **[P]** last access-review certification | [O] |
| 4 | Team table | table | See Tables | Prototype → **[P]** same endpoint | [O] |
| 5 | *Approval roles* | detail list | "Configured segregation of duties": Report preparer "Finance Team"; Report approver "CEO or CFO"; Forecast owner "CFO"; Board submission "Company Secretary + CEO" | Static → **[P]** `approval_routes` per company | [O] |
| 6 | *External access* | card | "Fund-side and adviser permissions"; notice "8 authorised external users" / "Matanho investment, portfolio, finance and legal team access is controlled by the fund administrator."; button *View external access log* (stub) | Static → **[P]** staff access to the company (audit events) | [O] |
| 7 | Live empty card | notice | "No data" / "Company team and access management is not available yet — a live team/user-management API is still pending. See design-refs/investee-portal-v8-backend-asks.md." | NVCCZ | [O] dormant |

##### Tables
**Company team**
| Column | Format | Sortable | Notes |
|---|---|---|---|
| Team member | avatar initials + name + e-mail (`{first}@zambezipay.{last}.com`, derived by string replace) | No | |
| Role | text | No | job title |
| Access profile | text | No | Workspace administrator, Executive approver, Report contributor, KPI owner, Finance editor |
| Last active | text | No | rows 1–2 "Today", 3–4 "Yesterday", others "30 Jul 2026" (by index) |
| MFA | pill | No | *Enabled* (literal) |
| Status | pill | No | *Active* |
| (action) | more icon | — | stub toast "Interactive control / {name} opened successfully in the prototype." |

- Rows: Tariro Moyo — Chief Financial Officer — Workspace administrator; Nyasha Chikore — Chief Executive Officer — Executive approver; Kuda Ndlovu — Chief Operating Officer — Report contributor; Tawanda Dube — Chief Technology Officer — KPI owner; Rudo Ncube — Head of People — Report contributor; Chipo Banda — Financial Controller — Finance editor. Filters/search/pagination: none (the "12 users" tile shows more than the 6 rows).

##### Inputs & validation
(Invite team member modal)
| Field | Control | Required | Options / default / placeholder | Validation today (code) | Target validation | Error message |
|---|---|---|---|---|---|---|
| Full name | text | Yes | placeholder "Name" | none | **[P]** 1–120 characters (Nexus) | **[P]** "Enter the member's name." |
| Work email | email | Yes | placeholder "name@company.com" | none | **[P]** valid e-mail, not already a member (409 `already_member`) | "already_member" |
| Access profile | select | Yes | *Report contributor* (default), *KPI owner*, *Executive approver*, *Read only*, *Workspace administrator* | none | **[P]** profile list below | — |
| Assigned responsibilities | textarea | No | placeholder "Optional reporting sections, KPIs or approvals." | none | **[P]** ≤ 1,000 chars | — |

##### Actions
| Control | Enabled when | Permission | Effect (state change, toast text, navigation) | Wiring / API | Label |
|---|---|---|---|---|---|
| *Invite team member* | Always | **[P]** administrator | Opens modal | Client | [O] |
| *Send invitation* | Always | administrator | Closes; toast "Invitation sent" / "The user must activate MFA before accessing company information." (nothing sent) | **[P]** `POST /api/v1/company/team/invitations` (Nexus invitation with `companyId`, 7-day token) | [O] dead |
| *Review access* | Always | administrator | Stub toast | **[P]** `POST /api/v1/company/team/access-review` (certify) | [O] dead |
| Row action | Always | administrator | Stub toast | **[P]** drawer: change profile, disable, remove | [O] dead |
| *View external access log* | Always | administrator | Stub toast | **[P]** `GET /api/v1/company/team/external-access` | [O] dead |

##### Modals & drawers
**Modal — Invite team member** [O]: title "Invite team member", sub "Grant controlled access to the company workspace."; fields above; footer *Cancel*, *Send invitation*.

##### States
- Empty: **[P]** "No team members" (cannot occur: at least one administrator).
- Loading: live skeleton "Loading records."
- Error: **[P]** inline "already_member" and invalid e-mail messages.
- Disabled / read-only: **[P]** non-administrators see the list read-only without invite/row actions.
- Conditional: none.

##### Business rules & calculations
- **[P]** BR-239: access profiles (no admin roles are created, section 4.4): *Workspace administrator* (manage members, all pages), *Executive approver* (approve reports, forecast, requests, sign), *Report contributor* (prepare and submit reports), *KPI owner* (submit KPIs), *Finance editor* (statements, forecast, requests drafts), *Read only* (view). Stored as `company_users.profile`.
- **[P]** BR-240: segregation of duties inside the company — report preparer ≠ approver; forecast owner = CFO; board submission = Company Secretary + CEO; the approval route is configurable by the fund.
- **[P]** BR-241: invitation e-mail contains a one-time link (7 days); new members must enrol MFA before accessing company data when the MFA policy is on; at least one *Workspace administrator* must remain.
- **[P]** BR-242: MFA coverage = members with a verified factor / active members; access review certifies the member list at least every 90 days (Q-NEW).
- **[O]** The table e-mail is synthesised from the name and is not a stored value.

##### Edge cases
- **[O]** The 12 / 6 counters do not match the six rows; the "Last active" column is index-based.
- **[O]** The invite modal does not validate and does not reset between openings.

##### Gaps, defects & open questions
- **DEF-507** everything is a literal; no persistence; all row actions are stubs.
- FR-CMP-043: Members list, invite, profile change, disable and removal for company administrators — AC: invited user receives a link; accepting adds a `company_users` row with the chosen profile; removal revokes access immediately and invalidates sessions of that company context.
- FR-CMP-044: External-access log shows fund-side users who viewed or downloaded company data — AC: derived from audit events (`document.downloaded`, `reporting.file.downloaded`).
- Q-197: Who provisions the first company user — the fund (Nexus `POST /companies/:ref/users`) — and may the company administrator invite others? — default: yes, within the same company only.
- Q-198: Are profiles an entitlement list or a replacement for roles (4.4 says no roles)? — default: scoped profiles on `company_users`, evaluated by the API; no role catalogue entries.

#### 5.D.13 Settings (`settings`, route `/settings`, `company scope`)

| Attribute | Value |
| --- | --- |
| Purpose | Company profile, the user's own profile, letterhead/logo, notification preferences and security information. |
| Access | Company scope. **[P]** Company profile and letterhead: *Workspace administrator*; own profile and notifications: any member. |
| Prototype layer | Runtime `settingsPage()`. |
| Wiring status | Prototype: forms render blank/default values (they read the dormant live payload) and *Save changes* only toasts. NVCCZ live (dormant): `PUT /applicant/profile`, `PUT /applicant/company`, `PUT /portfolio-companies/{id}/letterhead`, `POST …/letterhead/logo`. Nexus: none (portfolio_companies has no update endpoint; no letterhead). |
| Entry points | Sidebar *Settings*; profile drawer *Edit profile* (stub). |
| Exit points | None. |

##### Layout
1. **[O]** Header "Portal Settings" / "Configure reporting preferences, notifications, security and company information." with *Save changes* (primary, check icon).
2. **[O]** Left: *Company profile*, *Your profile*, *Letterhead*. Right: *Notifications*, *Security*.

##### Elements
| # | Element | Type | Content / behaviour | Data source (current → target) | Label |
|---|---|---|---|---|---|
| 1 | *Company profile* | form card | "Displayed across investor reporting and governance records"; fields below | Mock: blank (name default "Zambezi Pay Technologies (Private) Limited") → **[P]** `GET /api/v1/company/profile` | [O] |
| 2 | *Your profile* | form card | "Applicant account details"; First name, Last name, Email | Mock: blank → **[P]** `GET /api/v1/company/me` | [O] |
| 3 | *Letterhead* | form card | "Used on formal company documents"; fields below incl. Logo file input | Mock: blank (Country default "Zimbabwe") → **[P]** `GET /api/v1/company/letterhead` | [O] |
| 4 | *Notifications* | switch list | "Email and in-app alerts": *Reporting deadlines* "14, 7, 3 and 1 day reminders." (on); *New investor requests* "Immediate alert to assigned owner." (on) | Client → **[P]** `GET/PUT /api/v1/company/notification-preferences` | [O] |
| 5 | *Security* | detail list | "Company workspace controls": Multi-factor auth "Required for all users"; Session timeout "30 minutes"; button *Open security centre* (stub) | Static → **[P]** platform policy values (Nexus `mfa_required`, session idle minutes) | [O] |

##### Tables
None.

##### Inputs & validation
| Field | Control | Required | Options / default / placeholder | Validation today (code) | Target validation | Error message |
|---|---|---|---|---|---|---|
| Registered company name `#settingsCompanyName` | text | Yes | default "Zambezi Pay Technologies (Private) Limited" | none | **[P]** 1–200 chars | **[P]** "Enter the registered name." |
| Industry `#settingsIndustry` | text | No | — | none | **[P]** list or free text ≤ 120 | — |
| Registration number `#settingsRegistrationNumber` | text | No | — | none; NVCCZ host never sends it | **[P]** read-only for the company (changes via fund staff) | — |
| Website `#settingsWebsite` | text | No | — | none | **[P]** valid URL | **[P]** "Enter a valid URL." |
| Description `#settingsDescription` | textarea | No | — | none | **[P]** ≤ 2,000 | — |
| Contact email `#settingsContactEmail` | text | No | default profile email | none | **[P]** valid e-mail | **[P]** "Enter a valid e-mail." |
| Contact phone `#settingsContactPhone` | text | No | — | none | **[P]** E.164-ish | — |
| First name / Last name / Email | text | Yes | — | none (NVCCZ host sends only non-empty fields) | **[P]** e-mail unique; changing e-mail re-verifies | "email_taken" (Nexus) |
| Letterhead Legal name `#settingsLetterheadLegalName` | text | Yes (when saving letterhead) | default company name | none; NVCCZ host saves letterhead only when non-empty | **[P]** ≤ 512 | — |
| Letterhead Registration / Email / Phone / Website | text | No | default from company | none | **[P]** as above | — |
| Address line 1 | text | Yes (letterhead) | default company address; empty → saved as "—" | none | **[P]** required; no placeholder dash | **[P]** "Enter the address." |
| City | text | Yes (letterhead) | blank; empty → saved as "—" | none | **[P]** required | **[P]** "Enter the city." |
| Country | text | Yes (letterhead) | "Zimbabwe" | none | **[P]** ISO country | — |
| Logo `#settingsLetterheadLogo` | file | No | `accept="image/*"` | browser accept only; NVCCZ ≤ 10 MB | **[P]** PNG/JPEG/SVG ≤ 2 MB, dimensions limit | **[P]** "Logo must be an image under 2 MB." |
| Notification switches | switch | No | both on | none | **[P]** persisted per user | — |

##### Actions
| Control | Enabled when | Permission | Effect (state change, toast text, navigation) | Wiring / API | Label |
|---|---|---|---|---|---|
| *Save changes* | Always | per section | Mock: toast "Settings saved" / "Company and reporting preferences have been updated." (nothing stored). NVCCZ live: updates profile (non-empty fields), company (non-empty), letterhead (when legal name set), uploads logo; reloads; toast "Settings saved" | NVCCZ `PUT /applicant/profile`, `PUT /applicant/company`, `PUT /portfolio-companies/{id}/letterhead`, `POST …/letterhead/logo`; **[P]** Nexus equivalents | [O]/[P] |
| Notification switch | Always | any member | Toggles `.on`; toast "Preference updated" / "The setting has been changed for this prototype." (not persisted) | **[P]** preferences endpoint | [O] |
| *Open security centre* | Always | company scope | Stub toast | **[P]** MFA enrolment and session list | [O] dead |
| *Delete letterhead* (host action `delete-letterhead`) | — | administrator | No control exists; NVCCZ host supports `DELETE /portfolio-companies/{id}/letterhead` | NVCCZ | [O] dormant |

##### Modals & drawers
None.

##### States
- Empty: blank fields.
- Loading: none (live: Settings has no skeleton branch).
- Error: NVCCZ host "Request failed" toasts.
- Disabled / read-only: **[P]** company fields read-only for non-administrators.
- Conditional: letterhead saves only when a legal name is present and the portfolio-company id is known.

##### Business rules & calculations
- **[P]** BR-243: the letterhead (legal name, registration, tax number, e-mail, phone, website, logo, address lines, city, state, postal code, country, social links) is used on generated documents (board packs, certificates, signed copies); one letterhead per company; replaced as a whole.
- **[P]** BR-244: logo upload types and sizes per BR above; the stored URL is signed.
- **[P]** BR-NEW (NVCCZ defects not to port): letterhead and company updates must be limited to the caller's own company and to whitelisted fields (no `status`, `fundId`, `userId`).
- **[P]** BR-245: notification preferences cover at least: reporting deadline reminders at 14, 7, 3 and 1 day before the due date, new investor requests/questions, decisions on requests and consents, signature requests; channels e-mail and in-app.
- **[O]** The "Registered company name" default and "Zimbabwe" country default are fixtures.

##### Edge cases
- **[O]** In mock mode the user's first/last name and e-mail are blank even though the session knows them.
- **[O]** NVCCZ saving without re-typing city/address overwrites stored values with "—".
- **[O]** The company registration number is shown but cannot be saved.

##### Gaps, defects & open questions
- **DEF-508** mock Save is a toast; switches are session-only; Security block is static; letterhead is not pre-filled from the stored record; registration number is not saved.
- FR-CMP-045: Settings load and save the company profile, user profile, letterhead (with logo) and notification preferences — AC: reload shows the saved values; invalid e-mail/URL are rejected with field messages; a non-administrator cannot change company fields (403).
- FR-CMP-046: Security card shows the real MFA state and session timeout of the account — AC: values equal the platform policy and the user's factor status.
- Q-199: Which company fields can the company edit versus only the fund (legal name, registration number)? — default: contact and descriptive fields editable; legal name and registration changes go through a staff-approved change request.
- Q-200: Reminder schedule (14, 7, 3, 1 days) — configurable per fund? — default: fixed as shown, owned by the reporting-request settings.
