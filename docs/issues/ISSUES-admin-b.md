# ISSUES - Admin console part B (prefix ADB)

Tester: QA agent, local stack, signed in as sysadmin. No fixes made.

### ISS-ADB-001 [severity: major] IBOR page refers to "Refresh IBOR" / "Reconcile positions" actions that do not exist in the UI
- Where: /ops/ibor and /ops/ibor/position (Reconciliation tab)
- Steps: open IBOR & Positions as sysadmin, look at Authoritative-data controls; open a position > Reconciliation tab.
- Expected: a Refresh IBOR button (book the 3 unbooked fills) and a Reconcile positions button.
- Actual: controls say "3 fill(s) not yet booked. Run Refresh IBOR." and "Run Reconcile positions on the IBOR page", but the only buttons on the page are tiles, tabs, search and per-row Open. The LAST REFRESH tile click does nothing. Header shows LAST REFRESH "never".
- Evidence: text "3 fill(s) not yet booked. Run Refresh IBOR." / "No holdings reconciliation has been run for this scope."

### ISS-ADB-002 [severity: minor] IBOR "Book state" tile reads like a pass but lists the failing checks
- Where: /ops/ibor header tile BOOK STATE
- Expected: state "Review" with the reason ("2 checks need attention").
- Actual: tile shows "Review / All fills ingested · Holdings reconciled to the custodian", which are the names of the two FAILED checks and read as positive statements. EXCEPTIONS tile shows 0 "0 material" at the same time.

### ISS-ADB-003 [severity: major] IBOR headline Market Value sums mixed currencies; unsettled/ladder amounts lack currency
- Where: /ops/ibor tiles and ledger
- Steps: view MARKET VALUE (302,546,823.06, "Base-currency equivalent") and the ledger BASE MV column.
- Expected: one base currency, every row converted.
- Actual: Balanced Growth, USD Equity etc. rows show BASE MV in USD (e.g. 2,805,806.15 USD for a ZWG 36,475,480 holding) but Pension Mandate 04 and Zimbabwe Opportunities rows show BASE MV in ZWG (e.g. 27,738,000.00 ZWG). The tile total adds USD and ZWG figures. UNSETTLED BUYS tile shows "102,000.00" with no currency while the ladder shows "ZWG -102,000"; AVAILABLE CASH likewise has no currency.
- Evidence: ledger rows "27,738,000.00 ZWG" under BASE MV for ECO.ZW / Pension Mandate 04.

### ISS-ADB-004 [severity: polish] Position detail breadcrumb shows raw lower-case "position"
- Where: /ops/ibor/position?portfolioId=...&securityId=... breadcrumb "Operations / Portfolio / IBOR & Positions / position". Full page reload of any /ops page also takes ~10 s on "LOADING OPERATIONS CONSOLE" (dev server).

### ISS-ADB-005 [severity: major] Official-return controls show all-green while their own evidence says unreconciled / unverified
- Where: /ops/performance/<period id> (Official-return controls)
- Steps: Performance & Attribution > Prepare official period (leave dates blank) > Prepare draft > open the period.
- Expected: "IBOR positions reconciled" and "Valuation sources approved" fail or warn.
- Actual: all five controls "all done" (green tick) although detail text says "No holdings reconciliation has been run for this scope." and "No released NAV run on the period end to compare." IBOR page simultaneously flags 3 fills not booked. A different person would be allowed to lock an official return on this evidence.
- Evidence: "Official-return controls: all done"

### ISS-ADB-006 [severity: minor] Performance data ends 26 Aug 2026 although today is 03 Oct 2026; blank period dates accepted silently
- Where: /ops/performance. All portfolios show period 02 Jun to 26 Aug; Prepare official period accepts blank start/end and creates draft PRF-1001 immediately (no confirmation). Platinum Preservation Fund benchmark shows "—" for benchmark/active.
- Maker-checker works: "You prepared this period, so a different person must lock it."

