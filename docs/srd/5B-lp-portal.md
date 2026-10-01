# 5.B LP Portal (port 3101)

**Baseline for this section [O].** Since 30 Sep 2026 the investor portal (`portals/investor-web`, port 3101, host `investor.nexus.matanho.com`) is the LP portal, a Next.js (App Router) application imported from a sibling private-equity and fund-ERP product ("Arcus", NVCCZ). It replaces the V65 "LP Portal V59" prototype and its legacy bridge; nothing of that prototype is rendered any more.

- The portal has ten screens under `/lp-portal`: Dashboard, Performance, Account Activity, Capital Activity (capital calls and distributions), Subscriptions & Redemptions, Documents, Requests (with Messages), Notices, Organisation, Settings. The sidebar offers 14 entries (the sub-tree *My Investments* adds five more links per operating model).
- Every screen reads and writes through one typed client, `lib/api/lp-portal-api.ts`, which declares 70 methods. A `Proxy` answers every method from an in-memory demo store (`lib/lp-portal/mock-store.ts`, `mock-api.ts`: client "Horizon Pension Fund LP", funds "Matanho Growth Fund I" (private capital) and "Matanho Equity Opportunities Fund" (open-ended), as-of 30 Jun 2026, status FINAL). The HTTP client (`lib/api/api-client.ts`) is a stub that rejects every call. All data elements and all actions are therefore **Prototype**; this section names, for each one, the `lpPortalApi` method and path that is the target API call.
- Real behaviour today: sign-in, sign-out, the sign-in gate (`REQUIRE_AUTH_PORTALS`), the user's name and role in the profile menu (`GET /api/auth/me`, `POST /api/auth/logout`). Nothing the user does on a screen is saved: the store resets on every page load.
- The screens are byte-identical to the NVCCZ originals; the LP business logic (formulas, validation, workflow) lives in the NVCCZ backend (`C:\Users\lysp\Downloads\nvccz`), which this section reads as the **reference implementation** of the API. Where the Nexus UI (mock) and the reference backend disagree, both behaviours are stated and labelled.
- Evidence labels in this section: **[O]** implemented in the Nexus LP UI (mock layer); **[I]** implemented in the reference backend or stated by the design documents (`lp-portal-srd-ui-requirements.md`, `lp-portal-backend-srd.md`, `lp-portal-fe-gaps-api.md`, `lp-portal-realtime-api.md`) but not in the Nexus UI; **[P]** proposed by this SRD.
- Permission names in the page headings are the LP permission codes of the reference backend (`lp.*`); the mapping to the Nexus investor roles is in the ROLES & PERMISSIONS block at the end of this section.
- Companion blocks follow the ten pages: API CONTRACT (70 methods), DOMAIN MODEL, STATE MACHINES, BUSINESS RULES, ROLES & PERMISSIONS, GAP VS NEXUS API, STAFF-SIDE COUNTERPARTS and Corrections to other SRD sections.

Page index:

| Section | Page | Route | API methods used by the screen (UI-called) | Staff counterpart (see STAFF-SIDE COUNTERPARTS) |
| --- | --- | --- | --- | --- |
| 5.B.0 | Shell | `/lp-portal/*` layout | getSession, getNotifications, getDocuments (search) | fund master data, notifications |
| 5.B.1 | Dashboard | `/lp-portal` | getDashboard, getDashboardActions, getDashboardRecentActivity, getPerformanceHistory, getDocuments, downloadDocument | snapshots, calls, notices |
| 5.B.2 | Performance | `/lp-portal/performance` | getPerformance, getPerformanceHistory, getPerformanceByFund, getPerformanceBenchmarks, downloadPerformanceReport, getJob, downloadReport | snapshots, benchmarks, reports |
| 5.B.3 | Account Activity | `/lp-portal/account-activity` | getAccountActivity, getLedgerEntry, exportAccountActivity, downloadDocument | ledger postings |
| 5.B.4 | Capital Activity | `/lp-portal/capital-activity` | getCapitalCalls, getCapitalCall, getCapitalCallSummary, getCapitalCallDocuments, acknowledgeCapitalCall, uploadPaymentConfirmation, downloadCapitalCallNotice, getDistributions, downloadDistribution, downloadDistributionStatement, downloadDocument | calls, distributions, matching |
| 5.B.5 | Subscriptions & Redemptions | `/lp-portal/subscriptions-redemptions` | getDealingOverview, getDealingBankAccounts, getDealingRequests, estimateSubscription, submitSubscription, estimateRedemption, submitRedemption, exportDealingRequests | dealing desk, rules, NAV |
| 5.B.6 | Documents | `/lp-portal/documents` | getDocuments, getDocumentsSummary, getDocument, previewDocument, downloadDocument | document vault |
| 5.B.7 | Requests & Messages | `/lp-portal/requests` | getRequests, getRequest, createRequest, uploadRequestAttachment, replyToRequest, getMessages, getMessageThread, markMessageThreadRead, replyToMessageThread | service desk |
| 5.B.8 | Notices | `/lp-portal/notices` | getNotices, getNotice, acknowledgeNotice | notice composer |
| 5.B.9 | Organisation | `/lp-portal/organisation` | getOrganisation, getBankInstructionChanges, inviteColleague, revokeColleague, submitBankInstructionChange | access admin, bank verification |
| 5.B.10 | Settings | `/lp-portal/settings` | getSettings, updateNotificationSettings, updateDisplaySettings | MFA policy |

Twelve methods are declared but called by no screen: getRealtime, getDistribution, getLedger, getDealingRules, requestPerformanceReport, getVault, downloadVaultDocument, verifyVaultDocument, getColleagues, updateColleague, getMfaSettings, getReports. They are specified in the API CONTRACT because a complete API must implement them (the UI types and the design documents rely on them).

#### 5.B.0 Shell (`/lp-portal/*` layout: sidebar, topbar, session context; sign-in gate only)

| Attribute | Value |
| --- | --- |
| Purpose | Persistent frame of the LP portal: navigation tree that changes with the fund operating model, global fund / as-of / valuation context, global search, alerts bell, profile menu with sign-out, and the shared session context (client, LP role, funds, unread counts, refresh keys, realtime subscriptions) that every screen reads. **[O]** |
| Access | Two separate gates. (1) Route gate `createPortalProxy('investor', { requirePortalRole: true })`, active only when `REQUIRE_AUTH_PORTALS` contains `investor`: it calls `GET /api/auth/me` with the session cookie, passes when the user holds any role whose `portal` is `investor`, otherwise redirects to `/login?next={path+query}`; the matcher excludes `_next/`, `assets/`, `login`, `invite`, `reset-password`, `favicon.ico`, `new_logo.png`. **[O]** (2) LP session (`lpPortalApi.getSession`): supplies `lpRole`, funds and counts; today it is the hard-coded demo session and is NOT derived from the signed-in user. **[O]** The shell contains no permission gating: every nav item is shown to every `lpRole`. **[O]** |
| Prototype layer | Native React (Next.js App Router, route group `(lp)`): `app/(lp)/layout.tsx`, `app/(lp)/lp-portal/layout.tsx`, `components/layout/lp-portal-layout.tsx`, `lp-portal-sidebar.tsx`, `lp-portal-topbar.tsx`, `components/lp-portal/lp-portal-context.tsx`, `lib/lp-portal/{hooks,mappers,format,navigation,realtime,config}.ts`; data from `lib/lp-portal/mock-store.ts` through `lib/api/lp-portal-api.ts`. **[O]** |
| Wiring status | Prototype for every data element (session, funds, counts, notifications, search results). `lib/api/api-client.ts` is a stub that rejects every call; the `lpPortalApi` Proxy answers every method from the mock store whenever the mock implements it (all 70 do). The per-domain switch (`LP_LIVE_DOMAINS`, `LP_METHOD_DOMAIN`) is declared but not consulted by the Proxy, so flipping a domain flag has no effect. Sign-in, sign-out and the user name/role in the profile menu are real (`@matanho/portal-kit`, `GET /api/auth/me`, `POST /api/auth/logout`). **[O]** |
| Entry points | `/` redirects (307) to `/lp-portal`; successful sign-in redirects to the `next` query value (default `/`, hence `/lp-portal`); `/invite` acceptance and `/reset-password` completion return to sign-in; deep links `/lp-portal/*` (see "Deep links and legacy redirects" below). **[O]** |
| Exit points | Sign Out (profile menu) → `POST /api/auth/logout` then hard navigation to `/login`. No link to any other portal. The mobile logo links to `/home`, which has no route (DEFECT below). **[O]** |

##### Layout

1. Root layout `app/(lp)/layout.tsx`: `<html lang="en">`, fonts Montserrat, Inter and Geist Mono (CSS variables), page title "{ORG_NAME} | LP Portal" where `ORG_NAME` = `NEXT_PUBLIC_ORGANIZATION_NAME` (default "Matanho"); meta description "Fund performance, capital activity, documents and requests for Matanho limited partners."; favicon, shortcut and apple icons = `NEXT_PUBLIC_ORGANIZATION_LOGO` (default `/new_logo.png`); children wrapped in `<Suspense fallback={null}>`; a `sonner` toaster at `top-right` (white 95 % opacity card, 1 px border, bold 600 text, blur, shadow) for every toast in the portal. **[O]**
2. Portal frame `LpPortalLayout`: full-viewport flex row (`h-dvh`, `overflow-hidden`); the component sets `overflow: hidden` on `<html>` and `<body>` while mounted and restores the previous values on unmount. **[O]**
3. Left region (≥ 1024 px, Tailwind `lg`): sidebar, full height, 206 px expanded or 62 px collapsed. Below 1024 px it is hidden and replaced by the topbar's menu button and a 288 px left sheet. **[O]**
4. Right region: topbar (sticky, 80 px high, 24 px side padding), then a mobile-only second row (< 768 px) with the compact search and the as-of date button, then `main` (scrolls independently, background `#f5f7fb`) containing a centred container (max width 1 500 px, padding 12 px, 16 px from 1024 px) that holds the active screen. **[O]**
5. Overlays are rendered by the screens, not by the shell (drawers, dialogs, popovers); the shell owns only the navigation sheet, the search popover, the bell menu, the profile menu and the toaster. **[O]**

##### Elements

| # | Element | Type | Content / behaviour | Data source (current → target) | Label |
| --- | --- | --- | --- | --- | --- |
| 1 | Sidebar brand block | image / initial | Expanded: logo image (`ORG_LOGO_PATH`, `alt` = `ORG_NAME`, height 36 px, max width 140 px). Collapsed: 36 px rounded square, background `#1e293b`, first letter of `ORG_NAME` in white bold. 80 px high block with bottom border. Not rendered inside the mobile sheet. | Build-time env `NEXT_PUBLIC_ORGANIZATION_LOGO` / `NEXT_PUBLIC_ORGANIZATION_NAME` → same | [O] |
| 2 | Nav item *Dashboard* | link (icon LayoutDashboard) | `/lp-portal`. Active only when `pathname === "/lp-portal"` exactly. | Static | [O] |
| 3 | Nav group *My Investments* | expander button (icon WalletCards) | No route. Click toggles the sub-tree; if the sidebar is collapsed the click first expands the sidebar. Initially closed on every page load (state not persisted). The button is highlighted only when `pathname` starts with `/lp-portal/investments`, a path that redirects to `/lp-portal`, so it is never highlighted. | Static; sub-tree from `operatingModel` of the context | [O] |
| 4 | *My Investments* sub-tree, private-capital | link list under heading "Private Capital" (heading shown only when two groups are shown) | *Fund Overview* `/lp-portal`; *Commitment* `/lp-portal#capital-position`; *Capital Calls* `/lp-portal/capital-activity?tab=calls`; *Distributions* `/lp-portal/capital-activity?tab=distributions`; *Capital Account* `/lp-portal/account-activity?structure=private-capital`. | `operatingModel` = `PRIVATE_CAPITAL` (selected fund, or all in-scope funds private) | [O] |
| 5 | *My Investments* sub-tree, open-ended | link list under heading "Open-Ended" | *Fund Overview* `/lp-portal`; *Investor Account* `/lp-portal#open-ended-account`; *Subscriptions* `/lp-portal/subscriptions-redemptions?type=subscriptions`; *Redemptions* `/lp-portal/subscriptions-redemptions?type=redemptions`; *Account Holdings* `/lp-portal/account-activity?structure=open-ended`. | `operatingModel` = `OPEN_ENDED` | [O] |
| 6 | *My Investments* sub-tree, mixed | both groups stacked, headings "Private Capital" then "Open-Ended" | Shown when no fund is selected ("All Funds") and the in-scope funds hold both operating models. A link whose href contains `#` is never shown as active. | `operatingModel` = `MIXED` | [O] |
| 7 | Nav item *Performance* | link (TrendingUp) | `/lp-portal/performance` | Static | [O] |
| 8 | Nav item *Account Activity* | link (Activity) | `/lp-portal/account-activity` | Static | [O] |
| 9 | Nav item *Capital Calls* | link (CircleDollarSign) | `/lp-portal/capital-activity?tab=calls`. Active when the path starts with `/lp-portal/capital-activity` and query `tab` equals `calls`. Shown for every operating model. | Static | [O] |
| 10 | Nav item *Distributions* | link (HandCoins) | `/lp-portal/capital-activity?tab=distributions`. Active when `tab` equals `distributions`. Shown for every operating model. | Static | [O] |
| 11 | Nav item *Subscriptions & Redemptions* | link (Repeat2) | `/lp-portal/subscriptions-redemptions`. Shown for every operating model. | Static | [O] |
| 12 | Nav item *Statements & Reports* | link (ReceiptText) | `/lp-portal/documents?category=Fund%20Reports` | Static | [O] |
| 13 | Nav item *Documents* | link (FolderLock) | `/lp-portal/documents` | Static | [O] |
| 14 | Nav item *Requests* | link (Mail) + count badge | `/lp-portal/requests`. Active when the path starts with `/lp-portal/requests` and query `tab` is not `messages`. Badge = `unreadCounts.requests` when > 0. | `GET /lp-portal/session` → `unreadCounts.requests` (mock 2) | [O] |
| 15 | Nav item *Messages* | link (MessageSquareText) + count badge | `/lp-portal/requests?tab=messages`. Active when query `tab` equals `messages`. Badge = `unreadCounts.messages` when > 0. | `unreadCounts.messages` (mock 2) | [O] |
| 16 | Nav item *Notices* | link (BellRing) + count badge | `/lp-portal/notices`. Badge = `unreadCounts.notices` when > 0. | `unreadCounts.notices` (mock 3) | [O] |
| 17 | Nav item *My Organisation* | link (Building2) | `/lp-portal/organisation` | Static | [O] |
| 18 | Nav item *Settings* | link (Settings) | `/lp-portal/settings` | Static | [O] |
| 19 | Count badge | 17 px circle, background `#075fd8`, white 8 px semibold text | Renders the raw number (no "9+" cap). In the collapsed sidebar it is a 16 px circle pinned to the item's top-right corner. | Context `unreadCounts` | [O] |
| 20 | Collapse control | ghost button, text *Collapse navigation* (hidden when collapsed), `aria-label` "Collapse navigation" / "Expand navigation", chevron icon | Toggles the 206 px / 62 px width (200 ms transition). Collapsed items show only the icon with a native `title` tooltip equal to the label. State is local to the sidebar and resets on reload. Not rendered in the mobile sheet. | Local state | [O] |
| 21 | Mobile menu button | icon button, `aria-label` "Open portal navigation" | Visible below 1024 px. Opens a left sheet 288 px wide (max 288 px) with an sr-only title "LP Portal navigation", a close button (`aria-label` "Close navigation") at top right, and the sidebar in `mobile` mode (full width, never collapsed, no brand block, no collapse control). Selecting any link closes the sheet. | Local state | [O] |
| 22 | Mobile brand link | image link, `aria-label` "Matanho home" | Logo (height 40 px) shown below 1024 px, linking to `/home`. | Static | [O] |
| 23 | Topbar identity block | two-line text, visible from 640 px | Line 1 "LP Portal" (bold 12 px); line 2 `client.legalName` from the LP session, or "LP Portal" until the session loads. | `GET /lp-portal/session` → `client.legalName` (mock "Horizon Pension Fund LP") | [O] |
| 24 | Global search | search input in a popover (visible from 768 px; the compact copy is in the second row below 768 px) | `type="search"`, `aria-label` "Search investor portal", placeholder "Search funds, documents, pages..." (compact: "Search portal..."), magnifier icon at the right, pill shape. Focus or typing opens the result popover (width = input width). Details in Business rules. | Page list (static) + `GET /lp-portal/documents?q=&pageSize=5` | [O] |
| 25 | Search result row | button: round blue icon, bold label, grey detail | Click navigates (`router.push`), closes the popover and clears the query. *Enter* in the input navigates to the first result. | See rule | [O] |
| 26 | Search empty text | paragraph "No matching results" | Shown when the filtered result list is empty. | Derived | [O] |
| 27 | Fund selector | select (pill, 128 px, 150 px from 640 px), building icon, placeholder "Select fund" | Options: *All Funds* (value `all`), then one option per entitled fund showing `shortName`. Default `all`. Changing it re-scopes every screen (`fundId` query parameter), the sidebar sub-tree, the as-of date and the valuation chip. | `GET /lp-portal/session` → `funds[]` (mock: *Growth Fund I*, *Equity Opportunities*) | [O] |
| 28 | As-of date control | label with a transparent native `<input type="date">` stretched over it (visible from 768 px) | Label text "As of", the date formatted `MMM d, yyyy` in en-US (e.g. "Jun 30, 2026"), or "—" when empty, plus a calendar icon. `aria-label` "Valuation as-of date". The input has no `min`, `max` or step. Changing it sets the context `asOfDate`. Below 768 px a 36 px round calendar button with an sr-only date input in the second row does the same. | Context `asOfDate` ← session `defaultAsOfDate` or selected fund `asOfDate` | [O] |
| 29 | Valuation status chip | pill (visible from 1024 px) | Small caps label "Valuation" and the raw status string (e.g. "FINAL") with a 6 px emerald dot. The dot is always emerald for every status. Not shown below 1024 px. | `selectedFund.valuationStatus` ?? session `defaultValuationStatus` ?? "FINAL" | [O] |
| 30 | Alerts bell | ghost icon button, `aria-label` "{n} portal items need attention" | Red badge shows `unreadCounts.requests + unreadCounts.messages + unreadCounts.notices` (`unreadCounts.notifications` is not included), "9+" when above 9, hidden when 0. Opens the alerts menu. | Context `unreadCounts` | [O] |
| 31 | Alerts menu | dropdown, 288 px, right aligned | Header "Portal alerts" with "{n} open" (blue 10 px) when the total > 0. Body states in Business rules. Footer item *View all notices* → `/lp-portal/notices`. | `GET /lp-portal/notifications?limit=5` | [O] |
| 32 | Alert row | menu link: bold title, grey line "{fundName} · {MMM d, yyyy, h:mm AM/PM}" | Navigates to the item's `href`. The `read` and `type` fields are ignored; there is no unread styling and no mark-as-read call. | `LpNotificationItem` | [O] |
| 33 | Profile trigger | 40 px avatar with initials | Initials from the signed-in user's name (first letter of the first and last word, upper case; "U" if empty). | `GET /api/auth/me` → `user.name` | [O] |
| 34 | Profile menu header | avatar + name + role | Name = `user.name` (default "Investor"); role = label of the first role whose `portal` is `investor` (default "Investor portal"), capitalised by CSS. | `GET /api/auth/me` → `user.roles[]` | [O] |
| 35 | Profile menu item *Profile* | link | `/lp-portal/organisation` | Static | [O] |
| 36 | Profile menu item *Settings* | link | `/lp-portal/settings` | Static | [O] |
| 37 | Profile menu item *Sign Out* | destructive menu item, preceded by a separator | Rendered only when a session user was loaded. Click → `POST /api/auth/logout` (errors ignored) then `window.location.assign('/login')`. | `@matanho/portal-kit/session` → API | [O] |
| 38 | Toaster | sonner, top-right | All success / error messages of the portal screens. Default sonner duration. | Library | [O] |

##### Tables

None.

##### Inputs & validation

| Field | Control | Required | Options / default / placeholder | Validation today (code) | Target validation | Error message |
| --- | --- | --- | --- | --- | --- | --- |
| Fund selector | select | n/a | *All Funds* + entitled funds; default `all`; placeholder "Select fund" | Any value among the options; the value is not checked against the session | The selected `fundId` must be sent to the API on every call and revalidated server-side against the user's fund entitlements | — |
| As-of date | `<input type="date">` | n/a | Default = selected fund's `asOfDate`, else session `defaultAsOfDate` | None: any date, past or future, or empty is accepted; empty shows "—" and the API is called without `asOfDate` | FR-LP-001: the as-of date is limited to dates that have an approved valuation snapshot, no later than the latest approved `asOfDate` — AC: a future or unsnapshotted date shows an inline message and is not sent | none today |
| Global search | search input | n/a | Placeholder "Search funds, documents, pages..." | Trimmed; empty query shows the first 4 pages; document search debounced 300 ms; failures swallowed | Minimum 2 characters before the document search; server-side entitlement filtering | "No matching results" |

##### Actions

| Control | Enabled when | Permission | Effect (state change, toast text, navigation) | Wiring / API | Label |
| --- | --- | --- | --- | --- | --- |
| Nav link | Always | None in the UI. Target: each destination needs its own LP permission (see ROLES & PERMISSIONS) | Client-side navigation; on the mobile sheet the sheet closes. | None | [O] |
| *My Investments* expander | Always | None | Toggles the sub-tree; expands a collapsed sidebar first. | None | [O] |
| *Collapse navigation* | Desktop only | None | Toggles collapsed state; no toast; not persisted. | None | [O] |
| Fund selector change | Session loaded | None | `selectedFundId` = value; the effect then sets `asOfDate` to the fund's `asOfDate` (or session default for *All Funds*), overwriting any date the user picked. | None (context) | [O] |
| As-of date change | Always | None | `asOfDate` = chosen date (string `YYYY-MM-DD`); every `useLpFundScope` consumer refetches with `asOfDate`. | Query param `asOfDate` on dashboard, performance, account activity | [O] |
| Search typing | Always | None | Opens the popover; after 300 ms calls `getDocuments({ q, pageSize: 5 })`. | `GET /lp-portal/documents` (target) | [O] |
| Search result / Enter | Results non-empty | None | Navigates; clears the query; closes the popover. Document hits go to `/lp-portal/documents?document={id}`. | None | [O] |
| Bell | Always | None | Opens the alerts menu; does not refetch on open. | None | [O] |
| Alert row | Item has `href` | None | Navigates to `href`; the alert is not marked read. | None | [O] |
| *View all notices* | Always | None | Navigates to `/lp-portal/notices`. | None | [O] |
| *Profile* / *Settings* | Always | None | Navigates to `/lp-portal/organisation` / `/lp-portal/settings`. | None | [O] |
| *Sign Out* | A session user exists | Any signed-in user | Ends the API session and goes to `/login`. No confirmation dialog, no toast. The LP context is discarded with the page. | `POST /api/auth/logout` | [O] |

##### Modals & drawers

**Sheet — Portal navigation (below 1024 px).** Left sheet, 288 px; sr-only title "LP Portal navigation"; close button "Close navigation"; body = sidebar in mobile mode (rows 2 to 18). Closes on link selection, on the close button, on the overlay click and on Escape (Radix dialog behaviour). **[O]**

**Popover — Search results.** Anchored to the search input; see rows 24 to 26. Closes on selection, outside click and Escape. **[O]**

**Menu — Portal alerts.** See rows 30 to 32. **[O]**

**Menu — Profile.** See rows 33 to 37. **[O]**

##### States

- Empty:
  - Search: "No matching results". Bell: no notifications and total 0 → disabled row "No open portal alerts". Sidebar badges: hidden at 0. **[O]**
  - Funds list empty (no entitlement): the selector shows only *All Funds*; the sidebar sub-tree falls back to the open-ended list because `operatingModel` is `MIXED` only when two models exist and the fallback for an empty list is `MIXED` (both groups are shown). **[O]** Q-89: what should a user with zero fund entitlements see? — default: a full-page "No funds are linked to your account" empty state and no navigation other than *Settings*, *Requests* and *Notices*.
- Loading:
  - Session: no loading UI. The context starts with `client = null`, `funds = []`, counts 0, `asOfDate = ""` (shown as "—"), `valuationStatus = "FINAL"`, `presentationCurrency = "USD"`; the screens render against these defaults until the session resolves. **[O]**
  - Alerts: while `getNotifications` is pending the menu shows a disabled row "Loading alerts…". **[O]**
- Error:
  - Session failure sets `sessionError` and clears the session, but no component renders `sessionError` or `sessionLoading`. The shell silently shows the empty defaults. **DEF-319** a failed session load is invisible. **[O]**
  - Notification failure is swallowed and the list becomes empty (falls back to the unread-count rows). **[O]**
  - Document-search failure is swallowed (no document rows). **[O]**
- Disabled / read-only:
  - Sign Out is omitted when `GET /api/auth/me` has not returned a user. **[O]**
  - Hover-only tooltips in the collapsed sidebar use the native `title` attribute. **[O]**
- Conditional:
  - Sidebar sub-tree by `operatingModel` (rows 4 to 6). Valuation chip hidden below 1024 px; as-of label hidden below 768 px (replaced by the second-row button); identity block hidden below 640 px.

##### Business rules & calculations

- **Session bootstrap.** On mount the provider calls `getSession`; on success it stores the session and sets `asOfDate` to `defaultAsOfDate` only if it is still empty; once a session exists it calls `getNotifications(5)`. **[O]**
- **Fund scope.** `selectedFundId` is `"all"` or a fund id. `useLpFundScope()` returns `fundId = undefined` for `"all"`, plus `asOfDate` and `presentationCurrency`; every list/dashboard call receives these as query parameters. **[O]**
- **As-of precedence.** Whenever `selectedFund` or `session.defaultAsOfDate` changes, `asOfDate` is reset to `selectedFund.asOfDate` (a fund selected) or `session.defaultAsOfDate` (All Funds). A user-picked date therefore survives only until the next fund change. The Settings preference `defaultAsOfPreference` is not read by the shell. **[O]**
- **Valuation status.** `valuationStatus` = selected fund's status, else session `defaultValuationStatus`, else "FINAL". Vocabulary in the UI types: `ESTIMATED`, `PROVISIONAL`, `FINAL`, `RESTATED`. The chip does not react to the chosen as-of date. **[O]** BR-078: every monetary figure on every screen carries the as-of date and valuation status of the snapshot it was read from; PROVISIONAL, ESTIMATED and RESTATED must be visually distinct from FINAL (amber, amber, purple) and may never be shown without the label.
- **Operating model.** `operatingModel` = selected fund's model; for "All Funds": the single model when all funds share it, `MIXED` when both exist, `MIXED` when there are no funds. The sidebar sub-tree and the dashboard panels branch on it. **[O]**
- **Presentation currency.** `presentationCurrency` = session value (default "USD"); it is passed as `presentationCurrency` to the dashboard only. It is display-only (BR-018 applies to conversion rate source). **[O]**
- **Unread counts.** The session returns counts as strings; the provider coerces each of `requests`, `messages`, `notices`, `notifications` to a number (`Number(x) || 0`). Also, `lpPortalApi` coerces the keys `page, pageSize, total, totalPages, count, unreadCount, investmentCount, portfolioCompanyCount, newThisWeek, requiresSignature, secureDownloadsYtd, openCount, paidCallCount, dueSoonCount` from numeric strings to numbers in every non-blob response; money, units, rates and multiples stay decimal strings. **[O]**
- **Bell total.** `requests + messages + notices` (not `notifications`). The menu lists the latest 5 notifications; if the list is empty but the total is above 0 it falls back to up to three summary rows (*Open requests* "{n} awaiting action", *Unread messages* "{n} new", *Notices* "{n} unread"). **[O]**
- **Search.** Page list (label, detail → href): *Dashboard* "Portfolio overview" → `/lp-portal`; *Capital Activity* "Calls and distributions" → `/lp-portal/capital-activity`; *Performance* "Investment value history" → `/lp-portal/performance`; *Documents* "Reports and notices" → `/lp-portal/documents`; *Account Activity* "Transactions and statements" → `/lp-portal/account-activity`; *Requests* "Open investor requests" → `/lp-portal/requests`. Empty query shows the first four. A term (trimmed, lower-cased) filters pages whose "label detail" text contains it, then appends up to 5 document hits (title, category label), and the combined list is cut to 6 rows. Funds are not searched. **[O]**
- **Refresh keys.** `bumpRefresh(scope | scope[])` increments a per-scope counter (`dashboard, capital, performance, dealing, activity, documents, notices, requests, messages, organisation, settings, notifications`); the data hooks list the counter in their dependency array, so a bump re-runs the query. Screens call it after mutations; realtime handlers call it on events. **[O]**
- **Realtime.** The provider subscribes, once a session exists, to: `lp_notification` (refetch notifications and session), `lp_notice_updated` (bump notices, notifications, dashboard; refetch notifications), `lp_request_created` (bump requests, notifications; refetch notifications), `lp_request_updated` (bump requests), `lp_request_message` (bump requests, messages), `lp_thread_message` (bump messages, notifications), `lp_thread_read` (bump messages), `lp_thread_updated` (bump messages), and calls `joinLpPortalOrg()`. Today every function in `realtime.ts` is a no-op, so nothing is ever delivered; the contract endpoint `GET /lp-portal/realtime` (`{ enabled, wsUrl?, namespace?, events?, pollingIntervalMs? }`) is defined but not called, and no polling exists. **[O]** The design source specifies Socket.IO v4 with rooms `user:{userId}` and `lp_portal:{clientId}` and per-record rooms `lp_request:{reference}`, `lp_thread:{id}`. **[I]**
- **Number and date formats.** Money `Intl.NumberFormat('en-US', currency, 2 dp)`; compact money "$1.23B" / "$1.23M" / "$1.2K" (the `$` sign is hard-coded, whatever the currency); percentage input is a decimal fraction (|x| ≤ 1 and no "%" sign) multiplied by 100, otherwise used as is, 1 dp; multiples "{x.xx}x"; units 2 dp en-US; dates "MMM d, yyyy"; datetime "MMM d, yyyy, h:mm AM/PM"; invalid or empty date "—"; file size B / KB / MB (1 dp) and "—" for ≤ 0. Idempotency keys: `crypto.randomUUID()`, fallback `idem-{epoch ms}-{random base36 10}`, sent as header `Idempotency-Key`. Date-only strings are parsed as local midnight (`YYYY-MM-DDT00:00:00`). **[O]**
- **Download helper.** Blob responses are saved through a temporary anchor with `download` = file name and the object URL revoked afterwards. **[O]**
- **Branding.** `ORG_NAME`, `ORG_LOGO_PATH` and `IS_CUSTOM_BRAND` come from build-time variables so the same build serves the Nexus and the client-branded deployments. **[O]**
- **Deep links and legacy redirects.** `next.config.ts` redirects (307): `/` → `/lp-portal`; `/lp-portal/capital-calls` → `/lp-portal/capital-activity?tab=calls`; `/distributions` → `?tab=distributions`; `/dealing` → `/subscriptions-redemptions`; `/vault` → `/documents`; `/ledger` → `/account-activity`; `/messages` → `/requests?tab=messages`; `/colleagues` → `/organisation`; `/reports` → `/documents?category=Fund%20Reports`; `/investments/commitment` → `/lp-portal#capital-position`; `/investments/capital-account` → `/account-activity?structure=private-capital`; `/investments/investor-account` → `/lp-portal#open-ended-account`; `/investments/holdings` → `/account-activity?structure=open-ended`; `/investments` → `/lp-portal`. Query parameters read by the routes: Capital Activity `tab` (`distributions` else `calls`) and `call`; Subscriptions & Redemptions `type` (`subscriptions` | `redemptions`) and `request`; Account Activity `structure` and `entry`; Documents `category` and `document`; Notices `id`; Requests `tab` (`messages` else `requests`) and `ref`. `resolveLpLinkedRecordHref(relatedType, relatedId)` builds links for message and activity records: NOTICE → `notices?id=`, CAPITAL+CALL → `capital-activity?call=`, DISTRIBUTION → `capital-activity?tab=distributions`, DOCUMENT → `documents?document=`, REQUEST or "SR-" prefix → `requests?ref=`, SUBSCRIPTION/REDEMPTION/DEALING → `subscriptions-redemptions?request=`, LEDGER/TRANSACTION/ACTIVITY → `account-activity?entry=`; otherwise `null`. **[O]**
- **Sign-in screens.** `/login`, `/invite`, `/reset-password` are the shared portal-kit pages with `portal="investor"` under `AuthRootLayout`, title "Sign in | Matanho LP Portal"; they are specified in the shared authentication section. **[O]**

##### Edge cases

- Fund selector value is not reset when the session reloads; if the entitlement of the selected fund disappears the selector shows an empty value while `selectedFund` is `null`, so the shell behaves as "All Funds" for the as-of date but still sends the stale `fundId`. **[O]** (derived from the code paths)
- A user who holds an investor role but whose LP session lists no funds still passes the route gate.
- Collapsing the sidebar while *My Investments* is open hides the sub-tree but keeps `investmentsOpen` true; expanding again shows it open.
- Two nav items point to the Documents route (*Statements & Reports* with `?category=Fund%20Reports`, *Documents* without a query) and the active-state rule ignores the `category` query, so both items are highlighted on `/lp-portal/documents`. **[O]**
- On `/lp-portal/capital-activity` without a `tab` parameter the page opens the Calls tab, but neither *Capital Calls* nor *Distributions* is highlighted because the rule requires an explicit `tab`. **[O]**
- The profile name and role come from the Nexus session while the organisation line and all data come from the LP session; with the demo data a real signed-in user is shown above "Horizon Pension Fund LP". **[O]**
- A pasted URL with an unknown `?tab=` value falls back to the default tab silently. **[O]**

##### Gaps, defects & open questions

- **DEF-320** the mobile logo links to `/home`, which is not a route of this portal (404).
- **DEF-321** notification hrefs in the demo data use `/lp-portal/requests?thread=…` and `/lp-portal/documents?doc=…`; the routes read `ref` and `document`, so those two alerts open the screen without selecting the record.
- **DEF-322** `sessionError` and `sessionLoading` are never rendered; a failed session leaves an apparently empty portal with "As of —".
- **DEF-323** the valuation-status dot is always green; PROVISIONAL, ESTIMATED and RESTATED are not visually distinguished.
- **DEF-324** the as-of date is overwritten by the fund's `asOfDate` whenever the fund changes, and the Settings preference `defaultAsOfPreference` is ignored by the shell.
- **DEF-325** the search placeholder promises fund search, but only pages and documents are searched; the document search sends no `fundId`.
- **DEF-326** the per-domain data-source switch (`LP_LIVE_DOMAINS`, `LP_METHOD_DOMAIN`, `isLpDomainLive`) is not consulted by the `lpPortalApi` Proxy; flipping a flag does nothing. The stub `apiClient` rejects every call with "LP portal is running on demo data; {METHOD} {url} is not available."
- **DEF-327** the compact money formatter hard-codes "$" regardless of currency.
- FR-LP-002: the LP session (`GET /lp-portal/session`) is derived from the signed-in Nexus user (`client_users` membership → client, LP role, entitled funds, unread counts), never from a constant — AC: two users of two clients receive disjoint `client` and `funds`; a user with no membership receives 403 `no_client_access` and the shell shows an access-denied page.
- FR-LP-003: show a full-width error banner with a *Retry* action when the session load fails, and a skeleton while it loads — AC: with the API stopped the shell shows "Unable to load your portal session" and *Retry* refetches.
- FR-LP-004: a user who belongs to several clients (Q-23) gets a client switcher in the identity block; the selected client is sent as `?client=`/header and revalidated on the server — AC: switching client reloads every screen with disjoint data.
- FR-LP-005: persist sidebar collapsed state and last selected fund per user (browser storage or `display` settings) — AC: after reload the same fund is selected.
- FR-LP-006: realtime or polling — the shell refreshes `unreadCounts` and notifications at least every `pollingIntervalMs` (default 30 000 ms) when the tab is visible — AC: a staff reply raises the *Messages* badge within 30 s without reload.
- BR-079: fund, share class and as-of parameters sent by the browser are advisory; the API recomputes the allowed set from the user's entitlements and returns a generic 404 for anything outside it.
- Q-90: Is the LP-role badge (viewer, authorised signatory, administrator) shown in the profile menu? — default: yes, "Viewer", "Authorised signatory" or "Administrator" under the user name, replacing the Nexus investor-role label.
- Q-91: Does the notification bell total include `unreadCounts.notifications`? — default: the badge shows `unreadCounts.notifications` (items in the list) and the sidebar badges keep their own counts.
- Q-92: Which realtime transport does Nexus provide (Socket.IO as in the source product, Server-Sent Events, or polling)? — default: polling every 30 s until a transport exists.

#### 5.B.1 Dashboard (`/lp-portal`, `lp.dashboard.view`)

| Attribute | Value |
| --- | --- |
| Purpose | Landing screen of the LP portal. Answers "what is my position and what needs my attention?" for the signed-in investor organisation: six headline KPIs, value history, open-ended account summary, capital position, recent capital activity, actions required and the latest documents. **[O]** |
| Access | The Next.js route gate of the investor portal (`createPortalProxy('investor', { requirePortalRole: true })`) decides who reaches the page. **[O]** The page itself has no permission, `lpRole` or entitlement check: every signed-in user sees every tile and link. **[O]** Target: the API enforces `lp.dashboard.view` (KPIs, actions), `lp.performance.view` (history), `lp.activity.view` (recent activity) and `lp.documents.view` (documents). All three LP roles (*VIEWER*, *SIGNATORY*, *MANAGER*) hold all four permissions. **[I]** Funds are filtered through the investor-to-fund entitlement; a fund outside the entitlement answers 403/404. **[I]** |
| Prototype layer | Native React: `components/lp-portal/screens/lp-portal-dashboard-screen.tsx` in `portals/investor-web`, fed by `lib/lp-portal/hooks.ts` (`useLpDashboardBundle`), `mappers.ts`, `format.ts`, and the demo layer `lib/lp-portal/mock-api.ts` + `mock-store.ts` reached through `lib/api/lp-portal-api.ts`. The screen is the unmodified UI imported from the NVCCZ ("Arcus") LP portal. **[O]** |
| Wiring status | Prototype for every element. The `lpPortalApi` proxy answers every method from the in-memory mock store, all data domains are switched to mock (`LP_LIVE_DOMAINS` all false) and the HTTP client is a stub. Target calls are named per element. **[O]** |
| Entry points | Sidebar *Dashboard* and the sidebar logo (`/lp-portal`); sidebar investments group item *Fund Overview*; sidebar *Commitment* (`/lp-portal#capital-position`) and *Investor Account* (`/lp-portal#open-ended-account`); site root `/` (redirect); `/lp-portal/investments` and its sub-paths (redirects, see Exit points); topbar search result *Dashboard*; links from other screens that point at `/lp-portal`; the `Total Commitment` helper link. **[O]** |
| Exit points | *View Performance* (`/lp-portal/performance`); *View Account Details* (`/lp-portal/account-activity?structure=open-ended`); *View Capital Summary* (`/lp-portal/capital-activity`); *View All* and *View All Activity* of Recent Capital Activity (`/lp-portal/account-activity`); every recent-activity row (`/lp-portal/capital-activity`); *View All* of Actions Required (`/lp-portal/requests`); every action row (the action's own `href`); *View All* of Latest Documents & Notices (`/lp-portal/notices`); document rows (`/lp-portal/documents` or `/lp-portal/notices`); the `Total Commitment` helper link (`/lp-portal/investments`, which redirects back to `/lp-portal`); all sidebar and topbar destinations. **[O]** |

##### Layout

All regions are inside the shell (sidebar, topbar with fund selector, as-of date and valuation chip; see 5.B.0). Content width is at most 1 500 px. **[O]**

1. Page header: title and one-line subtitle. **[O]**
2. KPI strip: six tiles (grid of 2 columns, 3 columns from 768 px, 6 columns from 1 280 px): *Total Commitment*, *Paid-In Capital*, *Unfunded Commitment*, *Current NAV*, *Distributions*, *Net IRR*. **[O]**
3. Row 2 (from 1 280 px: two columns, 2 fr and 1 fr): left *Investment Value History* panel; right *Open-Ended / Hedge Fund Account* panel, present only when the payload carries an open-ended summary. Without it the history panel keeps its 2 fr width and the right cell stays empty. **[O]**
4. Row 3 (from 1 280 px: three equal columns): *Capital Position* panel; *Recent Capital Activity* panel; a right column with two stacked panels, *Actions Required* above *Latest Documents & Notices*. **[O]**
5. Below 1 280 px all panels stack in the order above. **[O]**
6. There are no tabs. The only in-page control is the period toggle of the history panel. **[O]**

##### Elements

| # | Element | Type | Content / behaviour | Data source (current → target) | Label |
|---|---|---|---|---|---|
| 1 | Page title | `h1`, 24 px bold | With a fund selected: the fund's short name (for example *Growth Fund I*). With *All Funds*: *Dashboard*. | Context `selectedFund` → session `funds[].shortName` from `GET /lp-portal/session` | [O] |
| 2 | Page subtitle | text, 13 px grey | Fund selected: *Overview of your investment in {fund full name}*. All funds: *Overview of your investments and accounts*. | Context → session | [O] |
| 3 | KPI tile *Total Commitment* | tile | Value = compact money of `kpis.totalCommitment`. Helper line (blue, 12 px, a link) = `{investmentCount} Commitment` when the count is 1, otherwise `{investmentCount} Commitments`. The link goes to `/lp-portal/investments`, which redirects to this page (no effect). Icon: gauge, blue. | Mock dashboard → `lpPortalApi.getDashboard` `GET /lp-portal/dashboard?fundId&asOfDate&presentationCurrency` → `data.kpis.totalCommitment`, `data.kpis.investmentCount` | [O] |
| 4 | KPI tile *Paid-In Capital* | tile | Value = compact money of `kpis.paidIn`. Helper = `{paidIn ÷ totalCommitment × 100, 1 decimal}% of Commitment`, or *—* when the commitment is 0 or less. Icon: crosshair, blue. | same call → `kpis.paidIn` | [O] |
| 5 | KPI tile *Unfunded Commitment* | tile | Value = compact money of `kpis.unfunded`. Helper = `{unfunded ÷ totalCommitment × 100, 1 decimal}% of Commitment`, or *—* when the commitment is 0 or less. Icon: file-plus, blue. | same call → `kpis.unfunded` | [O] |
| 6 | KPI tile *Current NAV* | tile | Value = compact money of `kpis.currentNav`. Helper = `{tvpi, 2 decimals}x TVPI · {rvpi, 2 decimals}x RVPI`. Icon: circle-dollar, purple. | same call → `kpis.currentNav`, `kpis.tvpi`, `kpis.rvpi` | [O] |
| 7 | KPI tile *Distributions* | tile | Value = compact money of `kpis.distributions`. Helper = `{dpi, 2 decimals}x DPI`. Icon: trending-up, orange. | same call → `kpis.distributions`, `kpis.dpi` | [O] |
| 8 | KPI tile *Net IRR* | tile | Value = percent of `kpis.netIrr`, 1 decimal. Helper = static text *Since Inception*. Icon: dollar, teal. | same call → `kpis.netIrr` | [O] |
| 9 | KPI info button (one per tile) | 16 px icon button | `aria-label` = *{tile label} information*. Native `title` = the tile label. No click behaviour, no popover and no formula text. | Static | [O] |
| 10 | Tile label | text, 13 px | The tile label sits under the icon row so it uses the full tile width. | Static | [O] |
| 11 | Panel *Investment Value History* title | `h2` 14 px + info button | Info button `aria-label` *Investment value history information*, `title` *Investment Value History*, no behaviour. | Static | [O] |
| 12 | History subtitle | text, 11 px | `Since Inception • As of {as-of date, e.g. Jun 30, 2026} • Valuation: {valuationStatus}`. *Since Inception* is static text and does not follow the toggle. The as-of date is the shell as-of date, not the response `asOfDate`. The status is bold, with no colour coding; default *FINAL* when the payload has none. | Context as-of; `data.valuationStatus` → `GET /lp-portal/dashboard` | [O] |
| 13 | Period toggle | pill group, four buttons | *Since Inception* (default), *3Y*, *1Y*, *YTD*. Active button: blue border and light-blue fill. Client-side only (see Business rules). | Local state | [O] |
| 14 | History legend | static legend | Solid dark-blue line *NAV*; dashed light-blue line *Paid-In Capital*. | Static | [O] |
| 15 | History chart | combined area and line chart, 250 px high | Series: NAV (area with a vertical gradient plus a 2.25 px dark-blue line, colour `#1d4ed8`) and Paid-In Capital (1.75 px dashed sky-blue line, `#38bdf8`). No data dots; an active dot appears on hover. X axis: the point `label` (for example *Jun 2025*), 10 px grey, no axis or tick lines; ticks thinned to every `max(1, floor(points ÷ 10))`-th label. Y axis: from 0 to a "nice" maximum (see Business rules), six ticks, labels *$0* or *$nM* (trailing zeros trimmed to 3 significant digits, for example *$1M*, *$2.5M*), always in dollars and millions whatever the presentation currency. Horizontal grid lines only. | Mock history → `lpPortalApi.getPerformanceHistory` `GET /lp-portal/performance/history?fundId&period=SI` → `data.points[]` `{date,label,nav,paidIn,distributions}` | [O] |
| 16 | History end-of-line value labels | two pills | At the last visible point only: a 62 × 20 px pill to the right of the point showing `$x.xxM` (2 decimals). NAV pill: dark blue with white text. Paid-In pill: light blue with dark-blue text. No collision handling. | same | [O] |
| 17 | History tooltip | hover card | Header = the point label. Rows: *NAV* and *Paid-In Capital* with `$x.xxM`. The unlabelled area series may add a second NAV row (not verified in a browser). | same | [O] |
| 18 | Link *View Performance* | text link with arrow | Goes to `/lp-portal/performance`. | Static | [O] |
| 19 | Panel *Open-Ended / Hedge Fund Account* | panel, anchor `#open-ended-account`, min height 318 px | Rendered only when `data.openEndedSummary` is present. Title followed by a decorative circled *i* (not a button). Right-aligned `As of {as-of date}`. | `data.openEndedSummary` → `GET /lp-portal/dashboard` | [O] |
| 20 | Open-ended stat *Account Value* | stat, 17 px | Compact money of `openEndedSummary.accountValue`. | same | [O] |
| 21 | Open-ended stat *Units Held* | stat, 15 px | `openEndedSummary.unitsHeld` with 2 decimals and thousands separators (source has 4 decimals, for example 184 233.4821 shows as *184,233.48*). | same | [O] |
| 22 | Open-ended stat *NAV Per Unit* | stat, 15 px | `openEndedSummary.navPerUnit` as full currency, 2 decimals (15.4448 shows as *$15.44*). | same | [O] |
| 23 | Open-ended NAV-per-unit chart | area and line chart, 168 px | Shown only when `openEndedHistory.points` is non-empty. X = point label, 9 px, first and last label always shown. Y = auto domain, labels `$x.xx`. Blue line `#2563eb` 2 px on a `#dbeafe` area. Tooltip: *NAV Per Unit* with full currency 2 decimals. | `data.openEndedHistory.points[]` `{label,navPerUnit,date?}` → `GET /lp-portal/dashboard` | [O] |
| 24 | Open-ended fallback text | centred text | When there are no history points the chart box shows `YTD Return: {percent}`. | `openEndedSummary.ytdReturn` | [O] |
| 25 | Open-ended YTD line | text, 10 px | `YTD Return: {ytdReturn percent, 1 decimal}` below the chart. Shown in addition to the fallback text, so with no history the same line appears twice. | same | [O] |
| 26 | Link *View Account Details* | text link | Goes to `/lp-portal/account-activity?structure=open-ended`. | Static | [O] |
| 27 | Panel *Capital Position* | panel, anchor `#capital-position` | Title with an info button (`aria-label` *Capital position information*, `title` *Capital Position*, no behaviour). Subtitle `As of {as-of date}`. | `data.kpis` → `GET /lp-portal/dashboard` | [O] |
| 28 | Capital Position donut | ring chart, 148 × 148 px | Inner radius 48, outer radius 68, 1.5° gap, white 2 px separators, starts at 12 o'clock and runs clockwise. One slice per legend entry (see Tables). Tooltip: slice name and `$x.xxM`. | derived from KPIs | [O] |
| 29 | Donut centre text | text | *Total Commitment* (10 px) over the compact money of `kpis.totalCommitment` (16 px bold). | `kpis.totalCommitment` | [O] |
| 30 | Capital Position legend | list of buttons | One entry per slice: coloured dot, name, `{compact money} ({percent of commitment})`. Entries are `button` elements with `title` = `{name}: {amount}`, hover shading and no click behaviour. | derived | [O] |
| 31 | Link *View Capital Summary* | text link | Goes to `/lp-portal/capital-activity`. | Static | [O] |
| 32 | Panel *Recent Capital Activity* | panel, min height 288 px | Title with decorative *i*; header link *View All* (`/lp-portal/account-activity`). Rows: see Tables. | Mock → `lpPortalApi.getDashboardRecentActivity(10)` `GET /lp-portal/dashboard/activity/recent?limit=10` | [O] |
| 33 | Link *View All Activity* | text link | Bottom of the Recent Capital Activity panel, `/lp-portal/account-activity`. | Static | [O] |
| 34 | Panel *Actions Required* | panel | Title with decorative *i*, a red circular count badge, header link *View All* (`/lp-portal/requests`). The badge shows the number of action items and is shown even when it is 0. Rows: see Tables. | Mock → `lpPortalApi.getDashboardActions()` `GET /lp-portal/dashboard/actions` | [O] |
| 35 | Panel *Latest Documents & Notices* | panel, anchor `#notices` | Title with decorative *i*, header link *View All* (`/lp-portal/notices`). Rows: see Tables. Only documents are loaded; no notices are fetched. | Mock → `lpPortalApi.getDocuments({fundId, pageSize:3})` `GET /lp-portal/documents?fundId&pageSize=3` | [O] |
| 36 | Document download button | 32 px ghost icon button per document row | Blue download icon, `aria-label` *Download {document title}*. | `lpPortalApi.downloadDocument(id)` `GET /lp-portal/documents/{id}/download` (blob) | [O] |
| 37 | Valuation status disclosure on the KPI strip | label | None today: the six KPI tiles carry no as-of date or valuation status; only the history subtitle and the shell show them. Target: the KPI strip shows the as-of date and valuation status of the figures. | — | [O] / [P] |
| 38 | Snapshot metadata | — | Not shown. The dashboard payload carries `asOfDate` and `valuationStatus` only; the screen ignores the response `asOfDate`. | `data.asOfDate` | [O] |

##### Tables

None of the three lists is a data table (no header row, no sorting, no filter, no search, no pagination). Each is a vertical list of link rows.

**Capital Position legend (panel 27)** — slices are computed in the browser from `kpis`; amounts are raw amounts, shares are relative to `totalCommitment`.

| Slice | Colour | Amount (display) | Share shown | Present when |
| --- | --- | --- | --- | --- |
| *Paid-In Capital* | `#1a56db` | compact money of `paidIn` | `paidIn ÷ totalCommitment`, 1 decimal | always |
| *Called, Not Yet Paid* | `#f59e0b` | compact money of `outstandingCalled` | `outstandingCalled ÷ totalCommitment` | only when `outstandingCalled` is above 0 |
| *Unfunded Commitment* | `#2dd4bf` | compact money of `unfunded` | `unfunded ÷ totalCommitment` | always |
| *Distributed* | `#bfdbfe` | compact money of `distributions` | `distributions ÷ totalCommitment` | always |
| *Remaining Value* | `#9ca3af` | compact money of `max(currentNav − distributions, 0)` | same basis | always |

- The share is *—* when `totalCommitment` is 0 or less. **[O]**
- The slices are not a partition of the commitment. In the demo data (commitment 5.00M) the shares are 75.0 %, 22.0 %, 36.4 % and 52.0 % (sum 185.4 %). The *Called, Not Yet Paid* slice never appears in the demo because the demo KPIs carry no `outstandingCalled`. **[O]**
- Row click: none. **[O]**

**Recent Capital Activity (panel 32)**

| Column (position in row) | Format | Sortable | Notes |
| --- | --- | --- | --- |
| Direction icon (left) | 28 px circle | No | Item type contains *DISTRIBUTION* → green circle, up-right arrow; any other type → light-blue circle, down arrow. |
| Type (top line) | Item `type` with underscores replaced by spaces, Title Case (*CAPITAL_CALL* → *Capital Call*) | No | The item `title` (for example *Capital Call CC-013 issued*) and `status` are fetched but not displayed. |
| Fund (second line) | Fund name looked up from the session funds by `fundId`; raw `fundId` if not found | No | Truncated with an ellipsis. |
| Amount (right) | Full currency, 2 decimals, in the presentation currency, for example *$150,000.00* | No | Non-monetary items (documents, notices) have a zero or null amount and show *$0.00*. |
| Date (right, under the amount) | `MMM d, yyyy, h:mm AM/PM` in the browser time zone | No | From `at`. |
| Arrow (far right) | Grey arrow, blue on hover | — | Decorative. |

- Row click: the whole row is a link to `/lp-portal/capital-activity`, the same target for every item type and record. **[O]**
- Order: as returned by the API; the screen does not sort. The demo returns seed order, not date order. **[O]** Target order: newest `at` first. **[I]**
- Count: at most 10 (`limit=10`). **[O]** The API clamps `limit` to 1–50. **[I]**
- Demo rows in order (type, fund, amount, date shown in UTC): *Capital Call*, Matanho Growth Fund I, $150,000.00, Jul 1, 2026, 9:00 AM; *Document*, Matanho Growth Fund I, $0.00, Jul 10, 2026, 8:00 AM; *Redemption*, Matanho Equity Opportunities Fund, $250,000.00, Jul 8, 2026, 11:00 AM; *Distribution*, Matanho Growth Fund I, $490,000.00, Mar 20, 2026, 11:00 AM (green up-arrow); *Subscription*, Matanho Equity Opportunities Fund, $500,000.00, Jun 3, 2026, 10:00 AM. **[O]**
- Not scoped by the fund selector: the call takes only `limit`, so all funds' items show whatever fund is selected. **[O]**
- Empty: no message; the panel shows only its header and *View All Activity*. **[O]**

**Actions Required (panel 34)**

| Column (position in row) | Format | Sortable | Notes |
| --- | --- | --- | --- |
| Icon (left) | 28 px circle with icon | No | Icon by `type` (map below); circle colour by `severity` (map below). |
| Title (top line) | `action.title`, 12 px semibold | No | The React key of the row is the title, so two actions with the same title would collide. |
| Fund (second line) | `action.fundName`, else the session fund name for `fundId`, else raw `fundId` | No | May be blank for items with no fund (KYC). Truncated. |
| Amount or label (right, line 1) | Compact money of `action.amount` when present, otherwise the `label` | No | The amount has no currency argument, so the *$* sign is used. |
| Label (right, line 2) | `label` | No | Shown only when an amount is shown on line 1. |
| Due (right, line 3) | `Due {MMM d, yyyy}` from `dueDate`, otherwise empty | No | Always red (`#dc2626`), also when the date has passed or the item is not a payment. |
| Arrow (far right) | Grey arrow, blue on hover | — | Decorative. |

- Row click: link to the action's own `href` (for example `/lp-portal/capital-activity?call=cc-013`). **[O]**
- Label resolution: `action.label` when non-empty; else the type with underscores replaced by spaces; fallback in the screen: type containing *SUBSCRIPTION* or *SIGN* → *Review & Sign*; containing *KYC* → *Update*; otherwise the type in Title Case. **[O]**
- Icon by `type` (uppercase contains): *CAPITAL_CALL* → arrow-down-to-line; *SUBSCRIPTION*, *DOCUMENT* or *SIGN* → file-check; *KYC* or *COMPLIANCE* → shield-check; anything else (for example *NOTICE*, *REQUEST*, *REDEMPTION_UNDER_REVIEW*) → file-text. **[O]**
- Circle colour by `severity` (uppercase): *HIGH* or *CRITICAL* → red; *MEDIUM* or *WARNING* → orange; any other value (including *LOW*) → blue. **[O]**
- Order and count: as returned; no cap in the screen. The real API sorts *HIGH*, *MEDIUM*, *LOW*. **[O] / [I]**
- Not scoped by the fund selector (`GET /lp-portal/dashboard/actions` has no parameters). **[O]**
- Demo rows: (1) icon red, *Acknowledge Capital Call CC-013*, Matanho Growth Fund I, *$150.0K*, *Action required*, *Due Jul 20, 2026*, link `/lp-portal/capital-activity?call=cc-013`; (2) icon orange, *Acknowledge dealing calendar notice*, Matanho Equity Opportunities Fund, *Acknowledgement* (no amount, no due date), link `/lp-portal/notices?id=notice-26`; (3) icon orange, *Reply to payment reference request*, Matanho Growth Fund I, *Awaiting you*, *Due Jul 22, 2026*, link `/lp-portal/requests?ref=REQ-1082`. Badge shows *3*. **[O]**
- Empty: no message; badge shows *0* and the list area is blank. **[O]**
- Items the real API produces (wiring target, **[I]**): *CAPITAL_CALL* items for calls in status ISSUED, ACKNOWLEDGED, PARTIALLY_PAID or OVERDUE (label *Capital Call Due*, severity HIGH when OVERDUE else MEDIUM, title `Capital Call #{callNo} due {dueDate or "soon"}`, amount = outstanding amount, href `/lp-portal/capital-activity?tab=calls`); *KYC_UPDATE* when the investor is on compliance hold or KYC needs an update (severity HIGH, title = the hold reason or *KYC / compliance update required*, href `/lp-portal/settings`, no fund, no label); *NOTICE_REQUIRES_ACK* for published notices not yet acknowledged (label *Notice*, severity MEDIUM, href `/lp-portal/notices`); *SUBSCRIPTION_AWAITING_FUNDS* or *REDEMPTION_UNDER_REVIEW* for dealing requests in AWAITING_FUNDS, UNDER_REVIEW, COMPLIANCE_REVIEW or SUBMITTED (severity MEDIUM, title `Subscription {STATUS}` or `Redemption {STATUS}` with the raw status code, due = requested dealing date, href `/lp-portal/subscriptions-redemptions`). The design also lists *DOCUMENT_REQUIRES_SIGNATURE*. **[I]**

**Latest Documents & Notices (panel 35)**

| Column (position in row) | Format | Sortable | Notes |
| --- | --- | --- | --- |
| Icon (left) | 28 px light-blue circle with a file icon | No | Same icon for every document. |
| Title (top line) | Document `name` (title), 12 px semibold, truncated | No | Part of the row link. |
| Meta (second line) | `{published date MMM d, yyyy} · {category label}` | No | Category label maps API codes to display names (*PERFORMANCE_REPORT* → *Fund Reports*, *CALL_NOTICE* → *Capital Calls*, *QUARTERLY_STATEMENT* → *Statements*, *TAX* → *Tax*, *LEGAL* → *Legal*, *GOVERNANCE* → *Governance*, *MANUAL* → *Other*; any other value is shown in Title Case, so display names such as *Fund Reports* pass through). |
| Download (right) | Icon button | No | See Actions. |

- Row click: the title and meta block is a link to `/lp-portal/notices` when the category label is *Notices*, otherwise to `/lp-portal/documents`. It does not open the specific document. **[O]**
- Loaded separately from the main bundle, once per fund-selection change, with `pageSize` 3 and the selected `fundId`. A failed load shows the empty state; it does not raise the page error. **[O]**
- Order: as returned. The demo returns seed order: *All Funds* → *Q2 2026 Investor Report* (Fund Reports, Jul 10, 2026), *June 2026 Investor Statement* (Statements, Jul 5, 2026), *CC-013 Capital Call Notice* (Capital Calls, Jul 1, 2026); *Growth Fund I* → *Q2 2026 Investor Report*, *CC-013 Capital Call Notice*, *2025 Audited Financial Statements* (Financial Statements, Apr 18, 2026); *Equity Opportunities* → *June 2026 Investor Statement*, *May 2026 Investor Statement* (Statements, Jun 5, 2026), *Subscription Confirmation SUB-024* (Dealing, Jun 3, 2026). **[O]** The real API sorts by published date, newest first. **[I]**
- The panel title promises "Notices" but no notice is listed (the notices endpoint is not called). **[O]**
- Loading: three skeleton rows (40 px). Empty: *No recent documents* (centred, grey). **[O]**

##### Inputs & validation

The page has no form fields. The scope of every figure is set by three inputs that live in the shell, plus one local control.

| Field | Control | Required | Options / default / placeholder | Validation today (code) | Target validation | Error message |
| --- | --- | --- | --- | --- | --- | --- |
| Fund scope | Topbar select | Yes (always has a value) | *All Funds* (default, value `all`) plus one option per entitled fund, labelled with the fund short name | None. *All Funds* sends no `fundId`; a fund sends its id. | `fundId` must be one of the user's entitled funds; otherwise the API answers 403 or 404. **[I]** | None shown by this page |
| As-of date | Topbar date input (hidden below 768 px; a calendar icon button replaces it) | Yes (set from the session) | Default = session `defaultAsOfDate` (demo `2026-06-30`); picking a fund resets it to that fund's as-of date, discarding a manual choice | None: any date, including future dates, is accepted | Valid `YYYY-MM-DD`; target also: not in the future [P] | None shown |
| Presentation currency | Session value (not a control on this page) | — | `USD` (demo); the backend type also allows `ZIG` | None | Value from the investor's display settings only | — |
| Period | Toggle on the history panel | Yes | *Since Inception* (default), *3Y*, *1Y*, *YTD* | None | — | — |

##### Actions

| Control | Enabled when | Permission | Effect (state change, toast text, navigation) | Wiring / API | Label |
| --- | --- | --- | --- | --- | --- |
| KPI helper link *{n} Commitment(s)* | Always | None today | Navigates to `/lp-portal/investments`, which redirects to `/lp-portal` (the same page). Target: a page listing the investor's commitments, or remove the link. | Prototype | [O] / [P] |
| KPI info buttons, panel info buttons | Always | None | No effect (native browser tooltip with the label only). Target: a popover with the definition and formula of the measure (see Business rules). | Prototype | [O] / [P] |
| Period buttons *Since Inception*, *3Y*, *1Y*, *YTD* | Always | None | Sets the period; the chart re-slices the already loaded history (see Business rules). No request, no toast. | Prototype (local state) | [O] |
| *View Performance* | Always | None | Navigates to `/lp-portal/performance`. | Prototype | [O] |
| *View Account Details* | Open-ended panel shown | None | Navigates to `/lp-portal/account-activity?structure=open-ended`. | Prototype | [O] |
| *View Capital Summary* | Always | None | Navigates to `/lp-portal/capital-activity`. | Prototype | [O] |
| Capital Position legend entries | Always | None | No effect (hover shading only). | Prototype | [O] |
| *View All* (Recent Capital Activity), *View All Activity* | Always | None | Navigates to `/lp-portal/account-activity`. | Prototype | [O] |
| Recent-activity row | Always | None | Navigates to `/lp-portal/capital-activity`. | Prototype | [O] |
| *View All* (Actions Required) | Always | None | Navigates to `/lp-portal/requests`. | Prototype | [O] |
| Action row | Always | None today. The target screens enforce their own permissions (for example acknowledging a capital call needs the signatory role). | Navigates to the action's `href`. | Prototype | [O] |
| *View All* (Latest Documents & Notices) | Always | None | Navigates to `/lp-portal/notices`. | Prototype | [O] |
| Document row link | Always | None | Navigates to `/lp-portal/notices` (category *Notices*) or `/lp-portal/documents`. | Prototype | [O] |
| Document download button | Disabled only for the document currently downloading | None today; target `lp.documents.download` | Sets the downloading id (button disabled), requests the file, saves it under the document name (no file extension is added), then clears the id. There is no success toast. If the request fails there is no error handling: no toast, the failure is unhandled and the button simply re-enables. | Prototype → `lpPortalApi.downloadDocument(id)` `GET /lp-portal/documents/{id}/download` | [O] |
| *Try Again* (error state only) | Page in error state | None | Re-runs the whole dashboard load (all four calls). | Prototype | [O] |
| Fund selector or as-of change (shell) | Always | `lp.portal.switch_fund` [I] | Re-runs the dashboard load; documents panel reloads on fund change. Previous figures stay visible until the new response arrives. | Prototype | [O] |

##### Modals & drawers

None. **[O]**

##### States

- Empty:
  - Recent Capital Activity and Actions Required: no message; list area blank (the badge shows 0). **[O]**
  - Latest Documents & Notices: *No recent documents*. **[O]**
  - History chart with no points: an empty axis from 0 to the minimum nice maximum (1), no message. **[O]**
  - Open-ended chart with no points: *YTD Return: {x}%* in the chart box. **[O]**
- Loading:
  - First load (no data yet): skeleton page: title bar (256 px wide), subtitle bar (384 px wide), six tile skeletons (118 px high), two panel skeletons (318 px high). **[O]**
  - Reload with data on screen (fund, as-of or currency change): no skeleton or spinner; stale figures remain until the response replaces them. **[O]**
  - Documents panel: three skeleton rows. **[O]**
  - Before the session has loaded the as-of date is empty; the load runs once with an empty date and again when the date is set, and the date text can briefly read *Invalid Date*. **[O]**
- Error:
  - Any of the four dashboard calls failing, with no data on screen: the title *Dashboard*, a red box with the error message (API message, otherwise *Request failed*) and an outline pill button *Try Again*. **[O]**
  - Documents call failing: treated as no documents, no message. **[O]**
  - Download failure: no feedback (defect below). **[O]**
- Disabled / read-only:
  - The document download button is disabled while its own download runs. **[O]**
  - No role-based disabling exists. **[O]**
- Conditional:
  - *Open-Ended / Hedge Fund Account* panel: only when `openEndedSummary` is present in the payload. **[O]**
  - *Called, Not Yet Paid* slice: only when `outstandingCalled` is above 0. **[O]**
  - Page title and subtitle: depend on whether a fund is selected. **[O]**
  - Helper text of tiles 4 and 5 and the percent helpers: *—* when the commitment is 0 or less. **[O]**
  - Row-3 and row-2 grids: single column below 1 280 px. **[O]**
  - Hash anchors `#capital-position`, `#open-ended-account`, `#notices`: the page tries to scroll to the anchor when it mounts. **[O]**

##### Business rules & calculations

Data loading
- On mount and whenever the fund, as-of date, presentation currency or the dashboard refresh key changes, the screen issues four requests in parallel: `getDashboard({fundId, asOfDate, presentationCurrency})`, `getDashboardActions()`, `getDashboardRecentActivity(10)` and `getPerformanceHistory({fundId, period: "SI"})`. Any failure fails the whole bundle. **[O]**
- The documents panel issues `getDocuments({fundId, pageSize: 3})` when `fundId` changes. **[O]**
- The dashboard has no realtime subscription. The refresh key of the dashboard is bumped when a *notice updated* realtime event arrives, which is a no-op in the prototype. **[O]** Target: re-fetch the dashboard on a notice-updated event and on capital-call, distribution and dealing events. **[P]**
- The demo layer answers each call after an 80 ms delay with a deep copy of the store. It uses the fund id to choose the payload, ignores `asOfDate` and `presentationCurrency`, and for *All Funds* returns the Growth Fund I KPIs (not a sum) plus the Equity Opportunities open-ended panel. **[O]**

Formats
- Compact money (tiles, donut centre, legend, open-ended Account Value): 1 000 000 000 or more → `$x.xxB`; 1 000 000 or more → `$x.xxM`; 1 000 or more → `$x.xK` (1 decimal); otherwise full currency with 2 decimals. The `$` sign is hard-coded for the compact forms. Examples: 5 000 000 → *$5.00M*; 150 000 → *$150.0K*; 0 → *$0.00*. **[O]**
- Percent: a value whose absolute value is 1 or less is treated as a fraction and multiplied by 100; otherwise it is taken as already a percent; 1 decimal. A null value prints *0.0%*. **[O]** BR-080: a null or unavailable rate (Net IRR on a fund with no cash flows) is shown as *—*, never as 0.0 %; rates are always sent as fractions so the heuristic can be removed.
- Multiples: 2 decimals followed by *x*. A null value prints *0.00x*. **[O]**
- Chart axis scaling: peak = the largest NAV or paid-in value in the visible points, in millions, at least 1; magnitude = 10 raised to floor(log10(peak)); axis maximum = the first of 1, 2, 2.5, 5, 10 times the magnitude that is at least the peak; six ticks at 0, max ÷ 5, … max. A 4.42M peak gives a 0–$5M axis. **[O]**
- Chart values are the API amounts divided by 1 000 000. **[O]**

KPI definitions (target API semantics; the browser only formats)
- BR-081: *Total Commitment* = sum of the investor's contractual commitments (status ACTIVE or PENDING) in scope. *Paid-In Capital* = cash contributions received and posted. *Called* = capital formally called and visible to the investor (calls at ISSUED or later). *Unfunded Commitment* = Total Commitment − Called (never − Paid-In). *Outstanding called* = Called − Paid-In (floored at 0). So Paid-In + Outstanding called + Unfunded = Total Commitment. **[I]**
- *Current NAV* = the investor's share of the approved fund NAV (residual NAV), never total fund assets. **[I]**
- *Distributions* = cumulative distributions paid to the investor (not cancelled). **[I]**
- DPI = Distributions ÷ Paid-In; RVPI = Current NAV ÷ Paid-In; TVPI = (Distributions + Current NAV) ÷ Paid-In; each is 0 when Paid-In is 0 and must never use the commitment as denominator. *Net IRR* = IRR of the dated investor cash flows with the ending NAV as terminal value. **[I]**
- Consolidated scope (*All Funds*): sums for amounts; multiples recomputed from the sums; the real service takes Net IRR from the last fund processed (not a pooled IRR). BR-082: the consolidated Net IRR is computed from the merged dated cash flows of all in-scope funds, or shown as *—* when it cannot be computed. **[P]**
- `investmentCount` = the number of the investor's own commitments in scope (not portfolio companies, which are returned separately as `portfolioCompanyCount`). **[I]**
- Open-ended summary (target): Account Value = Σ(units by class × NAV per unit by class); Units Held; NAV Per Unit; YTD Return = NAV per unit ÷ beginning-of-year NAV per unit − 1, using the fund-approved total-return methodology where distributions occur. **[I]**
- The browser calculations on this page (percent of commitment, Capital Position slices, history slicing) are display calculations and are not authoritative accounting values. **[I]**

Capital Position
- Slice amounts: paid-in, outstanding called (only if above 0), unfunded, distributions, and `max(currentNav − distributions, 0)` labelled *Remaining Value*. Shares are each amount ÷ Total Commitment. **[O]**
- BR-083: the Capital Position donut shows a partition of the commitment (Paid-In, Called Not Yet Paid, Unfunded) so the shares sum to 100 %; distributions and residual value are shown as separate figures, not as extra slices of the commitment. **[P]**

History period toggle
- The history is loaded once for *Since Inception*. The toggle slices the loaded points by count: *YTD* → last 3 points; *1Y* → last 6; *3Y* → last 13; *Since Inception* → all. These are point counts, not time windows. With the demo's 4 points *Since Inception*, *3Y* and *1Y* are identical and *YTD* shows the last 3. **[O]**
- BR-084: the toggle windows are time based (YTD = from 1 January of the as-of year; 1Y = 12 months; 3Y = 36 months, each ending at the as-of date), applied to dated points, and the subtitle shows the active window instead of the static *Since Inception*. **[P]**

Valuation status and as-of
- Supported statuses: *ESTIMATED*, *PROVISIONAL*, *FINAL*, *RESTATED*. A provisional or estimated value must never be shown without its label. **[I]** The dashboard shows the status as plain bold text in the history subtitle only. **[O]**
- The displayed as-of date is the shell as-of date. BR-085: the figures are those of the latest approved snapshot dated on or before the selected as-of date for each fund; the response `asOfDate` and `valuationStatus` are displayed, and for *All Funds* the status shown is the weakest status among the funds (ESTIMATED weaker than PROVISIONAL weaker than RESTATED weaker than FINAL) with the oldest snapshot date. **[P]** The real service currently picks the latest snapshot regardless of the requested as-of date. **[I]**

Operating-model branching
- The screen decides only by payload presence: the open-ended panel appears when `openEndedSummary` is present. The six KPI tiles and the Capital Position panel are always private-capital measures, so for an open-ended fund they show *$0.00* commitment and *—* shares. **[O]**
- BR-086: for a selected OPEN_ENDED fund the KPI strip shows Account Value, Units Held, NAV Per Unit, YTD Return and net contributions and redemptions instead of commitment, called, DPI, RVPI and TVPI; the Capital Position panel is hidden; for a PRIVATE_CAPITAL fund the open-ended panel is absent; for *All Funds* with both models both blocks show. The API returns `openEndedSummary: null` (not zeros) when no OPEN_ENDED fund is in scope. **[P]** (design guardrail: never show commitment, DPI or TVPI for an open-ended fund unless configured). **[I]**

Currency
- All money is formatted in dollars in compact forms and in the presentation currency in full forms; chart axes and tooltips are hard-coded to dollars and millions. **[O]** BR-087: the presentation currency (USD or ZIG) is applied by the API to every amount of the dashboard payload using the exchange rate of the as-of date, and the screen formats with the returned currency; the compact formats use the currency symbol or code, and chart axes show the currency. **[P]**

Recent activity and actions (target API rules, **[I]**)
- Recent activity merges capital-call allocations, distribution allocations, dealing requests, published documents and notices visible to the investor, sorted by event time descending, limited to the requested count.
- Actions: see the Actions Required table for the generated types and severities.

Audit and performance
- Document downloads write an audit event (user, time, IP). **[I]** Dashboard views write no audit event. **[P]**
- Target: P95 of the dashboard call ≤ 500 ms with cacheable snapshots. **[I]**

##### Edge cases

- A fund with commitment 0 (open-ended): *Total Commitment* tile *$0.00*, helper *1 Commitment*; the percent helpers and Capital Position shares show *—*; the donut contains a zero-size unfunded slice. **[O]**
- Demo *Equity Opportunities* selected: tile *Current NAV* shows *1.28x TVPI · 1.14x RVPI* and *Distributions* shows *$350.0K* with *0.14x DPI*, although the fund is open-ended. **[O]**
- A history point with a null NAV is plotted at 0 (the line drops to the axis) instead of leaving a gap. **[O]**
- NAV and paid-in end labels overlap when the two values are close. **[O]**
- When the investor has one fund the open-ended panel is absent and the history panel stays at two thirds of the row width. **[O]**
- A recent-activity item or action whose `fundId` is not in the session funds shows the raw id; an action with no fund shows an empty second line. **[O]**
- KPI tile labels use the full tile width (the icon and info button share the row above), so *Total Commitment* and *Unfunded Commitment* wrap rather than truncate. **[O]**
- Opening `/lp-portal#capital-position`, `#open-ended-account` or `#notices` does not scroll to the panel, because the panels do not exist yet when the scroll runs (the page is showing its loading skeleton). **[O]**
- Acknowledging a capital call or notice on another screen removes the matching action in the demo; the dashboard shows this on the next visit, not live. **[O]**
- The time shown in recent-activity rows follows the browser time zone. **[O]**
- Fractions above 1 (an IRR above 100 %) are shown without ×100. **[O]**

##### Gaps, defects & open questions

- **DEF-328** The whole dashboard is demo data. The *All Funds* view shows Growth Fund I only; nothing is aggregated and nothing is scoped to the real investor.
- **DEF-329** KPI tiles, Capital Position and the history chart have no operating-model branching; an open-ended fund shows commitment, DPI, RVPI and TVPI.
- **DEF-330** Capital Position slices overlap (185.4 % in the demo) and *Remaining Value* is defined as NAV minus distributions.
- **DEF-331** The KPI and panel info buttons do nothing; no formula or definition is available to the investor.
- **DEF-332** The history toggle slices by point count, never re-queries, and the subtitle always says *Since Inception*.
- **DEF-333** Recent-activity rows hide the item's descriptive title and status, show *$0.00* for documents, and all link to the same page.
- **DEF-334** Document download has no error handling or toast, and the saved file has no extension (named after the document title).
- **DEF-335** The *Latest Documents & Notices* panel never lists notices; its rows do not open the document.
- **DEF-336** Deep links to `#capital-position`, `#open-ended-account` and `#notices` do not scroll.
- **DEF-337** A null *Net IRR* shows *0.0%* and a null multiple shows *0.00x*; NAV per unit and units are shown to 2 decimals although the data has 4.
- **DEF-338** Currency is hard-coded to dollars in compact amounts and chart axes; *ZIG* presentation is not honoured by the dashboard KPIs in the real service either.
- **DEF-339** The shell as-of date is ignored by the demo layer, and the real service ignores it for KPI selection; the response as-of date is not shown.
- **DEF-340** The real service always returns an open-ended summary (zeros), which would make the open-ended panel show for every investor.
- **DEF-341** Actions ignore the fund selector; due dates are always red, also for non-payment items and overdue items (*Due Jul 20, 2026* is shown after that date has passed).
- **DEF-342** No automatic refresh (realtime is a no-op); the page does not refresh after an acknowledgement elsewhere.
- FR-LP-007: The dashboard KPI payload is computed from approved, immutable investor snapshots for the investor's entitled funds, with the formulas of Business rules — AC: for a seeded investor with commitment 5 000 000, called 3 900 000, paid-in 3 750 000, distributions 1 820 000 and NAV 4 420 000 the API returns unfunded 1 100 000, outstandingCalled 150 000, DPI 0.49, RVPI 1.18 and TVPI 1.66.
- FR-LP-008: The consolidated dashboard (*All Funds*) sums the amounts across entitled funds and recomputes the multiples from the sums — AC: with two PRIVATE_CAPITAL funds the tile values equal the sum of the two single-fund dashboards and TVPI equals (Σ distributions + Σ NAV) ÷ Σ paid-in.
- FR-LP-009: The KPI strip and the history subtitle show the as-of date and the valuation status of the figures, with a distinct badge for ESTIMATED, PROVISIONAL and RESTATED — AC: a fund whose latest snapshot is PROVISIONAL shows *PROVISIONAL* next to every value derived from it.
- FR-LP-010: Each KPI and chart info control opens a popover with the definition and formula of the measure (commitment, paid-in, unfunded, NAV, distributions, DPI, RVPI, TVPI, Net IRR) and the as-of date — AC: activating the control by mouse or keyboard shows the text and Escape closes it.
- FR-LP-011: The dashboard shows the operating-model-specific KPI set (see Business rules) — AC: selecting an OPEN_ENDED fund hides commitment, DPI, RVPI and TVPI and shows Account Value, Units Held, NAV Per Unit and YTD Return.
- FR-LP-012: Recent-activity rows show the item title, status and a link to the specific record, and omit the amount for non-monetary items — AC: a published document row shows its title, status *PUBLISHED* and no amount, and opens `/lp-portal/documents?document={id}`.
- FR-LP-013: Actions Required is empty-state aware, shows overdue items distinctly from upcoming ones and respects the fund selector when a fund is selected — AC: with no open items the panel shows *No actions required*; with a fund selected only that fund's items and fund-less items show.
- FR-LP-014: The document download shows a toast on failure and saves the file with its extension — AC: a failed request shows an error toast; a PDF is saved as `{name}.pdf`.
- FR-LP-015: Latest Documents & Notices lists the most recent documents and notices together, newest first — AC: a notice published after the newest document appears at the top with a link to `/lp-portal/notices?id={id}`.
- Q-93: What is the Nexus API prefix and source of the LP endpoints (the LP UI calls `/lp-portal/*`; the Nexus investor API is `/api/v1/investor/*` backed by published `InvestorSnapshot` records)? — default: implement `/api/v1/lp-portal/*` as in the NVCCZ contract, backed by the approved investor snapshot tables, and keep `/api/v1/investor/*` for the legacy pages until they are retired.
- Q-94: How are LP roles mapped to Nexus investor roles (*VIEWER*, *SIGNATORY*, *MANAGER* versus *admin*, *investment*, *finance*, *auditor*)? — default: *MANAGER* = Investor Admin, *SIGNATORY* = Finance, *VIEWER* = Investment Viewer, all holding the four dashboard permissions listed under Access.
- Q-95: How are amounts of funds in different currencies consolidated on *All Funds*? — default: convert each amount to the presentation currency at the as-of date's approved rate and disclose the rate and date.
- Q-96: Which treatment applies to a consolidated Net IRR when funds have different currencies and valuation dates? — default: merged dated cash flows converted at their own dates; *—* if any fund's cash flows are missing.

#### 5.B.2 Performance (`/lp-portal/performance`, `lp.performance.view`)

| Attribute | Value |
| --- | --- |
| Purpose | Shows the investor's performance measures (Net IRR, TVPI, DPI, RVPI, NAV, paid-in), value history, benchmark series, a cash-flow summary and a per-fund comparison for the selected fund, period and benchmark, and lets the investor download a performance report PDF. **[O]** |
| Access | Same route gate as 5.B.1; no page-level role or permission check. **[O]** Target: `lp.performance.view` for the five read calls and `lp.performance.download_report` for the report; all three LP roles hold both. **[I]** |
| Prototype layer | Native React: `components/lp-portal/screens/lp-performance-screen.tsx`, with `lib/lp-portal/hooks.ts` (`useLpPerformanceBundle`), `mappers.ts`, `format.ts`, `components/lp-portal/info-hint.tsx` and the demo layer `lib/lp-portal/mock-api.ts` + `mock-store.ts` via `lib/api/lp-portal-api.ts`. Unmodified NVCCZ ("Arcus") UI. **[O]** |
| Wiring status | Prototype for every element, including the report download (the demo creates an already-completed job and returns a 19-byte text file typed as PDF). Target calls are named per element. **[O]** |
| Entry points | Sidebar *Performance* (`/lp-portal/performance`); dashboard *View Performance*; topbar search result *Performance*; links from other screens. **[O]** |
| Exit points | *View Full Performance Details* (`/lp-portal/account-activity`); *View Rolling Returns* (`/lp-portal/performance`, the same page); *View Cash Flow Details* (`/lp-portal/capital-activity`); *View All Funds* (`/lp-portal/investments`, redirects to `/lp-portal`); *View Methodology* and *View Valuation Notes* (`/lp-portal/documents?category=Fund%20Reports`); the fund name button in the table (stays on the page and changes the global fund scope); all sidebar and topbar destinations. **[O]** |

##### Layout

1. Page header: title and subtitle. **[O]**
2. Filter bar (from 1 024 px one row of four cells, otherwise stacked): *Fund / Account* select, *Period* select, *Benchmark* select, *Valuation Status* card. **[O]**
3. KPI row: six tiles (2 columns, 3 from 768 px, 6 from 1 280 px). **[O]**
4. *Open-Ended Account Metrics* panel, only when the payload has open-ended metrics. **[O]**
5. Charts row (from 1 280 px: 1.75 fr and 1 fr): *Performance History* chart panel; *Benchmark Comparison* panel. **[O]**
6. Cash-flow and table row (from 1 280 px: 1 fr and 1.65 fr): *Capital Activity (Cash Flow)* chart panel; *Performance by Fund* table panel. **[O]**
7. Footer row of three cards (from 768 px): *Performance Methodology*, *Valuation Notes*, *Download Performance Report*. **[O]**
8. There are no tabs. Below the breakpoints all rows stack. **[O]**

##### Elements

| # | Element | Type | Content / behaviour | Data source (current → target) | Label |
| --- | --- | --- | --- | --- | --- |
| 1 | Page title | `h1`, 24 px bold | *Performance*. | Static | [O] |
| 2 | Page subtitle | text | *Measure long-term value creation and investor returns across your private markets portfolio.* | Static | [O] |
| 3 | *Fund / Account* select | select (see Inputs) | Bound to the shell fund selector: changing it changes the topbar selector and the whole portal's fund scope. | Context → session funds | [O] |
| 4 | *Period* select | select (see Inputs) | Default *Since Inception*. Sent to the performance and history calls. | Local state | [O] |
| 5 | *Benchmark* select | select (see Inputs) | Default *Cambridge Associates U.S. PE Index*. Sent as `benchmarkId`. | Local state | [O] |
| 6 | *Valuation Status* card | read-only card | Caption *VALUATION STATUS* (9 px uppercase) and the payload `valuationStatus` in bold (default *FINAL*), with an 8 px green dot that is green for every status. | `data.performance.valuationStatus` → `GET /lp-portal/performance` | [O] |
| 7 | KPI tile *Net IRR* | tile with trend arrow | Value = percent of `metrics.netIrr` (1 decimal). Helper *Since Inception*. Green dollar icon. | Mock performance → `lpPortalApi.getPerformance` `GET /lp-portal/performance?fundId&period&asOfDate` → `metrics.netIrr` | [O] |
| 8 | KPI tile *TVPI* | tile with trend arrow | Value = `metrics.tvpi` with 2 decimals and *x*. Helper *Since Inception*. Orange bar-chart icon. | same → `metrics.tvpi` | [O] |
| 9 | KPI tile *DPI* | tile with trend arrow | Value = `metrics.dpi`, 2 decimals and *x*. Helper *Since Inception*. Blue coins icon. | same → `metrics.dpi` | [O] |
| 10 | KPI tile *RVPI* | tile with trend arrow | Value = `metrics.rvpi`, 2 decimals and *x*. Helper *Since Inception*. Orange sliders icon. | same → `metrics.rvpi` | [O] |
| 11 | KPI tile *Current NAV* | tile | Value = compact money of `metrics.currentNav` in the reporting currency. Helper *As of {long date, e.g. June 30, 2026}*. Blue crosshair icon. | same → `metrics.currentNav`, `asOfDate` | [O] |
| 12 | KPI tile *Paid-In Capital* | tile | Value = compact money of `metrics.paidIn`. Helper *Since Inception*. Blue landmark icon. | same → `metrics.paidIn` | [O] |
| 13 | Trend arrow | 14 px green up-arrow | Shown on tiles 7–10 for every value (static, not derived from data). | Static | [O] |
| 14 | Tile info control | info icon button with popover | `aria-label` *{label} info*. Popover: the label in bold and the helper text of the tile (*Since Inception* or *As of {date}*) as description. It carries no definition or formula. | Static | [O] |
| 15 | Panel *Open-Ended Account Metrics* | section | Title *Open-Ended Account Metrics*, `As of {long date}`, four cells: *Account Value* (compact money), *Units Held* (2 decimals), *NAV Per Unit* (compact money, so under 1 000 it is full currency with 2 decimals, for example *$15.44* for 15.4448), *YTD Return* (percent, 1 decimal). Present only when `openEndedMetrics` is in the payload. | `data.performance.openEndedMetrics` → `GET /lp-portal/performance` | [O] |
| 16 | Panel *Performance History* title | `h2` with info popover | Popover text: *Investment value over the selected period.* | Static | [O] |
| 17 | History legend | static legend | Solid blue *NAV*; dashed light-blue *Cumulative Paid-In*; solid green *Distributions*. | Static | [O] |
| 18 | History range toggle | segmented buttons | *SI* (default), *1Y*, *3Y*, *5Y*, *10Y*, *MAX*. Client-side slicing (see Business rules). Independent of the *Period* select. | Local state | [O] |
| 19 | History chart | combined area and line chart, 300 px | Series: NAV (area gradient plus 2.25 px line `#0055d4`), Cumulative Paid-In (2 px dashed `#49b2e1`), Distributions (2.25 px `#10b981`). X axis: point label, thinned to keep first and last. Y axis: 0 to nice maximum (peak of NAV, paid-in and distributions in millions, at least 1), six ticks, labels *$0* or *$nM*, axis title *USD (Millions)* at the top left (hard-coded). Horizontal grid only. No dots. | Mock history → `lpPortalApi.getPerformanceHistory` `GET /lp-portal/performance/history?fundId&period` → `points[]` | [O] |
| 20 | History end labels | pills | At the last point: NAV (blue pill, white text), paid-in (pale-blue pill, blue text), distributions (green pill, white text), each `$x.xxM`. | same | [O] |
| 21 | History tooltip | hover card | Rows named *NAV*, *Cumulative Paid-In*, *Distributions* with `$x.xxM`; the unnamed area series may add an extra lower-case *nav* row (not verified in a browser). | same | [O] |
| 22 | Link *View Full Performance Details* | text link | `/lp-portal/account-activity`. | Static | [O] |
| 23 | Panel *Benchmark Comparison* title | `h2` with info popover | Popover text: *Compare fund performance against selected benchmarks.* | Static | [O] |
| 24 | Benchmark metric select | select, 104 px | *Net IRR* (default) or *TVPI*. | Local state | [O] |
| 25 | Benchmark bars | list of bars | One row per benchmark series point: coloured dot, point label (for example *Jun 2025*), value (*TVPI*: 2 decimals and *x*; *Net IRR*: 1 decimal and *%*), and a 14 px track with a filled bar. Bar colours cycle `#0055d4`, `#06b6d4`, `#8b5cf6`, `#f97316`, `#10b981`. Bar width = value ÷ axis maximum, where the axis maximum = the larger of the largest value and 2 (*TVPI*) or 30 (*Net IRR*), capped at 100 %. The fund's own value is not drawn. | Mock benchmarks → `lpPortalApi.getPerformanceBenchmarks({fundId, metric: NET_IRR or TVPI, benchmarkId})` `GET /lp-portal/performance/benchmarks` → `series[]` | [O] |
| 26 | Benchmark axis caption | static text | *0%  10%  20%  30%* under the bars (fixed, also when *TVPI* is selected) and centred *Since Inception*. | Static | [O] |
| 27 | Benchmark empty message | text | When there are no bars: the response `note` of the Net IRR call, otherwise *No approved benchmark series is configured.* | `data.benchmarks.note` | [O] |
| 28 | Link *View Rolling Returns* | text link | `/lp-portal/performance` (the same page; no rolling-returns view exists). | Static | [O] |
| 29 | Panel *Capital Activity (Cash Flow)* | panel | Title with popover *Capital calls and distributions over time.*; subtitle *USD (Millions)*; right text *Since Inception* (both static). | Static | [O] |
| 30 | Cash-flow bar chart | bar chart, 280 px | Four bars from the metrics (millions): *Paid-In Capital* = −paid-in (`#0046b5`), *Capital Calls* = −paid-in (`#00aeef`; the same value as the first bar), *Distributions* = +distributions (`#34a853`), *Current NAV* = +NAV (`#0046b5`). X labels on two lines (*Paid-In / Capital*, *Capital / Calls*, *Current / NAV*, *Distributions*). Y axis symmetric (−max to +max, max = nice maximum of the largest absolute value, at least 1), five ticks (−max, −max/2, 0, max/2, max), labels *($nM)*, *$0*, *$nM*. Dashed reference line at the Distributions value and a solid line at 0. Bar labels: negative values *($3.75M)* below the bar, positive *$1.82M* above. Tooltip: the formatted value only. | `data.performance.metrics` → `GET /lp-portal/performance` | [O] |
| 31 | Cash-flow legend | three entries | *Inflows (Calls)* (cyan, info popover *Capital called from investors.*), *Outflows (Distributions)* (green, info popover *Cash distributed to investors.*), *Ending Value (NAV)* (dark blue, no popover). | Static | [O] |
| 32 | Link *View Cash Flow Details* | text link | `/lp-portal/capital-activity`. | Static | [O] |
| 33 | Panel *Performance by Fund* | panel | Title with popover *Fund-level metrics for your entitled investments.*; link *View All Funds* (`/lp-portal/investments`, redirects to the dashboard); table (see Tables); footnote *Performance is net of fees, expenses and carried interest, if applicable.* (11 px italic grey). | Mock by-fund → `lpPortalApi.getPerformanceByFund(asOfDate)` `GET /lp-portal/performance/by-fund?asOfDate` → `funds[]` | [O] |
| 34 | Card *Performance Methodology* | card | Title with popover *Read the fund's performance calculation methodology.*; text *Performance is calculated in accordance with the Global Investment Performance Standards (GIPS®) and based on capital flows and valuations as of the valuation date.*; link *View Methodology* → `/lp-portal/documents?category=Fund%20Reports`. | Static | [O] |
| 35 | Card *Valuation Notes* | card | Title with popover *Notes on valuation basis and as-of dates.*; text *All investments are valued in good faith pursuant to the fund's valuation policy. The most recent valuation is as of {long as-of date}.*; link *View Valuation Notes* → `/lp-portal/documents?category=Fund%20Reports`. | `asOfDate` → `GET /lp-portal/performance` | [O] |
| 36 | Card *Download Performance Report* | card | Title with popover *Generate and download a performance report PDF.*; text *Download the comprehensive performance report including detailed returns, cash flows and benchmark analysis.*; outline pill button *Download Report* with a download icon. | See Actions | [O] |
| 37 | Snapshot metadata | — | The payload carries `calculationDate`, `version`, `sourceModule`, `approvedBy` and `reportingCurrency`. Only `reportingCurrency`, `asOfDate` and `valuationStatus` are displayed. | `data.performance.*` | [O] |
| 38 | Toasts | `sonner`, top-right, white card, bold text | Only the three report-download toasts (see Actions). | — | [O] |

##### Tables

**Performance by Fund (element 33)**

| Column | Format | Sortable | Notes |
| --- | --- | --- | --- |
| *Fund* | Text button (blue, underlined on hover): the fund's full name | No | Click sets the global fund scope to that fund (page reloads for it; no navigation). |
| *Structure* | *Closed-End*, *Open-End*, *Credit*, or the raw value, or *—* | No | Derived from `structure` or `operatingModel`: contains OPEN → *Open-End*; contains CREDIT → *Credit*; contains PRIVATE or CLOSED → *Closed-End*. |
| *Net IRR* | Percent, 1 decimal; *—* when null | No | Null for open-ended funds in the real API. |
| *TVPI / Return* | 2 decimals and *x*; *—* when null | No | Header says *Return* but only TVPI is shown; no open-ended return is shown. |
| *NAV / Account Value* | Compact money in the reporting currency | No | |
| *Benchmark* | Percent (or multiple) of the latest point of the loaded benchmark series; *—* when the series is missing, not configured or empty | No | The same value is printed in every row, whatever the fund. Taken from the Net IRR benchmark call, so it is a percent. |
| *As Of* | Long date, e.g. *June 30, 2026* | No | The same performance as-of date in every row. |

- Filters, search, pagination: none. **[O]**
- Scope: the table lists every fund returned by the endpoint; the *Fund / Account* select does not filter it. **[O]**
- Row click: only the fund-name button acts (sets the global fund). **[O]**
- Empty: the header row alone; no message. **[O]**
- Demo rows (All Funds): *Matanho Growth Fund I* | *Closed-End* | *18.4%* | *1.66x* | *$4.42M* | *18.4%* | *June 30, 2026*; *Matanho Equity Opportunities Fund* | *Open-End* | *12.8%* | *1.28x* | *$2.85M* | *18.4%* | *June 30, 2026*. With Equity Opportunities selected the Benchmark column shows *12.0%*. The demo gives the open-ended fund IRR and TVPI numbers, which the real API withholds. **[O]**
- The table is at least 720 px wide and scrolls horizontally inside the panel. **[O]**
- Status → colour: none (no badges). **[O]**

##### Inputs & validation

| Field | Control | Required | Options / default / placeholder | Validation today (code) | Target validation | Error message |
| --- | --- | --- | --- | --- | --- | --- |
| *Fund / Account* | Select (value is the global fund id) | Yes (has a value) | Placeholder *All Funds*. Options: *All Funds* (value `all`, no `fundId` sent) then one per entitled fund, labelled with the fund's full name (the topbar uses the short name). Default *All Funds*. | None | `fundId` must be entitled (403 or 404 otherwise) **[I]** | None |
| *Period* | Select (local) | Yes | *Since Inception* (`si`, default, sent as `SI`), *5 Years* (`5y`, `5Y`), *3 Years* (`3y`, `3Y`), *1 Year* (`1y`, `1Y`), *Year to Date* (`ytd`, `YTD`) | None | Period one of SI, 1Y, 3Y, 5Y, YTD (and MAX, 10Y for history) **[I]** | None |
| *Benchmark* | Select (local) | Yes | *Cambridge Associates U.S. PE Index* (`cambridge`, default), *S&P 500* (`sp500`), *Russell 3000* (`russell`) | None | Id must match a benchmark with an approved series, else the API returns `configured: false` **[I]** | The empty-state message |
| Benchmark metric | Select (local, in the benchmark panel) | Yes | *Net IRR* (default, sent as `NET_IRR`), *TVPI* (sent as `TVPI`) | None | One of NET_IRR, TVPI **[I]** | None |
| History range | Segmented buttons | Yes | *SI* (default), *1Y*, *3Y*, *5Y*, *10Y*, *MAX* | None | — | — |
| As-of date | Topbar date input (shell) | Yes | Session default (demo `2026-06-30`) | None | `YYYY-MM-DD` **[I]** | None |

The *Fund / Account* select changes the shared portal state: the topbar selector follows it, other screens inherit the fund, and the as-of date is reset to that fund's as-of date. The period, benchmark, metric and range controls are local and are lost on navigation. **[O]**

##### Actions

| Control | Enabled when | Permission | Effect (state change, toast text, navigation) | Wiring / API | Label |
| --- | --- | --- | --- | --- | --- |
| *Fund / Account* select | Always | `lp.portal.switch_fund` **[I]** | Sets the global fund scope; reloads the five calls; resets the as-of date to the fund's. No toast. | Prototype | [O] |
| *Period* select | Always | None | Reloads performance, history, by-fund and benchmark calls with the new period (the demo returns the same figures, echoing the period). | Prototype → `GET /lp-portal/performance?period=` and `GET /lp-portal/performance/history?period=` | [O] |
| *Benchmark* select | Always | None | Reloads the whole bundle with `benchmarkId`, and refetches the benchmark bars. The demo ignores the id. | Prototype → `GET /lp-portal/performance/benchmarks?benchmarkId=` | [O] |
| Benchmark metric select | Always | None | Refetches the bars with `metric=NET_IRR` or `TVPI`; the bars show a loading skeleton while it runs. | Prototype → `GET /lp-portal/performance/benchmarks?metric=` | [O] |
| History range buttons | Always | None | Re-slices the loaded history by point count (no request). | Prototype (local) | [O] |
| Tile and panel info controls | Always | None | Open a popover (see Elements 14 and the panel popovers); outside click or Escape closes. | Prototype | [O] |
| Fund-name button in *Performance by Fund* | Always | `lp.portal.switch_fund` **[I]** | Sets the global fund scope to that row's fund. | Prototype | [O] |
| *View Full Performance Details*, *View Rolling Returns*, *View Cash Flow Details*, *View All Funds*, *View Methodology*, *View Valuation Notes* | Always | None | Navigate to the exit points listed above. *View Rolling Returns* reloads this same page. | Prototype | [O] |
| *Download Report* | Not while a download is running | `lp.performance.download_report` **[I]** (all LP roles) | Starts the report flow below. The button is disabled while it runs; its label does not change and there is no spinner. | Prototype → `lpPortalApi.downloadPerformanceReport({fundId})` `GET /lp-portal/performance/report/download?fundId=`, then `lpPortalApi.getJob(jobId)` `GET /lp-portal/jobs/{jobId}`, then `lpPortalApi.downloadReport(jobId)` `GET /lp-portal/reports/{jobId}/download` | [O] |
| *Try Again* (error state only) | Page in error state | None | Re-runs the four-call bundle. | Prototype | [O] |

Report flow (exact behaviour of *Download Report*) **[O]**
1. The button is disabled.
2. `GET /lp-portal/performance/report/download?fundId={selected fund or omitted}` returns `{jobId, status, createdAt}`. Only the fund is sent; the Period, Benchmark and as-of date are not sent.
3. `GET /lp-portal/jobs/{jobId}` is requested immediately.
4. While the status (compared in upper case) is none of *COMPLETED*, *FAILED*, *CANCELLED* and fewer than 30 polls have been made, the screen waits 2 000 ms and requests the job again (at most 30 polls, about 60 seconds).
5. If the status is *FAILED*: error toast with the job's `errorMessage`, or "Report generation failed" when it is empty; the flow stops and the button is enabled.
6. Otherwise (status *COMPLETED*, *CANCELLED*, or any status after the 30 polls) the screen requests `GET /lp-portal/reports/{jobId}/download` as a file and saves it as `lp-performance-report.pdf`, then shows the success toast "Performance report downloaded".
7. Any thrown error (job fetch, file fetch): error toast with the error message, or "Failed to download performance report" when the error has none.
8. In every case the button is enabled again at the end.
- Toasts (sonner, top-right): success "Performance report downloaded"; error "Report generation failed" (fallback) or the job's error message; error "Failed to download performance report" (fallback) or the thrown error's message. **[O]**
- Demo: the job is created already *COMPLETED*; the file is a 19-byte text file typed as PDF named `lp-performance-report.pdf`. **[O]**
- The screen never calls `POST /lp-portal/jobs/performance-report` (the idempotent job-creation endpoint that exists in the API contract). **[O]**

##### Modals & drawers

None. The only overlays are the info popovers (anchored to the info icon, `max-w-xs`, left aligned: label in bold, description in grey) and the select menus. **[O]**

##### States

- Empty:
  - Benchmark panel without bars: the API note or *No approved benchmark series is configured.* **[O]**
  - By-fund table without rows: header only. **[O]**
  - Charts without data: empty axes (0 to the minimum nice maximum), no message. **[O]**
  - Open-ended panel absent when the payload has no open-ended metrics. **[O]**
- Loading:
  - First load (no data): skeleton: title bar (192 px), subtitle bar (384 px), four filter bars (40 px), six KPI blocks (96 px). Charts, table and footer cards are not drawn. **[O]**
  - Reload with data on screen (fund, as-of, period or benchmark change): no skeleton; stale data stays until replaced. **[O]**
  - Benchmark bars: four skeleton bars (32 px) while the benchmark request runs. **[O]**
  - Report download: button disabled only. **[O]**
- Error:
  - Bundle failure with no data on screen: title *Performance*, a red box with the error message (API message or *Request failed*), outline pill *Try Again*. **[O]**
  - Benchmark request failure: bars cleared and the empty message shown; no error text. **[O]**
  - Report failure: error toast (see Actions). **[O]**
- Disabled / read-only:
  - *Download Report* disabled while running. **[O]**
  - No role-based disabling. **[O]**
- Conditional:
  - *Open-Ended Account Metrics* panel: only with `openEndedMetrics` (demo: only when *Equity Opportunities* is selected). **[O]**
  - Benchmark label and bar format by metric (*%* or *x*) and axis maximum (30 or 2). **[O]**
  - Table *Net IRR* and *TVPI / Return* cells show *—* for null values. **[O]**
  - Benchmark column shows *—* when the series is missing, unconfigured or empty. **[O]**
  - Reporting currency: payload `reportingCurrency`, else the session presentation currency. **[O]**

##### Business rules & calculations

Data loading
- On mount and on any change of fund, as-of date, period, benchmark or the performance refresh key the screen issues four requests in parallel: `getPerformance({fundId, period, asOfDate})`, `getPerformanceHistory({fundId, period})`, `getPerformanceByFund(asOfDate)` and `getPerformanceBenchmarks({fundId, metric: "NET_IRR", benchmarkId})`. A failure of any fails the bundle. **[O]**
- The benchmark panel also issues its own `getPerformanceBenchmarks({fundId, metric, benchmarkId})` on mount and whenever the metric, benchmark or fund changes (so the Net IRR benchmark is requested twice on mount). Late responses of superseded requests are discarded. **[O]**
- The performance refresh key is never bumped in the prototype, so the page does not refresh by itself. **[O]**
- The demo layer returns the performance payload of the selected fund (Growth Fund I for *All Funds*), echoes the requested period and as-of date into it, returns the same history for every period, the same by-fund rows regardless of the as-of date, and one benchmark series per fund regardless of `benchmarkId` and `metric`. **[O]**

Measures (target semantics; the browser only formats) **[I]**
- DPI = cumulative distributions ÷ paid-in capital; RVPI = residual NAV ÷ paid-in capital; TVPI = (cumulative distributions + residual NAV) ÷ paid-in capital; Net IRR = IRR of dated investor cash flows with the ending NAV as terminal value. A multiple is 0 when paid-in is 0. Never use committed capital as the denominator.
- Aggregation over several funds: amounts are summed; DPI, RVPI, TVPI are recomputed from the sums when paid-in is above 0; Net IRR in the real service is the last fund's value, which BR-NEW replaces by a pooled IRR from merged dated cash flows (or *—*). **[P]**
- Open-ended measures: 1-month, 3-month, YTD, 1-year and since-inception returns; NAV return = ending NAV per unit ÷ beginning NAV per unit − 1; where distributions occur the fund-approved total-return method is used; the browser never invents reinvestment assumptions. The screen shows only *YTD Return*. **[I]**
- Private-capital multiples (Net IRR, TVPI, DPI, RVPI) are returned as null for an OPEN_ENDED fund and shown as *—* (an absent measure is not zero). **[I]** The by-fund table implements this; the KPI row does not (it prints whatever the aggregate carries, and a null Net IRR prints *0.0%*, a null multiple *0.00x*). **[O]**
- BR-088: when a single OPEN_ENDED fund is selected the KPI row shows the open-ended measures (Account Value, Units Held, NAV Per Unit, YTD Return, and 1M, 3M, 1Y, SI returns) instead of Net IRR, TVPI, DPI and RVPI; with *All Funds* and both models the private-capital KPIs cover the PRIVATE_CAPITAL funds only and the open-ended panel covers the OPEN_ENDED funds. **[P]**

Period handling
- The *Period* select is sent to the API. The real service uses it as the window start (YTD = 1 January of the as-of year; 1Y, 3Y, 5Y = 12, 36, 60 months before the as-of date; Since Inception and anything else = 120 months) but only for live computation; an approved snapshot ignores it. **[I]** BR-089: the *Period* select changes the figures: Net IRR, TVPI, DPI, RVPI and NAV change reflect the chosen window from approved period snapshots (or are marked as unavailable for that window), and the helper under each tile names the active period instead of the static *Since Inception*. **[P]**
- The *History range* buttons (*SI*, *1Y*, *3Y*, *5Y*, *10Y*, *MAX*) slice the already loaded history by point count: *1Y* → last 4 points, *3Y* → last 7, *5Y* → last 9, others → all. They do not request data and are independent of the *Period* select. With the demo's 4 points all six buttons show the same chart. **[O]** BR-090: the range buttons are time windows ending at the as-of date and are the single period control of the history chart; selecting *Period* in the filter bar sets the same window. **[P]**
- The real history endpoint: the SI window is the investor's own lifetime (earliest commitment, call or distribution date), 12 to 120 months; 1Y = 12, 3Y = 36, 5Y = 60, 10Y and MAX = 120 months; about seven points (steps of span ÷ 6 months) ending at *Now*; paid-in and distributions are cumulative sums of dated rows up to each point; NAV is the approved snapshot at or before each point (current NAV at *Now*) and null when there is none. **[I]** Its controller ignores the requested period (defect below).

Formats and scaling
- Money and percent formats as in 5.B.1 (compact money, 1-decimal percent, 2-decimal multiples). **[O]**
- History: values in millions; axis maximum = first of 1, 2, 2.5, 5, 10 × 10^floor(log10(peak)) that is at least the peak of NAV, paid-in and distributions (at least 1); six ticks. **[O]**
- Cash-flow chart: paid-in and the "calls" bar are negative, distributions and NAV positive; axis symmetric around 0 with the same nice-maximum rule on the largest absolute value; ticks −max, −max/2, 0, max/2, max; negative labels in parentheses. **[O]**
- Benchmark bars: Net IRR values of 1 or less are multiplied by 100, larger values are used as is; TVPI values are used as is; bar width = value ÷ max(largest value, 2 for TVPI or 30 for Net IRR). **[O]**
- Date format of the as-of label: long (*June 30, 2026*), from `performance.asOfDate`, else the shell as-of date. **[O]**

Benchmarks
- BR-091: a benchmark series exists only when approved points are stored for the pair (benchmark id, metric); the API then returns `configured: true`, `valuationStatus: FINAL`, the points with their date and label, the source and approval date; otherwise `configured: false`, `valuationStatus: UNAVAILABLE`, an empty series and the note *No approved {BENCHMARK} series is configured for {METRIC}.* The platform never generates a benchmark series. **[I]**
- Benchmark ids from the screen (`cambridge`, `sp500`, `russell`) are upper-cased by the API (`CAMBRIDGE`, `SP500`, `RUSSELL`); metrics are `NET_IRR` and `TVPI`; the points returned are those with date on or before the as-of date, oldest first. **[I]**
- The Benchmark column of the by-fund table uses the last point of the Net IRR series (the latest approved value). **[O]** BR-092: the column shows the benchmark value for the fund's own benchmark and as-of date, per row. **[P]**
- BR-093: the *Benchmark Comparison* panel compares the investor's (or selected fund's) value of the chosen metric with the selected benchmark's value for the same as-of date, in one chart, and the axis scale follows the metric (percent or multiple). **[P]**

Valuation status and snapshot metadata
- Statuses: ESTIMATED, PROVISIONAL, FINAL, RESTATED. The card shows the payload status; the real service currently hard-codes *FINAL*. **[O] / [I]**
- BR-094: the card shows the real status of the snapshot (weakest status among the funds for *All Funds*) with a colour per status (green FINAL, amber PROVISIONAL or ESTIMATED, purple RESTATED), and the page shows the snapshot's calculation date, version, source module and approver (for example in the Valuation Notes card or a popover). **[P]** Historic approved figures remain visible and unchanged after later valuations. **[I]**

Currency
- Money in KPI tiles, table NAV and open-ended metrics uses the payload `reportingCurrency` (demo *USD*); the compact forms still show *$*, and the chart axes, subtitle and axis title are hard-coded *USD (Millions)* / *$…M*. **[O]** BR-095: the chart axis titles and money symbols follow the reporting currency. **[P]**

Report job lifecycle (target) 
- BR-096: *Download Report* creates a server-side report job that captures the selected fund, period, benchmark and as-of date; job states are QUEUED, RUNNING, COMPLETED, FAILED, CANCELLED; the screen polls until a terminal state or a timeout and treats every terminal state explicitly (COMPLETED downloads; FAILED shows the job error; CANCELLED shows a cancellation message; timeout shows a "still preparing" message and keeps the job id so the file can be fetched later). **[P]**
- The real service creates the job synchronously with status *READY* and `downloadUrl` null; its download endpoint only knows fund-report delivery jobs, not performance-report jobs. The screen's terminal set (*COMPLETED*, *FAILED*, *CANCELLED*) does not include *READY*. **[I]**
- BR-097: one job vocabulary is used by the API and the screen (QUEUED, RUNNING, COMPLETED, FAILED, CANCELLED), and a COMPLETED performance-report job is downloadable by `GET /lp-portal/jobs/{jobId}/download` (or the `downloadUrl` returned by the job), with `Content-Type: application/pdf` and `Content-Disposition: attachment; filename="fund-performance-{fund or consolidated}-{as-of date}.pdf"`. **[P]**
- Job creation is idempotent per request (an `Idempotency-Key` header on `POST /lp-portal/jobs/performance-report`); the legacy `GET /performance/report/download` creates a new job on every call. **[I]**
- A job is visible only to the client that created it (another client gets 404 "Job not found"). **[I]**
- Each report download writes an audit event (user, client, fund, period, job id, time). **[P]**
- The report content is the same set of figures as the page (returns, cash flows, benchmark analysis) for the chosen scope, from approved snapshots, never recomputed with later valuations. **[I]**

Static content
- *Performance is calculated in accordance with the Global Investment Performance Standards (GIPS®)…* and *All investments are valued in good faith pursuant to the fund's valuation policy.* are static texts; they assert GIPS compliance. **[O]** Q-NEW below.

##### Edge cases

- Selecting an OPEN_ENDED fund: the KPI row still shows Net IRR, TVPI, DPI, RVPI (the demo gives 12.8 %, 1.28x, 0.14x, 1.14x) and *Paid-In Capital*, plus the *Open-Ended Account Metrics* panel (*$2.85M*, *184,233.48*, *$15.44*, *12.8%*). **[O]**
- *All Funds*: the demo shows Growth Fund I figures; the open-ended panel is absent. **[O]**
- By-fund row for an open-ended fund in the real API: *—* in *Net IRR* and *TVPI / Return*. **[I]**
- A null history NAV (real API) is drawn as 0. **[O]**
- NAV, paid-in and distributions end labels can overlap. **[O]**
- The period select, benchmark select, metric and range buttons reset when the user leaves and returns; the fund and as-of date persist. **[O]**
- Changing the fund here changes the as-of date to the fund's own as-of date, discarding a manually chosen date. **[O]**
- `YTD` is sent as a history period; the real history service has no YTD token and falls back to a 24-month window. **[I]**
- TVPI selected in the benchmark panel with the demo data prints the IRR decimals as multiples (0.16x to 0.18x) and bars about 8–9 % wide. **[O]**
- Clicking *Download Report* repeatedly is prevented only by the disabled state; each completed click creates a job. **[O]**
- The saved file name is fixed (`lp-performance-report.pdf`) whatever the fund; the real server names it `fund-performance-{Fund-Name}.pdf` but the screen does not use that header. **[O] / [I]**
- A polling timeout (30 polls) is not reported: the flow proceeds to the file download. **[O]**
- The report ignores the Period, Benchmark and as-of date shown on the page. **[O]**

##### Gaps, defects & open questions

- **DEF-343** All data is demo data; the *Period*, *Benchmark* and as-of controls change nothing in the demo layer (the period and as-of are only echoed), and the *All Funds* view is one fund's payload.
- **DEF-344** *Benchmark Comparison* shows the benchmark's own time series as bars; the fund's value is not plotted, so nothing is compared. Axis captions are fixed at 0–30 % also for TVPI, the *Since Inception* caption is static and the demo TVPI series is the IRR series.
- **DEF-345** The KPI row has no operating-model branching; a null Net IRR prints *0.0%* and a null multiple *0.00x*; the demo gives an open-ended fund IRR and TVPI values.
- **DEF-346** Trend arrows on four tiles are always green and always up; the valuation dot is always green; tile helpers always say *Since Inception* whatever the period.
- **DEF-347** Tile info popovers repeat the helper text and give no definition or formula (the design requires the formula behind each metric).
- **DEF-348** *Capital Calls* and *Paid-In Capital* bars carry the same number; the chart title says "over time" but it is a single snapshot; the two blue colours coincide; the tooltip shows the value without a series name.
- **DEF-349** By-fund *Benchmark* column repeats one value in every row; *As Of* is the same in every row; the table ignores the *Fund / Account* select; *View All Funds* and the dashboard's commitments link end on the dashboard; *View Rolling Returns* reloads the same page.
- **DEF-350** Report download: the real job status *READY* is not recognised as finished (the screen polls 60 seconds), the file endpoint cannot find performance-report jobs (404 "Report not found" expected), *CANCELLED* and timeouts proceed to download, the Period, Benchmark and as-of date are not sent, the button gives no progress feedback, and the saved file name ignores the server's.
- **DEF-351** Snapshot metadata (calculation date, version, source module, approver) is fetched but not displayed; the real service fills it with placeholders (*version* "1", *approvedBy* null, *valuationStatus* always *FINAL*, *reportingCurrency* always *USD*).
- **DEF-352** The real history endpoint ignores the requested period (controller passes `period`, service reads `range`), returns no NAV for past dates when no snapshot exists (null), has no YTD window, and the by-fund endpoint ignores `asOfDate`.
- **DEF-353** The real open-ended `ytdReturn` is a placeholder (always 0.0000).
- **DEF-354** Methodology and Valuation Notes cards both link to the Fund Reports category rather than to a methodology or valuation-notes document; the GIPS statement is unconditional.
- **DEF-355** `$` and `M` are hard-coded in compact amounts and chart axes; the axis title *USD (Millions)* is static.
- FR-LP-016: The Performance page loads the performance, history, by-fund and benchmark data from approved snapshots with period, as-of date and fund filters honoured by the API — AC: changing *Period* from *Since Inception* to *1 Year* changes the KPI values and the history window; changing the as-of date to a prior quarter-end returns the figures of the snapshot at that date.
- FR-LP-017: The KPI row shows the measure set of the selected fund's operating model, and shows *—* for any measure that is null — AC: selecting an OPEN_ENDED fund shows Account Value, Units Held, NAV Per Unit and YTD Return and no IRR, TVPI, DPI or RVPI; a null Net IRR on a private-capital fund shows *—*.
- FR-LP-018: Each KPI and chart info popover shows the definition, formula, period and as-of date of the measure — AC: the TVPI popover reads "(Distributions + residual NAV) ÷ Paid-In capital" and the as-of date.
- FR-LP-019: The trend arrow on a KPI shows the direction of change against the previous approved snapshot (up, down, none) or is removed — AC: a Net IRR lower than the previous snapshot shows a red down arrow; no previous snapshot shows no arrow.
- FR-LP-020: The valuation status card shows the real status with a colour per status, and the page shows the snapshot's calculation date, version, source module and approver — AC: a PROVISIONAL snapshot shows an amber *PROVISIONAL* card and the approver is displayed for a FINAL snapshot.
- FR-LP-021: The Benchmark Comparison panel plots the investor's value and the benchmark value of the chosen metric for the as-of date and the series over time, with an axis that follows the metric, and states when no approved series exists — AC: with an approved Cambridge series the fund bar and the benchmark bar for the same date are shown; without a series the message *No approved CAMBRIDGE series is configured for NET_IRR.* is shown and no bars.
- FR-LP-022: The Benchmark column of the fund table shows the benchmark value per fund for the as-of date, or *—* — AC: two funds with different benchmarks show different values; a fund without an approved series shows *—*.
- FR-LP-023: The Capital Activity chart shows called capital (capital calls) and paid-in separately, using the called amount as the calls bar — AC: for called 3 900 000 and paid-in 3 750 000 the bars read *($3.90M)* and *($3.75M)*.
- FR-LP-024: The performance report is generated as an asynchronous job with the selected fund, period, benchmark and as-of date, and one status vocabulary (QUEUED, RUNNING, COMPLETED, FAILED, CANCELLED) — AC: *Download Report* with Period *1 Year* produces a PDF whose period is 1 year; FAILED shows the job's error text in a toast; CANCELLED shows "Report generation was cancelled"; after the timeout a toast states the report is still being prepared.
- FR-LP-025: The *Download Report* button shows progress while the job runs — AC: label changes to *Preparing report…* and the button is disabled until a terminal state.
- FR-LP-026: The downloaded file uses the server file name — AC: the saved file is named `fund-performance-{fund}-{as-of date}.pdf`.
- FR-LP-027: Performance report generation and download write audit events — AC: an audit record exists for each download with the user, client, fund, period and job id.
- Q-97: Does the Nexus API produce period figures (1Y, 3Y, 5Y, YTD) from stored period snapshots or compute them from dated cash flows? — default: compute from approved dated cash flows and NAV snapshots, and mark a window as unavailable when the data does not cover it.
- Q-98: Where does benchmark index data come from and who approves it? — default: a maintained table of approved index points per benchmark id and metric (as in the NVCCZ `lp_benchmark_series_points`), approved by Investor Relations with a four-eyes check.
- Q-99: Is the GIPS compliance statement correct for Matanho funds? — default: show it only for funds flagged as GIPS-compliant; otherwise show a neutral methodology note.
- Q-100: Is the report a single PDF per fund or a multi-fund pack for *All Funds*, and who composes it (staff-approved fund report versus generated on demand)? — default: generated on demand from approved snapshots, a consolidated pack for *All Funds*.
- Q-101: Which benchmark options does the investor see? — default: only those with an approved series for the selected metric; the fixed three-item list (*Cambridge Associates U.S. PE Index*, *S&P 500*, *Russell 3000*) is replaced by an API-provided list.
- Q-102: What is the 3Y, 5Y, 10Y and MAX behaviour for an investor with less history than the window? — default: show all available points and label the range with the actual window.

#### 5.B.3 Account Activity (`/lp-portal/account-activity`, `lp.activity.view`; export `lp.activity.export`)

| Attribute | Value |
| --- | --- |
| Purpose | Consolidated, read-only investor ledger across all in-scope funds: contributions, distributions, subscriptions, redemptions and fees, with six clickable KPI tiles, a filter bar, a paged table, CSV / Excel / PDF export and a transaction-detail drawer with the linked capital-call allocation, documents, FX note and notes. **[O]** |
| Access | Any signed-in LP user of any `lpRole` (VIEWER, SIGNATORY, MANAGER) may view and export; the screen contains no role gating and no write control. **[O]** Target permissions: `lp.activity.view` for the list and the entry detail, `lp.activity.export` for the export; both are held by VIEWER, SIGNATORY and MANAGER. **[I]** Route gate and session are those of 5.B.0. Rows are scoped to the investor organisation and its entitled funds; a fund outside the entitlement answers 403 `LP_FORBIDDEN` ("Not entitled to this fund"), an unknown or foreign entry id answers 404. **[I]** |
| Prototype layer | Native React: `components/lp-portal/screens/lp-account-activity-screen.tsx` (route `app/(lp)/lp-portal/account-activity/page.tsx`); hook `useLpAccountActivity` in `lib/lp-portal/hooks.ts`; row mapping `mapAccountActivityRow` in `lib/lp-portal/mappers.ts`; data from `lib/lp-portal/mock-store.ts` (9 hard-coded entries) through `lib/lp-portal/mock-api.ts` and the `lpPortalApi` Proxy in `lib/api/lp-portal-api.ts`. **[O]** |
| Wiring status | Prototype for every element. Target calls: `lpPortalApi.getAccountActivity` = `GET /lp-portal/account-activity`; `lpPortalApi.getLedgerEntry` = `GET /lp-portal/ledger/{entryId}`; `lpPortalApi.exportAccountActivity` = `GET /lp-portal/account-activity/export`; `lpPortalApi.downloadDocument` = `GET /lp-portal/documents/{id}/download`. **[O]** The method `lpPortalApi.getLedger` (`GET /lp-portal/ledger`) exists in the contract but no screen calls it. **[O]** |
| Entry points | Sidebar *Account Activity* (`/lp-portal/account-activity`); sidebar sub-tree *Capital Account* (`?structure=private-capital`) and *Account Holdings* (`?structure=open-ended`); topbar quick link *Account Activity* ("Transactions and statements"); dashboard links *View All Activity*, the *View All* link of the *Recent Capital Activity* panel and *View Account Details* (`?structure=open-ended`); performance link *View Full Performance Details*; linked-record links of type ledger / transaction / activity (`?entry={entryId}`) resolved by the Requests & Messages screen; request type with "ACCOUNT" or "STATEMENT" in its name. **[O]** |
| Exit points | Document icon in the table (selected row only) and *Open* icon / *Open call notice document* link in the drawer -> `/lp-portal/documents?document={documentId}`; sidebar and topbar navigation. **[O]** |

##### Layout

1. Error banner (only when the list request failed): red rounded box above the title with the error text and a *Retry* button. **[O]**
2. Page header: title *Account Activity* and the subtitle "Detailed view of all transactions across your investments". **[O]**
3. KPI strip: six clickable tiles (2 columns below 768 px, 3 columns from 768 px, 6 columns from 1280 px): *Contributions*, *Distributions*, *Subscriptions*, *Redemptions*, *Fees*, *Net Cash Flow*. **[O]**
4. Filter bar (white card): *Fund*, *Transaction Type*, *Date Range*, *Currency*, *Structure*, *Status*, then *More Filters* and *Clear All* (single row from 1024 px, stacked below). **[O]**
5. Results card: (a) summary line "Showing x to y of n transactions" with the three export buttons; (b) the transactions table (11 columns, horizontal scroll under 1100 px); (c) footer with *Rows per page* and the pager. **[O]**
6. *Transaction Details* drawer: sticky right column (340 px, from 1280 px) beside the results card; below 1280 px it is stacked under the card. Present only while a row is selected. **[O]**
7. Overlay: *More filters* dialog (opened from the filter bar). **[O]**

##### Elements

| # | Element | Type | Content / behaviour | Data source (current -> target) | Label |
| --- | --- | --- | --- | --- | --- |
| 1 | Error banner | alert box + button | Shows the request error message; *Retry* re-runs the list request. The page below stays rendered (KPIs show zero values, the table shows "No transactions match the selected filters."). | Request error -> `getAccountActivity` error | [O] |
| 2 | Page title / subtitle | text | "Account Activity" (24 px bold) / "Detailed view of all transactions across your investments". | Static | [O] |
| 3 | KPI tile *Contributions* | button | Icon circle (blue `#dbeafe` / `#2563eb`, arrow-down-to-line), label, value = sum of the reporting amounts of the rows classified *contribution*, caption "{count} Transactions" (blue, not a link; no singular form). Active tile: border `#93c5fd` and ring `#bfdbfe`. Click toggles the *Contributions* filter (see Business rules). Info popover: "Capital paid into fund commitments." | `getAccountActivity` rows -> same (target: API-computed totals per type, see Gaps) | [O] |
| 4 | KPI tile *Distributions* | button | Green `#dcfce7` / `#16a34a`; rows classified *distribution*. Popover: "Cash returned from fund investments." | same | [O] |
| 5 | KPI tile *Subscriptions* | button | Violet `#ede9fe` / `#7c3aed`; rows classified *subscription*. Popover: "Open-ended fund purchase requests." | same | [O] |
| 6 | KPI tile *Redemptions* | button | Orange `#ffedd5` / `#ea580c`; rows classified *redemption*. Popover: "Open-ended fund redemption requests." | same | [O] |
| 7 | KPI tile *Fees* | button | Red `#fee2e2` / `#dc2626`; rows classified *fee*. Popover: "Management and administrative charges." | same | [O] |
| 8 | KPI tile *Net Cash Flow* | button | Teal `#ccfbf1` / `#0d9488`; value = contributions + subscriptions - distributions - redemptions - fees (all rows); caption "{n} Transactions" with n = number of all loaded rows. Click toggles the tile highlight only; it does not filter. Popover: "Net of inflows and outflows in reporting currency." | same | [O] |
| 9 | KPI info popover | icon button (info) top-right of each tile | `aria-label` "{label} info"; popover shows the label in bold and the description above. Placed outside the tile button (a button inside a button was a hydration error). | Static | [O] |
| 10 | KPI value format | number | Compact money, always USD: absolute value at least 1 000 000 000 -> `$x.xxB`; at least 1 000 000 -> `$x.xxM`; at least 1 000 -> `$x.xK` (1 decimal); otherwise `$1,234.50`. Negative values print the sign after the symbol (`$-666.4K`). | `formatMoneyCompact` | [O] |
| 11 | KPI scope | rule | Tiles are computed over every row returned for the fund scope and date range. They do **not** react to the Fund / Type / Currency / Structure / Status / More-Filters controls or to the page. | - | [O] |
| 12 | Filter *Fund* | select | See Inputs. | rows' `fundName` | [O] |
| 13 | Filter *Transaction Type* | select | See Inputs. | rows' description | [O] |
| 14 | Filter *Date Range* | date input + "to" + as-of text | From-date input (aria-label "From date"), literal "to", and the global as-of date in short format (read-only text). | `from` / `to` query | [O] |
| 15 | Filters *Currency*, *Structure*, *Status* | selects | See Inputs. | hard-coded lists | [O] |
| 16 | *More Filters* | outline button, sliders icon | Opens the dialog; a 16 px blue badge with the count (1-5) of active advanced filters is shown at its top-right when the count is above zero. | Client state | [O] |
| 17 | *Clear All* | text button (blue) | Resets all filters (see Actions). | Client state | [O] |
| 18 | Result summary | text | "Showing {from} to {to} of {n} transactions": from = 0 when there are no rows, else first index on the page; to = min(page end, n); n = number of rows after filtering. | Client count | [O] |
| 19 | *Export CSV* | outline pill button (green sheet icon) | See Actions. | `exportAccountActivity(format=csv)` | [O] |
| 20 | *Export Excel* | outline pill button (blue sheet icon) | See Actions; sends `format=xlsx`. | `exportAccountActivity(format=xlsx)` | [O] |
| 21 | *Export PDF* | outline pill button (red file icon) | See Actions. | `exportAccountActivity(format=pdf)` | [O] |
| 22 | Transactions table | table | See Tables. | `getAccountActivity` | [O] |
| 23 | Pager | footer | *Rows per page* select, previous / next buttons and up to five page-number buttons. | Client state | [O] |
| 24 | Transaction Details drawer | aside | See Modals & drawers. | `getLedgerEntry` | [O] |
| 25 | Per-kind icon | 20 px circle in the *Type* column and 40 px in the drawer | contribution blue `#dbeafe`/`#2563eb`, distribution green, subscription violet, redemption orange, fee red (same colours as the tiles). Icons: arrow-down-to-line, arrow-up-from-line, receipt, refresh, file-text. | Row kind | [O] |
| 26 | *Posted By* value | text | Always "System" (not supplied by any API field). | Mapper constant -> API `postedBy` [P] | [O] / [P] |

##### Tables

**Transactions table** (11 columns; minimum width 1100 px; horizontal scroll)

| Column | Format | Sortable | Notes |
| --- | --- | --- | --- |
| *Transaction Date ↓* | `MMM d, yyyy` (en-US), blue medium weight | No (the arrow is part of the header text; the header is not clickable) | Date of the entry. **[O]** |
| *Effective Date* | `MMM d, yyyy` | No | Today equal to the transaction date (no API field). **[O]** |
| *Fund* | text, truncated at 180 px | No | Fund name. **[O]** |
| *Type* | kind icon + text | No | Entry description (e.g. "Capital Call CC-013"); if empty, the entry type with underscores replaced by spaces. **[O]** |
| *Reference* | monospace 11 px | No | Today the ledger entry id (e.g. "txn-1006"). **[O]** |
| *Currency* | 3-letter code | No | **[O]** |
| *Original Amount* | right-aligned, `1,234.56` (no symbol, 2 decimals) | No | **[O]** |
| *Reporting Amount* | right-aligned, 2 decimals, medium weight | No | Today identical to the original amount. **[O]** |
| *Exchange Rate* | right-aligned, 4 decimals (`1.0000`) | No | Today the constant 1. **[O]** |
| *Status* | pill badge (see colours) | No | **[O]** |
| *Document* | centered; red file icon button (`aria-label` "Document for {reference}") or grey "—" | No | Icon appears only on the **selected** row and only when the entry detail carries `callNoticeDocumentId`; click -> `/lp-portal/documents?document={id}` (click does not change the selection). **[O]** |

- Filters: the nine client-side filters and the server-side from-date, as listed in Inputs & validation. All are combined with AND. **[O]**
- Search: none (the *Reference contains* filter inside *More Filters* is the only text filter; case-insensitive substring on the reference after trimming). **[O]**
- Row click: selects the row (blue background `#eff6ff` and a 3 px left bar `#2563eb`) and opens the drawer; hover background `#f9fafb`. **[O]**
- Row actions: none besides the *Document* icon. **[O]**
- Pagination: client-side over the loaded rows; *Rows per page* options 10, 15 (default), 25, 50; page buttons show at most five numbers: all pages when five or fewer; pages 1-5 when the current page is 3 or less; the last five when the current page is within two of the end; otherwise current-2 to current+2; no first/last or ellipsis controls; previous / next disabled at the ends; active page has a blue `#2563eb` fill with white text. The current page is clamped to the last page when the filtered count shrinks. **[O]**
- Sort: none implemented; rows keep the order returned by the API. The mock returns seed order (not date order); the real ledger service returns date descending. **[O] / [I]**
- Loading row: one cell spanning 11 columns, "Loading account activity…". **[O]**
- Empty row: "No transactions match the selected filters." **[O]**
- Status -> badge colour (pill, 11 px semibold, fully rounded): *Posted* background `#dcfce7` text `#15803d`; *Settled* `#dbeafe` / `#1d4ed8`; *Under Review* `#ffedd5` / `#c2410c`; *Pending* `#fef9c3` / `#a16207`. Any other status text (for example *Issued*, *Allocated*, *Paid*, which the demo data produces) has **no colour entry** and renders as an unstyled pill. **[O]**
- Status text rule: the API status with underscores replaced by spaces and each word capitalised (`UNDER_REVIEW` -> "Under Review"). **[O]**

##### Inputs & validation

| Field | Control | Required | Options / default / placeholder | Validation today (code) | Target validation | Error message |
| --- | --- | --- | --- | --- | --- | --- |
| *Fund* | select | No | Default "All Funds"; options = distinct fund names of the loaded rows (fund names of the session when there are no rows). | Exact string match on the fund name. **[O]** | Options from the entitled funds; filter by fund id. **[P]** | None |
| *Transaction Type* | select | No | Default "All Types"; options = distinct values of the *Type* column (one entry per distinct description, e.g. "Capital Call CC-013", "Subscription SUB-024"). | Exact string match. **[O]** | Options from the controlled transaction-type dictionary (capital call, capital call payment, distribution, distribution payout, subscription, redemption, fee, other). **[P]** | None |
| *Date Range* from | `input type=date`, aria-label "From date" | No | Empty; no min / max. | None; a change triggers a new list request with `from`; a from-date after the as-of date yields an empty list. **[O]** | Reject a from-date after the as-of date. **[P]** | None today. Target: "From date must be on or before the as-of date" **[P]** |
| *Date Range* to | read-only text | n/a | The global as-of date (short format); changed only through the topbar. | - **[O]** | - | - |
| *Currency* | select | No | Default "All Currencies"; options USD, EUR, GBP (hard-coded). | Exact match on the currency code, client side only (the `currency` API parameter is not sent). **[O]** | Options from the currencies present in the data. **[P]** | None |
| *Structure* | select | No | Default "All Structures", or "LP" / "Open-End" when the page is opened with `?structure=private-capital` / `?structure=open-ended`; options LP, Open-End, Credit (hard-coded). | Exact match on the structure label (the mapper yields LP, Open-End or Credit). **[O]** | - | None |
| *Status* | select | No | Default "All Statuses"; options Posted, Settled, Under Review, Pending (hard-coded). | Exact match. Rows with status Issued, Allocated or Paid cannot be matched by any option. **[O]** | Options cover every status the API returns. **[P]** | None |
| *Investor* (More Filters) | select | No | Default "All investors"; options = distinct investor names (the client's legal name for every row). | Exact match. **[O]** | - | None |
| *Reference contains* (More Filters) | text input | No | Placeholder "e.g. CC-2024-07". | Case-insensitive substring of the reference (the entry id today). **[O]** | Match the business reference (e.g. "CC-013"). **[P]** | None |
| *Posted by* (More Filters) | select | No | Default "Anyone"; options = distinct posters (only "System" today). | Exact match. **[O]** | - | None |
| *Min amount* (More Filters) | number input, min 0, step 0.01 | No | Placeholder "0.00". | Parsed with `Number`; ignored when blank or not a number; compares the **signed** reporting amount (`amount < min` hides the row), so outflows stored as negative numbers are hidden by any positive minimum. **[O]** | Compare the absolute amount. **[P]** | None |
| *Max amount* (More Filters) | number input, min 0, step 0.01 | No | Placeholder "No limit". | Same parsing; hides rows with `amount > max`. No check that max is at least min. **[O]** | Reject max below min. **[P]** | None today. Target: "Max amount must be at least Min amount" **[P]** |
| *Rows per page* | select | No | 10 / 15 / 25 / 50, default 15. | Changing it resets to page 1. **[O]** | - | None |

##### Actions

| Control | Enabled when | Permission | Effect (state change, toast text, navigation) | Wiring / API | Label |
| --- | --- | --- | --- | --- | --- |
| KPI tile click | Always | None | Sets the type filter to the tile's kind (or back to *all* when the same tile is clicked again) and returns to page 1. The *Net Cash Flow* tile toggles its highlight only. | Prototype | [O] |
| Fund / Type / Currency / Structure / Status change | Always | None | Applies the filter and returns to page 1. | Prototype | [O] |
| From-date change | Always | None | Sets the from date, returns to page 1 and re-requests the list with `from`. | Prototype -> `getAccountActivity({from})` | [O] |
| *More Filters* | Always | None | Opens the *More filters* dialog. | Prototype | [O] |
| *Clear All* | Always | None | Resets metric, fund, type, currency, structure (to *all*, even when the URL set it), status, from date, investor, reference, posted by, min, max; page 1; toast (neutral) "Filters cleared". | Prototype | [O] |
| *Export CSV* / *Export Excel* / *Export PDF* | No export is running (all three disable while any export runs; no spinner) | `lp.activity.export` (all roles) | Requests the file for the current fund scope, from date and as-of date, saves it as `account-activity.csv`, `account-activity.xlsx` or `account-activity.pdf` and shows the toast "CSV exported." / "EXCEL exported." / "PDF exported.". Failure toast: the API error message, else "Export failed". The export does **not** apply the type, status, currency, structure, amount, investor, reference, posted-by or tile filters. | Prototype -> `lpPortalApi.exportAccountActivity({fundId, from, to, format: csv\|xlsx\|pdf})` = `GET /lp-portal/account-activity/export` | [O] |
| Table row click | Always | None | Selects the row and loads its detail (see drawer). | Prototype -> `getLedgerEntry(entryId)` = `GET /lp-portal/ledger/{entryId}` | [O] |
| Row *Document* icon | Selected row has `callNoticeDocumentId` | None | Navigates to `/lp-portal/documents?document={id}`. | Prototype | [O] |
| Rows per page change | Always | None | Sets the page size and returns to page 1. | Prototype | [O] |
| Previous / Next / page number | Previous disabled on page 1, Next on the last page | None | Changes page. | Prototype | [O] |
| *Retry* (banner) | Banner shown | None | Re-runs the list request. | Prototype -> `getAccountActivity` | [O] |

##### Modals & drawers

**Dialog — More filters** (`max-w-md`; opened by *More Filters*) **[O]**

Title "More filters"; description "Narrow transactions by investor, reference, poster, or amount range."

| Field | Control | Required | Options / default / placeholder | Validation today (code) | Target validation | Error message |
| --- | --- | --- | --- | --- | --- | --- |
| *Investor* | select | No | "All investors" + names | None | - | None |
| *Reference contains* | text | No | "e.g. CC-2024-07" | None | - | None |
| *Posted by* | select | No | "Anyone" + names | None | - | None |
| *Min amount* | number (min 0, step 0.01) | No | "0.00" | None beyond the browser's number control | See main table | None |
| *Max amount* | number (min 0, step 0.01) | No | "No limit" | None | See main table | None |

| Control | Enabled when | Permission | Effect | Wiring / API | Label |
| --- | --- | --- | --- | --- | --- |
| *Reset* | Always | None | Clears the five advanced fields; the dialog stays open; the page is not reset. | Prototype | [O] |
| *Apply filters* | Always | None | Returns to page 1 and closes the dialog. (Filters already apply live while typing; closing the dialog with its close control keeps the values.) | Prototype | [O] |

**Drawer — Transaction Details** (aside; sticky; shows for the selected row) **[O]**

Content, top to bottom:
1. Header: *Transaction Details* and a close button (`aria-label` "Close details") that clears the selection (see the defect below: the first row is selected again immediately).
2. Identity block: kind icon (40 px), type text (bold) with the status badge, and "Reference: {reference}".
3. Definition list (label grey, value medium): *Transaction Date*, *Effective Date*, *Fund*, *Structure* (LP / Open-End / Credit), *Investor* (the client's legal name), *Currency*, *Original Amount* (2 decimals), *Reporting Amount*, *Exchange Rate* (4 decimals), *Status* (plain text), *Posted Date* (today equal to the transaction date), *Posted By* ("System").
4. While the detail request runs: "Loading allocation details…". When the detail carries an allocation: heading *Capital Call Allocation* with *Call Amount*, *Amount Paid* and *Status*, printed as the raw API values (for example 150000.00 and OUTSTANDING; not formatted). Nothing is shown for entries without an allocation.
5. Documents: when the detail has documents, heading "Linked Documents ({n})" and one row per document with a red file icon, the name (truncated), "{published date} · {size}" (size as `820.0 KB`, `1.2 MB`, or "—" when unknown) and two icon buttons *Open {name}* (navigate to the document) and *Download {name}* (download). When there are no documents but the detail has `callNoticeDocumentId`, a heading "Linked Documents" and a link "Open call notice document". Otherwise the section is absent.
6. *FX Details*: a small "fx" badge and the note (always "No FX required" today).
7. *Notes*: the entry description in a grey box.

| Control | Enabled when | Permission | Effect | Wiring / API | Label |
| --- | --- | --- | --- | --- | --- |
| Close (X) | Always | None | Sets the selection to none; an effect immediately selects the first row of the filtered list again, so the drawer never stays closed while rows exist. | Prototype | [O] |
| *Open {name}* | Document has an id | None | Navigates to `/lp-portal/documents?document={id}`. | Prototype | [O] |
| *Download {name}* | Document has an id | `lp.documents.download` | Downloads the file under the document name; toast "Document downloaded."; failure toast: the API error message, else "Download failed". | Prototype -> `lpPortalApi.downloadDocument(id)` = `GET /lp-portal/documents/{id}/download` | [O] |
| *Open call notice document* | Detail has `callNoticeDocumentId` and no document list | None | Navigates to the document. | Prototype | [O] |

##### States

- Empty: table row "No transactions match the selected filters." (shown both when filters exclude everything and when the API returned no entries); KPI tiles show `$0.00` and "0 Transactions". No separate "no data yet" illustration. **[O]**
- Loading: first load and every re-request (from-date change, fund change, as-of change) replace the table body with "Loading account activity…"; KPI tiles show the previous or zero values meanwhile; the drawer shows "Loading allocation details…" for its allocation block. **[O]**
- Error: list failure -> banner with the message (fallback "Request failed") and *Retry*; detail failure -> toast "Could not load transaction detail" (or the API / error message when one exists) and the allocation and document blocks stay empty. **[O]**
- Disabled / read-only: the three export buttons are disabled while an export runs; previous / next pager buttons disabled at the ends. No role-based disabling exists; the screen is read-only for everyone. **[O]**
- Conditional: the drawer column exists only while a row is selected; the *Document* icon only for the selected row with a call-notice document; the filter badge only when advanced filters are active; the allocation block only for entries with an allocation; empty KPI counts show "0 Transactions". Layout: single column below 1280 px (drawer under the table); KPI strip 2 / 3 / 6 columns at the 768 px and 1280 px breakpoints. **[O]**

##### Business rules & calculations

- Row classification (kind) from the entry type: type contains "DISTRIBUTION" -> distribution; "SUBSCRIPTION" -> subscription; "REDEMPTION" -> redemption; "FEE" -> fee; every other value (including capital call, capital-call payment and "OTHER") -> contribution. **[O]**
- Structure label: the entry's `structure` (else `operatingModel`) in upper case containing "OPEN" -> Open-End; containing "CREDIT" -> Credit; otherwise LP (so "Closed-End" and "Private capital" show as LP). **[O]**
- Tile value = sum of reporting amounts of the rows of the kind. Net Cash Flow = (contribution + subscription) - (distribution + redemption + fee), each term the sum of signed reporting amounts. BR-098: the API returns every ledger amount as a positive magnitude and the kind carries the direction; the demo data returns outflows as negative numbers, which makes the net formula add them. **[O] / [P]**
- The tiles and the net total ignore the filter controls (scope = fund selection, as-of date, from date). **[O]**
- Date scope: the list request sends the topbar fund (omitted when "All Funds"), the from date (omitted when empty) and the as-of date as `to`, with `pageSize` 100 and no `page`. Entries dated after the as-of date are not shown; the as-of date is empty on the first render (the request goes out without `to`) and the list is requested again when the session sets it. **[O]**
- Only the first 100 entries are ever shown; the response `total` is not used. **[O]**
- Exports use the same fund / from / to scope and never the screen filters. **[O]**
- Real ledger rules: entry types are capital call, capital call payment, distribution, distribution payout, subscription and redemption; payments are separate entries with status "POSTED"; entries are sorted by date descending; the list is not paginated server side. **[I]**
- Multi-currency (design): preserve original amount and currency; preserve the historic exchange rate and date; never overwrite; display currency does not alter ledger records; investors cannot edit a posted transaction. **[I]**
- Formats: dates `MMM d, yyyy`; table amounts `1,234.56`; file sizes below 1 KB `{n} B`, below 1 MB `{x.x} KB`, else `{x.x} MB`. **[O]**

##### Edge cases

- With the demo data and the default as-of date 30 Jun 2026, the three July 2026 entries (txn-1006, txn-1007, txn-1008) are hidden; six rows show in this order: txn-1005, txn-1004, txn-1003, txn-1002, txn-1001, txn-1000 (not date order). KPI values: Contributions `$750.0K` (3), Distributions `$-666.4K` (2), Subscriptions `$500.0K` (1), Redemptions `$0.00` (0), Fees `$0.00` (0), Net Cash Flow `$1.92M` (6). **[O]**
- The *OTHER* entry txn-1000 (amount 0.00) is counted as a contribution. **[O]**
- Status filter cannot select "Paid" / "Allocated" / "Issued" rows; a type filter holds one option per distinct description. **[O]**
- Opening `?entry={id}` on a fresh page load does not keep the entry selected: while the list is loading the selection is reset, and the first row is chosen afterwards. It works only when the page is reached by an in-app navigation after the list has loaded, and only when the entry is inside the filtered list. **[O]**
- Out-of-order detail responses are not cancelled; a slow response can overwrite the detail of the row selected later. **[O]**
- A min filter hides outflows because amounts are compared signed. **[O]**
- A from-date after the as-of date, or an empty fund scope, shows the empty row. **[O]**
- Clearing filters while `?structure=` is in the URL resets the structure to "All Structures". **[O]**
- Demo detail data: txn-1006 -> allocation `alloc-cc-013` (call amount 150000.00, paid 0.00, status OUTSTANDING) and document "CC-013 Capital Call Notice" (Jul 1, 2026 · 820.0 KB); txn-1003 -> allocation `alloc-cc-012` (250000.00 / 250000.00 / PAID) and "CC-012 Capital Call Notice" (Jun 1, 2026 · 791.0 KB); txn-1004 -> "DIST-008 Distribution Statement" (Mar 20, 2026 · 500.0 KB); txn-1005 -> "Subscription Confirmation SUB-024" (Jun 3, 2026 · 234.4 KB); other entries have no allocation and no documents; an unknown entry id returns an empty default detail instead of an error. **[O]**
- Demo entries (id, fund, date, amount, description, status): txn-1008 Equity, 15 Jul 2026, -1250.00, "Management fee accrual – Jul 2026", POSTED; txn-1007 Equity, 8 Jul 2026, -250000.00, "Redemption request RDM-016", UNDER_REVIEW; txn-1006 Growth, 1 Jul 2026, 150000.00, "Capital Call CC-013", ISSUED; txn-1005 Equity, 22 May 2026, 500000.00, "Subscription SUB-024", ALLOCATED; txn-1004 Growth, 20 Mar 2026, -490000.00, "Distribution DIST-008 – Exit Proceeds", PAID; txn-1003 Growth, 1 Jun 2026, 250000.00, "Capital Call CC-012", PAID; txn-1002 Growth, 12 Dec 2025, -176400.00, "Distribution DIST-007 – Dividend", PAID; txn-1001 Growth, 1 Feb 2026, 500000.00, "Capital Call CC-011", PAID; txn-1000 Equity, 1 Apr 2026, 0.00, "Share class rebalancing (book entry)", POSTED. All USD. **[O]**
- Real-backend differences to expect once wired: entry ids are allocation / payment cuids; descriptions read "Capital call — {percent}%", "Capital call payment received", "Distribution declared", "Distribution payout", "SUBSCRIPTION request", "REDEMPTION request"; amounts are positive; there are no fee entries; the allocation in the drawer is a raw record and for distribution entries has other field names. **[I]**

##### Gaps, defects & open questions

- **DEF-356** The status badge map has four entries while the mapper passes every API status through; *Issued*, *Allocated* and *Paid* (and any other value) render unstyled and cannot be filtered.
- FR-LP-028: Define one status vocabulary for ledger entries and give every value a badge colour per the design legend (green completed / paid / posted, blue active / issued / allocated, amber pending, red cancelled / rejected, purple under review) and a filter option. — AC: no row renders an unstyled badge; every status returned by the API appears in the Status filter; an unknown status renders a neutral grey badge with its text.
- **DEF-357** *Transaction Type* options are free-text descriptions; *Reference* is the internal entry id; *Effective Date*, *Reporting Amount*, *Exchange Rate*, *Posted Date*, *Posted By* and *Notes* are fabricated from other fields; the FX block always says "No FX required".
- FR-LP-029: The activity API returns `entryId`, business `reference`, controlled `entryType`, `transactionDate`, `effectiveDate`, `originalAmount` + `originalCurrency`, `reportingAmount` + `reportingCurrency`, historic `exchangeRate` + `fxDate`, `status`, `postedDate`, `postedBy` (display name or "System"), `notes` and `documents[]`; the UI shows them without derivation. — AC: a multi-currency entry shows distinct original and reporting amounts and its historic rate; changing the display currency never changes the stored rate.
- Q-103: Which `postedBy` value may an investor see (internal staff names are normally hidden)? — default: show "System" or the role name, never a staff user name.
- BR-099: Ledger amounts are positive magnitudes; the type determines direction; Net Cash Flow = contributions + subscriptions - distributions - redemptions - fees over settled (posted) rows only. — AC: for the demo data the net equals contributions + subscriptions minus the absolute distributions, redemptions and fees.
- FR-LP-030: Entries of type other than the five tile kinds are not counted as contributions; tiles list only the five kinds; an "Other" line is not added to the net. — AC: txn-1000 ("OTHER", 0.00) is excluded from every tile's count.
- FR-LP-031: The KPI tiles, the transactions count and the exports respect the same filters as the table (or the tiles state "All entries in scope"). — AC: after selecting Status "Posted" the tile counts equal the number of Posted rows, or the tile caption reads "{n} in scope"; an export after filtering contains exactly the rows shown.
- FR-LP-032: The activity list is sorted by transaction date descending (then entry id descending) by the API, accepts `sortBy`, `sortDirection`, `type`, `status`, `currency`, `structure`, `search` and `page` / `pageSize`, and the UI pages server side with the real `total`. — AC: with more than 100 entries every entry is reachable; the *Transaction Date ↓* header matches the order.
- FR-LP-033: Export returns real files: CSV (`text/csv`), XLSX (`application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`) and PDF (`application/pdf`) with the columns of the table (Transaction Date, Effective Date, Fund, Type, Reference, Currency, Original Amount, Reporting Amount, Exchange Rate, Status); error body `LP_EXPORT_FAILED`. — AC: each file opens in its native application; the CSV header names match the column titles. (The real NVCCZ endpoint returns a CSV with blank id and type columns and JSON for xlsx / pdf.)
- **DEF-358** The detail drawer cannot be closed because the first row is re-selected; the `?entry=` link is lost on a fresh load. FR-LP-034: closing the drawer keeps it closed until another row is chosen; `?entry=` selects that entry (loading it by id even when it is outside the current filter) and scrolls it into view. — AC: closing leaves no drawer; a shared link opens with the entry selected.
- **DEF-359** The as-of date is forced as the end of the date range, so the target of a deep link dated after the as-of date is never listed. Q-104: Should `?entry=` widen the as-of date to the entry date? — default: yes, the entry's detail is shown independently of the date range.
- **DEF-360** Negative amounts print as `$-666.4K` in tiles and a positive minimum hides outflows. FR-LP-035: compact money places the sign before the symbol (`-$666.4K`); min / max compare absolute amounts. — AC: `-666400` -> `-$666.4K`; Min 100 000 shows the 490 000 distribution.
- **DEF-361** The drawer prints allocation amounts as raw strings and, for a distribution or payment entry in the real API, would show an allocation block titled "Capital Call Allocation" with empty values. FR-LP-036: the detail response has a typed shape per entry type (capital call: allocation, payments, notice; payment; distribution: allocation, payments, statement; subscription / redemption: request summary) and the drawer titles the block by type and formats money. — AC: every entry type opens without error; subscription and redemption entries no longer answer 404.
- Q-105: Should Currency, Structure and Status options be derived from the data? — default: yes.
- **DEF-362** `lpPortalApi.getLedger` is unused; the detail endpoint is `/ledger/{id}` while the backend design names `account-activity/{id}`. Q-106: keep `/ledger` as an alias? — default: yes during migration.
- **DEF-363** The route `?structure=` parameter is not applied to the request (it filters on the client only), and *Clear All* undoes it.
- **DEF-364** Stale-response race on the detail request. FR-LP-037: ignore responses for a row that is no longer selected. — AC: rapid row changes always show the last-selected row's detail.

#### 5.B.4 Capital Activity (`/lp-portal/capital-activity`, `lp.capital_calls.view`, `lp.distributions.view`)

| Attribute | Value |
| --- | --- |
| Purpose | Capital-call register with a selected-call detail panel (amount due, wiring instructions, timeline, acknowledgement, linked documents) and the distribution ledger; investor actions: view notice, download notice, acknowledge, submit payment confirmation, download distribution document and distribution statement. Acknowledgement records that the investor has seen the notice; it is not a confirmation of payment. **[O]** |
| Access | View and download actions: any `lpRole`. Acknowledge and payment-confirmation upload: `lpRole` SIGNATORY or MANAGER only; the UI enables them when `lpRole` is not VIEWER (also while the role is still unknown during session load). **[O]** Server enforcement: acknowledge and upload require the Signatory role and the permissions `lp.capital_calls.acknowledge` / `lp.capital_calls.upload_payment_confirmation` (403 `LP_FORBIDDEN`, "Authorised Signatory access required"); VIEWER holds `lp.capital_calls.view`, `lp.capital_calls.download_notice`, `lp.distributions.view`, `lp.distributions.download`. **[I]** Records are limited to the investor organisation's own allocations and entitled funds; foreign ids answer 404. **[I]** |
| Prototype layer | Native React: `components/lp-portal/screens/lp-capital-activity-screen.tsx` (route `app/(lp)/lp-portal/capital-activity/page.tsx`); hooks `useLpCapitalCalls`, `useLpCapitalCallDetail`, `useLpDistributions` in `lib/lp-portal/hooks.ts`; mappers in `lib/lp-portal/mappers.ts`; data from `lib/lp-portal/mock-store.ts` through `lib/lp-portal/mock-api.ts`. **[O]** |
| Wiring status | Prototype for every element. Target calls: `getCapitalCalls` = `GET /lp-portal/capital-calls`; `getCapitalCallSummary` = `GET /lp-portal/capital-calls/summary`; `getCapitalCall` = `GET /lp-portal/capital-calls/{id}`; `getCapitalCallDocuments` = `GET /lp-portal/capital-calls/{id}/documents`; `acknowledgeCapitalCall` = `POST /lp-portal/capital-calls/{id}/acknowledge`; `uploadPaymentConfirmation` = `POST /lp-portal/capital-calls/{id}/payment-confirmations`; `downloadCapitalCallNotice` = `GET /lp-portal/capital-calls/{id}/notice/download`; `getDistributions` = `GET /lp-portal/distributions`; `downloadDistribution` = `GET /lp-portal/distributions/{id}/download`; `downloadDistributionStatement` = `GET /lp-portal/distributions/statement/download`; `downloadDocument` = `GET /lp-portal/documents/{id}/download`. `getDistribution` (`GET /lp-portal/distributions/{id}`) exists in the contract but no control calls it. **[O]** |
| Entry points | Sidebar *Capital Calls* (`?tab=calls`) and *Distributions* (`?tab=distributions`), also in the *My Investments* private-capital sub-tree; topbar quick link *Capital Activity* ("Calls and distributions"); dashboard *View Capital Summary*, every row of the dashboard *Recent Capital Activity* panel (plain route, no query), action-required items and notifications with `?call=cc-013`; performance link *View Cash Flow Details*; linked-record links of type capital call (`?call={id}`) or distribution (`?tab=distributions`); service-request types containing "CAPITAL". **[O]** |
| Exit points | Document links and icons -> `/lp-portal/documents?document={id}`; *View Notice* -> the document page, or a new browser tab with the notice file; sidebar and topbar navigation. **[O]** |

##### Layout

1. Loading skeleton (first load only) or error panel (both requests failed, no data): see States. **[O]**
2. Page header: title *Capital Calls & Distributions* and the subtitle "View and manage capital calls and distributions across your investments." **[O]**
3. Tab bar: *Capital Calls* and *Distributions*. **[O]**
4. KPI strip: five tiles (2 / 3 / 5 columns at the 640 px and 1024 px breakpoints): *Outstanding Calls*, *Paid Calls*, *Upcoming Due Amount*, *Total Distributions*, *Overdue Calls*; shown on both tabs. **[O]**
5. *Capital Calls* card (calls tab only): toolbar with *View Notice*, *Download Notice*, *Acknowledge*, *Submit Payment Confirmation*; calls table; footer link *View all Capital Calls →*. **[O]**
6. *Distributions* card (both tabs; first 3 rows on the calls tab, all rows on the distributions tab): *Download Statement* button, distributions table, footer link *View all Distributions →*. **[O]**
7. *Selected Capital Call* panel (calls tab, while a call is selected): right column of 300 px from 1280 px, otherwise under the cards: summary, amount-due callout, wiring preview, timeline and acknowledgement status, linked documents. **[O]**
8. *Wiring instructions* dialog (overlay). **[O]**
9. Hidden file input (always mounted) used for the payment confirmation: accepts `.pdf,.png,.jpg,.jpeg,.txt`. **[O]**

##### Elements

| # | Element | Type | Content / behaviour | Data source (current -> target) | Label |
| --- | --- | --- | --- | --- | --- |
| 1 | Page root | container | Carries the attribute `data-as-of` = the global as-of date. | Context -> same | [O] |
| 2 | Title / subtitle | text | "Capital Calls & Distributions" / "View and manage capital calls and distributions across your investments." | Static | [O] |
| 3 | Tab *Capital Calls* | text button | Active: blue text and 2 px blue underline `#2563eb`. Initial tab from `?tab=`: only the value `distributions` selects the other tab, anything else (or no value) selects *Capital Calls*. Clicking changes the tab but not the URL. | Static | [O] |
| 4 | Tab *Distributions* | text button | As above. | Static | [O] |
| 5 | KPI *Outstanding Calls* | tile (icon clock, bg `#e8f1ff`, icon `#2563eb`) | Value = `summary.outstanding` in compact money; footer button "{openCount} Calls" (no singular) switches to the calls tab. | `getCapitalCallSummary` -> `GET /lp-portal/capital-calls/summary?fundId` | [O] |
| 6 | KPI *Paid Calls* | tile (check-circle, `#e7f8ef` / `#16a34a`) | Value = `summary.paidYtd`; footer "{paidCallCount} Calls" -> calls tab. | same | [O] |
| 7 | KPI *Upcoming Due Amount* | tile (calendar, `#fff1e8` / `#f97316`) | Value = `summary.dueSoonAmount`; footer "{dueSoonCount} Calls Due" -> calls tab. | same | [O] |
| 8 | KPI *Total Distributions* | tile (circle-dollar, `#f3e8ff` / `#7c3aed`) | Value = `summary.totalDistributions`; footer "{count} Upcoming Notice" with "s" unless the count is 1 when `summary.upcomingDistributionNotices` is present (an object with `count 0` still counts as present), else "Since Inception"; click -> distributions tab. | same | [O] |
| 9 | KPI *Overdue Calls* | tile (file-text, `#e6faf8` / `#0d9488`) | Value = `summary.overdue`; footer "{n} Overdue" where n = number of loaded call rows with status *Overdue* (not from the summary); click -> calls tab. | summary + loaded rows | [O] |
| 10 | KPI money format | rule | Compact money with the summary currency code (default USD): at least 1e9 `$x.xxB`, at least 1e6 `$x.xxM`, at least 1e3 `$x.xK`, otherwise `$0.00`. | `formatMoneyCompact` | [O] |
| 11 | Card heading *Capital Calls* | text + decorative info icon | The icon has no tooltip and is hidden from assistive technology. | Static | [O] |
| 12 | Toolbar *View Notice* | outline pill (eye) | See Actions. | `getCapitalCallDocuments` / `downloadCapitalCallNotice` | [O] |
| 13 | Toolbar *Download Notice* | outline pill (download) | See Actions. | `downloadCapitalCallNotice` | [O] |
| 14 | Toolbar *Acknowledge* | primary blue pill (download icon) | See Actions. | `acknowledgeCapitalCall` | [O] |
| 15 | Toolbar *Submit Payment Confirmation* | outline pill (sparkles icon) | Opens the file picker. | `uploadPaymentConfirmation` | [O] |
| 16 | Calls table | table | See Tables. | `getCapitalCalls` | [O] |
| 17 | Footer link *View all Capital Calls →* | text button | Raises the visible-row limit from 8 to all loaded calls; cannot be undone; always shown. | Client state | [O] |
| 18 | Card heading *Distributions* | text + decorative info icon | On the distributions tab the card has a faint blue ring. | Static | [O] |
| 19 | *Download Statement* | outline pill (download) | See Actions. | `downloadDistributionStatement` | [O] |
| 20 | Distributions table | table | See Tables. | `getDistributions` | [O] |
| 21 | Footer link *View all Distributions →* | text button | Switches to the distributions tab and shows all rows; always shown on both tabs. | Client state | [O] |
| 22 | Panel *Selected Capital Call* | aside | See Modals & drawers. | `getCapitalCall`, `getCapitalCallDocuments` | [O] |
| 23 | Dialog *Wiring instructions* | dialog | See Modals & drawers. | `getCapitalCall` | [O] |
| 24 | Row radio marker | 15 px circle | Filled blue with a white centre dot when the row is selected. | Client state | [O] |
| 25 | PDF icon | 20 px red file glyph labelled "PDF" | Used for distribution documents and linked documents. | Static | [O] |

##### Tables

**Capital calls table** (minimum width 920 px; horizontal scroll)

| Column | Format | Sortable | Notes |
| --- | --- | --- | --- |
| (selector, no title) | radio marker | No | Selected row = filled marker. **[O]** |
| *Call No.* | integer, bold | No | Call number. **[O]** |
| *Fund* | text, truncated at 220 px | No | **[O]** |
| *Issue Date* | `MMM d, yyyy` | No | **[O]** |
| *Due Date* | `MMM d, yyyy`; red bold `#ef4444` when the row is due soon or its status is *Overdue*, otherwise grey `#475569` | No | Due soon = due in 0 to 7 days and not paid. **[O]** |
| *Amount* | right, whole US dollars with `$` (`$150,000`) | No | Always USD formatting, ignoring `currencyCode`. **[O]** |
| *Paid* | right, whole dollars | No | **[O]** |
| *Outstanding* | right, whole dollars, medium weight | No | **[O]** |
| *Status* | centered badge | No | See colours. **[O]** |
| *Actions* | centered kebab button (`aria-label` "Actions for Call No. {n}") | No | Opens the row menu; clicking it does not select the row. **[O]** |

- Filters, search, sort: none. Order = API order (demo: call 13, 12, 11, 10; real service: newest allocation first). **[O] / [I]**
- Row click: selects the call (row background `#eff6ff`), loads its detail, and shows the panel. **[O]**
- Row actions (kebab menu, width 13 rem): *View Notice* (selects the row, then as the toolbar action); *Download Notice*; *Acknowledge* (check icon; disabled when the role is VIEWER, the call is already acknowledged, or the status is *Paid*); *Payment Confirmation* (file-pen icon; disabled for VIEWER; selects the row and opens the file picker). View and download items are not disabled while another action runs. **[O]**
- Pagination: none; the first 8 calls are shown until *View all Capital Calls →* is clicked; at most 50 calls are loaded (`pageSize` 50, no paging). **[O]**
- Empty and loading rows: none (an empty list shows the bare header). **[O]**
- Status -> badge (rounded rectangle, 11 px semibold): *Issued* background `#e8f1ff` text `#2563eb`; *Paid* `#e7f8ef` / `#15803d`; *Overdue* `#fee2e2` / `#dc2626`. **[O]**
- Status mapping: API `PAID` -> *Paid*; `OVERDUE` -> *Overdue*; every other value (ISSUED, ACKNOWLEDGED, PARTIALLY_PAID, CANCELLED) -> *Issued*. **[O]**

**Distributions table** (minimum width 820 px; uppercase 10 px headers)

| Column | Format | Sortable | Notes |
| --- | --- | --- | --- |
| *Distribution Ref* | bold blue text | No | Reference (e.g. "DIST-008"). **[O]** |
| *Fund* | text, truncated at 200 px | No | **[O]** |
| *Type* | text | No | *Return of Capital* or *Income* (see rule). **[O]** |
| *Gross Amount* | right, whole dollars | No | **[O]** |
| *Adjustments* | right; "(" + whole dollars + ")" when above zero, else "—" | No | **[O]** |
| *Net Paid* | right, bold, whole dollars | No | **[O]** |
| *Payment Date* | `MMM d, yyyy` | No | **[O]** |
| *Document* | centered red PDF icon button (`aria-label` "Open {ref} document") | No | Document id present -> navigates to `/lp-portal/documents?document={id}`; otherwise downloads the distribution file. **[O]** |

- Filters, search, sort: none; order = API order (demo: DIST-008, 007, 006; real service: newest allocation first). **[O] / [I]**
- Row click: none (row hover only); no detail view. **[O]**
- Pagination: first 3 rows on the calls tab; all loaded rows (at most 50) on the distributions tab or after *View all Distributions →*. **[O]**
- Empty and loading rows: none. **[O]**
- Status badge: none (the distribution status is not displayed). **[O]**
- Type mapping: the API type in upper case containing "INCOME" or "DIVIDEND" -> *Income*; everything else -> *Return of Capital*. **[O]**

##### Inputs & validation

| Field | Control | Required | Options / default / placeholder | Validation today (code) | Target validation | Error message |
| --- | --- | --- | --- | --- | --- | --- |
| Payment confirmation file | hidden `input type=file`, single file, field name `file` | Yes (action stops when no file is chosen) | `accept=".pdf,.png,.jpg,.jpeg,.txt"` (picker hint only); opened by *Submit Payment Confirmation* or the row menu item *Payment Confirmation* | None: no size check, no type check, no check that the call is unpaid. The input value is cleared after every attempt so the same file can be chosen again. **[O]** | Allowed extensions / types `.pdf`, `.png`, `.jpg`, `.jpeg`, `.txt`; maximum 25 MB (the server's upload limit); empty files rejected. **[P]** (the real server limits only the size, to 25 MB) **[I]** | Today the server message or "Failed to upload payment confirmation". Target: "File too large (maximum 25 MB)" and "Unsupported file type" **[P]** (backend codes `LP_FILE_TOO_LARGE` 413, `LP_UNSUPPORTED_MEDIA` 415 **[I]**) |
| Amount claimed | none today | No | The mock reads `amountClaimed` (or `amount`) from the form data and falls back to the call's outstanding amount; the real endpoint accepts `amountClaimed` and `notes`. | No field in the UI, so never sent. **[O]** | Optional decimal, greater than 0, at most 2 decimals, not above the call's outstanding amount. **[P]** | Target: "Enter an amount greater than 0 and not above the outstanding amount" **[P]** |
| Notes | none today | No | The real endpoint accepts free-text `notes`. | No field in the UI. **[O]** | Optional text, at most 2 000 characters (Q-NEW below). **[P]** | - |

##### Actions

| Control | Enabled when | Permission | Effect (state change, toast text, navigation) | Wiring / API | Label |
| --- | --- | --- | --- | --- | --- |
| Tab buttons | Always | None | Switch tab (URL unchanged). | Prototype | [O] |
| KPI footer buttons | Always | None | Switch to the calls tab (tiles 1, 2, 3, 5) or the distributions tab (tile 4). | Prototype | [O] |
| Call row click | Always | None | Selects the call; loads detail and documents. | Prototype -> `getCapitalCall(id)` + `getCapitalCallDocuments(id)` | [O] |
| *View Notice* (toolbar / row menu) | A call is selected and no action is running (toolbar); always in the menu | `lp.capital_calls.view` (all roles) | Selects the call; reads its documents; when the first document has an id, navigates to `/lp-portal/documents?document={id}`; otherwise downloads the notice and opens it in a new browser tab (no opener); the temporary link is revoked after 60 s. Failure toast: the error message, else "Could not open notice". | Prototype -> `getCapitalCallDocuments` then `downloadCapitalCallNotice` | [O] |
| *Download Notice* (toolbar / row menu) | Same as above | `lp.capital_calls.download_notice` (all roles) | Downloads `Call-Notice-No-{callNo}.pdf`; toast "Downloaded Call Notice — Call No. {callNo}". Failure toast: the error message, else "Failed to download notice". | Prototype -> `lpPortalApi.downloadCapitalCallNotice(id)` = `GET /lp-portal/capital-calls/{id}/notice/download` | [O] |
| *Acknowledge* (toolbar) | A call is selected, it is not yet acknowledged, role is not VIEWER, no action running | `lp.capital_calls.acknowledge` (SIGNATORY, MANAGER) | Sends the acknowledgement with a new idempotency key (UUID per click). Success: toast "Capital call acknowledged"; the call is marked acknowledged locally; the calls and the detail are reloaded. Failure toast: the error message, else "Failed to acknowledge capital call". | Prototype -> `lpPortalApi.acknowledgeCapitalCall(id, key)` = `POST /lp-portal/capital-calls/{id}/acknowledge`, header `Idempotency-Key`, body `{}` | [O] |
| *Acknowledge* (row menu) | Role is not VIEWER, call not acknowledged, row status is not *Paid* | same | Same effect for that row (the selection does not change). | same | [O] |
| *Acknowledge Call* (panel button) | Shown only when the selected call is not acknowledged and the role is not VIEWER; disabled while an action runs | same | Same effect. | same | [O] |
| *Submit Payment Confirmation* (toolbar) | A call is selected, role is not VIEWER, no action running | `lp.capital_calls.upload_payment_confirmation` (SIGNATORY, MANAGER) | Opens the file picker. After a file is chosen: uploads it as multipart field `file` with a new idempotency key. Success: toast "Payment confirmation uploaded for Call No. {callNo}: {fileName}"; the calls and the detail are reloaded. Failure toast: the error message, else "Failed to upload payment confirmation". The picker is reset. | Prototype -> `lpPortalApi.uploadPaymentConfirmation(id, formData, key)` = `POST /lp-portal/capital-calls/{id}/payment-confirmations` (multipart), header `Idempotency-Key` | [O] |
| *Payment Confirmation* (row menu) | Role is not VIEWER | same | Selects the row, then opens the file picker as above. | same | [O] |
| *View full details →* | A call is selected | None | Opens the *Wiring instructions* dialog. | Prototype | [O] |
| Copy button (reference) | Always visible in the panel | None | Copies the wiring reference; toast "Wiring reference copied" and the icon turns into a check for 1.6 s; failure toast "Unable to copy reference". Does nothing when the reference is empty. | Browser clipboard | [O] |
| Panel close (X) | Panel open | None | Clears the selection; unless the page was opened with `?call=`, the first call is selected again immediately (see Gaps). | Prototype | [O] |
| Linked-document name link | Documents present | None | Navigates to `/lp-portal/documents?document={id}`. | Prototype | [O] |
| Linked-document download icon | No action running | `lp.documents.download` | Downloads the document as `{name with characters other than letters, digits, underscore, dot and hyphen replaced by "-"}.pdf`; toast "Downloaded {name}". Failure toast: the error message, else "Failed to download document". | Prototype -> `lpPortalApi.downloadDocument(id)` = `GET /lp-portal/documents/{id}/download` | [O] |
| *Download Statement* | No action running | `lp.distributions.download` (all roles) | Downloads `Distribution-Statement.pdf` for the selected fund (all funds when none) and the as-of date; toast "Downloaded distribution statement". Failure toast: the error message, else "Failed to download statement". | Prototype -> `lpPortalApi.downloadDistributionStatement({fundId, asOfDate})` = `GET /lp-portal/distributions/statement/download` | [O] |
| Distribution *Document* icon | Always | `lp.distributions.download` for the download branch | With a `documentId`: navigates to the document page. Without: downloads `{reference}.pdf`; toast "Downloaded {reference}". Failure toast: the error message, else "Failed to download distribution". | Prototype -> `lpPortalApi.downloadDistribution(id)` = `GET /lp-portal/distributions/{id}/download` | [O] |
| *View all Capital Calls →* | Always | None | Show every loaded call. | Prototype | [O] |
| *View all Distributions →* | Always | None | Distributions tab, all rows. | Prototype | [O] |
| *Try Again* (error panel) | Both requests failed | None | Reloads calls and distributions. | Prototype | [O] |
| Single-action lock | - | - | While any of acknowledge, upload, notice, view, statement, distribution or document download is running, the toolbar buttons, the panel acknowledge button and the download icons are disabled; there is no spinner. | - | [O] |

##### Modals & drawers

**Panel — Selected Capital Call** (aside, calls tab, while a call is selected) **[O]**

Content, top to bottom:
1. Header *Selected Capital Call* and a close button (`aria-label` "Close detail").
2. "Call No. {callNo}" with the status badge; the fund name below it.
3. Rows: *Issue Date*; *Due Date* = date followed by a red "(in {n} days)" whenever the days value exists (the days value is always calculated, so it also prints negative numbers, e.g. "(in -73 days)", and appears for paid calls; no singular); the value is bold red when the call is due soon; *Total Amount*; *Paid*; *Outstanding* (whole dollars).
4. When the outstanding amount is above zero: light-blue callout "Amount Due by {due date}" and the outstanding amount in 22 px bold blue.
5. *Wiring Instructions (preview)* with the link *View full details →*; rows *Bank*, *Account Name*, *Account Number* (the masked number, e.g. "•••• 4812"; falls back to the full number, then "—"), *ABA / Routing*, *Reference / Memo* (bold; with the copy button). Values read "—" until the detail has loaded.
6. *Timeline* (left) and *Acknowledgment Status* (right, with a decorative info icon):
   - Timeline steps from the detail's `timeline` array. Label = step code with underscores replaced by spaces and each word capitalised: ISSUED -> "Issued", ACKNOWLEDGED -> "Acknowledged", PAYMENT_RECEIVED -> "Payment Received", ALLOCATED -> "Allocated" (demo) or CLOSED -> "Closed" (real service). Detail line = the step date as `MMM d, yyyy` in the viewer's time zone when the step has a time; otherwise "Complete" when completed, "Pending" when not. A completed step has a filled blue marker with a white dot; a pending step a hollow grey marker and grey label; a vertical line joins the steps.
   - Fallback when the detail has no timeline: *Call Issued* (issue date, complete), *Acknowledged* ("Confirmed" / "Pending"), *Payment Received* ("Matched" when the status is *Paid*, else "Pending"), *Call Closed* ("Complete" when *Paid*, else "Pending").
   - Acknowledgment Status: a green circle with a check and the bold text "Acknowledged" when the call is acknowledged (locally acknowledged, or the call or its detail has an acknowledgement time); otherwise an orange circle with a clock and "Pending". Under "Pending", when the role is not VIEWER: the outline button *Acknowledge Call*.
7. *Linked Documents*: one row per document of the call: red PDF icon, the name as a blue link to the document page, the line "PDF · {published date as sent by the API, e.g. 2026-07-01}" ("PDF" is fixed text), and a download icon button (`aria-label` "Download {name}"). When there are none: "No linked documents".

Inputs: none. Actions: see the Actions table (close, *View full details →*, copy, *Acknowledge Call*, document link and download). **[O]**

**Dialog — Wiring instructions** (`max-w-lg`) **[O]**

Title "Wiring instructions"; description "Call No. {callNo} · {fund}". Body: when the detail has `wiring.raw`: a scrollable, wrapped monospace-style block with the raw text exactly as stored (demo cc-013: Beneficiary, Bank, ABA/Routing, "Account: ****4812", Reference, "Currency: USD", "Amount due: 150,000.00"). Otherwise a list *Bank*, *Account name*, *Account number* (the full number when present, else the masked one), *ABA / Routing*, *Reference / Memo*, each showing "—" when empty. When the detail has no wiring: "Wiring details are not available for this call." There is no copy, print or close button other than the dialog's own close control. Wiring status: Prototype -> `GET /lp-portal/capital-calls/{id}` `wiring`. **[O]**

| Control | Enabled when | Permission | Effect | Wiring / API | Label |
| --- | --- | --- | --- | --- | --- |
| Dialog close | Always | None | Closes the dialog. | Prototype | [O] |

##### States

- Empty: no empty message in either table (the bare header shows). When the topbar fund is *Matanho Equity Opportunities Fund* (no capital calls or distributions in the demo data) both tables are empty while the *Total Distributions* tile still shows `$350.0K`. When no call is selected the right panel is absent. **[O]**
- Loading: first load -> skeleton (a bar and five pulsing tiles) in place of the page; later reloads keep the page. Detail not yet loaded -> the wiring preview rows show "—" and the timeline uses the fallback steps; the previous call's detail remains visible until the new one arrives. **[O]**
- Error: both requests failed with no data -> title, a red box with the error text and *Try Again*. One request failing -> the page renders with the other half, zero KPIs when calls failed, and no message. Action failures -> toasts listed in Actions. **[O]**
- Disabled / read-only: for a VIEWER the toolbar *Acknowledge* and *Submit Payment Confirmation*, the row-menu *Acknowledge* and *Payment Confirmation* are disabled and the panel button *Acknowledge Call* is hidden, with no tooltip or explanation; the status block shows "Pending". All view and download controls stay enabled. Toolbar buttons are disabled while no call is selected or any action runs. **[O]**
- Conditional: calls table and panel only on the calls tab; distributions card always; the callout only when outstanding is above zero; the *Acknowledge Call* button only for unacknowledged calls and non-VIEWER roles; panel layout 300 px column from 1280 px. **[O]**

##### Business rules & calculations

- Call status shown to the investor (target service, derived at read time, evaluated in this order): CANCELLED when the call is cancelled; PAID when paid is at least the amount and the amount is above zero; PARTIALLY_PAID when paid is above zero; ACKNOWLEDGED when the investor has acknowledged; OVERDUE when the due date is before today (UTC date) and paid is below the amount; otherwise ISSUED. The portal never changes the paid amount or the allocation status. Consequently an acknowledged call never shows OVERDUE and a partly paid past-due call stays PARTIALLY_PAID. **[I]**
- Visibility: a call is visible to the investor only after its notice was sent or its status is NOTICES_SENT, ISSUED, ACTIVE, PARTIALLY_PAID, PAID or CLOSED; DRAFT and CANCELLED calls are hidden (design: the portal notification is at ISSUED, after maker-checker approval). Distributions are visible unless DRAFT or CANCELLED. **[I]**
- Outstanding = max(0, call amount - paid). Acknowledgement is not payment; an investor cannot change the amount or the due date. **[I]**
- Due-soon (row highlight in the UI) = days until the due date from 0 to 7 inclusive and status not PAID; days until = ceiling of (due date at local midnight - today at local midnight) / 24 h. The summary tile uses a different rule on the service: due date from today up to 14 days ahead and status not PAID. **[O] / [I]**
- Displayed status in the UI: only Issued / Paid / Overdue (see Tables); the UI does not derive Overdue itself. **[O]**
- KPI definitions (target service): *Outstanding* = sum of the outstanding amounts of calls in ISSUED, ACKNOWLEDGED, PARTIALLY_PAID or OVERDUE, and *openCount* their number; *Overdue* = outstanding amount of OVERDUE calls; *Paid Calls* value = sum of `paid` of PAID calls whose due date is in the current calendar year, caption = number of all PAID calls; *Upcoming Due* = count and outstanding sum of due-soon calls (14-day window); *Total Distributions* = sum over the investor's visible distributions; upcoming distribution notices = distributions in status DECLARED, NOTIFIED or ISSUED; currency code of the summary = USD. The summary is computed over the investor's visible calls, for the selected fund or all entitled funds. **[I]**
- Fund scope: the topbar fund (all funds when "All Funds") is sent as `fundId` to the three list calls; the as-of date is sent only to the statement download. **[O]**
- Role rule: write controls require `lpRole` other than VIEWER; the server requires SIGNATORY or MANAGER. **[O] / [I]**
- Wiring masking: the preview shows the masked account number ("••••" plus the last four digits) when present; the full-details dialog shows the raw instruction text (or the full number when no raw text exists). Distribution bank destinations are always masked ("{bank} •••• {last four}"). **[O] / [I]**
- Acknowledgement rules (server): not allowed for a cancelled or not-yet-issued call (409 `LP_CALL_NOT_ISSUED`); a second acknowledgement is rejected (409 `LP_CALL_ALREADY_ACKNOWLEDGED`, "Already acknowledged"); success returns `{acknowledgedAt}` and records who acknowledged; an audit event `CAPITAL_CALL_ACKNOWLEDGED` is required. **[I]**
- Idempotency: acknowledge and upload send an `Idempotency-Key` header (8 to 200 printable ASCII characters); same key with the same payload replays the first answer; same key with a different payload answers 409 `LP_IDEMPOTENCY_KEY_REUSED`. The UI creates a new UUID per click. **[O] / [I]**
- Payment confirmation upload (server): single file field `file`, up to 25 MB; stored with a SHA-256 hash; optional `amountClaimed` and `notes`; answer 201 `{id, fileName, sha256, amountClaimed, uploadedAt}`; it does not change the paid amount, the call status or the timeline (cash is matched by operations). **[I]**
- Distribution rows (server): reference "DIST-" plus the last six characters of the allocation id in upper case; gross = the investor's share; net = amount paid, else gross; adjustments = max(0, gross - net); types: REALISATION_PROCEEDS (from exit or realisation proceeds), DIVIDEND, INTEREST, INCOME, RETURN_OF_CAPITAL, OTHER; status PENDING or PAID. **[I]**
- Money formats: tables whole US dollars with `$`; tiles compact (see Elements); dates `MMM d, yyyy`. **[O]**
- Demo-seed values (Prototype): calls 13 (issued 1 Jul 2026, due 20 Jul 2026, 150 000 USD, paid 0, ISSUED), 12 (1 Jun / 20 Jun 2026, 250 000, paid 250 000, PAID, acknowledged 4 Jun), 11 (1 Feb / 15 Feb 2026, 500 000, PAID, acknowledged 3 Feb), 10 (1 Nov / 20 Nov 2025, 400 000, PAID, acknowledged 5 Nov); all in Matanho Growth Fund I. Wiring for all four: bank "First National Correspondent Bank", account name "Matanho Growth Fund I LP Collection", masked account "•••• 4812", ABA "021000021", reference "INV-AGFI-1042 / CC-0{nn}". Timeline steps ISSUED, ACKNOWLEDGED, PAYMENT_RECEIVED, ALLOCATED. Documents: call 13 -> "CC-013 Capital Call Notice" and "CC-013 Wiring Instructions" (both 2026-07-01); call 12 -> "CC-012 Capital Call Notice" (2026-06-01); calls 11 and 10 -> none. Summaries: Growth (also returned for "All Funds"): openCount 1, outstanding 150 000.00, overdue 0.00, paidYtd 750 000.00, paidCallCount 3, dueSoonCount 1, dueSoonAmount 150 000.00, totalDistributions 1 820 000.00, upcoming notices 0; Equity Opportunities: all zero except totalDistributions 350 000.00. Distributions: DIST-008 (20 Mar 2026, "Exit Proceeds", gross 500 000, adjustments 10 000, net 490 000, document id doc-105), DIST-007 (12 Dec 2025, "Dividend", 180 000 / 3 600 / 176 400, doc-106), DIST-006 (30 Jun 2025, "Return of Capital", 220 000 / 0 / 220 000, no document); all Growth Fund, USD, PAID, bank "•••• 7719". The demo session role is MANAGER. **[O]**

##### Edge cases

- First load with the demo data (all funds): KPIs `$150.0K` / "1 Calls"; `$750.0K` / "3 Calls"; `$150.0K` / "1 Calls Due"; `$1.82M` / "0 Upcoming Notices"; `$0.00` / "0 Overdue"; call 13 selected automatically. **[O]**
- Day maths use the viewer's clock while the status is fixed in the demo data: on 1 Oct 2026 all four calls are past due (-73, -103, -228 and -315 days); call 13 still shows *Issued*, its due date is not red, and the panel reads "Jul 20, 2026 (in -73 days)". The red due-soon highlight appears only between 13 and 20 July 2026. **[O]**
- After acknowledging call 13 in the demo: toast "Capital call acknowledged"; the panel shows "Acknowledged" and the timeline step "Acknowledged" gets today's date; the badge stays *Issued* (status ACKNOWLEDGED maps to Issued); the header and row *Acknowledge* controls become disabled; the demo removes the matching dashboard action. **[O]**
- Upload in the demo changes nothing on the call; the only feedback is the toast. The demo response uses the outstanding amount as `amountClaimed` when no amount is sent. **[O]**
- Deep link `?call={id}` selects the call and forces the calls tab; an id that is not in the loaded list shows no panel (and the demo detail request fails with "Capital call not found: {id}"). With `?call=` present the panel can be closed; without it the first call is selected again after closing. **[O]**
- *View Notice* on a call without linked documents (calls 11 and 10 in the demo) downloads the notice and opens it in a new browser tab; popup blockers can suppress it. **[O]**
- Switching the selected call keeps the previous call's wiring, timeline and acknowledgement flag visible until the new detail arrives, so a not-yet-acknowledged call can briefly look acknowledged. **[O]**
- With the real service the notice, distribution and statement downloads are plain-text files, while the UI saves them with a `.pdf` name; the distribution `documentId` is always empty, so every distribution document icon downloads that text file. **[I]**
- `lpRole` is null until the session loads, so write controls are enabled during that interval and the handlers still stop for VIEWER afterwards. **[O]**
- Equity Opportunities selected: summary `$350.0K` total distributions with an empty distributions table. All Funds in the demo returns the Growth summary only. **[O]**
- Demo inconsistency: the three distributions net to 886 400.00 while the summary says 1 820 000.00; "Paid Calls" shows 750 000.00 (calendar-year) beside a count of 3 calls (all-time). **[O]**

##### Gaps, defects & open questions

- **DEF-365** Status model — ACKNOWLEDGED, PARTIALLY_PAID and CANCELLED display as *Issued*; Overdue is never derived on the client; the service itself cannot return OVERDUE for an acknowledged call. FR-LP-038: the call badge supports ISSUED (blue), ACKNOWLEDGED (blue), PARTIALLY_PAID (amber), PAID (green), OVERDUE (red) and CANCELLED (grey), and OVERDUE is evaluated before ACKNOWLEDGED (any unpaid past-due call is OVERDUE). — AC: an acknowledged, unpaid call past its due date shows *Overdue* in red and counts in the *Overdue Calls* tile.
- **DEF-366** The due-date line prints "(in {n} days)" for negative and zero day counts and for paid calls. FR-LP-039: the line reads "(in {n} days)" for 2 or more days, "(in 1 day)", "(due today)", "({n} days overdue)" / "(1 day overdue)" for unpaid past-due calls, and nothing for paid calls. — AC: due 20 Jul with today 1 Oct and unpaid -> "(73 days overdue)".
- Q-107: One due-soon window? The row highlight uses 7 days and the summary uses 14 days. — default: a single configurable constant of 14 days shared by the row highlight and the *Upcoming Due Amount* tile.
- **DEF-367** The detail panel cannot be dismissed (the first call is re-selected) unless the page was opened with `?call=`. FR-LP-040: closing the panel keeps it closed until a row is selected; the first call is auto-selected only on the first load. — AC: clicking X leaves no panel.
- FR-LP-041: *Submit Payment Confirmation* opens a dialog with the file (required), *Amount claimed* (optional, greater than 0, at most 2 decimals, not above the outstanding amount) and *Notes* (optional), a file summary (name, size), a progress state and the validations "File too large (maximum 25 MB)", "Unsupported file type", "Enter an amount greater than 0 and not above the outstanding amount". — AC: oversized or wrong-type files are rejected before upload; the sent form contains `file`, `amountClaimed`, `notes`.
- Q-108: Notes length limit and allowed types for payment confirmations (the server allows any type up to 25 MB; the picker offers pdf, png, jpg, jpeg, txt). — default: server enforces the same five types and 25 MB, notes at most 2 000 characters, error 415 `LP_UNSUPPORTED_MEDIA` / 413 `LP_FILE_TOO_LARGE`.
- DEFECT (service): an oversize upload surfaces as HTTP 500 `LP_EXPORT_FAILED`, not 413 `LP_FILE_TOO_LARGE`; the idempotency hash is computed before the multipart body is parsed, so the file is not part of the hash; no virus scan; no audit of the upload hash. FR-LP-042: reject oversize with 413 `LP_FILE_TOO_LARGE`, hash the file content into the idempotency check, virus-scan and audit the SHA-256. — AC: a 26 MB file returns 413 with `fieldErrors.file`.
- FR-LP-043: The call detail lists previous payment confirmations (file name, amount claimed, uploaded at, SHA-256 prefix) so the investor sees what was sent; a confirmation changes no status. — AC: after an upload the confirmation is listed in the panel and the timeline is unchanged.
- **DEF-368** Downloads are labelled `.pdf` while the service returns `.txt` stubs; notices should be the published PDF from the document centre. FR-LP-044: the notice endpoint streams the published call-notice PDF (`application/pdf`) and the UI names files from the response's `Content-Disposition`. — AC: the saved file opens as a PDF with the correct name.
- FR-LP-045: Distribution detail drawer (required by the design: fund, reference, gross, adjustments, net, payment date, currency, masked bank destination, supporting document) opened by clicking a row, backed by `GET /lp-portal/distributions/{id}`. — AC: clicking DIST-008 shows all eight fields and the masked bank "•••• 7719"; account numbers are never shown in full.
- FR-LP-046: Distribution type and status: show *Return of Capital*, *Realisation Proceeds*, *Dividend*, *Interest*, *Income*, *Other* as sent by the API and a status badge (PENDING amber, PAID green). — AC: an `INTEREST` distribution does not display "Return of Capital".
- DEFECT (service): the summary's `totalDistributions` and the upcoming-notice amount read an `amount` field that distribution rows do not contain, so they are always 0.00; `currencyCode` is fixed to USD; `paidYtd` is by the call's due-date year and not by payment date. FR-LP-047: compute from `gross`/`netPaid`, currency from the fund, and *Paid Calls* by payment date. — AC: the *Total Distributions* tile equals the sum of the listed net-paid amounts.
- Q-109: Should *Total Distributions* be net paid or gross? — default: net paid to the investor (consistent with the table's *Net Paid*).
- **DEF-369** Tile semantics — *Paid Calls* shows a calendar-year amount with an all-time count; *Overdue Calls* shows a service amount with a client-counted caption; the design document lists *Upcoming Distribution Notices* as the fifth metric. Q-110: Which five tiles? — default: keep the five shown and label *Paid Calls* "Paid (year to date)" with a year-to-date count.
- **DEF-370** Fund scope — in the demo "All Funds" returns the Growth summary only; the Equity fund shows empty tables with no message. FR-LP-048: "All Funds" aggregates every entitled fund; empty tables show "No capital calls for the selected scope." and "No distributions for the selected scope." — AC: the tiles equal the sum over the funds in scope.
- FR-LP-049: Loading and empty states for both tables (skeleton rows) and a visible error for a partial failure ("Could not load distributions" with *Try Again*). — AC: a failed distributions request is visible while calls still display.
- FR-LP-050: Paging: the UI requests `page` / `pageSize` and the *View all* control loads further pages; `status` filter (Issued, Acknowledged, Partially Paid, Paid, Overdue) on the calls table; default sort by issue date descending, then call number descending; distributions by payment date descending. — AC: more than 50 calls are reachable; the order is stable.
- Q-111: Sort order of the call register — default: newest first (the service orders by allocation creation time; the demo by call number descending).
- **DEF-371** The timeline step codes differ between the demo (ALLOCATED) and the service (CLOSED); labels derive from the code. Q-112: Canonical steps — default: ISSUED, ACKNOWLEDGED, PAYMENT_RECEIVED, CLOSED with labels "Call Issued", "Acknowledged", "Payment Received", "Call Closed".
- **DEF-372** Step dates use the viewer's time zone while other dates are date-only. BR-100: all dates in the register are shown in UTC date form `MMM d, yyyy`. — AC: the step date equals the date stored.
- **DEF-373** The *Acknowledge* toolbar button uses a download icon; "PDF" in the document line is fixed text; the document date is shown as the raw ISO string. FR-LP-051: the line shows the document's real file type and a formatted date. — AC: "PDF · Jul 1, 2026".
- **DEF-374** A different idempotency key is created for every click, so a retry after a network error is not idempotent. FR-LP-052: one key per user intent, reused for automatic retries. — AC: a retried acknowledgement never produces a duplicate record.
- FR-LP-053: Disabled controls for a VIEWER carry a tooltip "Only authorised signatories can acknowledge capital calls" / "...submit payment confirmations", and write controls stay disabled until the session has loaded. — AC: a VIEWER sees the explanation; no write control is enabled while the role is unknown.
- BR-101: The full account number in the wiring dialog is shown only to roles that may pay (SIGNATORY, MANAGER) and each reveal is audited; VIEWER sees only the masked number. Q-113: Is a VIEWER allowed to see the full wiring text? — default: no.
- DEFECT (service): the wiring `raw` value is the whole stored instruction (including the full account number) and is shown verbatim. FR-LP-054: the service returns structured wiring fields plus a display text in which the account number is masked, and the unmasked number only on an explicit reveal. — AC: the preview never contains more than the last four digits.
- FR-LP-055: Refresh when new capital activity is published (a new call, a status change, a new distribution) — a realtime event or a refresh interval; today nothing refreshes the page. Q-114: Which event name? — default: reuse the notification event and refresh on `lp_notification`.
- **DEF-375** Only 8 calls are shown by default and 50 are ever loaded; the rest are unreachable. (See paging above.)
- **DEF-376** The call-detail request error is invisible (no message when the detail fails; the panel shows "—").
- **DEF-377** Money in tables is always whole USD with `$`, ignoring `currencyCode`. FR-LP-056: amounts use the call's or distribution's currency with the currency symbol and 2 decimals. — AC: a EUR call shows "€150,000.00".

#### 5.B.5 Subscriptions & Redemptions (`/lp-portal/subscriptions-redemptions`, `lp.dealing.view`; submit `lp.dealing.subscribe` / `lp.dealing.redeem`; estimate `lp.dealing.estimate`)

**Baseline [O].** This page is the open-ended dealing workspace of the LP portal UI imported from the NVCCZ product. Everything on it is answered by the in-memory mock (one open-ended fund, "Matanho Equity Opportunities Fund", Class A USD). The mock is not the real rule engine: where the prototype and the NVCCZ backend that this UI was written for compute different numbers, both are stated in *Business rules & calculations* and the target is stated as a requirement. Terms used below: *request* = one subscription or redemption row; *snapshot* = an estimate persisted server-side and identified by `estimateSnapshotId`; *dealing date* = the date on which the NAV used for allocation or cancellation applies.

| Attribute | Value |
| --- | --- |
| Purpose | Let an investor see the position of one open-ended fund (account value, units, NAV per unit, redeemable amount, pending requests), read the dealing rules and compliance checks, submit a subscription (with optional supporting documents) or a redemption (by amount, by units or in full) after a live estimate, and track the status of past requests. **[O]** |
| Access | Route inside the LP portal shell; sign-in gate `createPortalProxy('investor', { requirePortalRole: true })`. The page applies no role check: an investor whose `lpRole` is *VIEWER*, *SIGNATORY* or *MANAGER* sees the same enabled controls. **[O]** Target: *VIEWER* may view the page and obtain estimates (`lp.dealing.view`, `lp.dealing.estimate`); only *SIGNATORY* and *MANAGER* (and GP staff acting for the client) may submit (`lp.dealing.subscribe`, `lp.dealing.redeem`); fund visibility is limited to the funds in the user's entitlement scope. A *VIEWER* receives 403 "Authorised Signatory access required" on submit today in the target API; the UI must disable the two submit buttons for a *VIEWER* instead. **[I]** / **[P]** |
| Prototype layer | Native React: `portals/investor-web/src/components/lp-portal/screens/lp-subscriptions-redemptions-screen.tsx`, data hook `useLpDealingOverview` (`lib/lp-portal/hooks.ts`), row mapper `mapDealingRequestRow` (`lib/lp-portal/mappers.ts`), API facade `lib/api/lp-portal-api.ts`, mock `lib/lp-portal/mock-api.ts` + `lib/lp-portal/mock-store.ts`. The facade routes all nine dealing methods to the mock whether or not a domain switch exists; `apiClient` is a stub that always rejects. **[O]** |
| Wiring status | Prototype for every element and every action (no network call is made; no error path can occur). Target endpoints are named per element. **[O]** |
| Entry points | (1) Sidebar item *Subscriptions & Redemptions*. (2) Sidebar *My Investments* > *Subscriptions* (`?type=subscriptions`) and *Redemptions* (`?type=redemptions`), listed when the selected scope is open-ended or mixed. (3) Notification "Redemption RDM-016 under review" in the topbar notification menu. (4) Deep link `?request=<request id>` (opens the detail dialog) generated from a linked dealing record in Requests & Messages and from service-request types containing OPEN_ENDED or DEALING. (5) Target: dashboard actions "Subscription {status}" / "Redemption {status}". **[O]** / **[I]** |
| Exit points | *View Full Terms* (opens `termsUrl` in a new tab); sidebar and topbar navigation. The page has no link to the Requests screen, to the Documents screen or to Account Activity. **[O]** |

##### Layout

1. Page header: title *Subscriptions & Redemptions* and subtitle "Submit new subscription or redemption requests and track their status." **[O]**
2. KPI strip of six cards: *Account Value*, *Units Held*, *NAV per Unit*, *Available to Redeem*, *Pending Subscriptions*, *Pending Redemptions* (2 columns below 768 px, 3 columns from 768 px, 6 columns from the `xl` breakpoint). **[O]**
3. Main grid. From the `xl` breakpoint: three columns (1fr, 1fr, 260 px) and two rows. Below `xl` the four cards stack in the order a-d. **[O]**
   a. Card *New Subscription Request* (column 1, row 1). When the card is wide enough (container width of 560 px or more) it has two columns: form and supporting documents on the left, *Allocation Estimate* panel and disclaimer on the right; otherwise one column.
   b. Card *New Redemption Request* (column 2, row 1).
   c. Card *Validation Rules* (column 3, spans both rows): *Minimum Balance*, *Notice Period*, *Dealing Frequency*, *Compliance Checks* and the *View Full Terms* button.
   d. Card *Subscriptions & Redemptions History* (columns 1-2, row 2): toolbar (*Export*, type filter, status filter) and the requests table.
4. Dialog "{Type} details" for one request (hidden until opened). **[O]**
5. Replacement states: error panel with *Retry* (replaces items 1-4) and "No open-ended funds" panel (replaces items 1-4). **[O]**

There are no tabs. The `type` query parameter highlights card a or b with a 2 px ring (blue `#93c5fd` for `subscriptions`, red `#fca5a5` for `redemptions`); it does not scroll, filter the table or change any other state. Any other value is ignored. **[O]**

##### Elements

| # | Element | Type | Content / behaviour | Data source (current → target) | Label |
|---|---|---|---|---|---|
| 1 | Page title / subtitle | heading + text | As in Layout 1. | Static | [O] |
| 2 | KPI *Account Value* | card, wallet icon (blue chip) | Value = compact money of `accountValue` in the session presentation currency (`—` while loading). Compact rule: absolute value ≥ 1,000,000,000 → `$x.xxB`; ≥ 1,000,000 → `$x.xxM`; ≥ 1,000 → `$x.xK` (1 decimal); otherwise full currency format with 2 decimals. The currency symbol in the compact forms is always `$`. Helper "As of {asOfDate as `Mon D, YYYY`}" (`—` when no overview). Info popover (title = label, body = helper). Seed: `$2.85M`, "As of Jun 30, 2026". | Mock `getDealingOverview` → `GET /lp-portal/dealing/overview?fundId` field `accountValue` | [O] |
| 3 | KPI *Units Held* | card, layers icon (teal chip) | Value = `unitsHeld` with 2 decimals and thousands separators (seed `184,233.48`). Helper "As of {asOfDate}". Info popover. | same → `unitsHeld` | [O] |
| 4 | KPI *NAV per Unit* | card, refresh icon (purple chip) | Value = full currency format of `navPerUnit` with 2 decimals (seed 15.4448 shows `$15.44`: the 4-decimal NAV is rounded for display). Helper "As of {asOfDate}". Info popover. The overview field `valuationStatus` (seed FINAL) is not displayed. | same → `navPerUnit` | [O] |
| 5 | KPI *Available to Redeem* | card, coins icon (orange chip) | Value = compact money of `availableToRedeemValue` (seed `$2.60M`). Helper "{availableUnits with 2 decimals} Units" (seed "168,046.71 Units"; `—` while loading). Info popover. | same → `availableToRedeemValue`, `availableUnits` | [O] |
| 6 | KPI *Pending Subscriptions* | card, arrow-down-to-line icon (purple chip) | Value = compact money of `pendingSubscriptions` (seed `$0.00`). Helper "Awaiting allocation". Info popover. | same → `pendingSubscriptions` | [O] |
| 7 | KPI *Pending Redemptions* | card, arrow-up-from-line icon (red chip) | Value = compact money of `pendingRedemptions` (seed `$250.0K`). Helper "In progress". Info popover. | same → `pendingRedemptions` | [O] |
| 8 | Card header *New Subscription Request* | icon (blue circle) + heading | Static. Ring when `?type=subscriptions`. | Static | [O] |
| 9 | Panel *Allocation Estimate* | panel (grey-blue background) | Title with a decorative info icon (no tooltip). Subtitle "Calculating…" while an estimate is in flight, otherwise "Based on current NAV". Lines: *Estimated NAV per Unit* (NAV from the estimate, else from the overview; 2 decimals); *Estimated Units* (`—` when the entered amount is 0 or empty, otherwise units with 2 decimals; shows `0.00` until the first estimate returns); heading *Estimated Fees* with *Management Fee (Est.)* and *Other Fees (Est.)* (`$0.00` until an estimate exists); a rule; *Estimated Total Investment* (15 px bold). | Mock `estimateSubscription` → `POST /lp-portal/dealing/subscriptions/estimate` | [O] |
| 10 | Subscription disclaimer | info box (blue) | Text from the estimate `disclaimer`; before any estimate, or if the estimate has none: "Final allocation will be based on the NAV on the applicable dealing date and may differ." With the mock the text becomes "Estimates use the latest published NAV and are indicative only." after the first estimate. | Estimate response | [O] |
| 11 | Subscription documents drop zone | dashed box | Content in *Inputs & validation* and *Actions*. Status line: "PDF, DOCX, XLSX (Max {maxFileMb}MB each)" (`maxFileMb` from the rules, 25 when absent; seed 10), replaced by "{n} file(s) selected" once at least one file has been added. | Rules `subscription.maxFileMb` | [O] |
| 12 | Card header *New Redemption Request* | icon (rose circle) + heading | Static. Ring when `?type=redemptions`. | Static | [O] |
| 13 | *Redemption Type* group | label with decorative info icon + 3 radio-style buttons | *Amount*, *Units*, *Full Redemption*. Default *Amount*. All three are always shown; `rules.redemption.modes` is not used to hide a mode. | Static | [O] |
| 14 | Redemption estimate lines | text rows | *Estimated Units to be Cancelled* (units, 2 decimals; `…` while loading) and *Estimated Settlement Amount* (money; `…` while loading); both show `0.00` / `$0.00` when no estimate exists. | Mock `estimateRedemption` → `POST /lp-portal/dealing/redemptions/estimate` | [O] |
| 15 | *Notice Period* row | text row | "Notice Period" / "{noticeDays} Calendar Days" (`0 Calendar Days` before the overview loads; seed `30 Calendar Days`). | Rules `noticeDays` | [O] |
| 16 | *Estimated Settlement Date* | read-only box | Date of the estimate's `estimatedSettlementDate` (format `Mon D, YYYY`); `—` before an estimate. | Estimate response | [O] |
| 17 | Redemption disclaimer | warning box (amber, triangle icon) | Estimate `disclaimer`; default "Estimates are subject to change based on the final NAV on the dealing date. Actual settlement may vary." (mock text after an estimate: "Redemption estimates are indicative pending dealing-day NAV."). | Estimate response | [O] |
| 18 | Validation Rules heading | heading | "Validation Rules". | Static | [O] |
| 19 | *Minimum Balance* section | text + status line | Text: "Minimum account balance after redemption must be at least {minBalanceAmount, 2 decimals} or {minBalanceUnits, 0 decimals} units." (seed "$100,000.00 or 5,000 units"). Status line: green circle + "You will remain above the minimum balance." when the current redemption estimate has `aboveMinBalance` true or when no estimate exists; red text + "This request would breach the minimum balance." when it is false. The same check glyph is used for both outcomes. Decorative info icon. | Rules `minBalanceAmount`, `minBalanceUnits`; estimate `aboveMinBalance` | [O] |
| 20 | *Notice Period* section | text | "Redemptions require {noticeDays} calendar days' notice."; sub-label *Next eligible dealing date* = rules `nextEligibleDealingDate` formatted, `—` when absent (seed Aug 1, 2026). Decorative info icon. | Rules | [O] |
| 21 | *Dealing Frequency* section | text | Frequency text, then sub-label *Next eligible date* (same date as item 20). Frequency text: code `MONTHLY_LAST_BUSINESS_DAY` → "Monthly on the last business day."; any other code → the code with `_` replaced by spaces and the first letter of each word lower-cased (seed `MONTHLY` shows "mONTHLY"; `N/A` shows "n/a"). `—` when absent. Decorative info icon. | Rules `dealingFrequency`, `nextEligibleDealingDate` | [O] |
| 22 | *Compliance Checks* list | list with check glyph (green `#10b981` when passing, red `#ef4444` when failing) | Rows in order: "Accredited Investor Verified" (passes when `accreditedInvestor` is true; default false); "KYC Status: {kycStatus}" (text "Unknown" when absent; passes only when the status upper-cased equals `APPROVED`); "No Unsettled Capital Calls" (default passes); "No Legal Holds" (default fails). Then one red warning row per string in `blockers`, shown verbatim. Decorative info icon. While data is loading the defaults apply, so the list briefly shows two red rows. | Mock overview `compliance` → `GET /lp-portal/dealing/overview` (`compliance`) | [O] |
| 23 | *View Full Terms* | outline pill button with external-link icon | Rendered only when `compliance.termsUrl` is non-empty. Opens the URL in a new tab with `noopener,noreferrer`. Seed `/legal/dealing-terms` (no such route exists in the investor portal: the new tab shows a not-found page). | `compliance.termsUrl` | [O] |
| 24 | History heading + info popover | heading + `InfoHint` | "Subscriptions & Redemptions History"; popover title the same, body "Investor-scoped subscription and redemption requests for open-ended funds." | Static | [O] |
| 25 | Error panel | panel | Red border; message text of the load error (fallback "Request failed"); button *Retry*. | `useAsyncData.error` | [O] |
| 26 | No-fund panel | panel | "No open-ended funds are available for subscriptions and redemptions." Also visible for a short time while the session is still loading. | Session `funds` | [O] |
| 27 | Toasts | top-right sonner toasts | Listed in *Actions*, *Inputs & validation* and *States*. | — | [O] |

Seeded overview and rules shown by the prototype (fund "Matanho Equity Opportunities Fund", Class A USD) **[O]**: as of 2026-06-30, valuation status FINAL, NAV per unit 15.4448, account value 2,845,390.00, units held 184,233.4821, available to redeem 2,595,390.00 (168,046.7120 units), pending subscriptions 0.00, pending redemptions 250,000.00; minimum balance 100,000.00 or 5,000 units; notice 30 days; frequency `MONTHLY`; next eligible dealing date 2026-08-01; settlement lag 2 days; subscription management-fee rate 0.0150, other fee flat 250.00, maximum file size 10 MB; redemption fee rate 0.0050, modes AMOUNT, UNITS, FULL; compliance all passing, `termsUrl` `/legal/dealing-terms`. Bank accounts offered for this fund: "Primary USD operating" (Standard Chartered Bank, •••• 7719, default) and "Equity Opportunities settlement" (Stanbic Bank, •••• 3341). The seeded numbers are not mutually consistent (units × NAV = 2,845,449.28 ≠ account value; "available" = account value − pending redemption, not account value − minimum balance).

##### Tables

**Table — Subscriptions & Redemptions History** (`getDealingRequests`, fund = the fund chosen in the Fund field, page 1, page size 50) **[O]**

| Column | Format | Sortable | Notes |
|---|---|---|---|
| ID | request id as text, blue semibold button; hover underline | No | Click opens the detail dialog. Prototype ids: `deal-sub-024`, `deal-rdm-016`, `deal-sub-018`, new requests `deal-30`, `deal-31`, …. Human references such as "RDM-016" (used in notifications and Account Activity) are not shown here. |
| Type | 20 px icon chip + text: *Subscription* (arrow-down icon, blue chip `#e8f1ff`/`#2563eb`) or *Redemption* (arrow-up icon, pink chip `#fce7f3`/`#db2777`) | No | From `requestType`. |
| Fund | fund name | No | Fund name from the row, else looked up by fund id in the session funds, else the id; truncated at 200 px. |
| Share Class | text | No | Row share class; `—` when the API returns none. |
| Amount / Units | line 1 amount, 2 decimals, in the session presentation currency; line 2 "{units 2 decimals} Units" plus " (Est.)" when the row's `isEstimate` is true (10 px grey) | No | The row's own `currencyCode` is ignored. |
| Status | badge | No | Badge colour by the exact strings *Submitted* `#e8f1ff`/`#2563eb`; *Awaiting Funds* `#fff7ed`/`#ea580c`; *Allocated* `#e7f8ef`/`#15803d`; *Under Review* `#f3e8ff`/`#7c3aed`; *Settled* `#e7f8ef`/`#15803d`; *Rejected* `#fee2e2`/`#dc2626`. Any other text renders as an unstyled pill. The mapper turns `UNDER_REVIEW` into "UNDER REVIEW" and `ALLOCATED` into "ALLOCATED" (it capitalises word starts but never lower-cases the rest), so with the upper-case values of the API no badge matches a colour rule. DEFECT (see Gaps). |
| Submitted On | date `Mon D, YYYY` from `createdAt`, browser time zone | No | |
| Expected Settlement | date `Mon D, YYYY` from `requestedDealingDate`; `—` when empty | No | The value is the requested dealing date (for a subscription the expected funding date in the target API), not a settlement date. |
| Actions | icon button (three dots), `aria-label` "Actions for {id}" | No | Menu with one item *View details* (opens the dialog). |

- Row order: as returned by the API. Target order: `createdAt` descending. The seed is not date-ordered (May 2026, Jul 2026, Nov 2025); a newly created request is placed first. **[O]** / **[P]**
- Filters: *All Types* (default), *Subscriptions*, *Redemptions* (client-side on the loaded page; also sent to the export as `type`). *All Statuses* (default), *Submitted*, *Awaiting Funds*, *Allocated*, *Under Review*, *Settled*, *Rejected* (client-side exact comparison with the mapped status text; not sent to the export). The two filters combine with AND. **[O]**
- Search: none. Sorting: none. Pagination: none; only the first 50 requests of the selected fund are loaded and no indicator shows that more exist. **[O]**
- Row click: only the ID button and the menu item open the dialog; the rest of the row is inert. **[O]**
- Row hover: light grey background. Table minimum width 960 px with horizontal scroll. **[O]**
- Status values accepted by the target data model (the API returns upper-case snake case): `DRAFT`, `SUBMITTED`, `COMPLIANCE_REVIEW`, `AWAITING_FUNDS`, `FUNDS_RECEIVED`, `AWAITING_NAV`, `ALLOCATED`, `UNDER_REVIEW`, `SETTLED`, `REJECTED`, `CANCELLED`. The screen has colour rules and filter options for only six of them (above); the other five (`DRAFT`, `COMPLIANCE_REVIEW`, `FUNDS_RECEIVED`, `AWAITING_NAV`, `CANCELLED`) have none. **[I]**

##### Inputs & validation

All inputs belong to one fund: the fund in the *Fund* field drives the KPIs, rules, compliance checks, bank accounts, both estimates and the history table.

| Field | Control | Required | Options / default / placeholder | Validation today (code) | Target validation | Error message |
|---|---|---|---|---|---|---|
| Fund (subscription card) | select | Yes | Placeholder "Select fund"; options = session funds whose operating model is OPEN_ENDED, shown by fund name; default = first such fund. Changing it reloads overview, banks, history and re-runs both estimates. | None | Server rejects a fund outside the user's entitlement scope (403). Funds that are not open-ended must not be offered. | Target 403 "Not entitled to this fund" **[O]** / **[I]** |
| Share Class | select | Yes | One option only: the overview share class (`Class A USD` in the seed; `Class A` if the overview has none). | None | Options = share classes the investor holds in the fund; the chosen class is part of the estimate binding. | — |
| Amount currency | select | Yes | *USD* (default, then reset to the presentation currency whenever the overview reloads), *GBP*. | None. The mock ignores the currency (no FX, same NAV). | Options = the fund's dealing currencies; the server stores the currency upper-case. | — |
| Amount | text, decimal keyboard | Yes | Empty by default; no placeholder. Displayed with thousands separators and exactly 2 decimals as soon as a character is typed; commas are stripped on input; only digits and one dot are accepted (regex `^\d*\.?\d*$`). | Amount ≤ 0 or empty: no estimate is requested and the submit button stays disabled; if the submit handler is reached it toasts "Enter a subscription amount." No minimum, maximum or decimals limit. | Positive number, ≤ 2 decimals; subscription minimum and maximum from the share-class rules **[P]**. | "Enter a subscription amount." (UI); target API 422 "amount must be a positive number" with field error `amount`: "Required positive amount" |
| Expected Funding Date | date picker (transparent native date input over a styled box) | Yes in the target | Shown as `Mon D, YYYY` or `—`; default = rules `nextEligibleDealingDate`, else the overview as-of date; set once and not reset when the fund changes. | None: the date can be cleared, can be in the past (the seed default 2026-08-01 is already in the past) and is sent as an empty string when cleared. | Required; not before today; must precede or equal the dealing date it targets. **[P]** | — |
| Source Bank Account | select | Yes | Placeholder "Select bank account"; options = the investor's active bank accounts for the fund (account tied to the fund or to no fund), label = account label, else "{bankName} {maskedNumber} ({currency})"; default = the account flagged default, else the first. Set once and not revalidated when the fund changes. | If empty: toast "Select a source bank account." No currency match against the Amount currency. | Account must belong to the signed-in client and be ACTIVE; its currency should equal the Amount currency. **[P]** | "Select a source bank account." |
| Supporting Documents | hidden file input (multiple) + *Upload Files* button + drop zone | No | Accept filter `.pdf,.doc,.docx,.xls,.xlsx` on the file dialog only (not applied to dropped files). Helper text states "PDF, DOCX, XLSX (Max {maxFileMb}MB each)". | No size, type, count or duplicate check. Files are appended to the list; there is no way to remove one and no file names are shown. | Reject a file larger than `maxFileMb` (413 `LP_FILE_TOO_LARGE`) or of an unsupported type (415 `LP_UNSUPPORTED_MEDIA`); virus scan; store the file against the request. **[I]** | — |
| Redemption Type | 3 radio-style buttons | Yes | *Amount* (default), *Units*, *Full Redemption*. Selecting *Amount* or *Units* clears the entered value; selecting *Full Redemption* hides the value field and requests an estimate immediately. | None | Offer only the modes in rules `redemption.modes`. | — |
| Requested Amount (mode *Amount*) | currency select (inert; one option = presentation currency) + right-aligned text input | Yes | Same formatting and character filter as the subscription Amount (2-decimal display while typing). | ≤ 0 or empty: no estimate; handler toast "Enter a redemption amount or units." | Positive; ≤ available position; remaining position ≥ minimum balance unless full redemption. | "Enter a redemption amount or units." (UI); target API errors in *Business rules* |
| Requested Units (mode *Units*) | right-aligned text input | Yes | Raw text (no formatting); label "Requested Units". Digits and one dot only. | ≤ 0 or empty: no estimate; same toast. The value is sent rounded to 2 decimals (`toFixed(2)`), although units carry 4-6 decimals. | Positive; ≤ units held; remaining units ≥ minimum balance units unless full redemption; up to 6 decimals. | "Enter a redemption amount or units." |
| Earliest Dealing Date | date picker | Yes (the estimate is not requested while empty) | Shown `Mon D, YYYY` or `—`; default = rules `nextEligibleDealingDate`, else as-of date; set once. After an estimate the date is overwritten by the estimate's `earliestDealingDate` when present. | None locally: no check against the notice period or the dealing calendar. | Must be ≥ today + notice days (calendar days) and should be a dealing date of the fund's frequency. **[I]** | Target API 422 `LP_NOTICE_PERIOD` "Earliest dealing date must respect {n}-day notice period", field error `earliestDealingDate`: "Must be on or after {date}" |
| Type filter, Status filter | selects | No | See Tables. | — | — | — |

Client-side submit guards, in order **[O]**: *Subscription* — (1) amount ≤ 0 → "Enter a subscription amount."; (2) no estimate id → "Wait for the allocation estimate before submitting."; (3) no bank → "Select a source bank account.". *Redemption* — (1) not full and value ≤ 0 → "Enter a redemption amount or units."; (2) no estimate id → "Wait for the redemption estimate before submitting."; (3) estimate says below minimum balance → "Redemption would breach the minimum balance." Guards (1) and (2) of the subscription and (1) and (2) of the redemption cannot be reached with the mouse or keyboard because the submit button is disabled in those situations; guard (3) of the subscription is reachable only when the fund has no bank accounts.

##### Actions

| Control | Enabled when | Permission | Effect (state change, toast text, navigation) | Wiring / API | Label |
|---|---|---|---|---|---|
| *Fund* select | Always (when at least one open-ended fund exists) | `lp.dealing.view` | Sets the dealing fund; reloads overview, banks and history for it; both estimates re-run. | Prototype → `GET /lp-portal/dealing/overview`, `GET /lp-portal/dealing/bank-accounts`, `GET /lp-portal/dealing/requests` | [O] |
| Amount / currency / share class edit | Always | `lp.dealing.estimate` | After 400 ms without change, requests a subscription estimate when amount > 0 (otherwise clears the estimate); the in-flight call is not cancelled, so an older answer can overwrite a newer one. Shows "Calculating…" meanwhile. On failure the estimate is cleared and an error toast appears (see States). | Prototype → `POST /lp-portal/dealing/subscriptions/estimate` body `{fundId, shareClass, amount "{n.nn}", currency}` | [O] |
| *Upload Files* | Always | `lp.dealing.subscribe` | Opens the file dialog. Chosen files are appended; toast "{n} file(s) attached." (n = number of files just added). | Prototype (files are kept in memory only) | [O] |
| Drop files on the zone | Always | `lp.dealing.subscribe` | Same as above; browser default of the drop is suppressed; empty drops do nothing. | Prototype | [O] |
| *Review Subscription Request* (submit) | Not while submitting, not while an estimate is loading, and only when an estimate exists | `lp.dealing.subscribe` (target) | Despite the label there is no review or confirmation step: submits at once. Label becomes "Submitting…" while in flight. Sends `{fundId, shareClass, amount "{n.nn}", currency, expectedFundingDate, sourceBankAccountId, estimateSnapshotId}` as JSON, or as multipart form-data with one `files[]` part per file when files were added, with a fresh `Idempotency-Key` (random UUID per click). Success: toast "Subscription submitted." with description = the new request id; file list cleared; estimate cleared; history, KPIs and bank list reloaded. Amount, currency, date and bank stay filled; because nothing triggers a new estimate, the button stays disabled until the amount or currency is edited. Failure: see States. | Prototype → `POST /lp-portal/dealing/subscriptions` | [O] |
| Redemption type buttons | Always | `lp.dealing.estimate` | Sets the mode; *Amount* / *Units* clear the value; *Full Redemption* hides the value field and, once an earliest dealing date exists, requests an estimate immediately. | Prototype | [O] |
| Redemption value / earliest date edit | Always | `lp.dealing.estimate` | After 400 ms, requests a redemption estimate when (mode is *Full Redemption* or value > 0) and an earliest dealing date exists; otherwise clears it. On success stores the estimate, the estimated settlement date and replaces the earliest dealing date with the one returned (re-running once if it differs). | Prototype → `POST /lp-portal/dealing/redemptions/estimate` body `{fundId, shareClass, mode "AMOUNT"\|"UNITS"\|"FULL", earliestDealingDate, full (boolean), amount\|units "{n.nn}"}` | [O] |
| *Review Redemption Request* (submit) | Not while submitting, not while an estimate is loading, and only when an estimate exists (the button stays enabled when the estimate says the minimum balance would be breached; the click then fails with the guard toast) | `lp.dealing.redeem` (target) | Submits at once (no confirmation, although the design requires the investor to confirm the notice period). Label "Submitting…" while in flight. Sends JSON `{fundId, shareClass, mode, earliestDealingDate, estimateSnapshotId, full, amount\|units}` with a fresh `Idempotency-Key`. Success: toast "Redemption submitted." with the request id as description; estimate cleared; data reloaded; fields stay filled (button disabled until the next edit). | Prototype → `POST /lp-portal/dealing/redemptions` | [O] |
| *View Full Terms* | Only rendered when `termsUrl` exists | None | `window.open(termsUrl, "_blank", "noopener,noreferrer")`. | `compliance.termsUrl` | [O] |
| *Export* | Not while an export is running | `lp.dealing.view` | Downloads `dealing-requests.csv` for the chosen fund and the chosen type filter (the status filter is not sent); toast "Request history exported."; failure toast "Export failed" (or the API message). An *xlsx* variant exists in code (`dealing-requests.xlsx`) but no control invokes it. | Prototype (returns a fixed 2-line CSV) → `GET /lp-portal/dealing/requests/export?fundId&type&format=csv` | [O] |
| Type / status filter | Always | — | Filters the loaded rows. | Client-side | [O] |
| ID button / *View details* | Row exists | `lp.dealing.view` | Opens the detail dialog for that row. | Prototype | [O] |
| *Retry* | Error panel visible | — | Re-runs the three loading calls. | Prototype | [O] |
| Deep link `?request=<id>` | On load and after every reload of the history | — | Opens the dialog for the row with that id when it is among the loaded rows of the selected fund; does nothing (no toast) otherwise. After the user closes the dialog, the next reload re-opens it while the parameter is still in the URL. | Prototype | [O] |

##### Modals & drawers

**Dialog — {Type} details** (opens from the ID button, *View details* or `?request=`) **[O]**

Title "Subscription details" or "Redemption details" ("Request details" when no row is selected); description = request id. Standard close button (top right), Esc and overlay click close it. Read-only; the content is a snapshot taken when the dialog was opened (not refreshed by a later reload). No actions (no cancel, no download, no timeline, no notes).

| Field | Control | Required | Options / default / placeholder | Validation today (code) | Target validation | Error message |
|---|---|---|---|---|---|---|
| Fund | read-only text | — | Fund name (looked up by id when needed) | — | — | — |
| Share class | read-only text | — | Row share class | — | — | — |
| Amount | read-only text | — | 2-decimal money in the session presentation currency | — | — | — |
| Units | read-only text | — | 2-decimal units, plus " (Est.)" when the row is an estimate | — | — | — |
| Status | read-only text | — | Mapped status text (see Tables) | — | — | — |
| Submitted | read-only text | — | `Mon D, YYYY` | — | — | — |
| Expected settlement | read-only text | — | `Mon D, YYYY` or `—` | — | — | — |

| Control | Enabled when | Permission | Effect | Wiring / API | Label |
|---|---|---|---|---|---|
| Close (X / Esc / overlay) | Dialog open | — | Closes the dialog; `selectedHistoryRow` is retained. | Prototype | [O] |

##### States

- Empty:
  - No open-ended fund in the session (and not loading): the panel "No open-ended funds are available for subscriptions and redemptions." replaces the page. **[O]**
  - No request rows (or none match the filters): one table row "No requests match the current filters." (the same text is used when the fund has no requests at all). **[O]**
  - No estimate yet: estimate panels show `—` (subscription units), `$0.00` fees and total, `0.00` units, `$0.00` settlement amount and `—` settlement date. **[O]**
  - No bank account for the fund: the *Source Bank Account* select has no options and the subscription cannot be submitted ("Select a source bank account."). **[O]**
  - `termsUrl` absent: *View Full Terms* is not rendered. **[O]**
- Loading:
  - Initial load and every reload: KPI values show `—` (the *Available to Redeem* helper also `—`), the table body shows "Loading request history…". The forms stay usable. The first request may be made for the fund selected in the topbar before the screen has chosen its own fund. **[O]**
  - Estimates: subscription subtitle "Calculating…"; redemption lines show `…`; the respective submit button is disabled. **[O]**
  - Submit: button label "Submitting…" and disabled. Export: *Export* disabled (no label change). **[O]**
- Error:
  - Load failure: red panel with the message (fallback "Request failed") and *Retry*; it replaces the page. **[O]**
  - Estimate failure: subscription "Could not estimate subscription", redemption "Could not estimate redemption" (or the API message). If the API returns field errors the toast has a description with one "{field}: {detail}" line per field. The estimate is cleared, so the submit button is disabled. In the target API a rule failure at estimate time (for example 422 `LP_MIN_BALANCE_BREACH`, `LP_NOTICE_PERIOD`, `LP_INSUFFICIENT_UNITS`, 403 `LP_COMPLIANCE_HOLD`, 403 `LP_DEALING_SUSPENDED`) therefore appears only as a toast, once per debounced change. **[O]**
  - Submit failure: "Subscription submission failed" / "Redemption submission failed" (or the API message, with the field-error description). If the error code is `LP_ESTIMATE_EXPIRED` or the field errors contain `estimateSnapshotId`, the toast is the API message (default "Your estimate has expired.") with description = the `estimateSnapshotId` field error (default "Please wait for a fresh estimate before submitting."), and the estimate is cleared. No new estimate is requested automatically. **[O]**
  - Export failure: toast "Export failed" or the API message. **[O]**
  - The mock never raises these errors; none of the error states can be seen in the prototype. **[O]**
- Disabled / read-only:
  - Submit buttons: see Actions. Export while exporting. The *Estimated Settlement Date* box and the dialog are read-only. **[O]**
  - Target: both submit buttons and the document upload are disabled for *VIEWER*; both forms are disabled with an explanatory banner while a compliance hold or `DEALING_SUSPENDED` blocker is present. **[P]**
- Conditional:
  - Card ring: `?type=subscriptions` / `?type=redemptions`. **[O]**
  - *Full Redemption* hides the value field. *Amount* mode additionally shows an inert currency select. **[O]**
  - Documents status line switches between the limit text and "{n} file(s) selected". **[O]**
  - Compliance rows turn red from the data; each blocker string adds a red row. Blockers do not disable any control. **[O]**
  - Estimates: below 560 px container width the subscription card is single-column.

##### Business rules & calculations

Rounding and formatting used by the screen **[O]**: money values are parsed with `Number(...)` (empty or invalid text is 0) and shown with 2 decimals and `en-US` separators in the session presentation currency (default USD), never in the fund or holding currency; compact money in the KPI strip as in Elements #2; units 2 decimals (the API carries 4-6); NAV 2 decimals on screen; dates `Mon D, YYYY`. Amounts sent to the API are `Number(input).toFixed(2)` strings; redemption units are sent rounded to 2 decimals.

Estimate-then-submit protocol **[O]** (UI) / **[I]** (server):
- Each change of amount, currency, share class (subscription) or mode, value, earliest dealing date (redemption) requests a new estimate after a 400 ms debounce. An estimate is never requested for an empty or zero amount or units (except *Full Redemption*) nor for an empty earliest dealing date.
- A submit must carry the `estimateSnapshotId` of the latest estimate; the submit button is enabled only while that estimate exists. The page keeps only the latest estimate.
- Target server semantics (from the real backend this UI was written for): a snapshot is a stored row with an id, owner client, fund, type (SUBSCRIPTION or REDEMPTION), the estimate JSON, a payload hash and an expiry of 15 minutes after creation. On submit the server rejects with 409: a missing id (422 "estimateSnapshotId is required"), an unknown snapshot or one owned by another client ("Invalid estimate snapshot"), a type mismatch ("Estimate type mismatch"), an expired snapshot (`LP_ESTIMATE_EXPIRED`, "Estimate has expired — re-run estimate", field errors `amount` "Estimate expired — refresh estimate" and `estimateSnapshotId` "Expired"), a fund mismatch ("Fund mismatch vs estimate") and a payload mismatch ("Request body does not match estimate snapshot"). The stored units and (for redemptions) settlement amount and earliest dealing date come from the snapshot, not from the submitted body. **[I]**
- BR-102: a snapshot binds the fund, share class, amount (subscription) or mode/amount/units/earliest dealing date (redemption) and currency; the hash must be computed over a fixed canonical field list that excludes `estimateSnapshotId` and unrelated keys, so that the same request produces the same hash at estimate time and at submit time. The real backend hashes the whole redemption body (including `estimateSnapshotId` at submit time), which can never match; the Nexus implementation must not copy that.
- BR-103: a snapshot is single-use: after a successful submit it is marked consumed and cannot back a second request. (The real backend leaves it reusable for 15 minutes.)
- BR-104: on submit the server re-checks every rule that the estimate checked (notice period, minimum balance, units available net of pending redemptions, compliance gate), because the position and the rules can change within the 15-minute life of a snapshot. (The real backend re-checks only the compliance gate.)

Subscription estimate — what the prototype computes **[O]** (mock): `managementFee = amount × mgmtFeeRate` (seed rate 0.0150); `otherFees = otherFeeFlat` (seed 250.00); `estimatedUnits = (amount − managementFee − otherFees) ÷ NAV` (NAV 15.4448; no floor, so a tiny amount gives negative units); `estimatedTotalInvestment = amount`; NAV, currency and share class are not converted; units rounded to 4 decimals, money to 2. Example 100,000.00: fee 1,500.00, other fees 250.00, units 6,361.3643, total 100,000.00.
Subscription estimate — what the real backend computes **[I]**: `managementFee = amount × subscriptionFeeBps ÷ 10,000`; `otherFees = 0.00` (the "other fee flat" is not implemented); `estimatedUnits = amount ÷ NAV` (fees are not deducted); `estimatedTotalInvestment = amount + managementFee + otherFees` (fees are added on top); NAV = NAV per unit of the investor's latest active holding position of the fund and class, replaced by `1` when no position or NAV 0 exists; units shown with up to 6 decimals, NAV up to 8. Example 100,000.00 at 150 bps: fee 1,500.00, units 6,474.671087, total 101,500.00.
- Q-115: Are subscription fees paid on top of the invested amount (design example: 2,000,000 + 20,000 + 5,000 = 2,025,000; real backend) or deducted from it (prototype)? — default: on top, units = amount ÷ NAV, matching the design document formula "Units Allocated = Net Subscription Amount / NAV Per Unit".
- Q-116: Is the rate labelled *Management Fee (Est.)* a one-off subscription fee or a recurring management fee? The real backend feeds it from the subscription-fee setting (`subscriptionFeeBps`), the prototype from `mgmtFeeRate`. — default: relabel as *Subscription Fee (Est.)* and keep a separate recurring management fee out of this estimate.
- BR-105: the estimate never allocates units; units are confirmed only after funds are received and the dealing-date NAV is approved; every pre-dealing figure is labelled as an estimate (`isEstimate` true on estimates, and rows created from an estimate stay labelled "(Est.)" until the units are allocated). **[I]**

Redemption estimate — prototype **[O]**: mode *Full* (or the `full` flag): units = `availableUnits`, gross value = `availableToRedeemValue`; mode *Units*: gross value = units × NAV; mode *Amount*: gross value = amount, units = amount ÷ NAV. `redemptionFee = gross × redemptionFeeRate` (seed 0.0050); `estimatedSettlementAmount = gross − fee`; `estimatedUnitsToCancel` 4 decimals; `aboveMinBalance = (accountValue − gross) ≥ minBalanceAmount` (amount test only); `earliestDealingDate` and `estimatedSettlementDate` both equal the date entered (no notice-period check, no settlement lag). Examples (NAV 15.4448): amount 250,000 → units 16,186.6777, fee 1,250.00, settlement 248,750.00, above minimum; amount 2,800,000 → remaining 45,390.00 < 100,000.00 → below minimum; full → units 168,046.7120, gross 2,595,390.00, settlement 2,582,413.05.
Redemption estimate — real backend **[I]**:
- Full: units = units held, gross value = account value (the whole position, not "available to redeem"). Units mode when `mode` is units or a `units` value is present: value = units × NAV. Otherwise value = amount, units = value ÷ NAV. NAV as above (`1` fallback).
- Checks in this order: units must be a finite number > 0 (422 `LP_VALIDATION` "Invalid redemption amount/units"); units ≤ units held (422 `LP_INSUFFICIENT_UNITS` "Redemption exceeds holdings", field error `units` "Insufficient units", details units held and requested); minimum balance — unless full, both `accountValue − value ≥ minBalanceAmount − 0.01` and `unitsHeld − units ≥ minBalanceUnits − 0.000001`, otherwise 422 `LP_MIN_BALANCE_BREACH` "Redemption would breach the minimum balance." with field error `amount` "Remaining account value would be below ${minimum}" and details minimum and remaining value (the estimate fails; it never returns `aboveMinBalance` false); notice period — see below.
- Fee: `redemptionFee = value × redemptionFeeBps ÷ 10,000`; `estimatedSettlementAmount = value − fee`. Settlement date = earliest dealing date + 3 calendar days (fixed; the rules field `settlementLagDays`, default 3, is returned but not used, and weekends are not skipped).
- Defaults: minimum balance 1,000,000.00 and 100,000 units; notice 30 days.
- "Available to redeem" in the overview = `max(0, accountValue − minBalanceAmount)`; available units = that value ÷ NAV (or `max(0, unitsHeld − minBalanceUnits)` when NAV is 0). The prototype seed instead sets it to account value minus pending redemptions. Pending subscriptions and pending redemptions are the sums of `amount` of the investor's requests in the fund whose status is `SUBMITTED`, `COMPLIANCE_REVIEW`, `AWAITING_FUNDS`, `AWAITING_NAV` or `UNDER_REVIEW`.
- BR-106: "available to redeem" and the insufficient-units check use units held minus units of redemption requests not yet settled, so that several pending requests cannot together exceed the position.

Notice period, dealing frequency, cut-off, settlement lag **[I]**:
- Notice: the earliest dealing date must be on or after today + `noticeDays` calendar days (server date, UTC); if not, 422 `LP_NOTICE_PERIOD` "Earliest dealing date must respect {n}-day notice period" with field error `earliestDealingDate` "Must be on or after {YYYY-MM-DD}" and details `noticeDays` and `earliestEligible`. When the client sends no date, the rule's next dealing date is used, else today + notice days.
- Next eligible dealing date shown on the page = the fund's stored next dealing date, else today + notice days. The real backend has no dealing calendar and no cut-off time: `dealingFrequency` (default `MONTHLY_LAST_BUSINESS_DAY`) is informational and an entered date is not checked against it.
- BR-107: the next eligible dealing date is the first dealing date of the fund's frequency that is on or after (submission date + notice days), computed on the fund's business-day calendar and cut-off time zone; the earliest-dealing-date field accepts only dealing dates on or after it.
- Q-117: Does the notice period run in calendar days from the submission date (as the page text "Calendar Days" and the real backend say) and is there a cut-off time of day on the notice date? — default: calendar days from submission date, no time-of-day cut-off.
- BR-108: estimated settlement date = dealing date + `settlementLagDays` business days (seed 2; design example 3; real backend hard-codes 3 calendar days).

Compliance gate **[I]**: the real backend blocks estimate and submit with 403 `LP_COMPLIANCE_HOLD` (message = hold reason, default "Dealing blocked by compliance hold") when the client's compliance record is on hold, 403 `LP_DEALING_SUSPENDED` "Dealing is suspended for this fund" when the fund's rules suspend dealing, and 409 `LP_ACCOUNT_INACTIVE` "Investor account is inactive" when the client is not ACTIVE (in practice an inactive profile is already rejected earlier with 403 "LP profile is not active"). Overview and rules report `blockers` as the codes `COMPLIANCE_HOLD`, `DEALING_SUSPENDED` and `NOT_ACCREDITED`; the page prints those codes verbatim as red rows. Accredited status, KYC status and unsettled capital calls are display-only: the real backend does not enforce them (the unsettled-calls flag is always true and the KYC default is "CLEAR", not "APPROVED", so the KYC row would show red for a clean client).
- FR-LP-057: The compliance block is computed at request time from the client's accreditation, KYC status, open capital calls past due and legal holds, and the same checks are enforced on estimate and submit. — AC: for a client with an unmet check the estimate and submit calls fail with `LP_COMPLIANCE_HOLD` and the page shows each failed check, the hold reason and disables both submit buttons.
- BR-109: the `kycStatus` value set and the strings in `blockers` are a closed list with human-readable text (for example "Compliance hold", "Dealing suspended for this fund", "Investor not accredited", "KYC update required", "Unsettled capital call"); the page prints the text, not codes.

Subscription submit **[I]** (real backend): creates one request with status `SUBMITTED`, type SUBSCRIPTION, amount, units from the snapshot, currency (upper-case, default USD), share class, bank account id, expected funding date stored as the requested dealing date, estimate snapshot id and JSON, payload hash, the submitting user id and optional investor notes; responds 201 with the request and message "Subscription submitted". Documents sent with the request are not stored by the real backend today. Redemption submit: the same with status `SUBMITTED`, type REDEMPTION, amount = the requested amount (or the net settlement amount when the request is by units or full), units and earliest dealing date from the snapshot, redemption mode `FULL` or `PARTIAL`, currency fixed to USD, optional bank account id and notes.
Prototype **[O]**: creates `deal-{n}` with status `SUBMITTED`, subscription units "0" (the screen sends no units), subscription dealing date = the rule's next eligible date (the entered funding date is ignored), redemption amount "0" in *Units* and *Full* mode, redemption units "0" in *Amount* and *Full* mode, `isEstimate` false; bank, files and idempotency key are discarded; the KPI figures do not change.

Idempotency **[I]**: both submit calls require header `Idempotency-Key` (8-200 printable ASCII characters; the UI sends a random UUID, new for every click). The server stores, per client + action + path + key, the payload hash and the 2xx response. Same key and same payload → the stored response is returned with header `Idempotent-Replay: true`; same key and a different payload → 409 `LP_IDEMPOTENCY_KEY_REUSED` "Idempotency-Key already used with a different payload"; missing or malformed key → 400 `LP_VALIDATION` "Idempotency-Key header required (8–200 printable ASCII)".
- BR-110: the UI keeps one idempotency key per submit attempt (reused when the same attempt is retried after a timeout) and discards it after a response; the hash for multipart requests covers the form fields and the file hashes (the real backend hashes an empty body for multipart because its middleware runs before the file parser).

Request status lifecycle **[I]** / **[P]**: statuses used by the target data and documents are `DRAFT`, `SUBMITTED`, `COMPLIANCE_REVIEW`, `AWAITING_FUNDS`, `FUNDS_RECEIVED`, `AWAITING_NAV`, `ALLOCATED`, `UNDER_REVIEW`, `SETTLED`, `REJECTED`, `CANCELLED`. The investor portal only creates `SUBMITTED`. No code path in the real backend changes a status afterwards; the design documents assign the processing to Fund Operations and Compliance staff on the GP side ("Fund Operations Approver" approves subscription and redemption processing under maker-checker rules; "Compliance" reviews KYC and holds). Subscription flow in the design: `SUBMITTED` → `COMPLIANCE_REVIEW` → `AWAITING_FUNDS` → `FUNDS_RECEIVED` → `AWAITING_NAV` → `ALLOCATED`, with `REJECTED` and `CANCELLED` as terminal states; the prototype also shows `UNDER_REVIEW` (redemption under review) and `SETTLED`.
- FR-LP-058: Staff-side endpoints (not part of the investor portal) move a dealing request through its statuses with a recorded actor, timestamp and reason, enforce maker-checker where the actor who allocates units is not the actor who submitted the request on the investor's behalf, and write the allocated units, final NAV and settlement date back to the request. — AC: an investor-visible status changes only through those endpoints; each change appears in the audit log and raises the investor notification "Redemption {reference} {status}" and, for `AWAITING_FUNDS`, an action on the investor dashboard.
- BR-111: transitions allowed: `SUBMITTED` → `COMPLIANCE_REVIEW` | `REJECTED` | `CANCELLED`; `COMPLIANCE_REVIEW` → `AWAITING_FUNDS` (subscription) | `UNDER_REVIEW` (redemption) | `REJECTED`; `AWAITING_FUNDS` → `FUNDS_RECEIVED` | `REJECTED` | `CANCELLED`; `FUNDS_RECEIVED` → `AWAITING_NAV`; `UNDER_REVIEW` → `AWAITING_NAV` | `REJECTED`; `AWAITING_NAV` → `ALLOCATED`; `ALLOCATED` → `SETTLED`. No transition leaves `REJECTED`, `CANCELLED` or `SETTLED`.
- Q-118: May an investor cancel a request that is still `SUBMITTED` from this page? The design lists `CANCELLED` but the page has no cancel action. — default: no investor-side cancel in this release; cancellation is requested through the Requests screen.

History and export **[I]** (real backend): the list returns the investor's requests of the fund ordered by creation time, newest first, filterable by type, status and fund, page size 50 by default and at most 200; `fundName` is included. Export: CSV with header `id,fundName,shareClass,requestType,status,amount,units,createdAt`, values not quoted (a comma in a fund name breaks the row), at most 200 rows although the code asks for 500; any other format, including `xlsx`, returns a JSON file named `dealing-requests.json`. Every row is returned with `isEstimate` true.
- FR-LP-059: The export honours all three filters (fund, type, status), quotes and escapes CSV values, returns an `.xlsx` workbook when `format=xlsx`, and is not truncated to the first page. — AC: the file for "Subscriptions + Allocated" contains exactly the rows the table shows with those filters, in the same order, and opens in a spreadsheet without column shifts.

Display of requests **[I]**: *Expected Settlement* = requested dealing date for a redemption; for a subscription the expected funding date is stored in the same field. — BR-112: the history exposes separate `requestedDealingDate`, `expectedFundingDate` (subscriptions) and `expectedSettlementDate`, and the column *Expected Settlement* shows the settlement date once known and otherwise the estimate.

Security and audit **[I]**: the client is resolved from the token; every dealing request is scoped to the client and fund scope; the submit action is logged with the payload hash and the snapshot id (design: audit log "dealing submit (payload hash + estimate snapshot id)"). The real backend does not verify that `sourceBankAccountId` belongs to the client. — BR-113: the source bank account must be an ACTIVE account of the same client (and fund scope) or the submit fails with 422 and a field error on `sourceBankAccountId`.

Permissions **[I]**: `lp.dealing.view` (overview, rules, requests, export, bank accounts) for all three roles; `lp.dealing.estimate` for all three roles; `lp.dealing.subscribe` and `lp.dealing.redeem` for *SIGNATORY*, *MANAGER* and GP staff acting for a client. A missing permission returns 403 `LP_FORBIDDEN` "Missing permission {code}"; submit by a *VIEWER* returns 403 "Authorised Signatory access required".

##### Edge cases

- Seed dates: the default funding date and earliest dealing date (Aug 1, 2026) are before the environment date (Oct 1, 2026). The prototype accepts them; the target API rejects a redemption date earlier than today + notice days. **[O]** / **[I]**
- Changing the fund keeps the previously chosen bank account, funding date and earliest dealing date; the bank may not exist for the new fund. **[O]**
- After every reload the currency of the subscription is reset to the presentation currency, discarding a user-chosen *GBP*. **[O]**
- The Amount input reformats to 2 decimals on every keystroke: typing "1" shows "1.00" with the caret at the end, so further digits are appended after the decimals unless the caret is moved before the point or the value is pasted. (Derived from the code, not verified in a browser.) **[O]**
- *Units* mode sends units rounded to 2 decimals, so exact unit counts with 4-6 decimals cannot be requested. **[O]**
- After a successful submit or an expired estimate the form is not cleared and no new estimate is requested; the submit button stays disabled until the amount (or mode/value/date) is edited. **[O]**
- A server-side rewrite of the earliest dealing date after an estimate changes the date field under the user's cursor and triggers a second estimate. **[O]**
- An out-of-order estimate response (slow first call, fast second call) can overwrite the newer estimate; submit then carries the stale `estimateSnapshotId`. **[O]**
- A *Full Redemption* request is exempt from the minimum balance in the target API; the prototype computes the remaining balance for it and happens to pass. **[O]** / **[I]**
- When a fund has no holding the real backend returns NAV 0 in the overview and uses NAV 1 in estimates, which produces units equal to the amount. **[I]**
- Two pending redemptions by the same investor are not netted against each other by the real backend; each is checked against the full position. **[I]**
- One snapshot can be submitted more than once within 15 minutes with different idempotency keys in the real backend (see BR-NEW above). **[I]**
- `?request=<id>` of a request that belongs to another fund of the investor, or that is beyond the first 50 rows, opens nothing and shows no message. **[O]**
- A narrow window (below the `xl` breakpoint) places *Validation Rules* between the redemption card and the history. **[O]**
- If `termsUrl` is a relative path with no matching route, the new tab shows a not-found page. **[O]**

##### Gaps, defects & open questions

- **DEF-378** Status text and colours. The row mapper turns the API values `ALLOCATED`, `UNDER_REVIEW`, `SUBMITTED` into "ALLOCATED", "UNDER REVIEW", "SUBMITTED" (it never lower-cases), while the badge colours and the status filter compare with "Allocated", "Under Review", "Submitted". Result: no badge colour, and the status filter returns nothing for any status other than *All Statuses*. (Derived from the code; the mock data are upper-case.)
- **DEF-379** `dealingFrequencyLabel` lower-cases the first letter of each word instead of capitalising it: `MONTHLY` shows "mONTHLY".
- **DEF-380** Column *Expected Settlement* shows the requested dealing date, and the mock ignores the funding date the investor entered.
- **DEF-381** The submit buttons are labelled *Review …* but submit immediately; the design requires confirmation of the notice period and the estimate before a request is created.
- **DEF-382** Compliance rows use the same check glyph for pass and fail (colour only); KYC passes only for the literal `APPROVED`, whereas the real backend's default status is `CLEAR`.
- **DEF-383** Blockers never disable the forms and the page never shows the hold reason; `valuationStatus` is delivered but not shown beside the NAV, contrary to the rule that every NAV carries its valuation status.
- **DEF-384** Money formats ignore the row, fund and holding currency (always the presentation currency) and the compact KPI format always prints `$`.
- **DEF-385** After a subscription is submitted or an estimate expires the page asks the user to "wait for a fresh estimate" but never requests one.
- **DEF-386** The documents zone has no file list, no remove control and no size/type validation; dropped files bypass the `accept` filter.
- **DEF-387** Decorative info icons next to *Allocation Estimate*, *Redemption Type*, *Minimum Balance*, *Notice Period*, *Dealing Frequency* and *Compliance Checks* look like help but have no popover.
- **DEF-388** With `?request=` in the URL the dialog reopens after the user closes it whenever the history reloads.
- **DEF-389** The real backend uses `upload.single("file")` while the UI sends parts named `files[]`; the request fails with HTTP 500 `LP_EXPORT_FAILED` and uploaded files are never stored. Files above 25 MB also return 500 instead of 413.
- **DEF-390** The real backend hashes the complete redemption body, so a redemption submit that includes `estimateSnapshotId` can never match its estimate (409 "Request body does not match estimate snapshot").
- **DEF-391** The real backend export is limited to 200 rows, is unquoted CSV and returns JSON for `xlsx`; the UI would save that JSON as `dealing-requests.xlsx`.
- **DEF-392** The real backend returns `isEstimate: true` for every request row, so every row would display "(Est.)".
- FR-LP-060: The page applies the investor's role: for *VIEWER* the two forms stay usable for estimates but both submit buttons and the document upload are disabled with the text "Your role can view and estimate. Submitting requests requires an Authorised Signatory." — AC: a *VIEWER* session cannot trigger a submit call from the UI and a forced call returns 403.
- FR-LP-061: The page keeps the selected fund in the URL (`?fund=`), honours the topbar fund selector when it holds an open-ended fund, and applies `?type=` also to the history type filter. — AC: opening `?type=redemptions` pre-selects *Redemptions* in the type filter and scrolls the redemption card into view.
- FR-LP-062: The history is paginated (page size 25, page controls, total count) and sortable by *Submitted On*, *Amount / Units* and *Status*; the status filter is applied on the server and passed to the export. — AC: a client with 120 requests can reach every request; filter and export produce the same rows.
- FR-LP-063: The request detail shows the request reference, type, fund, share class, requested amount or units and mode, estimate (with the estimate date and "indicative" label), bank account (masked), dealing date, expected funding date, expected settlement date, allocated units and final NAV once known, status history with timestamps, uploaded documents with download links, and the investor notes. — AC: every field is present for a request in each status and read from the request API, not from the list row.
- FR-LP-064: The page refreshes when a request changes status (real-time event `lp_dealing_updated` or polling every 60 seconds), updating the KPIs, the table and an open dialog. — AC: a status change made by staff is visible within 60 seconds without reloading.
- FR-LP-065: An investor note field is offered on both forms and sent as `investorNotes` (subscription) / `notes` (redemption). — AC: the note appears in the request detail.
- FR-LP-066: A human-readable request reference (for example `SUB-000024`, `RDM-000016`) is generated per request and used in the table, the notifications and Account Activity. — AC: the reference in the notification text equals the ID column.
- BR-114: Currency of a request is one of the fund's dealing currencies; the estimate converts nothing and the history shows the request's own currency. — AC: a request in GBP is shown in GBP.
- Q-119: What are the minimum initial and additional subscription amounts per share class, and is a subscription document set mandatory (for example a signed subscription agreement and proof of payment) before the request leaves `SUBMITTED`? — default: no minimum enforced in this release; documents optional and visible to staff.
- Q-120: Which documents are "proof of payment"? The page offers only "Supporting Documents" and the NVCCZ design lists no distinct proof-of-payment field. — default: treat all uploads as supporting documents; staff mark funds received.
- Q-121: Which maximum file size applies? The prototype shows 10 MB (rules `maxFileMb`), the real backend hard-codes 25 MB and the design example is 25 MB. — default: take `maxFileMb` from the fund rules, default 25, enforce it on the client and the server.
- Q-122: Is the redemption fee rate (design example 0.208613 %, seed 0.50 %, real backend 0 by default) charged on the gross redemption value, and who may change the fee, notice, minimum balance and suspension flag? — default: gross value; fund rules edited by Fund Operations with maker-checker.
- Q-123: Should the redemption minimum balance test use amount, units, or both? The prototype tests amount only; the real backend tests both. — default: both.
- Q-124: Is a fund the investor holds through several share classes redeemable per class on this page? The page supports one class per fund. — default: one class per fund in this release; additional classes appear as extra options in *Share Class* and the estimate is per class.
- Q-125: Should an investor with a pending redemption be allowed to submit another one for the same dealing date? — default: yes, provided the sum of pending requests stays within the available position.
- Q-126: `termsUrl` — where are the dealing terms hosted, and is the link per fund or per share class? — default: a document in the Documents vault per fund, opened through the document viewer.

#### 5.B.6 Documents (`/lp-portal/documents`, `lp.documents.view`)

| Attribute | Value |
| --- | --- |
| Purpose | Permissioned register of the documents published to the signed-in investor organisation (statements, capital-call notices, distribution statements, fund reports, tax, legal, governance), with a category tab bar, four KPI tiles, search, sort, a paged table, an inline viewer, document details with the SHA-256 checksum, a permissions list, a download history (audit trail) and secure download. **[O]** |
| Access | Any signed-in portal user whose `lpRole` is VIEWER, SIGNATORY or MANAGER may list, preview and download (backend permissions `lp.documents.view` and `lp.documents.download`; the Nexus naming is `inv:documents.view`). **[O]** in the reference API, **[I]** in this UI: the screen never reads `lpRole`, so nothing is hidden or disabled by role. Documents are visible only when they are published to the investor organisation and, when `fundId` is set, the fund is inside the user's fund entitlement; a document id outside the entitlement answers 404 "Document not found". **[I]** Without a session the portal-kit login gate redirects to `/login`. **[O]** |
| Prototype layer | `components/lp-portal/screens/lp-document-centre-screen.tsx` (native React, imported from the Arcus/NVCCZ LP portal) over `lib/lp-portal/hooks.ts` (`useLpDocuments`), `lib/lp-portal/mappers.ts` and `lib/lp-portal/mock-api.ts` + `mock-store.ts` through the `lpPortalApi` Proxy in `lib/api/lp-portal-api.ts`. **[O]** |
| Wiring status | Prototype for every element. All nine document calls are answered by the mock store (`LP_LIVE_DOMAINS.documents = false`); `api-client.ts` is a stub that rejects. Target calls are named per row. **[O]** |
| Entry points | Sidebar *Documents* (`/lp-portal/documents`); sidebar *Statements & Reports* (`/lp-portal/documents?category=Fund%20Reports`); *Open in Documents* on Notices (`?category=Notices`); topbar global search hit (`?document={id}`); Capital Activity, Account Activity and Requests document links (`?document={id}`); Performance section links (`?category=Fund%20Reports`); Dashboard *Latest Documents & Notices* rows (`/lp-portal/documents`); bell notification links (mock seed uses the wrong key `?doc=`, which is ignored). **[O]** |
| Exit points | Document links to other pages: none on this screen. Shell navigation (sidebar, topbar, fund selector). The page performs no router navigation of its own and does not write tab, search, sort, page or selection into the URL. **[O]** |

##### Layout

1. Page header: title *Document Centre* with an info popover, subtitle. **[O]**
2. Error banner (only when the list or summary request failed) with *Retry*. **[O]**
3. Category tab bar: *All Documents*, *Statements*, *Capital Calls*, *Distributions*, *Fund Reports*, *Tax*, *Legal*, *Governance*, then the *More* dropdown (*Subscription Documents*, *Notices*, *Other*). **[O]**
4. KPI strip of four tiles: *Total Documents*, *New This Week*, *Requires Signature*, *Secure Downloads YTD*. **[O]**
5. Register card (left, fluid): toolbar (search box, *Sort by:* select), document table (9 columns), footer (range text and pager). **[O]**
6. Detail column (right, 340 px, only from the `xl` breakpoint; stacked under the register below it; only while a document is selected, and in practice always when the register has rows): Card 1 (title, status badge, fund and category line, close button, preview frame with toolbar, tabs *Details* and *Permissions*) and Card 2 (*Download History*). **[O]**
7. Dialog *Fullscreen preview* (title = document title). **[O]**
8. Dialog *Download history*. **[O]**

##### Elements

| # | Element | Type | Content / behaviour | Data source (current → target) | Label |
|---|---|---|---|---|---|
| 1 | Page title | `h1` | *Document Centre*, 24 px bold. | Static | [O] |
| 2 | Title info popover | info icon button, aria-label "Document Centre info" | Popover heading *Document Centre*; text "Secure repository for fund documents and communications." | Static | [O] |
| 3 | Subtitle | text | "Secure repository for all fund documents and communications." | Static | [O] |
| 4 | Error banner | red box (`#fecaca` border, `#fef2f2` fill) | Shows the error text (default "Request failed") and a blue pill button *Retry* that reloads list and summary. Visible only when either request failed; the table and KPI tiles still render underneath with empty/zero values. | Prototype → `getDocuments` + `getDocumentsSummary` failure | [O] |
| 5 | Category tab | 8 text buttons with underline | Labels and category sent to the API: *All Documents* (none), *Statements* (`QUARTERLY_STATEMENT`), *Capital Calls* (`CALL_NOTICE`), *Distributions* (`MANUAL`), *Fund Reports* (`PERFORMANCE_REPORT`), *Tax* (`TAX`), *Legal* (`LEGAL`), *Governance* (`GOVERNANCE`). Active tab: blue text and 2 px blue underline. Click sets the tab and page 1. | Static list → target vocabulary in Business rules | [O] |
| 6 | Tab count pill | rounded pill after the label | Shown only when the count is greater than 0. *All Documents* = `summary.total`; every other tab = the `summary.byCategory` entry whose mapped label equals the tab id. Active pill blue (`#dbeafe` / `#1d4ed8`), inactive grey (`#f3f4f6` / `#6b7280`). | Prototype `documentsSummary` → `GET /lp-portal/documents/summary` | [O] |
| 7 | *More* dropdown | trigger button with chevron + menu | Items *Subscription Documents*, *Notices*, *Other*. Selecting one makes the *More* tab active (blue underline), stores the sub-category and resets the page to 1. The trigger keeps the label *More*; it shows neither the chosen item nor a count. These three categories have no API category mapping, so the request carries no category filter (see Defects). | Static | [O] |
| 8 | KPI tile *Total Documents* | tile: icon in blue circle (file), info popover, label, value, helper | Value `summary.total` (fallback: list total, then 0). Helper "Across {n} fund(s)" where n is the number of funds in the session ("1 fund" singular, otherwise "{n} funds"). | Prototype → `GET /lp-portal/documents/summary` `total`; funds from `GET /lp-portal/session` | [O] |
| 9 | KPI tile *New This Week* | tile, green circle (sparkles) | Value `summary.newThisWeek` (0 when absent). Helper "Published in the last 7 days". | Prototype (constant 2) → `summary.newThisWeek` | [O] |
| 10 | KPI tile *Requires Signature* | tile, orange circle (pen) | Value `summary.requiresSignature` (0 when absent). Helper "Awaiting your signature". | Prototype (constant 1) → `summary.requiresSignature` | [O] |
| 11 | KPI tile *Secure Downloads YTD* | tile, violet circle (shield) | Value `summary.secureDownloadsYtd` (0 when absent). Helper "Verified downloads this year". | Prototype (constant 14) → `summary.secureDownloadsYtd` | [O] |
| 12 | KPI info popovers | 4 info icons (aria-label "{label} info") | Popover shows only the KPI label; no description text exists. | Static | [O] |
| 13 | Search box | text input, 280 px max, magnifier icon | Placeholder "Search documents..."; see Inputs. | Prototype → `getDocuments({q})` | [O] |
| 14 | Sort control | label *Sort by:* + select (140 px) | Options *Most Recent* (default), *Document Name*, *Fund*. | Client-side on the loaded page | [O] |
| 15 | Register table | table, min width 980 px, horizontal scroll | See Tables. | Prototype → `GET /lp-portal/documents` | [O] |
| 16 | Range text | text under the table | "Showing {from} to {to} of {total} documents" with the three numbers bold. | Prototype → target from list response | [O] |
| 17 | Pager | prev button, page buttons, ellipsis, last-page button, next button | See Tables / Pagination. | Prototype → `page`, `totalPages` of the list response | [O] |
| 18 | Detail card header | title `h2`, status badge, line "{fund} · {category}" with folder icon, close X (aria-label "Close details") | Reflects the selected row merged with the detail response. | Prototype → `GET /lp-portal/documents/{id}` | [O] |
| 19 | Preview toolbar | icon row | File icon; previous page (aria "Previous preview page") and next page (aria "Next preview page") around the text "{n} / {pages}"; zoom out (aria "Zoom out"), "{zoom}%", zoom in (aria "Zoom in"), fit (aria "Fit to screen"), fullscreen (aria "Fullscreen"). `pages` = `pageCount`, or 1 when absent. | Prototype | [O] |
| 20 | Preview frame | 200 px high area | When a preview blob exists: `iframe` titled "Preview {title}" showing the blob URL, scaled by CSS `scale(zoom/100)`. Otherwise a placeholder page card showing the document title, the formatted published date and, while the detail request runs, the text "Loading detail…". | Prototype (mock PDF blob, which is not a valid PDF) → `GET /lp-portal/documents/{id}/preview` (blob) | [O] |
| 21 | Detail tabs | two underlined tabs | *Details* (default) and *Permissions*; reset to *Details* on every selection change. | Static | [O] |
| 22 | Details field *Document Type* | label/value with file icon | Value is the raw business category of the document (it is shown as "PDF Document" only if the category string equals "PDF"). | Prototype → `LpDocument.category` | [O] |
| 23 | Details field *Published Date* | label/value with calendar icon | Raw `YYYY-MM-DD` text of the detail response (the table shows the same date formatted "MMM d, yyyy"). | Prototype → `publishedDate` | [O] |
| 24 | Details field *Version* | label/value with history icon | Version string, e.g. "1.0". | Prototype → `version` | [O] |
| 25 | Details field *File Size* | label/value | `—` when the size is missing or 0; "{n} B" below 1 KiB; "{x.x} KB" below 1 MiB; otherwise "{x.x} MB" (1 MiB = 1 048 576 bytes). | Prototype → `fileSizeBytes` | [O] |
| 26 | Details field *Checksum (SHA-256)* | label, monospace value (10 px, wraps anywhere), copy button (aria "Copy checksum") | Detail-response checksum, falling back to the list value. | Prototype → `checksumSha256` | [O] |
| 27 | Permissions list | list of grey bordered pills | One pill per entry of `permissions`, shown verbatim (mock: "VIEW", "DOWNLOAD", "ACKNOWLEDGE"). | Prototype → `permissions[]` | [O] |
| 28 | *Download History* card | heading + link + list | Heading *Download History*; *View All* link (disabled and grey when the history is empty); empty text "No downloads recorded yet."; otherwise the 3 most recent entries (person icon, user in bold, date-time, right-aligned "IP: {ip}") and, when there are more than 3, a link "+{n−3} more downloads". | Prototype → `history[]` of `GET /lp-portal/documents/{id}` | [O] |
| 29 | File-type icon | 32 px rounded square | Spreadsheet (green) when the mime type contains "sheet" or "excel"; document (blue) when it contains "word"; every other type shows the red PDF style. | Prototype → `mimeType` | [O] |
| 30 | Category badge | pill (11 px, semibold) | Label from the category map (see Business rules); colours in Tables. | Prototype | [O] |
| 31 | Status badge | pill | Status text with underscores replaced by spaces; intended colour map in Tables. | Prototype | [O] |
| 32 | Mobile / narrow layout | responsive grid | KPI tiles 1 column, 2 columns from `sm`, 4 from `xl`; detail column below the register under `xl`; table scrolls horizontally. | Static | [O] |

##### Tables

**Document register**

| Column | Format | Sortable | Notes |
| --- | --- | --- | --- |
| Document Name | file-type icon, bold title (truncated), grey file name below (11 px) | Yes, via *Sort by: Document Name* (locale string compare of the title, current page only) | Title = `name`; the file-name line repeats `name` (no extension). **[O]** |
| Fund | text, max 160 px, truncated | Yes, via *Sort by: Fund* (locale compare, current page only) | `fundName`; documents with no fund (organisation-level) show an empty cell. **[O]** |
| Category | badge | No | Mapped label of `category`. **[O]** |
| Period | text, no wrap | No | `period`, or `—` when null. **[O]** |
| Published Date ↓ | "MMM d, yyyy" (en-US, date only) | No (the arrow is static text, not a control) | `publishedDate`. Default order = server order (target: `publishedAt` descending). **[O]** |
| Version | tabular text | No | `version`. **[O]** |
| Access Scope | person icon + text | No | `accessScope` with underscores replaced by spaces and no case change (mock: "Investor organisation", "Investor account", "Fund investors"; the reference API sends `INVESTOR_ORGANISATION`, which would show as "INVESTOR ORGANISATION"). **[O]** |
| Status | badge | No | See status map. **[O]** |
| Actions | download icon button + kebab menu, right aligned | No | See Actions. **[O]** |

- Filters: category tab (and *More* sub-category) → `category`; fund selector in the top bar (*All Funds* = none, otherwise `fundId`; documents without a fund are always included by the mock); search `q`. No status, period, version or date filters exist. **[O]**
- Search: case-insensitive. Mock matches document name, category label or fund name; the reference API matches `title contains q` only. **[O]** / **[I]**
- Row click: selects the row (`selectedId`), opens the detail column and starts the detail and preview requests. Selected row: light-blue fill and 3 px blue bar on the left; hover grey. **[O]**
- Row actions: see Actions. **[O]**
- Pagination: list request `page` and `pageSize = 20`; buttons as in Elements #17. Page-number window: up to 5 numbers; with more than 5 pages, 1–5 while the current page ≤ 3, the last 5 while the current page ≥ total−2, otherwise current−2…current+2; an ellipsis and the last-page button appear when pages > 5 and current < total−2. The current page is clamped to `totalPages`. The tab, search and category changes reset to page 1; a fund change does not. **[O]**
- Range text: `from = total = 0 ? 0 : (page−1)×10 + 1`, `to = min((page−1)×10 + rowsOnPage, total)`, `total` = summary total (see Defects). **[O]**
- Status → badge colour (intended map in code; see Defects, none of these colours currently applies): *New* blue (`#dbeafe` / `#1d4ed8`); *Requires Signature* orange outline (`#fdba74` border, `#fff7ed` fill, `#c2410c` text); *Published* green outline (`#86efac` border, `#f0fdf4` fill, `#15803d` text); *Active* blue (`#dbeafe` / `#2563eb`); *Paid* green (`#dcfce7` / `#15803d`); every other value grey (`#f3f4f6` / `#4b5563`). **[O]**
- Category → badge colour: *Statements* `#dbeafe`/`#1d4ed8`; *Capital Calls* `#ffedd5`/`#c2410c`; *Distributions* `#ccfbf1`/`#0f766e`; *Fund Reports* `#dbeafe`/`#2563eb`; *Tax* `#fef9c3`/`#a16207`; *Legal* `#ede9fe`/`#6d28d9`; *Governance* `#ede9fe`/`#7c3aed`; *Subscription Documents* `#ccfbf1`/`#0d9488`; *Notices* `#dcfce7`/`#15803d`; *Other* and every unknown label (for example *Financial Statements*, *Dealing*, *AUDIT*) `#f3f4f6`/`#4b5563`. **[O]**
- Proposed status vocabulary and colours [P]: PUBLISHED → "Published" (green outline); REQUIRES_SIGNATURE → "Requires Signature" (orange outline); RESTATED → "Restated" (amber `#fef9c3`/`#a16207`); SUPERSEDED → "Superseded" (grey); WITHDRAWN → not listed (see BR-NEW below); chip "New" (blue) = PUBLISHED and published within the last 7 days, replacing the Published chip. **[P]**

**Download history (detail card and dialog)**

| Column | Format | Sortable | Notes |
| --- | --- | --- | --- |
| User | bold name | No | `history[].user`. The reference API sends the raw user id (cuid), not a display name. **[O]** / **[I]** |
| Action | blue 11 px text, dialog only | No | `history[].action` verbatim ("DOWNLOAD" in the seed; the reference API also writes "VIEW" and "PREVIEW"). **[O]** |
| Date-time | "MMM d, yyyy, h:mm AM/PM" in the browser time zone | No | `history[].at`. **[O]** |
| IP | "IP: {ip}" right aligned | No | `history[].ip`; `ip` may be null in the reference API. **[O]** |

- Order: as received (reference API: newest first, maximum 20 rows, all users of the investor organisation). Card shows 3, dialog shows all. **[O]** / **[I]**

##### Inputs & validation

| Field | Control | Required | Options / default / placeholder | Validation today (code) | Target validation | Error message |
| --- | --- | --- | --- | --- | --- | --- |
| Query `category` | URL query, read once per prop change | No | Matches a tab label or tab id (e.g. "Fund Reports", "Statements", "Notices"); default "All Documents" | A value that is not a tab and not in the More list falls back to *All Documents* (silently). **[O]** | Same, plus unknown value ignored. **[P]** | None |
| Query `document` | URL query | No | Document id | Applied to `selectedId`, then overwritten by the first row (see Defects). **[O]** | Must select the requested row, load its page if needed and scroll it into view; unknown or unentitled id → 404 toast "Document not found". **[P]** | "Could not load document detail" (fallback) |
| Search | text | No | Placeholder "Search documents..."; default empty | `trim()`, 300 ms debounce, empty sends no `q`; no length limit. **[O]** | Max 200 characters; wildcard characters escaped. **[P]** | None |
| Sort by | select | No | *Most Recent* (`recent`, default), *Document Name* (`name`), *Fund* (`fund`) | Applies to the 20 rows of the current page only. **[O]** | Server-side `sortBy`/`sortDirection` (the reference API accepts both) so sort covers all pages. **[P]** | None |
| Category tab / More item | buttons | No | See Elements #5, #7 | None | `category` ∈ the target vocabulary | None |
| Page | pager buttons | No | 1…`totalPages` | Clamped to `totalPages` | Same | None |
| Preview page | prev/next icon buttons | No | 1…`pages` | Counter only (no effect on the frame) | Must scroll the viewer to that page. **[P]** | None |
| Zoom (card) | −, +, fit buttons | No | 100 %, step 10, range 60–160 | Clamped | Same | None |
| Zoom (dialog) | *Zoom out*, *Zoom in*, *Reset* | No | Shared with the card; range 60–200 | Clamped | One shared range. **[P]** | None |
| Detail tab | tabs | No | *Details* / *Permissions* | None | None | None |

##### Actions

| Control | Enabled when | Permission | Effect (state change, toast text, navigation) | Wiring / API | Label |
| --- | --- | --- | --- | --- | --- |
| Category tab | Always | `lp.documents.view` | Sets the tab and page 1; reloads list with the tab's category; selection moves to the first row of the result. | Prototype → `GET /lp-portal/documents?category=` | [O] |
| *More* → item | Always | `lp.documents.view` | Sets tab *More*, sub-category, page 1; reloads (no category is sent). | Prototype | [O] |
| Search typing | Always | `lp.documents.view` | Sets page 1; reloads 300 ms after the last keystroke. | Prototype → `GET /lp-portal/documents?q=` | [O] |
| *Sort by* change | Always | None | Re-orders the loaded page; no request. | Client-side | [O] |
| Row click | Always | `lp.documents.view` | Selects the document: resets preview page, zoom and tab; requests detail and preview. No toast on success. | Prototype → `GET /lp-portal/documents/{id}` and `GET /lp-portal/documents/{id}/preview` | [O] |
| Row download icon (aria "Download {title}") | Always (not disabled while running) | `lp.documents.download` | Requests the file, saves it through a temporary link, toast "Document downloaded."; on failure toast with the server message or "Download failed". Does not select the row. The saved file name is the document name without an extension (see Defects). | Prototype → `GET /lp-portal/documents/{id}/download` (blob) | [O] |
| Kebab (aria "More actions for {title}") | Always | None | Opens the menu *Open preview*, *Download*, separator, *View permissions*. | Static | [O] |
| Menu *Open preview* | Always | `lp.documents.view` | Selects the document. | Prototype | [O] |
| Menu *Download* | Always | `lp.documents.download` | Same as the download icon. | Prototype | [O] |
| Menu *View permissions* | Always | `lp.documents.view` | Sets the detail tab to *Permissions*; on an unselected row the selection effect resets it to *Details* **(verify in browser)**. | Static | [O] |
| Close X (aria "Close details") | Selected row exists | None | Intended to close the detail column; in practice the first row is selected again. | Static | [O] |
| Preview previous / next page | Previous: page > 1; next: page < `pages` | None | Changes the counter only. | Static | [O] |
| Zoom out / in / fit | Always | None | Zoom −10 (min 60) / +10 (max 160) / 100. | Static | [O] |
| Fullscreen (aria "Fullscreen") | Always | `lp.documents.view` | With no preview blob: toast "Preview is not available for this document."; otherwise opens the *Fullscreen preview* dialog. | Static | [O] |
| *Details* / *Permissions* tab | Always | None | Switches the pane. | Static | [O] |
| Copy checksum (aria "Copy checksum") | Always | None | Writes the checksum to the clipboard (not awaited) and shows toast "Checksum copied" (no full stop) even if the clipboard write is refused. | Browser clipboard | [O] |
| *View All* / "+{n} more downloads" | History not empty (*View All* is disabled when empty) | None | Opens the *Download history* dialog. | Static | [O] |
| *Retry* | Error banner shown | None | Reloads list and summary. | Prototype | [O] |
| Verify checksum | n/a | `lp.documents.view` | Not present in the UI. Target: recompute the stored file's SHA-256 and compare to the stored value. | `lpPortalApi.verifyVaultDocument` → `GET /lp-portal/vault/{documentId}/verify`; not called by any screen | [I] |
| Vault list | n/a | `lp.documents.view` | Not present in the UI. | `lpPortalApi.getVault` → `GET /lp-portal/vault?category&fundId&search`; not called | [I] |
| Vault download | n/a | `lp.documents.download` | Not present in the UI. | `lpPortalApi.downloadVaultDocument` → `GET /lp-portal/vault/{documentId}/download`; not called | [I] |
| Sign / acknowledge a document | n/a | `lp.documents.view` + signatory role | Not present in the UI although the status *Requires Signature* and the permission "ACKNOWLEDGE" exist in the data. | none; Nexus has `POST /investor/documents/{ref}/sign` | [I] |

##### Modals & drawers

**Dialog — Fullscreen preview** (opened by the Fullscreen button when a preview blob exists)

| Field | Control | Required | Options / default / placeholder | Validation today (code) | Target validation | Error message |
| --- | --- | --- | --- | --- | --- | --- |
| Zoom | text buttons *Zoom out*, *Zoom in*, *Reset* with "{zoom}%" | No | Step 10 %, range 60–200, reset 100 (state shared with the card) | Clamped | Same | None |

| Control | Enabled when | Permission | Effect | Wiring / API | Label |
| --- | --- | --- | --- | --- | --- |
| Dialog close (X, ESC, overlay) | Always | None | Closes the dialog; zoom value is kept. | Static | [O] |
| *Zoom out* / *Zoom in* / *Reset* | Always | None | Changes the scale of the iframe. | Static | [O] |

- Size: 92 vh high, up to 96 vw wide, no padding; title = document title (fallback "Document preview"); screen-reader description "Fullscreen document preview". Body: `iframe` titled "Fullscreen preview {title}" with the same blob URL; without a blob the text "Preview unavailable". **[O]**

**Dialog — Download history** (opened by *View All* or "+{n} more downloads")

| Field | Control | Required | Options / default / placeholder | Validation today (code) | Target validation | Error message |
| --- | --- | --- | --- | --- | --- | --- |
| (none) | read-only list | n/a | n/a | n/a | n/a | n/a |

| Control | Enabled when | Permission | Effect | Wiring / API | Label |
| --- | --- | --- | --- | --- | --- |
| Dialog close | Always | None | Closes. | Static | [O] |

- Title *Download history*; description "{document title} — {n} recorded download(s)" ("download" singular only when n = 1; "Document" when nothing is selected). Body lists every entry (rounded grey cards: avatar, user, blue action text if any, date-time, "IP: {ip}"), scrolls at 60 vh; empty text "No downloads recorded yet.". **[O]**

##### States

- Empty: table row "No documents match your filters." (also shown after an error, because data is cleared); detail column hidden when no row is selected; history "No downloads recorded yet."; KPI tiles show 0 when the summary is absent; tab counts hidden when 0. **[O]**
- Loading: table row "Loading documents…" (single cell across 9 columns) on every reload, including tab, search, page and fund changes; the previous KPI and tab counts stay on screen while reloading; preview placeholder text "Loading detail…". The footer keeps showing the previous range text. **[O]**
- Error: list/summary failure → red banner with the message and *Retry*; detail failure → toast "Could not load document detail" (or the server message) and the card falls back to the list row's values; preview failure → toast (status 415: "Preview is not available for this file type."; otherwise the server message or "Preview unavailable for this document") and the placeholder page stays; download failure → toast (server message or "Download failed"). The reference API uses 404 "Document not found" / "File not available" and 415 `LP_UNSUPPORTED_MEDIA` "Preview is only available for PDF and image documents". **[O]** / **[I]**
- Disabled / read-only: *View All* disabled with no history; previous/next preview page and pager prev/next disabled at the ends (40 % opacity). There is no write action on this screen. **[O]**
- Conditional: detail column present only when a document is selected; xlsx/docx/pdf icon by mime type; the *Fullscreen* button toasts instead of opening when there is no preview; More categories select an unfiltered list; KPI helper pluralises "fund(s)". **[O]**

##### Business rules & calculations

- Visibility **[I]**: a document is listed only if (a) it belongs to the signed-in investor organisation, (b) it is published (`publishedAt` set and status not WITHDRAWN/DRAFT) and (c) its fund is within the user's fund entitlement or it has no fund. Cross-investor or unentitled id → 404, never 403 (FR-INV-001, FR-DOC-005).
- BR-115: unpublished (draft) and withdrawn documents are never returned by list, summary, detail, preview or download. The reference list query does not filter `publishedAt` today. **[P]**
- Category vocabulary. UI tab → API category: Statements → `QUARTERLY_STATEMENT`; Capital Calls → `CALL_NOTICE`; Distributions → `MANUAL`; Fund Reports → `PERFORMANCE_REPORT`; Tax → `TAX`; Legal → `LEGAL`; Governance → `GOVERNANCE`; *Subscription Documents*, *Notices*, *Other* → none. Label map used for badges and counts: `PERFORMANCE_REPORT` → *Fund Reports*; `CALL_NOTICE` → *Capital Calls*; `QUARTERLY_STATEMENT` → *Statements*; `TAX` → *Tax*; `LEGAL` → *Legal*; `GOVERNANCE` → *Governance*; `MANUAL` → *Other*; any other value → the text with underscores replaced by spaces (not case-folded). Vault categories in the API type: `TAX`, `AUDIT`, `PERFORMANCE_REPORT`, `CALL_NOTICE`, `MANUAL`, `QUARTERLY_STATEMENT`, `LEGAL`. Documents the reference platform publishes: `PERFORMANCE_REPORT` (fund-report jobs), `QUARTERLY_STATEMENT`, `TAX` (tax return packs), `CALL_NOTICE` (capital-call notices), and GP uploads with a chosen category (default `MANUAL`). **[O]** / **[I]**
- BR-116: one canonical category enum is used by the API, the filter and the counts: `STATEMENTS`, `CAPITAL_CALLS`, `DISTRIBUTIONS`, `FUND_REPORTS`, `TAX`, `LEGAL`, `GOVERNANCE`, `FINANCIAL_STATEMENTS`, `NOTICES`, `SUBSCRIPTION`, `REDEMPTION`, `DEALING`, `OTHER` (the first eleven are the reference design list, `FINANCIAL_STATEMENTS` and `DEALING` are present in the seed data); the UI label is a lookup; *Distributions* must not share `MANUAL` with *Other*; every More item maps to a category (`SUBSCRIPTION` for *Subscription Documents*, `NOTICES`, `OTHER`). **[P]**
- Fund scoping **[O]**: the list is scoped by the selected fund (`fundId`); KPI tiles and tab counts come from one unscoped summary call. BR-117: the summary accepts the same `fundId` and (for tab counts) ignores `category` and `q`, so tiles and counts follow the fund selector. **[P]**
- *Total Documents* **[I]**: count of documents visible to the organisation and the user's fund entitlement.
- *New This Week* **[I]**: visible documents with `publishedAt` ≥ now − 7 days (a rolling 7 × 24 h window computed on the server clock). Not "since Monday".
- *Requires Signature* **[I]**: the reference API returns a constant 0. BR-118: the count of visible documents that have an open (Pending) signature request for the signed-in user's organisation (Nexus `signature_requests` status Pending); status REQUIRES_SIGNATURE for the same documents; the tile helper "Awaiting your signature" stays. **[P]**
- *Secure Downloads YTD* **[I]**: number of DOWNLOAD audit events of the investor organisation (all of its users) since 1 January of the current year in server time. Previews and views are not counted. The tile helper says "Verified downloads"; BR-119: only downloads that completed and were audited are counted, and the figure refreshes after a download. **[P]**
- Detail response **[I]**: opening a document (detail request) writes a VIEW audit event, a preview request writes a PREVIEW event, a download writes a DOWNLOAD event; each carries user id, IP and user agent. The history list returns the last 20 events for the document across the organisation. BR-120: the history card shows DOWNLOAD events only (heading *Download History*), user shown as display name, and VIEW/PREVIEW remain in the audit log (SRDUI events `DOCUMENT_VIEWED`, `DOCUMENT_DOWNLOADED`); audit rows are append-only with a retention of at least 7 years. **[P]**
- Secure download **[I]**: the file is streamed through the API with `Content-Disposition: attachment` and a file name built from the title with every run of characters outside letters, digits, `_`, `.`, `-` replaced by `-` plus the extension from the mime type (`.pdf`, `.xlsx`, `.docx`, otherwise `.bin`); the reference platform has no signed URL, no expiry and no rate limit. FR-DOC-002 (short-lived signed URL, 5 minutes, audited) is the Nexus rule. BR-121: the download endpoint either streams the bytes or answers a 5-minute HMAC-signed URL, always after the entitlement check and always writing the audit event; failures are not counted in *Secure Downloads YTD*; a download rate limit of N per minute per user returns 429 `rate_limited` (default N = 30). **[P]**
- Preview rule **[I]**: only PDF and image mime types preview; any other type answers 415 and the UI shows "Preview is not available for this file type.".
- Checksum **[I]**: `checksumSha256` is the SHA-256 (64 hex characters) computed from the stored bytes at publication (GP upload) or copied from the generating job. The verify call recomputes the hash of the stored file and returns `{documentId, verified, expectedSha256, actualSha256}`; with no stored hash it returns `verified: false` and a reason "No checksum on file". Download does not re-verify. Nexus stores the hash on `document_versions.sha256`.
- Versioning **[I]**: the reference API returns `version` "1.0" for every document and has no version history; Nexus `document_versions` give the version number (n+1 on a new upload). BR-122: the register shows the latest published version; SUPERSEDED versions stay reachable and labelled (SRDUI §19) and RESTATED documents show "Restated". **[P]**
- Access scope **[I]**: the reference API returns the constant `INVESTOR_ORGANISATION`. The UI type list also names "Investors", "Advisory Board", "Authorised Signatories". BR-123: allowed values are `INVESTOR_ORGANISATION` and `INVESTOR_ACCOUNT`; the badge text is Title-Cased ("Investor organisation", "Investor account"). **[P]**
- Sort: the "Most Recent" option relies on server order; the reference list is ordered by `publishedAt` descending. The mock list is in array order, not date order. **[O]**
- Number and date formats **[O]**: dates "MMM d, yyyy" (en-US); date-times "MMM d, yyyy, h:mm AM/PM" in the browser time zone; file size as in Elements #25.
- Prototype seed **[O]**: 12 documents (doc-101…doc-112) across Matanho Growth Fund I and Matanho Equity Opportunities Fund; categories *Fund Reports* 2, *Statements* 2, *Capital Calls* 2, *Distributions* 2, *Financial Statements* 1, *Legal* 1, *Tax* 1, *Dealing* 1; statuses: 10 PUBLISHED, 1 REQUIRES_SIGNATURE (doc-103 *CC-013 Capital Call Notice*, permissions VIEW, DOWNLOAD, ACKNOWLEDGE), 1 RESTATED (doc-104, version 2.0); summary constants total 12, new this week 2, requires signature 1, secure downloads YTD 14; only doc-101 has a history (one DOWNLOAD by "Jane Smith", IP 196.27.0.12). Vault seed: 6 entries with the same checksums; verify always returns `verified: true`. Session role is MANAGER.

##### Edge cases

- A fund selected in the top bar hides other funds' documents; documents without a fund remain visible. **[O]**
- A category with documents but no tab (*Financial Statements*, *Dealing*) is reachable only under *All Documents* and shows a grey badge. **[O]**
- Search plus a category tab combine (AND). Search is not highlighted in the rows. **[O]**
- A period of `null` shows `—`; a missing page count shows "1 / 1"; a missing size shows `—`. **[O]**
- Opening the same document again re-requests detail and preview (and writes new audit events in the target). **[O]** / **[I]**
- A very long checksum or title wraps/truncates (checksum `break-all`, title truncated with ellipsis). **[O]**
- Changing the fund while on page N keeps N until the response arrives, then clamps to `totalPages`. **[O]**
- Download of a document whose file is missing: 404 "File not available" toast. **[I]**
- Revoked entitlement or a withdrawn document while the row is open: detail/preview/download answer 404; the UI shows the server message in a toast. **[I]**
- Browser blocks the clipboard: the toast "Checksum copied" still appears. **[O]**

##### Gaps, defects & open questions

- **DEF-393** status badges are always grey and upper case. The mapper keeps the API's upper-case words ("PUBLISHED", "REQUIRES SIGNATURE", "RESTATED") while the colour map is keyed by Title-Case, so the Published, Requires Signature, New, Active and Paid styles never apply; "New", "Active", "Paid" are produced nowhere.
- **DEF-394** in the prototype the tabs *Statements*, *Capital Calls*, *Distributions*, *Fund Reports* return an empty table although their count pills show 2 (the mock tests the API enum against category labels); the sidebar *Statements & Reports* link therefore lands on an empty list.
- **DEF-395** *More* items (*Subscription Documents*, *Notices*, *Other*) send no category, so the full unfiltered list is shown; *More* does not display the selected item. *Open in Documents* on a notice therefore shows every document.
- **DEF-396** `?document={id}` is lost: the first render clears the selection (no data yet) and the first row is selected after load; stale detail/preview responses are not cancelled.
- **DEF-397** the close button (X) cannot close the detail column while rows exist (the first row is re-selected).
- **DEF-398** range text uses a page size of 10 while 20 rows are requested per page, and uses the unfiltered global total; an empty result reads "Showing 1 to 0 of N documents".
- **DEF-399** KPI tiles and tab counts ignore the fund selector, search and category; the "Across N funds" helper counts session funds, not document funds.
- **DEF-400** preview page arrows only change a counter; zoom is a CSS transform and the card (160 %) and dialog (200 %) share one value.
- **DEF-401** the saved file is named after the document title with no extension; the *Document Type* field shows the category; *Published Date* is unformatted; permissions are shown as raw codes.
- **DEF-402** the history card is headed "Download History" but, with the reference API, lists VIEW and PREVIEW events and raw user ids, and each row selection writes two audit events (VIEW and PREVIEW).
- **DEF-403** a failure of the summary call blanks the list too (one `Promise.all`).
- **DEF-404** real `accessScope` text would render in capitals; the mock preview is a fake PDF; the mock notification link uses `?doc=`.
- **DEF-405** no download progress or in-flight disable; double click downloads twice; the KPI and history are not refreshed after a download.
- FR-LP-067: the register is paged on the server with the same page size for fetch and display, and the range text is built from the response's `page`, `pageSize` and `total` — AC: with 45 documents and pageSize 20, page 2 reads "Showing 21 to 40 of 45 documents"; a search with no hits reads "Showing 0 to 0 of 0 documents".
- FR-LP-068: `?document={id}` selects and loads the requested document even when it is not on page 1 — AC: opening `/lp-portal/documents?document=doc-104` highlights doc-104 and shows its checksum; an unknown id shows the toast "Document not found" and selects the first row.
- FR-LP-069: the close button closes the detail column and keeps it closed until a row is clicked — AC: after *Close details* no row is highlighted and the grid is a single column.
- FR-LP-070: *Verify checksum* action in the *Details* tab — AC: *Verify integrity* calls `GET /lp-portal/vault/{id}/verify`; on `verified: true` it shows the toast "Checksum verified"; on false it shows "Checksum mismatch — contact Investor Relations"; with no stored hash it shows "No checksum on file". Texts are proposed. **[P]**
- FR-LP-071: *Sign document* for REQUIRES_SIGNATURE rows, SIGNATORY/MANAGER only, with step-up MFA (FR-DOC-006) — AC: the row leaves *Requires Signature* and the KPI decrements after a successful signature; a VIEWER sees the status but no sign control.
- FR-LP-072: `GET /lp-portal/documents` supports `sortBy` (`publishedAt`, `name`, `fundName`), `sortDirection` and the response includes `version`, `period`, `status`, `accessScope`, `mimeType`, `fileSizeBytes`, `pageCount` — AC: sorting by name orders all pages, not only the current one.
- FR-LP-073: realtime event `lp_document_published` (or the shared `lp_notification`) bumps the `documents` refresh key so a newly published document appears without a reload — AC: a document published by staff appears in the open register within the polling interval.
- BR-124: the topbar search, dashboard panel and Capital/Account Activity links use the same document ids as this screen. **[P]**
- Q-127: how are *Distributions* distinguished from *Other* in the target data (the prototype maps both to `MANUAL`)? — default: a dedicated `DISTRIBUTIONS` category.
- Q-128: do SUPERSEDED, RESTATED and WITHDRAWN documents appear in the register? — default: SUPERSEDED and RESTATED are listed with their label; WITHDRAWN is hidden and its download answers 404.
- Q-129: how does the Nexus `documents` / `publications` / `signature_requests` / `document_versions` model supply `period`, `version`, `status` and `accessScope`? — default: `period` from the report period, `version` from the latest version, `status` from the publication and signature state, `accessScope` constant `INVESTOR_ORGANISATION`.
- Q-130: blob streaming or 5-minute signed URL for download and preview? — default: keep the blob contract in `lpPortalApi` and have the API return the file bytes (or a 302 to a signed URL).
- Q-131: should `VIEWER` be allowed to download? — default: yes (reference rule; both permissions are in the VIEWER set).

#### 5.B.7 Requests & Messages (`/lp-portal/requests`, `lp.requests.view` + `lp.messages.view`; writes `lp.requests.create` + `lp.messages.reply`)

| Attribute | Value |
| --- | --- |
| Purpose | Controlled service-request workspace plus record-linked secure message threads. The investor creates a request (reference, type, fund, priority, description, attachments), tracks its status, reads and replies to conversations with the Matanho team, and can ask for a colleague to be added to a conversation. **[O]** |
| Access | Route gate `createPortalProxy('investor', { requirePortalRole: true })`. The screen itself performs no permission check except one: the *Add participant* button is disabled when `lpRole` is `VIEWER`. Every other control (create request, attach, reply) is enabled for all three roles. The target API requires SIGNATORY or MANAGER for create-request, upload-attachment, request reply and thread reply, and answers 403 `LP_FORBIDDEN` to a VIEWER. **[O]** / **[I]** |
| Prototype layer | `components/lp-portal/screens/lp-requests-messages-screen.tsx` (1 360 lines), hooks `useLpRequestsMessages` and `useLpOrganisation`, mappers `lib/lp-portal/mappers.ts`, mock layer `lib/lp-portal/mock-api.ts` + `mock-store.ts` (seed REQ-1082, REQ-1074, REQ-1031, REQ-1090 and three threads), realtime stub `lib/lp-portal/realtime.ts` (all no-ops). The three screens were imported unchanged from the NVCCZ product; only the brand text was changed to "Matanho". **[O]** |
| Wiring status | Prototype for every element. `lpPortalApi` answers every method from the mock store after an 80 ms delay; the live client class exists but is never reached. Target calls are named per element below. **[O]** |
| Entry points | Sidebar *Requests* (`/lp-portal/requests`, badge = `unreadCounts.requests`) and *Messages* (`/lp-portal/requests?tab=messages`, badge = `unreadCounts.messages`); topbar quick link *Requests*; notification menu entries *Open requests* (`{n} awaiting action`) and *Unread messages* (`{n} new`); a thread's *Linked to REQUEST …* chip (`/lp-portal/requests?ref=<reference>`); *Request details* "Linked To" targets of other screens. Query parameters: `tab=messages` (opens the Messages tab; any other value opens Requests) and `ref=<request reference>` (selects that request and switches to the Requests tab; an unknown reference is ignored silently). A notification link of the form `?thread=<id>` (present in the mock notification feed) is not read by the screen. **[O]** |
| Exit points | Request details "Linked To" link (to the screen of the request type, see Actions); thread chip *Linked to …* (to the related record screen or a toast); empty-participant hint names *Organisation settings* (text only, no link); sidebar/topbar. **[O]** |

##### Layout

1. Page header: title *Requests & Messages* and subtitle "Submit, track, and manage your requests or communicate with the Matanho team." **[O]**
2. Red error banner showing the load error (hidden when none). **[O]**
3. KPI strip of five clickable tiles. **[O]**
4. Two-column body (second column fixed at 320 px from the `xl` breakpoint): **[O]**
   - Left column
     1. Card A with a two-item tab strip *Requests (N)* / *Messages (U)*. Tab *Requests*: filter bar (status select, *Filters* button, search box, export icon button), requests table, footer count line. Tab *Messages*: the filter bar and table are replaced by one sentence of text.
     2. Card B (always visible, on both tabs): left rail *Conversations* (search box, thread list, *View all conversations* button) and right pane (thread header, message list, composer). The right pane exists only when a thread is active.
   - Right column
     1. Card *Create New Request*.
     2. Card *Request Details* (shown only when a request is selected).
5. Dialog *Add participant*. **[O]**

##### Elements

| # | Element | Type | Content / behaviour | Data source (current → target) | Label |
|---|---|---|---|---|---|
| 1 | Page title / subtitle | text | As in Layout 1. | Static | [O] |
| 2 | Error banner | red text box | Shows the message of the failed load of requests or threads (default "Request failed"). While it shows, both lists are empty. | Prototype → `getRequests` + `getMessages` errors | [O] |
| 3 | KPI tile *Open Requests* | button tile (icon Inbox, blue disc) | Value = number of requests whose status is not *Resolved* and not *Closed*. Link text *View all open* (blue). Click: tab → Requests, status filter → *Open*. | `getRequests` → `GET /lp-portal/requests` | [O] |
| 4 | KPI tile *Awaiting Investor* | button tile (AlertCircle, violet) | Value = requests with status *Awaiting Investor*. Link text *Action required* (red). Click: tab → Requests, filter → *Awaiting Investor*. | same | [O] |
| 5 | KPI tile *Under Review* | button tile (Clock3, orange) | Value = requests with status *Under Review*. Link *In progress*. Click: tab → Requests, filter → *Under Review*. | same | [O] |
| 6 | KPI tile *Unread Messages* | button tile (MessageSquare, green) | Value = sum of `unread` over the loaded threads. Link *View messages*. Click: tab → Messages only (the status filter is left as is). | `getMessages` → `GET /lp-portal/messages` | [O] |
| 7 | KPI tile *Closed / Resolved* | button tile (CheckCircle2, teal) | Value = requests with status *Closed* or *Resolved* (all time; no date window). Link *View history*. Click: tab → Requests, filter → *Closed / Resolved*. | `getRequests` | [O] |
| 8 | Tab *Requests (N)* | tab | N = number of loaded requests (maximum 50 loaded, unfiltered). Active tab: blue text and 2 px blue underline. | `getRequests` | [O] |
| 9 | Tab *Messages (U)* | tab | U = total UNREAD messages across loaded threads, not the thread count. | `getMessages` | [O] |
| 10 | Status select | select, 140 px, pill | Placeholder *All Requests*; options *All Requests*, *Open*, *Awaiting Investor*, *Under Review*, *Closed / Resolved*. | Client-side filter | [O] |
| 11 | *Filters* button | outline pill button with sliders icon | No handler: clicking does nothing. | — | [O] |
| 12 | Search box | text input, placeholder *Search requests...* | Client-side substring filter (see Tables). | Client-side | [O] |
| 13 | Export icon button | round icon button, `aria-label` "Export" | No handler: clicking does nothing. | — | [O] |
| 14 | Requests table | table | See Tables. | `getRequests` | [O] |
| 15 | Footer count | text | "Showing 1 to N of N requests" where both N equal the number of rows after filtering (0 → "Showing 0 to 0 of 0 requests"). No pagination control exists. | Derived | [O] |
| 16 | Messages-tab notice | text | "Conversation workspace is below. Select a thread to continue messaging the Matanho team." | Static | [O] |
| 17 | Conversations rail title | text | *Conversations* | Static | [O] |
| 18 | Conversation search | text input, placeholder *Search conversations...* | Case-insensitive substring over thread title, fund name and last-message preview. | Client-side | [O] |
| 19 | Conversation row | button | Folder icon, title (subject, 1 line), fund name (10 px), preview (2 lines), updated timestamp (e.g. "Jul 16, 2026, 2:10 PM"), blue unread pill when unread > 0. Active row has a light-blue background. Click: make the thread active and select the request whose id equals the thread's `relatedId`. | `getMessages` → `GET /lp-portal/messages` | [O] |
| 20 | *View all conversations* | text button at the foot of the rail | Switches to the Messages tab; nothing else changes (the list is already complete). | Client | [O] |
| 21 | Thread title | text | Thread subject. | `getMessageThread` → `GET /lp-portal/messages/{id}` | [O] |
| 22 | Linked-record chip | pill button | Text "Linked to {relatedType} {relatedId}" (for example "Linked to REQUEST REQ-1082", "Linked to GENERAL welcome"). Click navigates to the related record screen or shows a toast (see Actions). | Thread `relatedType`/`relatedId` | [O] |
| 23 | Thread fund | text | Fund name of the thread. | Thread `fundName` | [O] |
| 24 | Thread request reference | mono text | Reference of the request whose id equals the thread's `relatedId`; empty if no request matches (always empty in the prototype, see Defects). | Derived | [O] |
| 25 | Participants label | text | "Participants (n)". | `getMessageThread.participants` | [O] |
| 26 | Participant avatars | overlapping 28 px avatars | Initials (`initials`, or first letters of up to two words upper-cased); colour cycles blue → violet → green by index. No tooltip, no names visible. | `participants` | [O] |
| 27 | *Add participant* button | round dashed 28 px "+" button, `aria-label` "Add participant" | Disabled for `VIEWER` (title "Viewers cannot request participant changes"); otherwise title "Request to add colleague". Opens the dialog with the first eligible colleague preselected. | Client | [O] |
| 28 | Message list | scroll area | One block per message: avatar (blue for the investor side, near-black for the team side), sender, timestamp, body bubble (white with border for the investor side, grey `#f3f4f6` for the team side), attachment chips. | `getMessageThread` | [O] |
| 29 | Message attachment chip | row with red file icon | File name (truncated), size ("48.2 KB"), download icon button, `aria-label` "Download {name}". | message `attachments` | [O] |
| 30 | Reply composer | textarea (2 rows, placeholder *Type your message...*) | Free text; paperclip icon button (`aria-label` "Attach file", one file per click) and *Send* button (pale blue). Selected files appear as a list of names above the textarea. | Client | [O] |
| 31 | *Create New Request* card | form card | See Inputs. | — | [O] |
| 32 | *Request Details* card | definition list | Rows: *Reference*, *Status* (badge), *Priority* (dot + text), *Linked To* (blue link showing the fund name), *Fund*, *Submitted By*, *Last Updated*; then *Attachments (n)* with file rows or "No attachments." | `getRequest` → `GET /lp-portal/requests/{reference}` | [O] |
| 33 | Realtime subscriptions | background | The screen subscribes to `lp_request_created`, `lp_request_message`, `lp_thread_message` (each triggers a reload of both lists), joins the realtime room of the selected request (by reference) and of the active thread (by id) and leaves them on change. In the prototype all of these are no-ops. | Prototype (no-op) → Socket.IO per the LP realtime contract | [O] / [I] |

##### Tables

**Requests table** (shown on the *Requests* tab; minimum width 900 px, horizontal scroll)

| Column | Format | Sortable | Notes |
|---|---|---|---|
| Reference | monospace 11 px, blue, no wrap | No | Reference string: mock `REQ-1082`; the real service generates `SR-` + 10 upper-case alphanumerics (see Business rules). |
| Request Type | text, no wrap | No | Display = API type with `_` replaced by a space. The four types created by the form therefore show as "ACCOUNT STATEMENT", "CAPITAL ACTIVITY", "OPEN ENDED ACTIVITY", "PROFILE ACCESS"; seeded rows show "Capital Activity", "Account / Statement", "Profile / Access", "Tax / Reporting". |
| Linked Fund | text, truncated at 150 px | No | Fund name. |
| Subject | bold text, truncated at 180 px | No | — |
| Submitted By | text | No | A string is shown as is; an object `{name, email}` shows name, else email, else "You". |
| Last Updated | text | No | "MMM d, yyyy, h:mm AM/PM" in the browser's local time zone (`en-US`). |
| Status | pill badge | No | See colour map below. |
| Priority | 8 px dot + text | No | See map below. |
| Actions | right-aligned `…` icon button, `aria-label` "Actions for {reference}" | — | Opens a menu (below). Click does not select the row. |

- Filters: status select (semantics below) AND free-text search. **[O]**
  - *Open* hides *Resolved* and *Closed* (so *Submitted*, *Assigned*, *Under Review*, *Awaiting Investor* remain). *Awaiting Investor* = status *Awaiting Investor*. *Under Review* = status *Under Review*. *Closed / Resolved* = *Closed* or *Resolved*. *All Requests* = no status filter.
  - Search: when the trimmed text is non-empty, the lower-cased text (not trimmed) must be a substring of "reference type fund subject submittedBy" lower-cased and joined by single spaces.
- Sorting: none; rows keep the order returned by the API. Mock order = newest created first; real order = `createdAt` descending. **[O]**
- Row click: selects the request (blue highlight with a 3 px left bar) and, when a thread whose `relatedId` equals the request id exists, makes that thread the active conversation. The first request is selected automatically on load. **[O]**
- Row menu: *View details* (same as row click); *Open conversation* (select + switch to the *Messages* tab). **[O]**
- Pagination: none. The hook loads the first 50 requests and the first 50 threads only; later items are unreachable. **[O]** / **[P]**
- Status → badge colour (text on tint): *Under Review* orange `#c2410c` on `#ffedd5`; *Awaiting Investor* violet `#6d28d9` on `#ede9fe`; *Assigned* blue `#1d4ed8` on `#dbeafe`; *Submitted* sky `#0369a1` on `#e0f2fe`; *Resolved* green `#15803d` on `#dcfce7`; *Closed* grey `#4b5563` on `#f3f4f6`. **[O]**
- API status → label: any value containing both AWAITING and INVESTOR → *Awaiting Investor*; ASSIGNED → *Assigned*; RESOLVED → *Resolved*; CLOSED → *Closed*; SUBMITTED → *Submitted*; every other value (UNDER_REVIEW, OPEN, AWAITING_INTERNAL, unknown) → *Under Review*. **[O]**
- Priority → dot: *High* red `#ef4444`, *Medium* orange `#f97316`, *Low* green `#22c55e`. API priority → label: HIGH or URGENT → *High*; LOW → *Low*; any other value (NORMAL, MEDIUM, missing) → *Medium*. **[O]**

**Conversation list** (left rail of Card B)

| Column | Format | Sortable | Notes |
|---|---|---|---|
| (single list item) | folder icon, title, fund, 2-line preview, timestamp, unread pill | No | Order = API order. Mock: seed order. Real: last message time descending. Unread pill shows when `unread` is a positive number. |

- Search: see Elements #18. Row click: see Elements #19. The list has `max-height` 360 px and scrolls. **[O]**

**Request attachments list** (inside *Request Details*)

| Column | Format | Sortable | Notes |
|---|---|---|---|
| (file row) | red file icon, name (truncated), size, download icon button | No | Size via the file-size formatter: "—" when unknown, "N B" below 1 KiB, "x.x KB" below 1 MiB, otherwise "x.x MB". |

##### Inputs & validation

**Create New Request** (right column)

| Field | Control | Required | Options / default / placeholder | Validation today (code) | Target validation | Error message |
|---|---|---|---|---|---|---|
| Request Type | select | Yes (always has a value) | *Account / Statement* (default), *Capital Activity*, *Open-Ended Activity*, *Profile / Access*; sent as `ACCOUNT_STATEMENT`, `CAPITAL_ACTIVITY`, `OPEN_ENDED_ACTIVITY`, `PROFILE_ACCESS` | None | Server accepts only those four types (BR-NEW below) | — |
| Linked Fund | select | No (optional in the API) | Placeholder *Select fund*; options = every fund of the investor (fund name); default = first fund | None; an empty list sends no `fundId` | `fundId` must be inside the user's fund scope (403 "Not entitled to this fund") | — |
| Subject | text | Yes | Placeholder *Brief summary of your request* | Non-blank after trim | Required; maximum 512 characters | "Subject is required." (toast) |
| Priority | select with colour dot | Yes (default) | *High*, *Medium* (default), *Low*; sent as `HIGH`, `MEDIUM`, `LOW` | None | One of the priority vocabulary (Q-NEW below) | — |
| Description | textarea (min 88 px) | No | Placeholder *Provide details to help the Matanho team respond...* | None; blank is sent as the literal "No description provided." | Optional; maximum length to be set (Q-NEW) | — |
| Attachments | dashed drop-zone button plus hidden multi-file input | No | Caption "Drag & drop or click to browse" and "PDF, DOC, XLSX, PNG · Max 20MB" | No `accept` filter, no size or count check, no drop handler (drag and drop does nothing), no remove control; selected files are listed by name | Allowed types and 20 MB limit enforced client-side and server-side (FR-NEW below) | server message (toast) |

**Reply composer** (thread pane)

| Field | Control | Required | Options / default / placeholder | Validation today (code) | Target validation | Error message |
|---|---|---|---|---|---|---|
| Message | textarea, 2 rows | Yes | Placeholder *Type your message...* | Trimmed text must be non-empty; otherwise *Send* silently does nothing (no toast) | Required after trim (422 "body is required"); maximum length to be set | — |
| Attachment | paperclip → file input | No | One file per click, added to a list shown above the textarea; no remove control | None | Same as request attachments | server message |

**Search and filter controls** — status select, request search, conversation search: see Elements #10, #12, #18; no validation. **[O]**

##### Actions

| Control | Enabled when | Permission | Effect (state change, toast text, navigation) | Wiring / API | Label |
|---|---|---|---|---|---|
| KPI tile | Always | None in the UI | See Elements #3–#7. | Client | [O] |
| Tab *Requests* / *Messages* | Always | None | Switches the tab. Also set from the URL (`tab` parameter) whenever the parameter changes. | Client | [O] |
| Row click / *View details* | A row exists | None | Selects the request and its linked thread; loads the request detail with `getRequest(reference)`; error toast "Failed to load request" (or the server message). | Prototype → `GET /lp-portal/requests/{reference}` | [O] |
| *Open conversation* | A row exists | None | As row click, plus switches to the *Messages* tab. | Client | [O] |
| Conversation row click | Always | None | Activates the thread (loads it, see below) and selects `relatedId` as the selected request. | Client | [O] |
| Thread load | When a thread becomes active (the first thread is activated automatically on page load) | `lp.messages.view` | Fetches the thread, shows "Loading messages…" meanwhile, then renders messages and participants and calls `markMessageThreadRead` without waiting; error toast "Failed to load conversation" (or the server message). Because the first thread is auto-activated, merely opening the page marks that thread read, even on the *Requests* tab. The conversation list, KPI value and sidebar badge are not refreshed after the mark. | Prototype → `GET /lp-portal/messages/{id}` then `POST /lp-portal/messages/{id}/read` | [O] |
| Linked-record chip | Thread has a related record | None | Navigates with the rules in Business rules; if no route exists shows an informational toast titled "Linked record" with the description "{relatedType} {relatedId}". | Client | [O] |
| *Add participant* | Role is not `VIEWER` | UI: not VIEWER; target: `lp.requests.create` (SIGNATORY or MANAGER) | Opens the *Add participant* dialog. | Client | [O] |
| Download icon (message or request attachment) | Always | None | If the file has no download URL: error toast "Download URL not available."; otherwise opens the URL in a new tab with `noopener,noreferrer`. Prototype files never carry a URL, so the toast always appears. | Prototype → `GET /lp-portal/attachments/{id}/download` | [O] |
| Paperclip (composer) | Always | None | Opens the file chooser; the chosen file is appended to the reply file list. | Client | [O] |
| *Send* | Not while a send is in progress | Target `lp.messages.reply` (SIGNATORY or MANAGER) | See *Send reply* in Business rules. Success: toast "Message sent."; the text and files are cleared; both lists and the thread are reloaded. Failure: toast with the server message or "Failed to send message"; text is kept. Empty text: nothing happens. | Prototype → `POST /lp-portal/requests/{reference}/messages` (request-linked thread) or `POST /lp-portal/messages/{id}/replies`; before each: `POST /lp-portal/requests/attachments` per file | [O] |
| Drop-zone click | Always | None | Opens the multi-file chooser; chosen files are appended to the form file list. | Client | [O] |
| *Submit Request* | Not while a submit is in progress | UI none; target `lp.requests.create` (SIGNATORY or MANAGER) | Validates the subject, uploads each file in order, creates the request. Success: toast "Request submitted."; both lists are reloaded; the new request becomes the selected request; the form is reset (type first option, fund first fund, subject and description empty, priority *Medium*, files cleared). The tab and the filters do not change. Failure: toast with the server message or "Failed to submit request"; form values are kept. | Prototype → `POST /lp-portal/requests/attachments` (per file), then `POST /lp-portal/requests` with an `Idempotency-Key` header | [O] |
| *Linked To* link (Request Details) | A request is selected | None | Navigates to the screen for the request type (see Business rules). | Client | [O] |
| *Filters*, export icon | Always | — | No effect. | — | [O] |

##### Modals & drawers

**Dialog — Add participant** (opened by the "+" button)

Title *Add participant*. Description: "Select a colleague from your organisation. We will submit a profile access request to your fund administrator to add them to this conversation." Close by the X button (sr-only "Close"), Esc, an overlay click or *Cancel* (closing is also possible while a submission is running). **[O]**

Inputs

| Field | Control | Required | Options / default / placeholder | Validation today (code) | Target validation | Error message |
|---|---|---|---|---|---|---|
| Colleague | list of selectable rows (avatar with two initials, name, email) | Yes | Candidates = organisation colleagues that are active (`isActive` and not revoked) and whose lower-cased name and email are not among the thread participant names. First candidate preselected. Selected row has a light-blue border. | *Request access* is disabled when nothing is selected | Candidates limited to active colleagues of the same organisation inside the thread's fund scope | — |

When there are no candidates the body shows "All active colleagues are already on this thread, or no eligible colleagues were found. Invite new colleagues from Organisation settings." and *Request access* is disabled. **[O]**

Actions

| Control | Enabled when | Permission | Effect (state change, toast text, navigation) | Wiring / API | Label |
|---|---|---|---|---|---|
| *Cancel* | Always | None | Closes the dialog. | Client | [O] |
| *Request access* (label *Submitting…* while sending) | A colleague is selected, no submission running, at least one candidate | Not VIEWER (target SIGNATORY or MANAGER) | Creates a *Profile / Access* request, medium priority, in the fund of the thread (matched by fund name, else the first fund): subject "Add participant to conversation: {thread title}"; description of four lines: 'Please add {name} ({email}) to the message thread "{title}".' / 'Linked record: {linkedLabel}' / 'Thread ID: {id}' / 'Current participants: {names joined by ", " or "None listed"}'. Success: toast "Access request submitted for {name}."; dialog closes; selection cleared; lists reloaded. Failure: toast with server message or "Could not submit participant request". The thread participants are not changed by this action. | Prototype → `POST /lp-portal/requests` (`type` `PROFILE_ACCESS`, `priority` `MEDIUM`) | [O] |

##### States

- Empty:
  - Requests: table row "No requests match your filters." (also shown when there are no requests at all; there is no separate "no requests yet" message). **[O]**
  - Conversations: the list is blank; no empty message exists. If no thread is active (no threads) the whole right pane is absent. A thread without messages renders an empty message area. **[O]**
  - Request attachments: "No attachments." **[O]**
  - Request Details: the card is absent when no request exists. **[O]**
- Loading: the requests table is replaced by "Loading requests…" during the first load and during every reload (after submit, send, add-participant, or a realtime event); the thread area shows "Loading messages…" while a thread loads. KPI values show the counts of the data currently held (0 before the first load). The *Submit Request* and *Send* buttons are only disabled while their own action runs; *Submit Request* shows no spinner. **[O]**
- Error: red banner (Elements #2); toasts as listed in Actions. A failed list load clears both lists. **[O]**
- Disabled / read-only: *Add participant* disabled for `VIEWER`; *Send* disabled while sending; *Submit Request* disabled while submitting; *Request access* disabled as above. A VIEWER can still type, attach and press the other buttons, but the real API would answer 403. **[O]** / **[I]**
- Conditional:
  - `tab=messages` replaces the filter bar and table with the Messages-tab notice; Card B and the right column are unaffected.
  - Request Details is shown for `requestDetail`, else the selected row, else the first filtered row (so after a filter change it can describe a row that is not visible).
  - A new request created in the prototype is `SUBMITTED` and is hidden by every status filter except *All Requests* and *Open*.

##### Business rules & calculations

- **KPI formulas [O]:** *Open Requests* = count(status ∉ {Resolved, Closed}); *Awaiting Investor* = count(status = Awaiting Investor); *Under Review* = count(status = Under Review); *Unread Messages* = Σ thread.unread; *Closed / Resolved* = count(status ∈ {Closed, Resolved}). All are computed over the loaded page (maximum 50 requests, 50 threads), not over server totals.
- **Request types vocabulary [O]/[I]:** `ACCOUNT_STATEMENT` (statement query, account query, tax document request), `CAPITAL_ACTIVITY` (capital-call and distribution query), `OPEN_ENDED_ACTIVITY` (subscription and redemption request), `PROFILE_ACCESS` (bank-detail change, access request, document request, participant request). Request type → screen for *Linked To*: contains CAPITAL → *Capital activity*; contains OPEN_ENDED or DEALING → *Subscriptions & redemptions*; contains ACCOUNT or STATEMENT → *Account activity*; contains DOCUMENT → *Documents*; contains PROFILE or ACCESS → *My Organisation*; contains NOTICE → *Notices*; otherwise this screen.
- **Statuses [I]** (real service desk): `SUBMITTED` (set on creation by the portal), `OPEN`, `ASSIGNED`, `UNDER_REVIEW`, `AWAITING_INVESTOR`, `AWAITING_INTERNAL`, `RESOLVED`, `CLOSED`. Only Matanho staff change a status or priority, or assign an owner (assignment without an explicit status sets `ASSIGNED`); the investor cannot. A staff reply sets `AWAITING_INVESTOR` unless the request is `RESOLVED` or `CLOSED`. An investor reply on a `RESOLVED` or `CLOSED` request sets `AWAITING_INVESTOR` (reopened); in every other state it leaves the status unchanged. The prototype differs: an investor reply on an `AWAITING_INVESTOR` request sets `UNDER_REVIEW`. Workflow in the design (Section 21): submitted → reference created → routing rule → assigned → under review → awaiting investor / awaiting internal → resolved → closed.
- **Reference format [I]:** the real service generates `SR-` + last 6 characters of the base-36 millisecond clock + 4 random base-36 characters, all upper-case (e.g. `SR-K3F9A2Q7XB`; unique; 32-character column). The prototype shows `REQ-nnnn` (counter from 1091). Nexus staff service requests already use `REQ-` (Q-NEW below).
- **Request creation [I]:** client must be active (404 "LP profile not found", 403 "LP profile is not active"); fund (if supplied) must be in the user's scope; subject required (422 `LP_VALIDATION` with `fieldErrors.subject` "Required"); attachment ids must belong to the client (422 "Invalid attachmentIds"); stored type = upper-cased type (default `PROFILE_ACCESS`); stored priority = upper-cased priority (default `NORMAL`); status `SUBMITTED`; when a description is present, a first message with `authorType` `INVESTOR` containing the description is also created; realtime events `lp_request_created` and a per-user `lp_notification` (actor excluded) are emitted. `Idempotency-Key` (8–200 printable ASCII) is required; the same key with the same payload replays the stored response, with a different payload answers 409 `LP_IDEMPOTENCY_KEY_REUSED`.
- **Priority [O]/[I]:** the UI sends `HIGH`, `MEDIUM`, `LOW`; the service default is `NORMAL`, the 16-character field accepts any string and staff can overwrite it; the UI maps HIGH and URGENT to *High*, LOW to *Low*, all others to *Medium*.
- **Send reply [O]:** a thread is a *request thread* when its `relatedType`, upper-cased, contains `REQUEST` (the real seed uses `SERVICE_REQUEST`, the mock `REQUEST`). For a request thread the request is found by `id = relatedId`, else by `reference = relatedId`; if found the reply goes to `POST /lp-portal/requests/{reference}/messages`; otherwise, when `relatedId` is non-empty, `relatedId` is used as the reference; otherwise the action fails with "Could not resolve request reference for reply". For any other thread the reply goes to `POST /lp-portal/messages/{id}/replies`. Attachments are uploaded first, one request per file in selection order; if file *k* fails, files 1…*k*-1 remain uploaded and unlinked and the reply is not sent.
- **Reply rules [I]:** body required after trim (422 "body is required"); attachment ids validated; an investor reply to a thread sets `lastMessageAt` and sets the thread status to `OPEN` (a closed thread is reopened); realtime `lp_thread_message` and `lp_thread_updated` are emitted.
- **Unread counting [I]:** a message counts as unread when its `readAt` is empty and its author type is `OPS` (staff). The count is per thread (`unreadCount`) and organisation-wide for the session counter; one colleague opening a thread marks it read for every colleague of the organisation. Marking read stamps only staff messages (`POST /lp-portal/messages/{id}/read` returns `{threadId, markedRead}` and emits `lp_thread_read`). The prototype counts any non-investor message as unread. Session counters: `unreadCounts.requests` = number of requests in status `OPEN`, `SUBMITTED`, `UNDER_REVIEW`, `AWAITING_INVESTOR`, `ASSIGNED`; `unreadCounts.messages` = unread staff messages; `unreadCounts.notifications` = unacknowledged notices + open requests + unread messages.
- **Message rendering [O]:** author type `INVESTOR` (any case) renders as sender "You", initials "Y"; every other author type renders as sender "Matanho Team", initials "A". Messages show in the order returned (ascending time expected). The message body is plain text; line breaks are not preserved.
- **Thread/record linkage [O]/[I]:** a thread carries `relatedType` and `relatedId`. The chip routes by the upper-cased type (spaces → `_`), first match wins: contains NOTICE → `/lp-portal/notices?id={id}`; CAPITAL and CALL → `/lp-portal/capital-activity?call={id}`; DISTRIBUTION → `/lp-portal/capital-activity?tab=distributions`; DOCUMENT → `/lp-portal/documents?document={id}`; REQUEST or starts with `SR-` → `/lp-portal/requests?ref={id}`; SUBSCRIPTION, REDEMPTION or DEALING → `/lp-portal/subscriptions-redemptions?request={id}`; LEDGER, TRANSACTION or ACTIVITY → `/lp-portal/account-activity?entry={id}`; otherwise none (toast). The design allows threads linked to fund, capital call, distribution, subscription, redemption, statement, request or document; `relatedType` is a 32-character field.
- **Attachment rules [I]:** upload is multipart field `file`; the server stores the file with SHA-256, size, MIME type (default `application/octet-stream`), returns `{id (att_ + 12 hex), name, size, mimeType, downloadUrl, createdAt}`; empty file → 422 "file is required"; maximum 25 MB per file (memory upload limit); no type allow-list; an attachment can be linked once, to one request or one message; download is client-scoped (404 "Attachment not found").
- **Realtime [I]:** transport Socket.IO v4 with a JWT in the handshake; automatic rooms `user:{userId}` and `lp_portal:{clientId}`; the client emits `join_lp_request {reference}`, `join_lp_thread {threadId}` (and the `leave_*` pairs) and `join_lp_portal` after a reconnect. Events and the effect required of this screen: `lp_request_created` (reload lists), `lp_request_updated` (reload lists / patch row), `lp_request_message` (reload; append to open request), `lp_thread_message` (reload; append to open thread), `lp_thread_read` (clear unread pill), `lp_thread_updated` (reload list), `lp_notification` (topbar refresh and session counter refresh).
- **Role matrix [I]:** VIEWER: view requests and messages only; SIGNATORY and MANAGER: also create requests, upload attachments, reply to requests and threads.
- **Scope [O]:** the screen ignores the selected-fund control, the as-of date and the operating model; requests and threads of all entitled funds are always listed. Requests without a fund are allowed.

##### Edge cases

- Opening `?ref=` for a request that is not in the first 50 requests selects nothing and shows no message. **[O]**
- The date shown in Last Updated and message timestamps uses the browser's locale formatting (`en-US` pattern) and time zone. **[O]**
- Two attachments with the same name collide on the React key in the attachment lists; two selected files with the same name and size collide in the file lists. **[O]**
- A thread whose `relatedId` does not match a request id (the case for every seeded thread in the prototype, where ids are lower-case `req-1082` and `relatedId` is `REQ-1082`) selects a non-existent request: the Request Details card falls back to the first row and the thread reference shows blank. **[O]**
- Reply on a thread while another thread load is in flight: the earlier load is cancelled when the active thread changes; the reply refetch uses the thread active at send time. **[O]**
- Closing the dialog during *Request access* does not cancel the request. **[O]**
- The first attachment upload may succeed and a later one fail; no cleanup of orphaned uploads exists. **[O]**
- A submit with an empty linked-fund list sends no fund; the real service accepts that (fund optional). **[I]**

##### Gaps, defects & open questions

- **DEF-406** the *Filters* and export buttons have no behaviour. FR-LP-074: *Export* downloads the filtered request list as CSV with the visible columns — AC: file contains exactly the filtered rows; *Filters* opens a panel with type, fund, priority and date range — AC: each filter narrows the table and the footer count.
- **DEF-407** drag and drop is advertised but not implemented; no file type or size check; caption says 20 MB while the server limit is 25 MB; no way to remove a chosen file. FR-LP-075: enforce the allowed types (PDF, DOC, DOCX, XLS, XLSX, PNG) and the 20 MB limit before upload, support drop, show each file with size and a remove button — AC: a 21 MB file is rejected with a visible message and is never sent.
- **DEF-408** *Request Details* never shows the subject, description, creation date, assignee or the request's own message history; request messages returned by the API are discarded by the mapper. FR-LP-076: show subject, description, created date and a chronological timeline of request messages (investor and staff) in *Request Details* — AC: a staff reply posted through the staff API appears in the investor's *Request Details* without opening a thread.
- **DEF-409** the real service desk does not create a message thread for a request and staff replies are written to the request, not to a thread; no code creates threads. The *Messages* area therefore has no data in a real deployment. Q-132: are threads created automatically one-per-request, or does the investor see request replies only in *Request Details*? — default: create one thread per request automatically (related type `REQUEST`, related id = request id) and write staff and investor replies to both the request timeline and the thread.
- **DEF-410** in the prototype, a reply typed in a request-linked thread is stored on the request only and never shown in the thread pane (success toast "Message sent." but no visible effect).
- **DEF-411** seeded thread `relatedId` values are request references while request ids are lower-case; selection, linked reference and the *Open conversation* link do not work in the prototype. BR-125: a thread's `relatedId` for type `REQUEST` is the request `reference`, and the screen matches by reference.
- **DEF-412** opening the page auto-selects the first thread and marks it read; the unread pills, KPI and sidebar badge are not refreshed afterwards. FR-LP-077: mark a thread read only when it is visible and opened, then update the thread row, KPI and session counter — AC: badge decrements by the number of messages marked.
- **DEF-413** the *Messages* tab label shows the unread count; the design (Section A.7) lists a "Closed This Month" KPI whereas the tile counts all closed requests. Q-133: should *Messages (n)* show unread or total threads, and should *Closed / Resolved* be limited to the current month — default: *Messages (n)* shows the number of threads with unread messages; *Closed / Resolved* stays all-time.
- **DEF-414** "Showing 1 to N of N" and the absence of pagination hide anything beyond the first 50 requests and 50 threads. FR-LP-078: server-side pagination (`page`, `pageSize` up to 200) with a footer "Showing a to b of total" using the server total — AC: with 120 requests the footer reads "Showing 1 to 50 of 120 requests" and next/previous pages are reachable.
- **DEF-415** a VIEWER sees working create, attach and reply controls although the service refuses them. FR-LP-079: disable *Submit Request*, *Send*, the attachment controls and *Add participant* for `VIEWER`, with the hint "Viewers cannot submit requests or send messages" — AC: no 403 can be triggered from the UI by a VIEWER.
- **DEF-416** an empty description is stored as the text "No description provided." and, in the real service, also becomes the first message. BR-126: an empty description is stored empty and creates no first message.
- **DEF-417** sender names are fixed ("You", "Matanho Team", initials "A"); colleagues' messages show as "You" and staff members are not identified. FR-LP-080: show the author's real name and role; label own messages "You" only when `authorId` equals the signed-in user — AC: a colleague's message shows the colleague's name.
- **DEF-418** *Linked To* in *Request Details* shows the fund name, not a record. Q-134: should it show the related record (capital call, document) — default: show the fund and request type, and link to the type's screen.
- **DEF-419** downloads open a bare URL in a new tab; the prototype never provides one ("Download URL not available."). FR-LP-081: attachment download is an authenticated, client-scoped endpoint (`GET /lp-portal/attachments/{id}/download`) that works with the portal session — AC: another organisation's attachment id answers 404.
- **DEF-420** all realtime functions are no-ops, so lists update only after a user action. FR-LP-082: implement the Socket.IO contract above — AC: a staff reply raises the unread pill without reloading.
- Q-135: which request-type and priority values may the API accept — default: the four types above and priorities `LOW`, `NORMAL`, `HIGH`, `URGENT` (UI *Medium* sent as `NORMAL`), rejecting other values with 422.
- Q-136: reference format `SR-…` (real service), `REQ-nnnn` (prototype and Nexus staff service requests) — default: keep the Nexus `REQ-` sequence so that investor and staff views agree.
- Q-137: Nexus today exposes `/api/v1/investor/threads` and staff `/service-requests`; the LP contract (`/lp-portal/requests`, `/lp-portal/messages`) must either be implemented as a facade over them or replace them — default: implement the LP contract paths on the Nexus API and map them to the existing tables.

#### 5.B.8 Notices (`/lp-portal/notices`, `lp.notices.view`)

| Attribute | Value |
| --- | --- |
| Purpose | Inbox of fund and organisation announcements addressed to the investor (report available, capital call, valuation/NAV, distribution, dealing calendar, policy, system), with read tracking (Unread / Opened / Acknowledged), four count tiles, status/type/fund/date filters, search, a detail panel and an *Acknowledge Notice* action for notices that require it. **[O]** |
| Access | `lp.notices.view` for VIEWER, SIGNATORY and MANAGER. Acknowledging requires `lp.notices.acknowledge`, granted to SIGNATORY and MANAGER only (the reference API answers 403 `LP_FORBIDDEN` "Authorised Signatory access required" to a VIEWER). **[I]** The screen never reads `lpRole`, so a VIEWER sees and can click *Acknowledge Notice* and receives the server message in a toast. **[O]** A notice is visible only if its target is all investors, the user's organisation, the user, or a fund inside the user's entitlement; an invisible notice id answers 404 "Notice not found". **[I]** |
| Prototype layer | `components/lp-portal/screens/lp-notices-screen.tsx` over `useLpNotices` (`lib/lp-portal/hooks.ts`), `mapNoticeRow` (`lib/lp-portal/mappers.ts`), `lib/lp-portal/mock-api.ts` + `mock-store.ts` via the `lpPortalApi` Proxy; realtime stub `lib/lp-portal/realtime.ts`. **[O]** |
| Wiring status | Prototype for every element (`LP_LIVE_DOMAINS.notices = false`). The Nexus API has no notice entity or endpoint today. Target calls are named per row. **[O]** |
| Entry points | Sidebar *Notices* (with unread count badge); topbar bell menu items and *View all notices*; Dashboard action rows (`?id={noticeId}` for notice actions) and the *Latest Documents & Notices* panel *View All*; Requests linked-record links (`?id=`); bell notification links (`?id=`). **[O]** |
| Exit points | *Open in Documents* → `/lp-portal/documents?category=Notices`; shell navigation. No router push on row selection (the URL is not updated). **[O]** |

##### Layout

1. Page header: title *Notices* with an info popover, subtitle. **[O]**
2. Error line (only when the list failed). **[O]**
3. KPI strip of four tiles: *All Notices*, *Unread*, *Ack. Required*, *Acknowledged*. **[O]**
4. Two-column grid (list left, 340 px detail right from the `xl` breakpoint; stacked below): list card (filter toolbar, notice rows) and detail aside (shown when a notice is selected). **[O]**
5. Dialog *Notice filters*. **[O]**

##### Elements

| # | Element | Type | Content / behaviour | Data source (current → target) | Label |
| --- | --- | --- | --- | --- | --- |
| 1 | Page title | `h1` | *Notices*, 24 px bold. | Static | [O] |
| 2 | Title info popover | info button, aria-label "Notices info" | Heading *Notices*; text "Fund and organisation announcements requiring review or acknowledgement." | Static | [O] |
| 3 | Subtitle | text | "Announcements, valuation updates, and actions requiring your attention." | Static | [O] |
| 4 | Error line | red bordered paragraph | Shows the error text (default "Request failed"). No retry control. | Prototype → `getNotices` failure | [O] |
| 5 | KPI tile *All Notices* | tile with blue bell icon | Number of notices fetched (maximum 50). | Prototype → `GET /lp-portal/notices?pageSize=50` | [O] |
| 6 | KPI tile *Unread* | tile with sky clock icon | Count of notices whose status is *Unread* (never opened, not acknowledged). | Prototype → derived | [O] |
| 7 | KPI tile *Ack. Required* | tile with orange document icon | Count of notices with `requiresAck` true and status not *Acknowledged*. | Prototype → derived | [O] |
| 8 | KPI tile *Acknowledged* | tile with green check icon | Count of notices with status *Acknowledged*. | Prototype → derived | [O] |
| 9 | Status filter | pill select, 130 px, placeholder "Status" | *All Statuses* (`all`, default), *Unread*, *Opened*, *Acknowledged*. | Client-side | [O] |
| 10 | Type filter | pill select, 160 px, placeholder "Type" | *All Types* (default) plus the distinct type labels present in the fetched notices, alphabetically. | Client-side | [O] |
| 11 | *Filters* button | outline pill with funnel icon | Opens the *Notice filters* dialog; a blue circular count badge (top-right) appears when 1–4 advanced filters are active (fund, acknowledgement-only, from, to). | Client-side | [O] |
| 12 | Search box | pill input, min 200 px, magnifier icon | Placeholder "Search notices..."; see Inputs. | Client-side | [O] |
| 13 | Notice list | list of full-width row buttons | See Tables. | Prototype → `GET /lp-portal/notices` | [O] |
| 14 | Detail header | title `h2` + status badge | The selected notice. | Prototype → `GET /lp-portal/notices/{id}` | [O] |
| 15 | Detail subline | text | "{fund} · {audience}"; audience is the fixed text "Fund investors". | Prototype (constant) → targeting description | [O] |
| 16 | Detail fields | 3 label/value rows (110 px label column) | *Type* (kind label), *Published* (date-time "MMM d, yyyy, h:mm AM/PM", browser time zone), *Requires Ack.* ("Yes"/"No"). | Prototype | [O] |
| 17 | Detail body | bordered grey box | While the detail request runs: "Loading notice…"; otherwise the notice body, or "No content available." when empty. Plain text; line breaks are not preserved. | Prototype → `body` | [O] |
| 18 | *Acknowledge Notice* | blue pill button, 40 px | Visible only when the notice requires acknowledgement and is not acknowledged; shows a spinner while the request runs. | Prototype → `POST /lp-portal/notices/{id}/acknowledge` | [O] |
| 19 | *Open in Documents* | outline pill link | Navigates to `/lp-portal/documents?category=Notices`. Always visible. | Static | [O] |
| 20 | Unread dot | 8 px circle at the row start | Blue (`#2563eb`) when the status is *Unread*, otherwise transparent. | Derived | [O] |
| 21 | Type chip | 10 px pill next to the title | Label of the notice type; colours in Tables. | Derived | [O] |
| 22 | Summary line | one-line text (clamped) | `preview`, or the first 120 characters of the body. | Prototype → `preview` | [O] |

##### Tables

**Notice list (rows, not a table)**

| Column | Format | Sortable | Notes |
| --- | --- | --- | --- |
| Unread dot | 8 px dot | No | Blue only for *Unread*. **[O]** |
| Title + type chip | bold 13 px title; chip 10 px | No | Chip label from the type map; unknown → grey. **[O]** |
| Summary | 12 px grey, one line | No | `preview` ?? first 120 characters of `body`. **[O]** |
| Fund · published | "{fund} · {MMM d, yyyy, h:mm AM/PM}" 11 px | No | Fund name, or the fund id when no name; empty for notices without a fund. **[O]** |
| Status badge | pill, right | No | *Unread*, *Opened*, *Acknowledged*. **[O]** |

- Filters: *Status* (equality), *Type* (equality on the mapped label), *Fund* (equality on the fund label, in the dialog), *Acknowledgement required only* (`requiresAck` and status not *Acknowledged*), *Published from* / *Published to* (compare the UTC date part of `publishedAt`, `YYYY-MM-DD`, inclusive), search. All filters AND together and apply immediately. The KPI tiles ignore the filters. **[O]**
- Search: case-insensitive substring over "{title} {summary} {fund}". **[O]**
- Row click: sets the selected notice (see Defects: after the first detail load the selection cannot change). Active row: light-blue fill with a 3 px blue left bar. **[O]**
- Pagination: none; one request for 50 notices; notices beyond 50 are never shown and are not counted. **[O]**
- Order: as returned (reference API: `publishedAt` descending; the mock returns ids 31 → 26 in array order, which is not date order). **[O]**
- Status → badge colour: *Unread* `#dbeafe`/`#1d4ed8`; *Opened* `#fef9c3`/`#a16207`; *Acknowledged* `#dcfce7`/`#15803d`. **[O]**
- Type → chip colour: *Report Available* `#dbeafe`/`#1d4ed8`; *AGM Notice* `#ede9fe`/`#6d28d9`; *Valuation Update* `#ccfbf1`/`#0f766e`; *Capital Call* `#ffedd5`/`#c2410c`; *Distribution* `#dcfce7`/`#15803d`; *Policy Update* `#f3f4f6`/`#4b5563`; every other type (including the mock's "INFO" and "ACTION REQUIRED") `#f3f4f6`/`#4b5563`. **[O]**
- Status derivation: `acknowledgedAt` present → *Acknowledged*; else `openedAt` present or `status` = OPENED → *Opened*; else *Unread* (PUBLISHED and DELIVERED both read as Unread). **[O]**

##### Inputs & validation

| Field | Control | Required | Options / default / placeholder | Validation today (code) | Target validation | Error message |
| --- | --- | --- | --- | --- | --- | --- |
| Query `id` | URL query | No | Notice id | Applied as the selected notice on mount and re-applied on every selection change; the notice is fetched even if absent from the list. **[O]** | Unknown or invisible id → 404 toast and the first notice is selected. **[P]** | "Failed to load notice" (fallback) |
| Status | select | No | `all` / Unread / Opened / Acknowledged | None | Same | None |
| Type | select | No | `all` + dynamic | None | Options = target notice type vocabulary. **[P]** | None |
| Fund (dialog) | select | No | placeholder "All funds"; *All funds* + dynamic funds | None; a null fund value would break the item | Options = funds of the session. **[P]** | None |
| Acknowledgement required only (dialog) | checkbox | No | Unchecked | None | Same | None |
| Published from (dialog) | date input | No | Empty | No check against *Published to* | From ≤ To; otherwise the *To* field is flagged. **[P]** | "Published to must be on or after Published from" (proposed text) |
| Published to (dialog) | date input | No | Empty | None | As above | As above |
| Search | text | No | Placeholder "Search notices..." | None; no debounce (client-side) | Max 200 characters | None |

##### Actions

| Control | Enabled when | Permission | Effect (state change, toast text, navigation) | Wiring / API | Label |
| --- | --- | --- | --- | --- | --- |
| Row click | Always | `lp.notices.view` | Selects the notice; requests its detail, which marks it *Opened* (first open). No toast. | Prototype → `GET /lp-portal/notices/{id}` | [O] |
| Auto-select on load | Notices loaded and none selected | `lp.notices.view` | The first notice in the list is selected and fetched, so it is marked *Opened* without a click. | Prototype | [O] |
| *Acknowledge Notice* | Notice requires acknowledgement and is not *Acknowledged*; disabled while a request runs | `lp.notices.acknowledge` (SIGNATORY, MANAGER) | Sends a new `Idempotency-Key` (UUID) per click; on success toast "Notice acknowledged.", reloads the list (the list shows the loading spinner meanwhile) and re-fetches the notice so the status becomes *Acknowledged* and the button disappears; on failure toast with the server message or "Failed to acknowledge notice". No confirmation dialog. | Prototype → `lpPortalApi.acknowledgeNotice(id, key)` → `POST /lp-portal/notices/{id}/acknowledge` (header `Idempotency-Key`, body `{}`) → `{acknowledgedAt}` | [O] |
| *Open in Documents* | Always | `lp.documents.view` | Navigates to `/lp-portal/documents?category=Notices`. | Static link | [O] |
| *Filters* | Always | None | Opens the dialog. | Static | [O] |
| Dialog *Reset* | Always | None | Clears fund, acknowledgement-only, from and to; leaves status, type and search; does not close. | Client-side | [O] |
| Dialog *Apply* | Always | None | Closes the dialog (filters were already live). | Client-side | [O] |
| Dialog close (X, ESC, overlay) | Always | None | Closes; filters stay. | Client-side | [O] |
| Realtime `lp_notice_updated` | Event received | None | Reloads the list (does not refresh the open detail). No-op in this build. | `lib/lp-portal/realtime.ts` stub → Socket.IO event | [O] / [I] |

##### Modals & drawers

**Dialog — Notice filters** (opened by *Filters*)

| Field | Control | Required | Options / default / placeholder | Validation today (code) | Target validation | Error message |
| --- | --- | --- | --- | --- | --- | --- |
| Fund | select | No | "All funds" default; fund labels of the loaded notices, sorted | None | Session funds | None |
| Acknowledgement required only | checkbox with label "Acknowledgement required only" | No | Off | None | Same | None |
| Published from | date | No | Empty | None | ≤ *Published to* | "Published to must be on or after Published from" (proposed) |
| Published to | date | No | Empty | None | ≥ *Published from* | As above |

| Control | Enabled when | Permission | Effect | Wiring / API | Label |
| --- | --- | --- | --- | --- | --- |
| *Reset* | Always | None | Clears the four advanced filters. | Client-side | [O] |
| *Apply* | Always | None | Closes the dialog. | Client-side | [O] |

- Title *Notice filters*; description "Filter by fund, acknowledgement requirement, or publish date." Max width medium. **[O]**

##### States

- Empty: list text "No notices match your filters." (also when there are no notices at all); detail aside hidden when no notice exists; KPI tiles show 0. **[O]**
- Loading: list replaced by a centred spinner with "Loading notices…" on the first load, after *Acknowledge Notice*, and on every realtime reload; detail body "Loading notice…". **[O]**
- Error: red line above the tiles with the error text (no retry); detail failure → toast "Failed to load notice" (or the server message, e.g. "Notice not found"); acknowledge failure → toast "Failed to acknowledge notice" (or the server message, e.g. 403 "Authorised Signatory access required" for a VIEWER, 404 "Notice not found"). **[O]** / **[I]**
- Disabled / read-only: *Acknowledge Notice* disabled with a spinner while the request runs; the button is hidden (not disabled) once acknowledged or when the notice does not require acknowledgement. No role-based disabling exists. **[O]**
- Conditional: *Acknowledge Notice* only for `requiresAck` and not acknowledged; unread dot only for *Unread*; the filter badge only when advanced filters are active; the detail aside only when a notice is selected. **[O]**

##### Business rules & calculations

- Visibility **[I]**: a notice is listed when its status is PUBLISHED or DELIVERED and its target is (a) all investors, (b) the investor organisation, (c) the specific user, or (d) a fund inside the user's fund entitlement. Notices are never filtered by the top-bar fund selector (the notices request has no `fundId`). Notice targeting may also name a share class; the reference platform stores it but does not filter on it. BR-127: a FUND-targeted notice is visible only to organisations with an active or pending commitment in that fund, and a share-class notice only to holders of that class. **[P]**
- Types / categories **[O]** / **[I]**: type label map: `CAPITAL_CALL` → *Capital Call*; `REPORT`, `REPORT_AVAILABLE` → *Report Available*; `POLICY`, `POLICY_UPDATE` → *Policy Update*; `DISTRIBUTION` → *Distribution*; `VALUATION` → *Valuation Update*; `AGM` → *AGM Notice*; anything else → the key with underscores replaced by spaces, not case-folded. The type used is `kind`, falling back to `category`, then `POLICY`. The reference platform stores a free-text `category` (up to 32 characters) and sets `kind` equal to it; when no category is given it infers one from the title (contains "capital call" or "call #" → CAPITAL_CALL; contains "report", "letter" or "quarterly" → REPORT; contains "policy" or "terms" → POLICY; otherwise GENERAL). BR-128: one category enum (`CAPITAL_CALL`, `DISTRIBUTION`, `REPORT`, `VALUATION`, `NAV`, `AGM`, `POLICY`, `DEALING`, `REDEMPTION_SUSPENSION`, `SYSTEM`, `GENERAL`) with Title-Case labels, and `kind` (INFO / ACTION_REQUIRED) is a separate field that never replaces the category. **[P]**
- Status model **[I]**: PUBLISHED → DELIVERED → OPENED → ACKNOWLEDGED. The UI shows three: *Unread* (PUBLISHED or DELIVERED, no open), *Opened* (first detail fetch recorded `openedAt`), *Acknowledged* (`acknowledgedAt` set). Open tracking: the first detail request by a user creates the receipt with `openedAt` and emits a realtime event; later opens do not change it. Because the screen auto-selects the first notice, that notice is marked opened on page load. BR-129: the open is recorded only when the user has the detail visible for at least one selection made by a click or a deep link, not by auto-selection. **[P]**
- Acknowledgement **[I]**: requires SIGNATORY or MANAGER; requires an `Idempotency-Key` header of 8–200 printable ASCII characters (otherwise 400 `LP_VALIDATION` "Idempotency-Key header required (8–200 printable ASCII)"); the first call per (organisation, action, path, key) stores its 2xx response, and the same key with the same body replays it with header `Idempotent-Replay: true`, while the same key with a different body answers 409 `LP_IDEMPOTENCY_KEY_REUSED`. The receipt is per user; the organisation status shown to every colleague is taken from the most recently created receipt of the organisation. The reference code overwrites `acknowledgedAt` on every call, so a second acknowledgement with a new key moves the timestamp. BR-130: acknowledgement keeps the first `acknowledgedAt`; a repeat answers 200 with the original timestamp; the organisation is *Acknowledged* when any SIGNATORY or MANAGER of the organisation has acknowledged; an `NOTICE_ACKNOWLEDGED` audit event records user, time and IP. **[P]**
- `requiresAcknowledgement` **[I]**: the reference API returns the constant `true` for every notice, so every unacknowledged notice would show *Acknowledge Notice* and count under *Ack. Required*; the mock uses false for informational notices. When the field is absent the UI treats the notice as requiring acknowledgement unless `acknowledgedAt` is set. BR-131: `requires_acknowledgement` is a stored boolean set by the publisher (default false); capital-call and policy notices default true. **[P]**
- Unread definitions **[I]**: the page tile *Unread* counts unopened notices; the sidebar badge and bell take `unreadCounts.notices` from the session, which the reference API defines as visible notices with no acknowledged receipt ("unacknowledged"). BR-132: the session `unreadCounts.notices` equals the number of visible notices with status *Unread* (not opened), and a separate count of notices awaiting acknowledgement drives dashboard actions and the bell. **[P]**
- Bell feed **[I]**: `GET /lp-portal/notifications?limit=` returns unacknowledged notices (href `/lp-portal/notices?id={id}`, id `notif_notice_{id}`), open requests and open capital calls, newest first; `limit` default 5, clamped to 1–50.
- Dashboard action **[I]**: each unacknowledged notice yields a dashboard action of type `NOTICE_REQUIRES_ACK` (mock: `NOTICE`), removed when the notice is acknowledged.
- Staff publishing **[I]**: staff create a notice with a required title and body, an optional category, a target (ALL, FUND with `fundId`, ORG or USER with `clientId`) and an optional share class. Errors: "title is required", "body is required", "targetType must be one of: ALL, FUND, ORG, USER", "fundId is required when targetType is FUND", "clientId is required when targetType is ORG or USER". Publication sets PUBLISHED and `publishedAt` = now and creates one delivery receipt per recipient organisation (FUND: organisations with ACTIVE or PENDING commitments in the fund; ALL: every organisation with an ACTIVE or PENDING commitment). Staff counts delivered / opened / acknowledged are distinct organisations. There is no edit, withdraw, schedule or expiry. There is no staff UI for notices in the Nexus admin today. BR-133: add edit-before-open, withdraw and `expires_at`. **[P]**
- Realtime **[I]**: event `lp_notice_updated` payload `{type:"NOTICE", noticeId, title, status (OPENED | ACKNOWLEDGED | PUBLISHED), fundId, fundName, href, at}` to the organisation room; it refreshes the list, bell, session counts and dashboard.
- Number and date formats **[O]**: date-time "MMM d, yyyy, h:mm AM/PM" in the browser time zone; the date filters compare UTC dates.
- Prototype seed **[O]**: 6 notices (notice-31 … notice-26), array order 31, 30, 29, 28, 27, 26; initial derived tiles: All 6, Unread 3 (31, 30, 26), Ack. Required 2 (30, 26), Acknowledged 2 (29, 27); session `unreadCounts.notices` = 3 (a different definition from the tile). Seeded types (the mock's `kind` wins): "INFO" for 31, 29, 28, 27, 26 and "ACTION REQUIRED" for 30, so the Type filter lists exactly *ACTION REQUIRED* and *INFO*. Acknowledging in the mock removes the matching dashboard action.

##### Edge cases

- A notice without a fund (ALL, ORG or USER target) shows an empty fund cell and would add an empty option to the fund filter. **[O]** / **[I]**
- A notice with `acknowledgedAt` but `requiresAck` false shows *Acknowledged* without a button. **[O]**
- A notice acknowledged by a colleague appears *Acknowledged* to the organisation only if its receipt is the latest-created one (reference behaviour). **[I]**
- `?id=` of a notice outside the first 50 or filtered out still shows in the detail aside; the list highlights nothing. **[O]**
- When filters remove every row, the detail aside keeps the previously loaded notice. **[O]**
- Acknowledging an already acknowledged notice is not offered (button hidden); a double click is blocked by the disabled state, but two tabs can send two keys. **[O]**
- The realtime reload replaces the list with the spinner for the duration of the request. **[O]**

##### Gaps, defects & open questions

- **DEF-421** selection is stuck. After the first detail load the aside always shows that first notice, and clicking another row reverts the selection (the loaded detail takes priority and the selection is forced back to it; `?id=` is re-applied on every change). **(verify in browser)**
- **DEF-422** the list is not refreshed after the first open, so a row can read *Unread* while its detail reads *Opened*.
- **DEF-423** type labels come from `kind`, hiding the category; with the mock data the chips read "INFO"/"ACTION REQUIRED" in grey and the Type filter has two options; labels are not case-folded.
- **DEF-424** fund-less notices render an empty fund and a null filter option; the audience line is a hard-coded "Fund investors".
- **DEF-425** after *Acknowledge Notice* the session counts, bell and dashboard actions are not refreshed; the list reload flashes the spinner; the notice is fetched twice.
- **DEF-426** the detail body ignores line breaks; there is no retry on the error line; no confirmation before acknowledging.
- **DEF-427** *Open in Documents* is not specific to the notice and, because *Notices* has no API category, lists all documents.
- **DEF-428** the reference API marks every notice as requiring acknowledgement; its acknowledge is not state-idempotent (timestamp overwritten); FUND-target visibility has no commitment check and share class is ignored.
- **DEF-429** the page tile *Unread* (unopened) and the sidebar badge (unacknowledged in the reference API) use different definitions.
- **DEF-430** only 50 notices are fetched and counted; there is no pager.
- FR-LP-083: row selection switches the detail pane, records the open of the clicked notice, updates the row badge and sets `?id=` in the URL — AC: clicking notice B shows B within one render, B's row badge becomes *Opened*, and reloading the URL reopens B.
- FR-LP-084: *Acknowledge Notice* is shown enabled only to SIGNATORY and MANAGER; a VIEWER sees the notice and a disabled control with the hint "Only authorised signatories can acknowledge notices" (proposed text) — AC: a VIEWER session cannot trigger the request.
- FR-LP-085: after acknowledging, the screen refreshes the session counts, the bell and the dashboard actions (`refreshSession`, `bumpRefresh(["notices","notifications","dashboard"])`) without a spinner flash — AC: the sidebar badge decrements immediately.
- FR-LP-086: paginate notices (`page`, `pageSize` 20, `totalPages`) and send the status, type, fund, date and search filters to the API so counts and filters cover every notice — AC: the *All Notices* tile equals `total` of the list response.
- FR-LP-087: `GET /lp-portal/notices` returns `requiresAcknowledgement`, `kind`, `category`, `audience` (a text such as "All investors", "Matanho Growth Fund I investors", "Your organisation"), `openedAt`, `acknowledgedAt`, `shareClass`, `fundName` — AC: the detail line shows the real audience instead of "Fund investors".
- FR-LP-088: a notice may link to a document (`documentId`) so *Open in Documents* opens that document (`/lp-portal/documents?document={id}`) — AC: the link opens the exact document, not the generic category.
- FR-LP-089: notice publication, targeting and receipts exist in Nexus (staff create/list/withdraw endpoints, investor list/get/acknowledge, receipts per organisation and user, delivered/opened/acknowledged counts, `lp_notice_updated` realtime event) — AC: a staff-published FUND notice appears for entitled investors only and the staff counts match the receipts.
- BR-134: acknowledgement is audited (`NOTICE_ACKNOWLEDGED`) and opens are recorded per user. **[P]**
- Q-138: is acknowledgement recorded per person or per organisation? — default: per person, with organisation status = acknowledged once any SIGNATORY or MANAGER has acknowledged.
- Q-139: which notices require acknowledgement? — default: publisher-set flag, true for capital-call and policy notices.
- Q-140: do notices expire or can staff withdraw them? — default: yes, `expires_at` and a withdraw action; withdrawn notices disappear from the list and the bell.
- Q-141: should notices follow the top-bar fund selector? — default: yes, notices with a fund follow the selector and notices without a fund (ALL, ORG, USER) are always shown.
- Q-142: should the portal email or push a notice on publication? — default: yes, honouring the in-app and email notification preferences (`emailNotices`, `inAppNotices`) on the Settings screen.

#### 5.B.9 Organisation (`/lp-portal/organisation`, `lp.organisation.view`; colleague and bank changes `lp.organisation.manage_colleagues`)

| Attribute | Value |
| --- | --- |
| Purpose | Shows the investor organisation's authorised users with role, fund count, MFA status and last activity; lets a Manager invite or revoke colleagues; lists bank instruction change requests and lets a Manager submit a new one for verification. **[O]** |
| Access | Route gate as 5.B.7. `canManage` = `lpRole` is `MANAGER`. For any other role (and while the session loads) an amber banner reads "Colleague management requires Manager role." and *Invite User*, *Request Change* and every row action menu are disabled. The target API shows the colleague list only to a MANAGER (other roles receive an empty list from `GET /lp-portal/organisation` and 403 from `GET /lp-portal/colleagues`) and lets a SIGNATORY or MANAGER submit a bank instruction change. **[O]** / **[I]** |
| Prototype layer | `components/lp-portal/screens/lp-organisation-screen.tsx` (674 lines), `useLpOrganisation`, mock layer `mock-api.ts` + `mock-store.ts` (organisation "Horizon Pension Fund LP", three colleagues, two approved bank changes). **[O]** |
| Wiring status | Prototype for all elements. Target: `getOrganisation` → `GET /lp-portal/organisation`; `getBankInstructionChanges` → `GET /lp-portal/bank-instructions/changes`; `inviteColleague` → `POST /lp-portal/colleagues`; `revokeColleague` → `PATCH /lp-portal/colleagues/{membershipId}/revoke`; `submitBankInstructionChange` → `POST /lp-portal/bank-instructions/changes`; `updateColleague` → `PATCH /lp-portal/colleagues/{membershipId}` and `getColleagues` → `GET /lp-portal/colleagues` exist in the contract but no control calls them. **[O]** |
| Entry points | Sidebar *My Organisation*; topbar user menu; *Profile / Access* request type link (*Linked To*) from 5.B.7; hint text in the *Add participant* dialog. **[O]** |
| Exit points | None (no outbound links). **[O]** |

##### Layout

1. Header: title *My Organisation*, subtitle "Manage users, roles, fund entitlements, and bank instruction changes."; right: *Invite User* button. **[O]**
2. Red error banner (load error). **[O]**
3. Amber banner (non-Manager). **[O]**
4. Four KPI cards. **[O]**
5. Two-column body (second column 300 px from `xl`): colleagues card (toolbar + table) and, when a colleague is selected, the *User Details* aside. **[O]**
6. Card *Bank Instruction Changes* (header with *Request Change* button, table). **[O]**
7. Dialog *Request Bank Instruction Change*. **[O]**
8. Dialog *Invite User*. **[O]**

##### Elements

| # | Element | Type | Content / behaviour | Data source (current → target) | Label |
|---|---|---|---|---|---|
| 1 | Title / subtitle | text | As in Layout 1. | Static | [O] |
| 2 | *Invite User* | primary pill button, user-plus icon | Opens the invite dialog. Disabled unless Manager. | Client | [O] |
| 3 | Error banner | red text | `getApiErrorMessage` of the failed load (default "Request failed"); the organisation and the bank-change list load together, so a failure of either clears both. | Prototype → `GET /lp-portal/organisation`, `GET /lp-portal/bank-instructions/changes` | [O] |
| 4 | Non-Manager banner | amber text | "Colleague management requires Manager role." | `lpRole` | [O] |
| 5 | KPI *Organisation* | card (building icon, blue) | Value = organisation legal name ("—" until loaded); helper "Investor {investorId}" or "Investor entity" when no id. | `getOrganisation` | [O] |
| 6 | KPI *Authorised Users* | card (violet) | Value "…" while loading, otherwise number of colleague rows (including revoked rows); helper "{a} active · {i} invited" where a = rows displayed as *Active* and i = rows displayed as *Invited*. | `getOrganisation.colleagues` | [O] |
| 7 | KPI *Fund Entitlements* | card (green) | Value "…" while loading, otherwise the larger of (sum over colleagues of their fund counts) and (number of funds of the investor); helper "Across private capital & open-ended". | derived | [O] |
| 8 | KPI *MFA Coverage* | card (orange) | Value "…" while loading; "—" with no colleagues; otherwise "{m}/{n}" (m = colleagues with MFA on, n = all colleague rows); helper "{round(m ÷ n × 100)}% enabled", or "No users yet". | derived | [O] |
| 9 | Role filter | select (150 px pill), placeholder *Role* | Options *All Roles*, *Investor Admin*, *Viewer*, *Signatory* (matched on the displayed role label). | Client | [O] |
| 10 | User search | text input, placeholder *Search users...* | Case-insensitive substring over "name email role-label". | Client | [O] |
| 11 | Colleagues table | table | See Tables. | `getOrganisation.colleagues` | [O] |
| 12 | *User Details* aside | card | Title *User Details*; rows *Name*, *Email*, *Role*, *Funds* (number), *MFA* ("Enabled" or "Off"), *Status*, *Last Active*; note box "Fund access must remain a subset of organisation entitlements." The selected row is the clicked row if it is still in the filtered list, else the first filtered row; the aside is absent when the filtered list is empty. | derived | [O] |
| 13 | Bank section heading | text | *Bank Instruction Changes* and "Changes never activate immediately — MFA and verification are required." | Static | [O] |
| 14 | *Request Change* | outline pill button, plus icon | Opens the bank-change dialog. Disabled unless Manager. | Client | [O] |
| 15 | Bank changes table | table | See Tables. | `getBankInstructionChanges` | [O] |

##### Tables

**Colleagues table** (minimum width 760 px)

| Column | Format | Sortable | Notes |
|---|---|---|---|
| User | 32 px avatar with initials (first letter of each space-separated word of the name, first two letters, not forced to upper case), name (bold), email (11 px grey) | No | — |
| Role | pill | No | *Investor Admin* (API `MANAGER`), *Signatory* (`SIGNATORY`), *Viewer* (anything else). |
| Funds | integer | No | Number of fund ids on the membership; a membership with no fund restriction (`null`) shows 0. |
| MFA | pill | No | *Enabled* (green) or *Off* (grey), from `mfaEnabled` (missing = Off). |
| Status | pill | No | *Active*, *Invited*, *Suspended*; every other API status is shown as *Active*. |
| Last Active | date-time or "—" | No | `lastActiveAt` formatted "MMM d, yyyy, h:mm AM/PM". |
| Actions | `…` icon button, `aria-label` "Actions for {name}" | — | Disabled unless Manager. Menu has one item, *Revoke access*. |

- Filters: role select and search (Elements #9, #10). **[O]**
- Row click: selects the row (blue highlight, 3 px left bar) for the *User Details* aside; the first row is selected on load. **[O]**
- Row action: *Revoke access* (red text; shows *Revoking…* while the call runs; disabled while running and for non-Managers). No confirmation dialog. **[O]**
- Pagination: none; the list is not paged. **[O]**
- Sorting: none; API order (mock: seed order then invitations appended; real: newest membership first). **[O]**
- Role → colour: *Investor Admin* blue `#1d4ed8` on `#dbeafe`; *Viewer* grey `#4b5563` on `#f3f4f6`; *Signatory* violet `#6d28d9` on `#ede9fe`. Status → colour: *Active* green `#15803d` on `#dcfce7`; *Invited* sky `#0369a1` on `#e0f2fe`; *Suspended* red `#b91c1c` on `#fee2e2`. **[O]**
- Empty: "No colleagues match your filters." Loading: spinner and "Loading colleagues…". **[O]**

**Bank Instruction Changes table** (minimum width 720 px)

| Column | Format | Sortable | Notes |
|---|---|---|---|
| Fund | bold text | No | Fund name, else the fund id. |
| Account | monospace 11 px | No | Masked account number, e.g. "•••• 3341". |
| Requested By | text | No | Name of the requester. |
| Submitted | date-time | No | "MMM d, yyyy, h:mm AM/PM". |
| Status | pill | No | See map. |

- No filter, search, row click, row action or pagination. Newest first (mock inserts new rows at the top). **[O]**
- Status → label → colour: `SUBMITTED` → *Submitted* sky `#0369a1` on `#e0f2fe`; `UNDER_VERIFICATION`, `PENDING_VERIFICATION`, `PENDING` → *Under Verification* orange `#c2410c` on `#ffedd5`; `APPROVED` → *Approved* blue `#1d4ed8` on `#dbeafe`; `REJECTED` → *Rejected* red `#b91c1c` on `#fee2e2`; `ACTIVE` → *Active* green `#15803d` on `#dcfce7`; any other value (including the design statuses `DRAFT` and `ACTIVATED`) → *Submitted*. Hyphens are treated as underscores and case is ignored. **[O]**
- Empty: "No bank instruction changes on record." No loading indicator is shown for this table (the empty message shows while the data loads). **[O]**

##### Inputs & validation

**Invite User dialog**

| Field | Control | Required | Options / default / placeholder | Validation today (code) | Target validation | Error message |
|---|---|---|---|---|---|---|
| Email | email input | Yes | Placeholder *colleague@company.com*; disabled while sending | Non-blank after trim only; no format check, no duplicate check | Valid e-mail format (`^[^@\s]+@[^@\s]+\.[^@\s]+$`), trimmed and lower-cased; not already an active member (409) | "Email is required." (toast); server: "A valid email address is required", "User already has active access" |
| Role | none | — | Fixed to `VIEWER` in the request | — | Role picker *Viewer* / *Signatory* (MANAGER cannot be granted through the portal) | — |
| Fund access | none | — | Fixed to all funds of the inviter | — | Multi-select limited to the inviter's own fund scope | — |

**Request Bank Instruction Change dialog**

| Field | Control | Required | Options / default / placeholder | Validation today (code) | Target validation | Error message |
|---|---|---|---|---|---|---|
| Fund | select (label *Fund*) | Yes | Placeholder *Select fund*; all funds of the investor; default first fund | Must have a value | Fund inside the user's scope | "Fund, bank name, and account number are required." (toast) |
| Bank name | text, placeholder *Bank name* (no label) | Yes | — | Non-blank after trim | Required, maximum length to be set | same toast |
| Account name | text, placeholder *Account name (optional)* | No | Sent only when non-blank | None | Should match the legal name of the investor or be explained (Q-NEW) | — |
| Account number | text, placeholder *Account number* | Yes | Shown in clear text while typing | Non-blank after trim | Numeric/IBAN format by country; confirmation field (FR-NEW below) | same toast |

All dialog inputs are disabled while the request is running. **[O]**

##### Actions

| Control | Enabled when | Permission | Effect (state change, toast text, navigation) | Wiring / API | Label |
|---|---|---|---|---|---|
| *Invite User* | Role is Manager | `lp.organisation.manage_colleagues` | Opens *Invite User*. | Client | [O] |
| *Send Invite* | Not while sending | Manager | Sends `{email, role: "VIEWER", fundIds: all fund ids}`. Success: toast "Invitation sent."; dialog closes; email cleared; list reloaded. Failure: toast with the server message or "Failed to send invitation"; the dialog stays open with the e-mail kept. | Prototype → `POST /lp-portal/colleagues` with `Idempotency-Key` | [O] |
| Invite *Cancel* | Not while sending | — | Closes the dialog. | Client | [O] |
| Colleague row click | Always | None | Selects the row. | Client | [O] |
| *Revoke access* | Manager and not already revoking this row | Manager | Immediately revokes, without confirmation. Success: toast "Access revoked."; list reloaded. Failure: toast with server message or "Failed to revoke colleague". | Prototype → `PATCH /lp-portal/colleagues/{membershipId}/revoke` | [O] |
| *Request Change* | Role is Manager | Manager (target: SIGNATORY or MANAGER) | Opens the bank-change dialog. | Client | [O] |
| *Submit Request* (bank dialog; spinner while sending) | Not while sending | as above | Validates the three required fields, sends `{fundId, bankName, accountName (omitted when blank), accountNumber}`. Success: toast "Bank instruction change submitted."; dialog closes; form reset (fund = first fund, texts empty); list reloaded. Failure: toast with server message or "Failed to submit bank instruction change". | Prototype → `POST /lp-portal/bank-instructions/changes` with `Idempotency-Key` | [O] |
| Bank dialog *Cancel* | Not while sending | — | Closes the dialog (form values are kept until the next successful submit). | Client | [O] |

##### Modals & drawers

**Dialog — Invite User**

Title *Invite User*; description "Grant another team member access to this organisation. They must already have an Matanho account." Body: one email field. Footer: *Cancel*, *Send Invite*. Closing (X, Esc, overlay) is possible at any time. Inputs and Actions: see the tables above. **[O]**

**Dialog — Request Bank Instruction Change**

Title *Request Bank Instruction Change*; description "Submit a new bank account for verification. Changes require MFA and will not activate immediately." Body: the four fields above. Footer: *Cancel*, *Submit Request*. No MFA prompt exists in the dialog. Inputs and Actions: see the tables above. **[O]**

##### States

- Empty: colleagues "No colleagues match your filters." (shown both for a real empty organisation and for a non-Manager, because the target API returns an empty list to non-Managers); *User Details* absent; bank table "No bank instruction changes on record." **[O]**
- Loading: KPI values "…" for users, entitlements and MFA; colleagues area "Loading colleagues…"; the *Organisation* card shows "—" until loaded. A reload after any action shows the same loading state. **[O]**
- Error: red banner; toasts as listed. **[O]**
- Disabled / read-only: for non-Managers *Invite User*, *Request Change* and row menus are disabled and the amber banner shows; the tables remain visible. During a call the related dialog buttons and inputs are disabled. **[O]**
- Conditional: *User Details* appears only when the filtered list is non-empty; the amber banner also flashes while `lpRole` is still unknown. **[O]**

##### Business rules & calculations

- **Role set [I]:** `VIEWER` (view only), `SIGNATORY` (viewer rights plus acknowledgements, payment confirmation uploads, dealing submissions, service requests, bank-instruction change submission), `MANAGER` ("Investor Admin": also invites, edits and revokes colleagues). Legacy `LP_MANAGER` and `ADMIN` map to `MANAGER`; `LP_VIEWER` to `VIEWER`. The design adds that a portal-administrator right can never be granted to a colleague.
- **KPI formulas [O]:** Authorised Users = number of rows; active = rows displayed *Active*; invited = rows displayed *Invited*; Fund Entitlements = max(Σ per-colleague fund counts, number of investor funds) (this is a sum of memberships, not a count of distinct funds); MFA Coverage = rows with MFA on ÷ rows, rounded to a whole percent.
- **Invite flow [I]:** only a Manager (or Matanho staff) can invite. E-mail is trimmed and lower-cased. Role defaults to `VIEWER`; `MANAGER` cannot be granted through the portal (403 "Cannot invite another MANAGER via portal"). Fund ids are reduced to the inviter's own fund scope when the inviter is restricted. If no user with that e-mail exists, one is created with role "Limited Partner", a random 14-character temporary password and `mustChangePassword`, and an e-mail is sent with the portal sign-in URL, the temporary password and an activation link (`{portal}/reset-password?token=…`); the token is stored as a SHA-256 hash, is valid for 7 days, and any earlier unused token of that user is invalidated. If the user already exists no e-mail is sent and the membership is simply linked. A failed e-mail is logged and does not roll back the membership, and the response does not tell the caller. An existing active membership answers 409 "User already has active access"; a revoked membership is re-activated with the new role and funds. The membership is active immediately (there is no pending-acceptance state); the invitee becomes usable by setting a password or signing in. The audit requirement lists colleague invite and revoke. Invalid e-mail: 400 "A valid email address is required".
- **Update rules [I]:** a Manager can change a colleague's role and fund ids (`PATCH /lp-portal/colleagues/{membershipId}`): `MANAGER` cannot be granted through the portal (403 "Cannot promote to MANAGER via portal"); fund ids are reduced to the actor's scope; other organisations' memberships answer 404. No screen exposes this action.
- **Revoke rules [I]:** only a Manager; the target must belong to the same organisation (404 "Membership not found"); a membership whose role is `MANAGER` cannot be revoked through this API (403 "Cannot revoke manager via colleague API"), which also prevents self-revocation by a Manager and removal of the last Manager; revoking sets the membership inactive with the revocation time and increments the user's token version so the user's sessions stop working immediately; the displayed status becomes *Suspended*. The design requires immediate revocation.
- **Status derivation [I]:** `Suspended` when the membership is inactive or has a revocation time, otherwise `Active`. The status *Invited* is never produced by the real service (the prototype produces it for new invitations).
- **Fund-subset rule [I]:** a colleague's fund access must be a subset of the organisation's (and the inviter's) entitlements; an organisation administrator cannot expand entitlements (QA scenario in the design).
- **Bank instruction change workflow [I]:** old details remain active → MFA challenge → request submitted (status `SUBMITTED`) → verification by compliance or fund operations → optional call-back verification → approval → new details activated and the old archived. Design statuses: `DRAFT`, `SUBMITTED`, `UNDER_VERIFICATION`, `APPROVED`, `REJECTED`, `ACTIVATED`. A change never becomes active on submission; the full account number is masked after submission. The real service creates the record with status `SUBMITTED` only; no verification, approval or activation operation exists yet. Maker–checker: the requester must not approve (BR-001), and changes to bank instructions require dual approval and out-of-band verification (BR-006).
- **MFA policy [I]:** a single organisation-wide switch `requireMfaForLp` (default off) with an issuer name. When it is on and the submitting user has no verified TOTP factor, submission is refused with 403 `LP_MFA_REQUIRED` "MFA must be enabled to submit bank instruction changes". No per-submission code challenge is implemented.
- **Data stored for a change [I]:** fund, status, requester id, creation time and the submitted fields; the real service stores the whole request body, including the clear account number, in a JSON column and its list endpoint returns that payload rather than a masked number.
- **Idempotency [I]:** `POST /colleagues` and `POST /bank-instructions/changes` require `Idempotency-Key`.
- **Scope [O]:** the screen is organisation-wide; it ignores the fund selector and as-of date.

##### Edge cases

- A freshly invited colleague appears as *Invited* with MFA *Off* and last active "—"; its display name is the e-mail local part with dots replaced by spaces (not capitalised) in the prototype. **[O]**
- A revoked colleague stays in the list; in the prototype it is displayed as *Active* (the status `REVOKED` is unknown to the mapper), in the real service as *Suspended*. **[O]** / **[I]**
- A Manager can click *Revoke access* on their own row or another Manager's row; the service refuses with the 403 above. **[O]** / **[I]**
- An account number shorter than 4 characters is masked as "•••• ****" by the prototype. **[O]**
- The `bankName` of a change is stored but not displayed in the table. **[O]**
- Reload after every action resets the colleague and KPI areas to the loading state. **[O]**
- Initials are not upper-cased in the table but are in the *Add participant* dialog of 5.B.7. **[O]**

##### Gaps, defects & open questions

- **DEF-431** a revoked colleague is shown as *Active* and is counted in "active" (mock status `REVOKED`). FR-LP-090: map API membership states to *Active*, *Invited*, *Suspended*, *Revoked* and exclude *Suspended* and *Revoked* from "active" — AC: after revoking, the row shows *Revoked* (or *Suspended*) and the active count falls by one.
- **DEF-432** a membership with no fund restriction shows "0" funds. FR-LP-091: show "All funds" when the restriction is null — AC: Funds column and details aside read "All funds".
- **DEF-433** *Fund Entitlements* adds per-colleague counts instead of counting distinct entitled funds. FR-LP-092: value = number of distinct funds the organisation is entitled to — AC: with funds A and B and three colleagues the card shows 2.
- **DEF-434** *Revoke access* acts without confirmation and is offered on the user's own row and on Manager rows. FR-LP-093: confirm dialog "Revoke access for {name}? They will be signed out immediately." and hide the action for the signed-in user and for Managers — AC: no revoke request is sent before confirmation.
- **DEF-435** the invitation dialog has no role or fund controls, always invites a `VIEWER` with all funds, says the invitee "must already have an Matanho account" (grammar and wrong: the service creates accounts) and the update action has no screen. FR-LP-094: invitation dialog with Role (*Viewer*, *Signatory*), Fund access (multi-select within the inviter's scope) and, per colleague, an *Edit access* action calling the update endpoint — AC: an invited Signatory with fund A only can see only fund A.
- **DEF-436** the response to an invitation does not say whether the e-mail was delivered. FR-LP-095: return `activationEmailSent` and offer *Resend invitation* for colleagues who have not signed in — AC: when delivery fails the manager sees a warning toast and a resend action.
- **DEF-437** *Invited* status never occurs for real data because memberships are active at once. Q-143: should an invitation create a pending membership that is activated on first sign-in — default: yes; status *Invited* until the first sign-in or activation, *Active* afterwards.
- **DEF-438** the dialog copy says bank changes "require MFA" but no MFA step exists and no verification or approval step exists on the investor or staff side. FR-LP-096: bank instruction submission requires a fresh TOTP code (step-up, FR-AUTH-011) and creates a staff verification task with maker–checker approval — AC: submission without a valid code is refused; approval by the requester is refused; activation archives the old instruction.
- **DEF-439** bank-change list contract mismatch: the screen reads `fundName`, `accountNumberMasked`, `requestedBy`, `submittedAt`; the real service returns `payload`, `createdAt`. FR-LP-097: list returns `{id, fundId, fundName, bankName, accountNumberMasked, requestedBy, submittedAt, status}` — AC: table renders without blank cells.
- **DEF-440** the clear account number is persisted unmasked in the request payload. BR-135: store the account number encrypted, expose only the last four characters, and never return it.
- **DEF-441** UI requires Manager for *Request Change* while the service allows Signatories; the design says the Administrator invites and revokes and "Cannot grant access outside organisation fund entitlements", and that a Viewer has "no bank changes". Q-144: who may submit a bank instruction change — default: SIGNATORY and MANAGER (service behaviour), and the UI is aligned to it.
- **DEF-442** statuses `DRAFT` and `ACTIVATED` fall through to *Submitted*. FR-LP-098: add status labels *Draft* and *Activated* — AC: each design status has its own label and colour.
- FR-LP-099: bank form adds Currency, SWIFT/BIC or routing number, IBAN where applicable, supporting letter upload, and a confirm-account-number field — AC: mismatching confirmations block submission. Q-145: required bank fields per currency — default: Bank name, Account name, Account number, SWIFT/BIC, Currency.
- **DEF-443** non-Managers see "No colleagues match your filters." and KPI zeros, which looks like an empty organisation. FR-LP-100: for non-Managers hide the colleague table and show "Only Managers can view colleagues." — AC: no empty-table message for non-Managers.
- **DEF-444** the organisation profile (e-mail, country, phone, address, status) is returned but never displayed. Q-146: should these fields be shown (read-only) — default: yes, read-only card; changes go through a *Profile / Access* request.
- Q-147: Nexus today stores investor users as `client_users` with roles `admin`, `investment`, `finance`, `auditor` and a scope string, managed by staff only (`/investor-users`); how do these map to `VIEWER`, `SIGNATORY`, `MANAGER` — default: `admin` → MANAGER, `finance` → SIGNATORY, `investment` and `auditor` → VIEWER.

#### 5.B.10 Settings (`/lp-portal/settings`, `lp.settings.view`)

| Attribute | Value |
| --- | --- |
| Purpose | Personal portal preferences: e-mail and in-app notification switches per alert type, e-mail digest cadence, display currency and default as-of preference, plus a read-only security summary (MFA status and the organisation MFA policy) with links to account security pages. **[O]** |
| Access | Route gate as 5.B.7. No role check in the screen; every role can open and save. The target API allows every LP role (`lp.settings.view`); preferences are stored per user within the organisation. **[O]** / **[I]** |
| Prototype layer | `components/lp-portal/screens/lp-settings-screen.tsx` (371 lines), `useLpSettings`, mock layer `mock-api.ts` + `mock-store.ts` (seed: all switches on, digest weekly, MFA on, USD). **[O]** |
| Wiring status | Prototype for all elements. Target: `getSettings` → `GET /lp-portal/settings`; `updateNotificationSettings` → `PATCH /lp-portal/settings/notifications`; `updateDisplaySettings` → `PATCH /lp-portal/settings/display`; `getMfaSettings` → `GET /lp-portal/settings/mfa` (in the contract, not called by the screen). **[O]** |
| Entry points | Sidebar *Settings*; topbar user menu. **[O]** |
| Exit points | *Manage*, *Review*, *Change* open the URLs supplied by the settings response in a new tab. **[O]** |

##### Layout

1. Header: title *Settings*, subtitle "Notification preferences, security controls, and display defaults for your portal."; right: *Save Changes* button. **[O]**
2. Red error banner. **[O]**
3. Three summary cards: *MFA Status*, *Security*, *Email Digest*. **[O]**
4. Two-column grid (from `xl`): left card *Notification Preferences*; right column with card *Security* above card *Display Preferences*. **[O]**

##### Elements

| # | Element | Type | Content / behaviour | Data source (current → target) | Label |
|---|---|---|---|---|---|
| 1 | Title / subtitle | text | As in Layout 1. | Static | [O] |
| 2 | *Save Changes* | primary pill button (spinner while saving) | Saves all preferences at once. Disabled while loading or saving. | Prototype → two PATCH calls | [O] |
| 3 | Error banner | red text | Message of the failed settings load (default "Request failed"). | `getSettings` error | [O] |
| 4 | Card *MFA Status* | summary card (phone icon; green tint when enabled, grey otherwise) | Value "…" while loading, "Enabled" or "Not enabled"; helper = MFA issuer name, or "Authenticator app" when absent. | `getSettings.mfa` → `GET /lp-portal/settings` | [O] |
| 5 | Card *Security* | summary card (shield icon, blue) | Value "MFA required" when the organisation policy `requireMfaForLp` is on, otherwise "Standard"; helper "Session + entitlement checks". | `getSettings.mfa.requireMfaForLp` | [O] |
| 6 | Card *Email Digest* | summary card (mail icon, violet) | Value from the current (possibly unsaved) selection: *Daily* for `daily`, *Weekly* for `weekly`, otherwise *Off*; helper "Capital & document alerts". | local state | [O] |
| 7 | Notification table | table with header *Alert Type*, *Email*, *In-App* | Four rows of switches (see Tables). | `getSettings.notifications` | [O] |
| 8 | Digest select | select (max 220 px pill) under label *Email digest cadence* | Options *Daily summary* (`daily`), *Weekly summary* (`weekly`), *Off* (`off`). Not disabled while loading. | `notifications.digest` | [O] |
| 9 | Security row *Multi-factor authentication* | row with button *Manage* | Sub-text "Enabled · {date}" (date from `enabledAt` in the browser locale, omitted when absent) or "Not enabled for this account". *Manage* is disabled when no manage URL is supplied; otherwise opens it in a new tab (`noopener,noreferrer`). | `mfa.manageUrl` | [O] |
| 10 | Security row *Active sessions* | row with button *Review* | Sub-text "Managed by platform auth". *Review* disabled without a sessions URL; otherwise opens it in a new tab. | `mfa.sessionsUrl` | [O] |
| 11 | Security row *Password* | row with button *Change* | Sub-text "Change via account settings". *Change* disabled without a password URL; otherwise opens it in a new tab. | `mfa.passwordUrl` | [O] |
| 12 | *Display currency* | select | See Inputs. Hint with globe icon "Presentation currency for portal amounts and reports." | `presentationCurrency` | [O] |
| 13 | *Default as-of preference* | select | See Inputs. | `defaultAsOfPreference` | [O] |

##### Tables

**Notification preferences table**

| Column | Format | Sortable | Notes |
|---|---|---|---|
| Alert Type | bold text | No | *Capital calls & distributions*, *Documents published*, *Notices & acknowledgements*, *Requests & messages*. |
| Email | switch, `aria-label` "{row} email" | No | Checked when every underlying key is on. |
| In-App | switch, `aria-label` "{row} in-app" | No | Checked when every underlying key is on (a missing in-app value counts as on). |

- Row → stored keys: *Capital calls & distributions* = `emailCapitalCalls` + `emailDistributions` and `inAppCapitalCalls` + `inAppDistributions`; *Documents published* = `emailDocuments` / `inAppDocuments`; *Notices & acknowledgements* = `emailNotices` / `inAppNotices`; *Requests & messages* = `emailMessages` / `inAppMessages`. **[O]**
- Switch behaviour: toggling sets every key of the row to the opposite of "all keys currently on"; if the two keys of the first row differ, one toggle turns both on. Switches are disabled while loading. Nothing is sent until *Save Changes*. **[O]**
- No sorting, filtering or pagination. **[O]**

##### Inputs & validation

| Field | Control | Required | Options / default / placeholder | Validation today (code) | Target validation | Error message |
|---|---|---|---|---|---|---|
| Email digest cadence | select | Yes (always has a value) | *Daily summary*, *Weekly summary*, *Off*; default `daily` until the settings load, then the stored value (mock seed `weekly`; real default `WEEKLY`) | None | One of `daily`, `weekly`, `off` (case normalised); persisted | — |
| Notification switches (8 shown, 10 stored) | switch | — | All on by default | None | Booleans only | — |
| Display currency | select | Yes | *USD* (default), *EUR*, *GBP*, *ZAR*; disabled while loading; a stored value outside the four (for example ZWG) shows an empty selection | None | One of the currencies Nexus can present (Q-NEW) | — |
| Default as-of preference | select | Yes | *Latest FINAL valuation* (default), *Latest available (incl. provisional)*, *Prior month-end FINAL*; disabled while loading | None | One of three codes (below) | — |

##### Actions

| Control | Enabled when | Permission | Effect (state change, toast text, navigation) | Wiring / API | Label |
|---|---|---|---|---|---|
| Notification switch | Settings not loading | None | Changes local state only. | Client | [O] |
| Digest select | Always | None | Changes local state only (the *Email Digest* card updates at once). | Client | [O] |
| Display currency / as-of selects | Settings not loading | None | Change local state only. | Client | [O] |
| *Manage* / *Review* / *Change* | The corresponding URL is present | None | Opens the URL in a new tab with `noopener,noreferrer`. | Prototype URLs: `/account/security/mfa`, `/account/security/sessions`, `/account/security/password` (none exists as a page in this app) | [O] |
| *Save Changes* | Not loading and not saving | None | Sends both groups in parallel; success: toast "Settings saved." and the settings are reloaded; failure: toast with the server message or "Failed to save settings" and local values remain unsaved. There is no dirty-state indicator, no *Cancel* or revert, and no leave-page warning. | Prototype → `PATCH /lp-portal/settings/notifications` with the ten switches and `digest`, and `PATCH /lp-portal/settings/display` with `presentationCurrency` and `defaultAsOfPreference` | [O] |

##### Modals & drawers

None. **[O]**

##### States

- Empty: not applicable; defaults are all-on switches, digest *Daily*, currency *USD*, as-of *Latest FINAL valuation*. **[O]**
- Loading: *MFA Status* value "…"; switches and the two display selects disabled; *Save Changes* disabled; the digest select stays enabled. **[O]**
- Error: red banner; toast on save failure. **[O]**
- Disabled / read-only: as above; *Manage*, *Review*, *Change* disabled when their URL is missing. **[O]**
- Conditional: *MFA Status* tint and text follow `enabled`; *Security* follows `requireMfaForLp`; the MFA row text includes the enrolment date only when `enabledAt` exists. **[O]**

##### Business rules & calculations

- **As-of preference mapping [O]:** stored → shown: `LATEST_ANY` → *Latest available (incl. provisional)*; `PRIOR_MONTH_END` → *Prior month-end FINAL*; every other value (`LATEST`, `LATEST_FINAL`, empty) → *Latest FINAL valuation*. Shown → sent: *Latest available (incl. provisional)* → `LATEST_ANY`; *Prior month-end FINAL* → `PRIOR_MONTH_END`; *Latest FINAL valuation* → `LATEST`. The prototype seed stores `LATEST_FINAL`; the real default is `LATEST`.
- **Persistence [I]:** preferences are stored per (organisation, user) with defaults: all ten switches on; digest `WEEKLY`; currency `USD`; as-of `LATEST`. A first save creates the row and later saves update it (upsert). Only boolean switch values are accepted; text values (digest, currency, as-of) are stored as given without validation; the digest field of the real service is named `emailDigest`.
- **Effect of preferences [I]:** switches decide whether the corresponding alert types are e-mailed or shown in the portal notification feed; the digest controls the summary e-mail cadence; presentation currency is the currency in which the portal shows amounts; the as-of preference decides the valuation date the portal opens on (*FINAL* only, any incl. provisional, or the prior month-end FINAL). In the prototype and in the real service none of these preferences is applied anywhere: the session reports `USD` regardless of the saved value and the as-of date comes from the funds' latest valuation date.
- **MFA [I]:** the organisation policy `requireMfaForLp` (default off, one row, changed only by a system administrator) and the issuer name are shown read-only. A user's MFA is on when a TOTP factor has been confirmed (enabled date). When the policy is on, a user with no confirmed factor cannot submit a bank instruction change. The real service returns MFA actions as `manageUrls` `{enroll: "/api/auth/mfa/enroll", confirmEnrollment: "/api/auth/mfa/confirm-enrollment", changePassword: "/api/auth/change-password"}`, which are API endpoints and not pages; the screen expects flat `manageUrl`, `sessionsUrl`, `passwordUrl` page addresses. TOTP uses a 30-second code with one step of tolerance and 8 single-use backup codes.
- **Mock side effect [O]:** the mock display update also changes the session currency in the store, but the portal context is not reloaded, so other screens change only after a full reload.
- **Scope [O]:** no fund, as-of or operating-model dependence; no role dependence.

##### Edge cases

- Saving sends both requests in parallel; one may succeed while the other fails, leaving the stored state half-updated and the screen not reloaded. For a first-time save the two parallel upserts target the same row. **[O]** / **[I]**
- The *Email Digest* card shows the unsaved choice, while the *MFA Status* and *Security* cards show saved data. **[O]**
- A stored digest in another case or spelling (for example `WEEKLY`) matches no option: the select appears empty and the card shows *Off*. **[O]**
- A stored currency outside USD, EUR, GBP, ZAR leaves the currency select empty. **[O]**
- The MFA enrolment date is rendered with the browser locale (`toLocaleDateString`), unlike other dates in the portal. **[O]**
- The digest select is the only preference control that stays enabled while the settings load; changing it before the load completes is overwritten when the data arrives. **[O]**

##### Gaps, defects & open questions

- **DEF-445** field names differ between the screen and the real service (`digest` vs `emailDigest`, `manageUrl`/`sessionsUrl`/`passwordUrl` vs `manageUrls.{enroll, confirmEnrollment, changePassword}`), so the digest is never saved and the three security buttons stay disabled against the real service. FR-LP-101: align the contract — `GET /lp-portal/settings` returns `notifications.digest` as `daily`, `weekly` or `off` and an `mfa` object with `manageUrl`, `sessionsUrl`, `passwordUrl` pointing at portal pages — AC: saving digest *Off* and reloading shows *Off*; the three buttons are enabled.
- **DEF-446** the three seeded security URLs (`/account/security/*`) do not exist. FR-LP-102: provide pages (or an in-portal drawer) for MFA enrolment (QR code, code confirmation, backup codes), active sessions with *Sign out other devices* (FR-AUTH-017) and password change — AC: *Manage* opens MFA enrolment and a confirmed factor flips *MFA Status* to *Enabled*.
- **DEF-447** *Display currency* and *Default as-of preference* are stored but not applied; the session always reports USD and ignores the as-of preference. FR-LP-103: the session returns the saved presentation currency and default as-of date, the portal context reloads after saving, and amounts and the as-of date follow the preference — AC: choosing ZAR and saving shows ZAR amounts on the dashboard without a manual reload.
- **DEF-448** no dirty indicator, no revert and no unsaved-changes guard. FR-LP-104: *Save Changes* is enabled only when something changed, with a *Discard* action and a leave-page warning — AC: with no edits *Save Changes* is disabled.
- **DEF-449** both save requests are separate and can partially fail. FR-LP-105: save as one atomic request or report which part failed — AC: a failed display save shows "Display preferences not saved" while notification changes remain saved.
- **DEF-450** the as-of vocabularies differ (`LATEST_FINAL` in the mock, `LATEST` in the real default and design). BR-136: valid codes are `LATEST`, `LATEST_ANY`, `PRIOR_MONTH_END`; `LATEST_FINAL` is read as `LATEST`.
- **DEF-451** the display-currency list (USD, EUR, GBP, ZAR) differs from the currencies Nexus presents elsewhere (USD, ZAR, ZWG). Q-148: which presentation currencies are offered — default: USD, ZAR, ZWG (the currencies with a published rate in the valuation snapshot), restricted to currencies for which an FX rate exists.
- **DEF-452** the in-app switches and the *Capital calls & distributions* row control two keys with one switch; a mixed state cannot be shown. Q-149: should capital calls and distributions have separate rows — default: keep merged, and show the switch as on only when both are on (as implemented).
- Q-150: are notification preferences per user or per organisation — default: per user (as in the service).
- Q-151: does the portal enforce MFA for Signatories and Managers (design: "MFA is mandatory for signatories, administrators and bank-detail changes") — default: yes; when `requireMfaForLp` is on, a user without a confirmed factor is taken to MFA enrolment at sign-in (FR-AUTH-010), whereas the current service only checks at bank-change submission.
- Q-152: which notification categories exist in the Nexus notification table (`notification_preferences` exists but is not read or written) — default: use it with `channel` ∈ {email, in_app} and the four alert types plus digest.
