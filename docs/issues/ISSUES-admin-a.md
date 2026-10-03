# Admin console QA issues (ADA) - tester A

Environment: local stack (docs/LOCAL-STACK.md), Next dev servers. No code was changed. Passwords are not recorded here.

### ISS-ADA-001 [severity: major] No seeded persona can approve the seeded order or route/fill any order (lifecycle untestable)
- Where: Orders (/ops/orders, /ops/orders/ORD-001001), personas in secrets/uat-users.json
- Steps: Log in as each admin persona via the API; list `orders.*` permissions; call POST /api/v1/orders/<id>/approve on ORD-001001 (status Awaiting Approval) as investment_director.
- Expected: A second approver persona exists so that the maker-checker flow (create -> approve -> route -> fill -> settle) can be exercised end to end.
- Actual: Only `investment_director` holds `orders.approve`, and it is also the maker of every seeded order, so approval returns 403. No persona holds `orders.route` (roles `dealer` and `portfolio_manager` exist in the role catalog but have no UAT user), so routing/fills cannot be done from the UI by any persona.
- Evidence: `403 {"error":{"code":"segregation_of_duties","message":"A different person must approve this (segregation of duties)"}}`. local_admin/sysadmin have only `orders.view`.

### ISS-ADA-002 [severity: major] "local_admin" (documented as the system admin for testing) is view-only on nearly all operations; no New order / NAV / posting rights
- Where: docs/LOCAL-STACK.md persona list; Orders, NAV, Accounting, Cash
- Steps: Log in as local_admin; read /api/auth/me permissions (31 perms).
- Expected: Persona documented as able to run ops flows (or doc states it is read-only/SoD).
- Actual: system_admin has no orders.create/approve, nav.*, accounting.post/close, cash.journal.*, recon.* permissions. "New order" button is hidden on /ops/orders. Today shows "Your role has no approval queues." This is plausible SoD design but the test plan/doc implies full admin.
- Evidence: permissions include only *.view plus admin.rbac, admin.settings, risk.manage, corporate_actions.manage, esign.*, data.manage.

### ISS-ADA-003 [severity: minor] Step-up (TOTP) is silently skipped for every UAT persona (no MFA factor), so approval step-up UI cannot be exercised
- Where: requireStepUp on orders approve/route, NAV release, etc.
- Steps: Call an approve endpoint as any persona.
- Expected: step-up dialog or documented bypass.
- Actual: With no enrolled factor and policy mfa_required off, the middleware calls next(); no step-up code path runs. NAV "release with step-up" cannot be verified locally.
- Evidence: backend/api/src/middleware/requireAuth.ts requireStepUp returns next() when no verified factor.

### ISS-ADA-004 [severity: major] Shared browser session: signing in as a persona in one tab is overwritten by other testers (single cookie jar on localhost)
- Where: http://localhost:48221 login/session
- Steps: Sign in as local_admin in own tab; later call /api/auth/me.
- Expected: Session stays local_admin.
- Actual: /api/auth/me returned "UAT System Administrator" (sysadmin@uat...) after another tester signed in. Env limitation (cookie is per host, not per tab) that makes persona-gating tests unreliable in the shared pane. Using http://127.0.0.1:48221 to get a separate jar renders a blank login page (Next dev HMR websocket blocked: `WebSocket connection to 'ws://127.0.0.1:48221/_next/hmr' failed`, no hydration), contradicting the doc note that both hosts work.
- Evidence: console error above; /api/auth/me payload.