### ISS-ADB-007 [severity: major] Portfolio Construction has no UI to create/edit/approve models or to save a what-if as a proposal / create draft orders
- Where: /ops/portfolio-lab (Model portfolios, What-if rebalance, Saved proposals)
- Steps: as sysadmin open each tab; run what-if Balanced Growth Fund vs MDL-1001.
- Expected: New model, Edit, Approve (draft MDL-1002 says "awaiting a second approver"), Save proposal, Create draft orders (lede: "turned into draft orders only when you ask").
- Actual: none of these controls render (model detail drawer is read-only; what-if result has no Save button; Saved proposals empty: "No proposals saved. Run a what-if and save it."). Possibly gated by a missing permission, but no disabled button or explanation is shown.

### ISS-ADB-008 [severity: minor] What-if verdicts inconsistent
- Where: /ops/portfolio-lab What-if result (Balanced Growth Fund vs Balanced Core)
- Actual: MANDATE card says "Within / All whole-book checks pass" while 8 of 10 proposed trades show Fail (liquidity 31-122% ADV vs 25% limit, cash "only 0.00 is free" even though the same message says it is "Funded by the sale proceeds in this rebalance"). No overall warning. Draft model MDL-1002 totals 100.0100% (flagged in drawer, but list row shows no warning).

### ISS-ADB-009 [severity: minor] Private Markets "By client" tab empty although commitments exist
- Where: /ops/private-markets > By client
- Actual: "No client has an active private-market commitment through a portfolio." while Overview lists 4 commitments (15.16m) all through Balanced Growth Fund. Also Overview "Latest approved mark 03 Sept 2026" while pending mark is 01 Oct. Maker-checker on NAV mark works ("A different person with private.mark.approve must approve").

### ISS-ADB-010 [severity: major] Research case form: server validation errors not surfaced per field
- Where: /ops/research > New case
- Steps: fill form with thesis "qa" (and target price "abc", text field), Create draft.
- Expected: inline field message "State the thesis (20+ characters)", target price numeric validation client side.
- Actual: only a generic toast "Validation failed" (dismisses quickly, renders faintly behind the modal overlay); modal stays open. Detail was only in the API response (POST /api/v1/research/cases 400: path thesis "State the thesis (20+ characters)").
- Positive: valid create works (RSC-1004), Submit for review works, own-case publish blocked, IC vote works.

### ISS-ADB-011 [severity: polish] Research overview "Awaiting ratification 1" counts a decision with 0 votes
- Where: /ops/research tiles. ICD-1001 had 0 votes/no quorum ("Voting"), tile says "AWAITING RATIFICATION 1 - Voting open; a second person ratifies". Proposer can vote on own proposal (accepted).

### ISS-ADB-012 [severity: major] Permission-gated actions are silently absent (no disabled button, no explanation) for the System Administrator login
- Where: /ops/financing (margin call MC-0001 "Issued" drawer: no acknowledge/dispute/resolve/waive; no New facility / pool), /ops/portfolio-lab, /ops/onboarding (risk scoring table has no Edit), /ops/clients cash account "Pending Approval" (no Approve)
- Steps: sign in as sysadmin; open these drawers/rows.
- Expected: a visible but disabled control with the missing permission, or a hint, so staff know why. Task brief says to test as local_admin/sysadmin and the docs call local_admin the "system admin".
- Actual: drawers end after the read-only facts. sysadmin permissions (GET /api/auth/me) lack financing.*, private.mark.approve, research.ic.decide, onboarding.manage, etc. Users cannot tell whether the feature is missing or gated. (Not re-tested as local_admin.)

### ISS-ADB-013 [severity: major] Client 360 contradicts the client list (accounts, mandates, KYC cases)
- Where: /ops/clients, client Horizon Pension Fund LP (CL-00418)
- Steps: compare list row with the detail panel tabs.
- Expected: same counts.
- Actual: list shows 5 accounts and mandate "Balanced Growth · Private Markets"; detail shows "Cash accounts (0) - No cash accounts", "Mandates (0) - No mandates", "Portfolios: No portfolios linked", "KYC cases: No KYC cases" while KYC = Current, and tab label "Portfolios & commitments (2)" counts commitments only. "Documents (26)" in the tab versus 32 total in the vault (fine) but the vault register lists the same client's documents under two different numbering schemes (LP-DOC-1xx and DOC-0xx).
- Also: after creating a client the open 360 drawer stays on the previous client; new cash account for QA Test Client shows account holder "Matanho Managed Funds".

### ISS-ADB-014 [severity: minor] Generic "Validation failed" toasts across admin forms hide the field-level reason
- Where: Research New case, Reports > Email (invalid address), Reports > Generate (end before start), Clients > New client (invalid currency), Investor Services > Change status (also, status select option values are labels).
- Expected: message from API details (e.g. "State the thesis (20+ characters)").
- Actual: only "Validation failed"; reason visible only in the 400 body.

### ISS-ADB-015 [severity: minor] Investor Services SLA: "Waiting on you" requests counted as SLA breached; request types do not match SLA policy types
- Where: /ops/investor-services. 5 of 6 open cases "Breached", "AVG RESOLUTION 96d, 0% closed within SLA". Requests types shown (Account / Statement, Capital Activity, Tax / Reporting) have no matching row in the SLA policy table (Query, Statement request, Transfer ...), so the "All other types" fallback applies. Seed ages are 2-3 months so the page is mostly red.

### ISS-ADB-016 [severity: minor] Document vault small issues
- Where: /ops/vault
- (a) Upload form does not default the Name field from the chosen file. (b) Version size shows "1 KB" for a 22-byte file. (c) The Approve button is enabled on a document the same user submitted; clicking it only then shows "Maker-checker: a different person must approve this document" (enforcement is correct). (d) Pending change DOC-081 reason text ends "(demo)". (e) Valuation evidence tab: approved marks PMM-00003/00004 show "No file" with an Attach file link although marks "need evidence".
- Works: upload, SHA-256 recorded, download (valid response), submit for review.

### ISS-ADB-017 [severity: polish] Reports & BI scheduling/format
- Where: /ops/reports > Schedules: Next run uses ISO date ("2026-10-04") while other dates use "3 Oct 2026, 14:58"; after "Run now" the Next run is unchanged. PDF generation works (valid %PDF, 8.7 KB) and "Email" works for a valid address.

### ISS-ADB-018 [severity: minor] Regulatory filing: stale red hint after populate/evidence
- Where: /ops/regulatory > REG-00002 drawer
- Steps: Rebuild from live data (native browser confirm()), Attach evidence, observe.
- Actual: red text "Populate the figures before sending for review" stays next to Send for review after figures were populated and evidence attached until the button is clicked. Confirmation uses a native window.confirm rather than the app modal. Flow then works (Send for review OK, payload hash set). Overdue annual filing REG-00004 shows tone "Overdue / Draft" fine.

### ISS-ADB-019 [severity: minor] Data Fabric: 25 quality rules never run, raw JSON in check column, seeded data gaps
- Where: /ops/data
- Actual: Overview "Rules passing 0 / 25, Never run 25" until "Run all rules" is pressed; Quality rules table prints raw JSON ({"op":"eq","other":"total_credit"}) in the CHECK column. After Run all: 20/25 pass, 17 open exceptions, 12 securities "Missing isin". Security prices newest record 26 Aug 2026, positions/cash as of 26 Aug 2026 (stale vs 03 Oct).

### ISS-ADB-020 [severity: major] Shipped roles violate the platform's own separation-of-duties catalogue (25 SoD warnings)
- Where: /ops/rbac > Segregation of duties; /ops/security
- Actual: control scan lists 25 warnings on the out-of-the-box roles, e.g. Compliance Officer combines financing.manage+approve, reports.create+approve, reports.approve+submit, risk.manage+model.approve; Dealer combines orders.create+route; System Administrator combines admin.rbac+admin.settings; all 7 staff have no MFA. Security page claims "27 permission pairs" while listing 25 rules. Staff access "LAST SIGN-IN" shows time only ("14:46", no date).