### ISS-ADA-005 [severity: minor] Hard navigation to any /ops page sits on "LOADING OPERATIONS CONSOLE" for 10-25 s (dev compile + auth bootstrap)
- Where: all /ops/* on first hit, e.g. /ops/command, /ops/orders
- Steps: Load URL directly.
- Expected: Page within a few seconds.
- Actual: Splash screen text for 10-25 s, then the page; "Loading today's figures..." persists further. API calls themselves take 40-200 ms (measured), so the delay is client bootstrap/dev compile. Console shows two `401 (Unauthorized)` resource errors on every page load.
- Evidence: console `Failed to load resource: the server responded with a status of 401 (Unauthorized)` x2 per navigation while /api/auth/me then returns 200.

### ISS-ADA-006 [severity: minor] Today: "Orders working 2" counts Awaiting Approval, while Orders page shows Working 1 and Awaiting approval 1
- Where: /ops/command vs /ops/orders
- Expected: Consistent definition (Orders page: Working = approved/routing/partly filled).
- Actual: Today tile "ORDERS WORKING 2 - 1 approved, 1 awaitingapproval" (also missing space "awaitingapproval" in page text).
- Evidence: visible text.

### ISS-ADA-007 [severity: major] Risk limit breaches not surfaced: Today says RISK BREACHES 0 while scenario output shows limit LIM-1001 exceeded (and mandate limits disagree)
- Where: /ops/command (Scenarios) vs /ops/portfolios/PF-1005
- Steps: Open Today; read scenarios table; open Portfolios.
- Expected: One consistent limit set; Today breach count reflects current limit status.
- Actual: PF-1005 Liquidity Plus: scenario says "LIM-1001 SINGLE_NAME_PCT would be 75.3217% against a limit of 15.0000%" and PF-1003 34.0013% vs 15%, yet portfolio list shows "75.3% of 80% limit" and "34.0% of 40% limit" (Within) and Risk breaches 0. Also all three scenarios show result "Escalate" for the liquidity stress on every portfolio with "LOSS 0.0000%".
- Evidence: visible text on /ops/command.

### ISS-ADA-008 [severity: minor] Market prices are 27 days stale (26 Aug 2026) so portfolio valuations/performance on 03 Oct use stale prices without warning; Today performance window ends 2026-08-26
- Where: /ops/portfolios/PF-1001, /ops/securities, /ops/command
- Expected: Stale-price warning on valuation surfaces (feed panel flags Stale 27d).
- Actual: Portfolio header "valued 2026-10-03" with each position priced 2026-08-26 and no stale flag; Today's performance period "2026-06-02 to 2026-08-26". Market-data panel shows ZSE_AFX/ER_API "Never" fetched, "No refresh has run yet".
- Evidence: Price freshness table "Stale 27d", FX rates are seeded daily to 02 Oct while prices are not.

### ISS-ADA-009 [severity: minor] Risk: breaches only appear after a manual "Run monitor"; Today/Portfolios show "Within" and 0 breaches until then
- Where: /ops/risk (Breaches), /ops/command, /ops/portfolios/<id> mandate limits
- Steps: Open Breaches (empty, "No breaches recorded"); click Run monitor.
- Expected: Seeded active firm limit LIM-1001 (15% single name) breaches visible without manual action, or the scheduler status shown.
- Actual: Before the run Today showed RISK BREACHES 0 while PF-1003/1004/1005/1006 exceeded the 15% firm limit; the run then opened 4 breaches/cases (RC-1002..RC-1005; PF-1005 at 75.32% is a T-bill, severity critical). Portfolio page mandate-limit table still reads "Within" (it only shows the mandate limit, not the firm limit).
- Evidence: "Monitor run for 2026-10-03: 6 limit checks across 6 portfolios. 4 new breach(es)..."

### ISS-ADA-010 [severity: minor] Form validation errors are generic ("Validation failed") with no field/rule detail
- Where: NAV run create modal (invalid accruals "abc"), NAV Edit inputs (negative fees), exception Resolve modal (rationale "ok")
- Steps: Submit invalid values.
- Expected: Field-level message (e.g. "Rationale must be 5+ characters").
- Actual: Red banner "Validation failed" only; empty portfolio submit gave no visible message in the modal body I could read.
- Evidence: modal text ends with "Validation failed".

### ISS-ADA-011 [severity: major] NAV maker-review returned HTTP 500 after the DB write committed; UI stayed on stale "Draft" state
- Where: /ops/nav/<id> "Maker review" button; POST /api/v1/nav/runs/:id/maker-review
- Steps: Resolve all exceptions, Edit inputs, click Maker review.
- Expected: Status becomes Maker reviewed, or a clean failure with no state change.
- Actual: Button showed "Internal server error"; the run was already MAKER_REVIEWED (second click returned "NAV-00001 is MAKER_REVIEWED; it must be DRAFT or EXCEPTIONS_OPEN for maker review") while the header still read "Draft" because the page does not reload after an error. API log: Prisma P1001 "Can't reach database server at 127.0.0.1:3306" in respond()/audit step (nav.service.ts:492). Possibly a transient DB drop under load from parallel testers, but the handler lets the response phase fail after commit and the UI does not refetch on error.
- Evidence: `POST .../maker-review -> 500 Internal Server Error`; api.log P1001.

### ISS-ADA-012 [severity: minor] NAV market value differs by 0.01 from the Portfolio page (rounding of FX 0.0769230769)
- Where: /ops/portfolios/PF-1001 vs /ops/nav/<NAV-00001>
- Expected: Same valuation figure.
- Actual: Portfolio page: securities USD 19,801,207.69, market value 21,635,767.69. NAV bridge: 19,801,207.68 and NAV 21,635,767.68 (Today scenarios also show 21,635,767.68).
- Evidence: visible figures.

### ISS-ADA-013 [severity: polish] Stale-price age reported inconsistently: "Stale 27d" (Securities) vs "38 days old (limit 3)" (NAV)
- Where: /ops/securities freshness table vs /ops/nav/<id> exceptions
- Expected: One unit (calendar vs business days) and label.
- Actual: Same 26 Aug 2026 price is 27d on one page and 38 days on the other.

### ISS-ADA-014 [severity: polish] Money actions (NAV maker review / release) use native window.confirm; buttons silently do nothing in automation/when confirm is suppressed
- Where: /ops/nav/<id> ActionButton confirm
- Expected: In-app confirmation dialog consistent with other modals.
- Actual: Click with confirm auto-dismissed produces no request and no feedback.
- Evidence: no network call until window.confirm overridden.

### ISS-ADA-015 [severity: blocker] Cash & Ledgers: Reservations, Expected cash, Statement imports and Period close tabs crash the whole page
- Where: http://localhost:48221/ops/cash (tabs Reservations, Expected cash, Statement imports, Period close)
- Steps: Open /ops/cash, wait for Balances, click any of those four tabs (reproduced on a fresh load with one click each, as sysadmin).
- Expected: Tab content (list or empty state "No reservations.").
- Actual: Next.js runtime error overlay / "This page couldn't load - Reload / Back". The API calls return 200 with correct shape (e.g. `{"data":[],"total":0,"summary":{...}}`), but the client `api.get()` unwraps the `data` key (ops/api.ts unwrap) while these tabs read `r.data.length`, so `r.data` is undefined. Cash ledger and Balances tabs work.
- Evidence: console `Uncaught TypeError: Cannot read properties of undefined (reading 'length')` at Loaded/children; overlay source `src/app/(ops)/ops/cash/page.tsx (421:20)` `r.data.length === 0`. Same `useResource<{data:...}>(() => api.get<{data:...}>(...))` pattern at cash/page.tsx lines 103, 387, 600, 768, 908 and ops/CashJournalForm.tsx:47 (the New cash journal ledger picker is likely affected; not exercised as sysadmin lacks the permission).

### ISS-ADA-016 [severity: minor] NAV release auto-creates only a 4-account chart (1200, 2000, 4100, 5000) for PF-1001; no cash/equity accounts
- Where: /ops/accounting (New journal account picker for PF-1001), POST /accounting/accounts/default-chart
- Steps: Release NAV-00001 for PF-1001, then open New journal for that entity.
- Expected: Full default chart (PF-1002 has 15 accounts: 1000..5200) or a prompt to install it.
- Actual: Only the four accounts the NAV journal needed exist, so manual journals touching cash/capital cannot be entered until the default chart is separately installed. Other portfolios (PF-1003..1006) have no chart at all.
- Evidence: account picker lists "1200, 2000, 4100, 5000" only.

### ISS-ADA-017 [severity: minor] Seeded cash journals CJ-00001..06 have the same person as maker and checker (SoD violation in seed data) and seeded order fills do not move posted cash
- Where: /ops/cash Cash ledger tab; Balances
- Expected: Maker != checker; fills reflected as cash movements.
- Actual: "UAT System Administrator / UAT System Administrator" on all six opening-balance journals; PF-1006 cash is still exactly the 7,300,000 opening balance although ORD-001003/6/7 are Filled.
- Evidence: visible Maker / Checker column.

### ISS-ADA-018 [severity: polish] Journal posted when no accounting period exists for the entry date; Accounting "Periods" shows only USD Equity Fund
- Where: /ops/accounting
- Actual: JNL-00001 was posted (periodId null, "No period opened for this date") with no warning; periods exist only for PF-1002. Opening 2026-10 for PF-1001 afterward correctly lists blockers (unposted journal JNL-00003, NAV for 2026-10-31 not released), so close controls work; trial balance, balanced-entry guard (Save draft disabled when out of balance), SoD on posting (accounting.post required) and reversal (JNL-00002 auto-posted, JNL-00001 -> Reversed) all behaved correctly.

### ISS-ADA-019 [severity: major] Prices of source VENDOR dated 2026-10-03 appeared with wild moves (e.g. DLTA.ZW 31.94 -> 1.8964 = -94.06%, T-BILL-91D 1.00 -> 49.04, ZIM.VX 2.29 -> 17.66) with no exception, no refresh run record and no provenance
- Where: /ops/securities (Price freshness, Market data feed), GET /api/v1/securities, /api/v1/market-data/status
- Steps: Re-read securities after ~1 hour of testing (another tester may have triggered the fake provider refresh); `changePct` for DLTA.ZW = -94.0627; market-data status shows `runs: []`, `exceptions: []`, `provenance: null` for these VENDOR prices.
- Expected: Fake/real feed values beyond the tolerance (NAV uses 10% move) are rejected or raised as exceptions; every accepted VENDOR price has a refresh run and provenance row; "Recent refreshes" reflects the run.
- Actual: Prices accepted silently; panel says "No refresh has run yet" and "No open exceptions" while all 13 prices are now VENDOR 2026-10-03. Pre-trade checks and portfolio valuation now use them (ZIM.VX 1,000 sh BUY notional 17,661.65; mandate weight 22.8%).
- Evidence: API `latestPrice {price:"1.896374",source:"VENDOR"}`, `previousPrice {price:"31.940000",source:"SEED"}`.

### ISS-ADA-020 [severity: minor] Orders: validation gaps and unfriendly messages
- Where: POST /api/v1/orders, /submit; /ops/orders/new
- Steps (as investment_director via API): create BUY ZIM.VX quantity 999,999,999; create with quantity not a board-lot multiple; submit with no rationale.
- Expected: Early rejection for absurd size; lot-size rule reported at create or clearly at pre-check; submit error names the field in plain words.
- Actual: Both drafts (ORD-001008/9) are accepted at create (201) and only flagged on validate (mandate/cash/concentration/liquidity Fail, "Post-trade weight 19011.34%", "125000.00% of average daily volume"). The liquidity check printed "Board lot 1 respected" for the 150-share ZIM.VX order (lot rule is only evaluated at pre-check). Submit without rationale returns `Invalid input: expected string, received undefined` (zod text). Blocked pre-check correctly prevents submit (`precheck_required`), negative quantity and LIMIT without price are rejected with clear text, and a draft cannot be approved (`invalid_transition`).
- Evidence: responses above.

### ISS-ADA-021 [severity: major] Capital calls list "PAID" column and Funds "COMMITTED" column are blank because the UI reads fields the API does not send
- Where: /ops/capital-calls, /ops/funds
- Steps: Open both lists.
- Expected: Paid amounts (e.g. CC-AGFI-012 Paid: USD 300,000.00) and fund commitments (Growth Fund I: 6,000,000.00).
- Actual: PAID shows "-" for every call including fully Paid calls; COMMITTED shows "-" for both funds. API returns `paid` ("300000.00") and `totalCommitment` ("6000000.00"); the pages read `amountPaid` and `totalCommitted` (capital-calls/page.tsx:99, funds/page.tsx:66). VINTAGE is also "-" for both funds (vintage null in data).
- Evidence: GET /api/v1/ops/capital-calls -> `"paid":"300000.00"`; list text "USD 300,000.00 | - | Paid".

### ISS-ADA-022 [severity: major] Capital call detail, LP notices and payments show raw UUIDs and blanks instead of names
- Where: /ops/capital-calls/<id>; /ops/notices (list + detail)
- Steps: Create/issue a call (CC-00001) and record a payment; open detail; open /ops/notices.
- Expected: Names for preparer/approver/LP, allocation method, commitment and unfunded-before, "Recorded by".
- Actual: Call detail: PREPARED BY and APPROVED BY show user ids (3ea805a4-..., ed0e9e33-...); ALLOCATION "-"; allocations table COMMITMENT and UNFUNDED BEFORE "-"; Payments table LP column empty and RECORDED BY "-". Notices list/detail: AUDIENCE "LP: 493bef52-2742-4209-b8c6-5d8bb28b127e", PREPARED BY f42bbc15-... (raw id).
- Evidence: visible text.

### ISS-ADA-023 [severity: minor] Reference numbering inconsistent: new call ref CC-00001 / notices "CC-014" vs seeded CC-AGFI-013; seeded call number sequence not continued in ref
- Where: /ops/capital-calls, /ops/notices
- Actual: Created call is `CC-00001` (call no. 14) while seeded calls are `CC-AGFI-010..013`; auto notice titles say "CC-014 capital call issued".
- Verified OK: create validation (due before call date, negative amount, call exceeding unfunded commitments "Horizon Pension Fund LP: 83333333.33 exceeds the unfunded commitment of 3700000.00"), pro-rata allocation (16,666.67 / 83,333.33), approve needs capital.approve (maker 403), issue, overpayment rejected, partial payment -> Partially Paid.

### ISS-ADA-024 [severity: major] Seeded in-flight records are owned by the only persona that could progress them (term sheet, custodian day-end), so these flows are blocked for UAT users
- Where: /ops/term-sheets (TS-103-01 Draft), /ops/custodian (DAY-DEMO1 Received), plus ISS-ADA-001 for orders
- Steps: TS-103-01: author is investment_director, who lacks `term_sheets.create`, so Submit returns 403 permission_denied ("Only the term sheet author can submit it for approval" for analyst); director approve would hit SoD. DAY-DEMO1: submitted by the custodian_approver persona, approving as custodian_approver returns 403 "The submitter of a day-end package cannot approve it"; custodian_submitter has no approve permission; admin review needs status Approved.
- Expected: Seed data authored by a neutral/system user so each UAT persona can complete the maker-checker step they own.
- Actual: Both seeded records are stuck; only freshly created records move (new term sheet TS-1001: analyst create -> submit -> compliance approve -> analyst issue worked; analyst self-approve 403).
- Evidence: error bodies above.

### ISS-ADA-025 [severity: minor] Unknown/unbuilt /api/v1/ops/* routes return HTTP 501 with a server stack trace and absolute file paths in the JSON body
- Where: GET /api/v1/ops/dealing (also /ops/custodian/day-end)
- Steps: Call a non-existing ops path as any staff user.
- Expected: 404 with a short message; no stack in client responses.
- Actual: `{"error":{"code":"not_implemented","message":"This operations endpoint is not available yet","details":{"stack":"HttpError: ... at C:\Users\lysp\Downloads\matanho-nexus-v56-deployment\backend\api\src\modules\ops\ops.routes.ts:36:9 ..."}}}`
- Evidence: response body (information disclosure, fine in dev only if gated by NODE_ENV).

### ISS-ADA-026 [severity: minor] Reporting packs: default filter "submitted" hides newly opened periods and overdue packs are not flagged
- Where: /ops/reporting
- Steps: Open period for PC-101 2026-09 (due 2026-10-15). Dialog closes with no confirmation; list still says "No reporting packs match this status."
- Expected: Confirmation/toast or list switches to the new item; overdue packs (PC-101 2026-06 due 2026-08-12, PC-100 2026-08 due 2026-09-05, PC-102 2026-06) marked overdue.
- Actual: Need to switch Status to "open" to see them; no overdue marker. Period labels inconsistent ("Sept 2026" vs "Aug 2026", "Apr - Jun 2026" for period key 2026-06).

### ISS-ADA-027 [severity: minor] Custodian day-end trade counts disagree across screens: package DAY-DEMO1 shows 2 trades, Reconciliation source health shows 3 executions, API counts.executions 5
- Where: /ops/custodian, /ops/reconciliation (Overview > Source health), GET /api/v1/ops/custodian/submissions
- Also: Holdings MV ZWG 0.00 on the package while the Positions feed file for the same date has 7 rows, producing REC-00003 (Critical, -96,827,000 ZWG).

### ISS-ADA-028 [severity: minor] Sidebar is not permission-filtered: analyst (12 permissions) sees all 43 console links including RBAC & Controls, Audit Trail, Settings, Integrations
- Where: Shell sidebar (any /ops page) as analyst@uat
- Steps: Sign in as analyst; read sidebar links.
- Expected: Links hidden or de-emphasised for areas the role cannot open.
- Actual: Every link shown. Pages do degrade gracefully (Accounting: "Your role does not include valuation. Ask an administrator for the valuation.view permission."; Orders: "You do not have permission to view orders") but only after a 10 s+ "Loading orders..." state, and Accounting names the wrong permission (valuation.view instead of an accounting permission). API gating verified for 6 personas x 21 endpoints (admin users/roles 403 except sysadmin; orders/NAV/accounting/recon 403 for analyst and client_services; term sheets 403 for operations and client_services; reports catalogue 403 for operations).

### ISS-ADA-029 [severity: polish] "Back to the investment workspace" link (href "/") just redirects to /ops; overview greets "Welcome, UAT"
- Where: sidebar footer, /ops
- Actual: GET / -> 307 /ops (link goes nowhere new). Welcome text uses first word of the persona name ("UAT").

### ISS-ADA-030 [severity: polish] Reconciliations break drawer: field labels overlap (TRADE REF value overlapping PORTFOLIO label); Operations control says "8 open, 8 high" when breaks are 3 critical + 5 high
- Where: /ops/reconciliation > Breaks > REC-00001 drawer; /ops/operations "Open reconciliations"
- Evidence: screenshot of drawer; text "Open reconciliations - 8 open, 8 high, 0 awaiting checker".

### ISS-ADA-031 [severity: polish] Seed/demo dates and wording: corporate action ex/record dates fall on weekends (CA-00001 ex 10 Oct 2026 Saturday, CA-00003 ex 17 Oct Saturday); notes read "Demo event."; seeded settlement break says ORD-001007 "traded 2026-09-27" (a Sunday) while the order was created 03 Oct; all corporate-action record dates are in the future so Calculate entitlements/Process cannot be exercised today
- Where: /ops/corporate-actions, /ops/reconciliation (REC-00004)

## Verified working (no issue)
- Login invalid password error ("Invalid email or password"), sign out, session redirect to /login?next=.
- Risk: add limit draft -> submit -> maker Approve button disabled "Awaiting another approver", compliance approves via API (maker 403 `sod_violation`), monitor run opens 4 breaches + cases, acknowledge, scenario run (-20% equity on PF-1001 = 18.30% loss).
- NAV: create run, 11 stale-price exceptions with required rationale (5+ chars), edit inputs with correct bridge/NAV per unit math, maker review, release by compliance (sysadmin 403), release auto-created journal JNL-00001 (fee 1,500.50 + accrual 2,000.00).
- Accounting: balanced-entry guard, post (accounting.post), re-post 409, reverse with reason (5+), period open and close checklist with blockers.
- Recon: run all 7 families for 2026-10-02 (9 breaks), assign -> investigate -> resolve (validation 10+ chars) -> approve (self 403, compliance 200).
- Dealing: process with NAV, SoD approve (RDM-016 completed, units 16,186.77 = 250,000 / 15.4448), capital call lifecycle, term sheet new-record lifecycle (create -> submit -> compliance approve -> issue).

## Not tested / limitations
- Bank instructions (empty, no records to act on), Investee requests (empty; needs company portal submission), LP notices create/approve/publish (needs client_services session; list/detail only), Distributions create/issue/settle (list only), Operations control task create/complete (view only), Securities Set price / Refresh (no portfolio.manage in the active session), Orders new/approve/route/fill UI (blocked by ISS-ADA-001; API pre-check/validation covered), CASH New journal/reservation/import/close tabs (blocked by ISS-ADA-015), Today scenario tabs, Cases tab in Risk.
- Browser session is a shared cookie jar, so UI persona was whatever signed in last (sysadmin, investment_director, analyst); persona flows were driven through the API with separate cookies.

## Coverage table
| Page | Tested | Result |
|---|---|---|
| Overview (/ops) | yes | Renders; tiles match personas; "Welcome, UAT" |
| Today (/ops/command) | yes | Data real; stale perf window; Working count inconsistent (ADA-006/007) |
| Portfolios list + detail | yes | Filters work; 0.01 mismatch vs NAV (ADA-012) |
| Securities & prices + market data panel | partially | Renders; prices volatile/no provenance (ADA-019); no write actions for session |
| Orders | partially | List/filters OK; lifecycle blocked (ADA-001); API validations (ADA-020) |
| Risk | yes | Works; breaches need manual run (ADA-009) |
| NAV & valuation | yes | Works; 500 on maker review (ADA-011) |
| Accounting & Close | yes | Works; partial chart (ADA-016) |
| Cash & Ledgers | partially | Balances and Cash ledger OK; 4 tabs crash (ADA-015) |
| Corporate actions | partially | List/detail/confirm OK; calc/process blocked by dates |
| Reconciliations | yes | Works end to end via API; layout polish (ADA-030) |
| Operations control | partially | Renders live data; actions not exercised |
| Funds | yes | COMMITTED/VINTAGE blank (ADA-021) |
| Capital calls | yes | Lifecycle OK; list PAID blank, UUIDs in detail (ADA-021/022) |
| Distributions | partially | List only |
| LP notices | partially | List/detail; UUIDs (ADA-022) |
| Bank instructions | partially | Empty state only |
| Dealing queue | partially | List + API lifecycle OK |
| Term sheets | yes | Seeded sheet stuck (ADA-024); new flow OK |
| Investee requests | partially | Empty state only |
| Reporting packs | yes | Open period works; UX (ADA-026) |
| Custodian submissions | partially | List; seeded package stuck (ADA-024) |

## Counts by severity
- blocker: 1 (ADA-015)
- major: 9
- minor: 15
- polish: 6
- total: 31 (ISS-ADA-001 to ISS-ADA-031)