### ISS-ADB-021 [severity: polish] Settings page copy and raw values
- Where: /ops/settings. Footer says "Settings marked recorded ..." but no setting is marked "recorded". Critical alert channel shows raw "in_app_email". Security settings flagged "Step-Up" changed (idle timeout 30 to 45, reverted by tester) without any authenticator prompt because MFA is not enrolled/mandatory (consistent with policy text, but the page lede says security settings "need a fresh authenticator code"). Numbering, change history, flags tabs work.

### ISS-ADB-022 [severity: polish] Integrations screen
- Where: /ops/integrations. Simulated feed result is shown as raw JSON in a toast ("Simulate market data feed: {"date":"2026-10-03","pricesCreated":13,...}"). "Failure simulation: 0 means every call fails until cleared" is one click from an unrecoverable-looking state (not exercised). NOTE for other testers: running the market-data feed created 13 VENDOR prices + 1 FX rate dated 03 Oct 2026, so valuations changed during testing. Test call, Details, Call log and Simulated inbox work.

### ISS-ADB-023 [severity: polish] Model ID clash
- MDL-1001/MDL-1002 are used both by Portfolio Construction models (Balanced Core, Resources Tilt) and Model Governance models (NAV pricing, Concentration limit monitor); same prefix, different registers.

### ISS-ADB-024 [severity: major] Simulated market-data feed accepts absurd prices; one click distorts every valuation platform-wide
- Where: /ops/integrations > Simulated feeds > Market data: prices and FX (Run feed, default date today); effects in /ops/securities, /ops/ibor, /ops/copilot, /ops/portfolio-lab
- Steps: run the feed once for 2026-10-03.
- Expected: plausibility / tolerance check against the previous close (or at least a warning), and a way to review/reverse.
- Actual: 13 VENDOR prices created, each becoming "latest": e.g. T-BILL-91D 1.00 to 49.04 (+4,803%), SEED.VX +2,983%, NMB.ZW +1,490%, DLTA.ZW -94%. IBOR headline market value changed from 302,546,823.06 to 1,752,058,254.08; what-if turnover for the same model went from 13.29% to 64.75%; Copilot reports T-BILL position at 353m. No confirmation, no warning, no revert action. Audit records only "pricesCreated: 13".
- NOTE FOR OTHER TESTERS: all valuation figures after about 15:06 local on 03 Oct 2026 are affected by this test action.

### ISS-ADB-025 [severity: major] Staff e-signature signers have no way to sign in the admin console
- Where: /ops/esign (request ESG-00004 created by tester with staff signers analyst and client_services), notification "Signature requested" (link http://localhost:48221/ops/esign)
- Steps: create request from document store (wizard step 1-3, parallel, 2 staff signers), Send. Sign in as client_services (a signer, has esign.view) and as analyst (a signer).
- Expected: a "Sign" action (or portal link) for the signed-in staff signer.
- Actual: request drawer shows only Resend / Download original / Verify integrity / Remind everyone / Void; no Sign button for the signer. Analyst has no esign.view, so the notification link lands on "Your role does not include e-signatures. Ask an administrator for the esign.view permission." Signing UIs exist only in onboarding-web (/sign/[token]) and company-web. Sign flow therefore NOT testable from admin. Positive: create wizard, send, Verify integrity ("Original document hash ok, Signature hash chain ok, Audit event chain ok") work; sealed/certificate downloads correctly disabled until completion.

### ISS-ADB-026 [severity: major] Shell on mobile width: sidebar renders full width above content, no menu toggle
- Where: any /ops page at 375x812 (resize_window mobile)
- Steps: resize to mobile, open /ops.
- Expected: collapsible/hamburger navigation, content visible first.
- Actual: the 2,225 px tall sidebar (all 40 links) occupies the first screens; <main> starts at y=2289 px; topbar buttons (search, notifications, avatar/sign-out) are only reachable after scrolling past it; no hamburger exists. No horizontal page overflow (docW 375; tables scroll inside wrappers, e.g. IBOR table 1226 px in 285 px wrapper).

### ISS-ADB-027 [severity: minor] Password change form: mismatch and weak-password feedback
- Where: /ops/profile > Change password
- Actual: short new password gives generic "Validation failed"; repeat-password mismatch is not caught client side (request is sent, answer was "Your current password is not correct" for a wrong current password). Device column shows raw user-agent ("Mozilla/5.0 ... KHTML, l"), and 6 stale "node" sessions from scripts are listed. No password was actually changed.

### ISS-ADB-028 [severity: polish] Shell details
- (a) Notifications dropdown has a horizontal scrollbar and cuts the text ("Case RC-1..."). (b) Command palette search "horizon" returns client and one document only (works; Enter opens /ops/record/client/<uuid>). (c) /ops/record/<kind>/<id> is a raw field dump with labels like "MANDATE LABEL", "VALUE LABEL", "ACCOUNTS COUNT", "ID", "REF" (and ACCOUNTS COUNT 5 conflicts with 0 accounts on the 360). (d) Next dev overlay shows "3 issues" badge on several pages (not inspected). (e) Full page reload of /ops takes about 10 s on "LOADING OPERATIONS CONSOLE".
- Works: Ctrl+K palette, bell (unread count, click-through to /ops/risk), sign-out (session ended, /ops/audit redirects to /login?next=..., API 401), profile page.

### Positive checks (no issue)
- Maker-checker enforced: performance lock (different person), private mark approval (sysadmin blocked, director approved; approval booked unrealised gain journal JNL-00004), document approval, research own-case publish, IC ratify note.
- Portfolio construction as investment_director: New model/Edit/Activate/Clone/Retire visible; Activate on MDL-1002 correctly refused ("total 100.0100%"); Save as proposal works; Create draft orders refused when every line fails.
- Audit trail: chain verifies (146 events), CSV export (52 KB), filters/search work (Search button required; typing alone does not filter).

## Coverage

| Page | Tested | Result |
|---|---|---|
| IBOR & Positions (+ position detail) | yes | ADB-001..004 |
| Performance & Attribution (+ period) | yes | ADB-005, 006 |
| Research & IC | yes | ADB-010, 011 |
| Private Markets | yes | ADB-009 |
| Portfolio Construction | yes (sysadmin and director) | ADB-007, 008 |
| Collateral & Financing | partially (read-only; no write permission for sysadmin/director) | ADB-012 |
| Clients & Accounts | yes | ADB-013 |
| Investor Services | yes | ADB-015 |
| Onboarding & KYC review | partially (queue empty, no cases to review; config read-only) | ADB-012 |
| Document Vault | yes (upload, download, review, maker-checker) | ADB-016 |
| Reports & BI | yes (run, PDF, email, schedules) | ADB-017 |
| Regulatory reporting | yes (populate, evidence, review; submit/approve not done) | ADB-018 |
| Data Fabric & Studio | yes | ADB-019 |
| Model governance | partially (read-only, no register/approve run) | ADB-023 |
| RBAC & Controls | partially (matrix, scans read; change-request form not submitted) | ADB-020 |
| Settings | yes | ADB-021 |
| Security controls | yes | ADB-020 |
| Audit Trail | yes | none |
| Investment Copilot | yes | ADB-024 (data) |
| Integrations | yes | ADB-022, 024 |
| E-signatures | partially (create/send/verify; sign flow not available in admin) | ADB-025 |
| Shell: palette, bell, profile, sign-out | yes | ADB-028 |
| Shell: mobile width | yes (home, IBOR) | ADB-026 |

## Counts by severity

| Severity | Count |
|---|---|
| blocker | 0 |
| major | 11 (ADB-001, 003, 005, 007, 010, 012, 013, 020, 024, 025, 026) |
| minor | 10 (ADB-002, 006, 008, 009, 014, 015, 016, 018, 019, 027) |
| polish | 7 (ADB-004, 011, 017, 021, 022, 023, 028) |

Total 28.
