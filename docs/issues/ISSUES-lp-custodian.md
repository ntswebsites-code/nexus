# QA issues: LP portal and Custodian portal (prefix LPC)

Tester notes
- Local stack, API http://localhost:48211, LP http://localhost:48222, custodian http://localhost:48225.
- Personas: lp_a_manager, lp_a_signatory, custodian_approver. No credentials recorded here.
- The browser pane shares the single `nexus_session` cookie across all `localhost` ports with the other testers (see ISS-LPC-001), so API-level testing with a private cookie jar was done first and UI passes in the browser second.
- Test data created while testing (not cleaned): LP requests REQ-2053/REQ-2054, call CC-014 acknowledged, notice CC-014 acknowledged, payment-confirmation evidence rows on CC-013 and CC-012.

### ISS-LPC-001 [severity: major] Portals share one session cookie on `localhost`; a second sign-in in the same browser silently replaces another portal's session
- Where: all portals (cookie `nexus_session`, host-only on `localhost`, ports are not part of cookie scope); API `/api/auth/login`
- Steps: Staff user signed in on admin :48221 in the browser. Open LP :48222/login in the same browser profile.
- Expected: Either an independent session per portal, or a clear "switch account" flow that does not terminate the other portal's session unexpectedly.
- Actual: LP login page shows "Signed in as investment_director@uat.matanho.test, but this account does not have access to the LP Portal" with only a "Sign in with a different account" button; signing in as an LP replaces the admin session for every localhost portal. Using `127.0.0.1` or `*.localhost` to isolate cookies is not possible locally: `127.0.0.1` never hydrates (Next dev blocks cross-origin dev resources; login page stuck on "Checking session..."), and `lpc.localhost` is rejected by API CORS ("No 'Access-Control-Allow-Origin' header").
- Evidence: console "Access to fetch at 'http://localhost:48211/api/auth/me' from origin 'http://lpc.localhost:48222' has been blocked by CORS policy"; page text "Checking session…" persists on http://127.0.0.1:48222/login.

### ISS-LPC-002 [severity: major] POST /lp-portal/requests returns the wrong request in the response (an old CLOSED request) instead of the one just created
- Where: API `POST /api/v1/lp-portal/requests` (LP "New request" form relies on this response)
- Steps: As lp_a_signatory POST `{type:"Query",subject:"QA signatory request",description:"hello",priority:"NORMAL"}`; repeat with a second subject.
- Expected: 201 with the new request (REQ-2053, SUBMITTED, subject as sent).
- Actual: 201 "Service request created" but `data` is REQ-2017 "Authorised signatory update", status CLOSED, created 2026-08-14, for both calls. The new requests exist (REQ-2053, REQ-2054 appear in GET /requests), so the UI would show/redirect to the wrong record.
- Evidence: response `data.reference` = "REQ-2017" for both creates; list shows REQ-2053, REQ-2054 SUBMITTED.

### ISS-LPC-003 [severity: major] Payment confirmation accepts any claimed amount (over-payment) and is accepted on an already PAID call
- Where: API `POST /api/v1/lp-portal/capital-calls/:id/payment-confirmations`
- Steps: As lp_a_signatory upload a PDF with `amountClaimed=99999999` to CC-013 (outstanding 150,000.00); upload with `amountClaimed=1` to CC-012 (status PAID, outstanding 0).
- Expected: 400 validation error (amount exceeds outstanding / call already settled).
- Actual: 201 "Payment confirmation uploaded" for both; evidence records with amountClaimed 99999999.00 and 1.00 created. Non-numeric and negative amounts are correctly rejected.
- Evidence: `{"amountClaimed":"99999999.00",...}` status 201.

### ISS-LPC-004 [severity: major] E-sign accepts a typed signature that does not match the signer's name
- Where: API `POST /api/v1/esign/me/requests/:id/sign` (LP signatures page / capital-call acknowledgement signing)
- Steps: As lp_a_signatory (Tawanda Moyo) with a pending ESG-00005 (capital-call acknowledgement CC-013) send `{mode:"TYPED",typedName:"Wrong Person",consent:true}`.
- Expected: Rejected (typed name must match the signer's registered name) or at least flagged.
- Actual: 200 `{"signed":true,"status":"COMPLETED"}`; call CC-013 became acknowledged with an evidentiary signature in someone else's name.
- Evidence: `{"signed":true,"status":"COMPLETED","ref":"ESG-00005"}`

### ISS-LPC-005 [severity: minor] E-sign endpoints use a different error envelope from the rest of the LP API
- Where: `/api/v1/esign/me/*` vs `/api/v1/lp-portal/*`
- Steps: Trigger a validation error on each (empty sign body vs empty request create).
- Expected: One error contract (`{success:false,code,message,fieldErrors}`), as the LP client expects.
- Actual: esign returns `{"error":{"code":"bad_request","message":"Validation failed","details":[{"path":"mode","message":"Invalid option: expected one of \"TYPED\"|\"DRAWN\""}]}}` (raw zod text), LP returns `{"success":false,"code":"LP_VALIDATION","fieldErrors":{...}}`.
- Evidence: see above.

### ISS-LPC-006 [severity: minor] Invalid enum/date/period inputs are silently accepted or ignored on several LP endpoints
- Where: `GET /lp-portal/performance?period=XYZ` (echoed back as `period:"XYZ"`), `?asOfDate=garbage` (ignored), `GET /lp-portal/dashboard?asOfDate=garbage`, `GET /lp-portal/notices?status=bogus`, `POST /lp-portal/dealing/redemptions/estimate` with `earliestDealingDate:"garbage"` (200 using the default date), `PATCH /lp-portal/settings/display {currency:"ZZZZ"}` (200 "Display preferences saved", nothing changed), `POST /lp-portal/colleagues` with `lpRole:"GOD"` (invite created as VIEWER).
- Expected: 400 with a field error.
- Actual: 200/201, input ignored or coerced; invalid role is silently downgraded.
- Evidence: invite response `lpRole:"VIEWER"` for requested `GOD`.

### ISS-LPC-007 [severity: minor] Fund-scoped endpoints behave inconsistently for an out-of-scope fund (signatory is scoped to Growth Fund I only)
- Where: `GET /lp-portal/dashboard?fundId=<Equity Opportunities>` as lp_a_signatory
- Steps: Request dashboard with the other fund's id; compare with capital-calls/dealing/performance/documents/account-activity.
- Expected: 404 "Fund not found" like every other endpoint.
- Actual: dashboard returns 200 with data (Growth Fund I figures), others return 404. Also `dealing/overview?fundId=<closed-end Growth Fund I>` returns 200 with all-zero balances instead of a "dealing not available for private funds" error (estimate endpoint does return that error).
- Evidence: dashboard 200 vs `{"code":"LP_NOT_FOUND","message":"Fund not found"}`.

### ISS-LPC-008 [severity: minor] Documents list for the fund-scoped signatory includes documents labelled with funds outside the LP's fund list; distribution notice categorised as CALL_NOTICE
- Where: `GET /lp-portal/documents` (Document Centre)
- Steps: As lp_a_signatory (session funds = Growth Fund I) list documents.
- Expected: Only documents for in-scope funds/consolidated items; consistent fund names; correct categories.
- Actual: 24 documents including fund names "Balanced Growth", "Private Credit Fund I", "Private funds" (none appear in /session funds). "Distribution Notice · DIST-2610-01" (Private Credit Fund I) has `category:"CALL_NOTICE"`.
- Evidence: distinct fundName values: Matanho Growth Fund I, Consolidated, Balanced Growth, Private Credit Fund I, Private funds.

### ISS-LPC-009 [severity: minor] Headline KPIs do not reconcile with the listed transactions, and exclude the open-ended fund
- Where: LP dashboard / performance (`/lp-portal/dashboard`, `/performance`) vs capital-calls and distributions lists
- Steps: Compare KPIs with lists as lp_a_manager (two funds).
- Expected: Totals consistent with the underlying records and with a stated scope.
- Actual: `distributions` KPI 1,820,000.00 but the distributions list totals 900,000.00 gross / 886,400.00 net (3 items); `called` 3,983,333.33 and `paidIn` 3,750,000.00 vs five listed calls totalling 1,383,333.33 (paid 1,150,000.00). `currentNav` (4,420,000.00), `paidIn` and `totalCommitment` cover Growth Fund I only while `investmentCount` is 2 and Equity Opportunities holds 2,595,449.28 (paid-in 2,500,000, distributions 350,000). Dashboard `asOfDate` is 2026-10-03 while session `defaultAsOfDate` and performance history use 2026-06-30.
- Evidence: values above from API responses.

### ISS-LPC-010 [severity: minor] Pending colleague invitations cannot be edited, only revoked; colleague list exposes all emails to viewers/signatories
- Where: `PATCH /lp-portal/colleagues/:membershipId`, `GET /lp-portal/colleagues`
- Steps: Manager invites a colleague (status INVITED, userId empty), then PATCH role/fund scope with that membershipId. Separately GET colleagues as lp_a_viewer.
- Expected: Role/scope of a pending invite editable; colleague directory limited to what the role needs.
- Actual: PATCH returns 404 "Membership not found"; revoke works. Viewer/signatory can list every colleague's email, role and last-active time. The listed colleague "Kariba Signatory" (lp_b_signatory, documented as belonging to a second client) is a member of Horizon Pension Fund LP (client A), contradicting docs/LOCAL-STACK.md.
- Evidence: PATCH 404; colleagues includes lp_b_signatory@uat.matanho.test under client CL-00418.

### ISS-LPC-011 [severity: major] Day-end package with a declared trade count that does not match the executions received can be submitted and approved
- Where: API `POST /api/v1/custodian/day-end/:id/submit` and `/approve` (custodian portal Day-end control totals)
- Steps: As custodian_submitter create a day-end package (statement date 2026-09-30, account CUST-CL-00418, USD, tradeCount=5) with no executions on file for that date; submit; then approve as custodian_approver.
- Expected: Submit rejected with `control_total_mismatch` ("Declared control totals do not match the executions received").
- Actual: Submit returned 200 and status Received; approve returned 200 Approved. `GET /day-end/:id` shows `controls:{"executionsReceived":0,"tradeCount":5,"matches":false}`. Only quantity and notional are enforced by `totalsMismatch`; count is not.
- Evidence: CDE-10003 status Received then Approved with `matches:false`.

### ISS-LPC-012 [severity: minor] Seeded day-end package DAY-DEMO1 has no file and no hash, and cannot be approved by any persona
- Where: Custodian day-end list / detail, package DAY-DEMO1
- Steps: As custodian_approver view DAY-DEMO1 (Received) and press approve.
- Expected: A demonstrable package with an official file and fingerprint; a second approver persona able to approve.
- Actual: `file:null, sha256:null`; approve returns 403 `segregation_of_duties` (preparer was custodian_approver himself); custodian_submitter lacks `custodian.dayend.approve`, so nobody in the seeded personas can approve it.
- Evidence: `{"error":{"code":"segregation_of_duties","message":"The submitter of a day-end package cannot approve it"}}`.

### ISS-LPC-013 [severity: major] Bulk CSV and single execution entry store spreadsheet-formula text unchanged (CSV injection)
- Where: API `POST /custodian/executions/bulk` (and `/executions`), fields tradeRef, broker, note
- Steps: Upload CSV with tradeRef `=CMD()<n>` and broker `=1+1`.
- Expected: Rejected, or neutralised (prefix with a quote) when stored or exported.
- Actual: 201 Accepted; stored verbatim (`tradeRef:"=CMD()1791034287615"`, `broker:"=1+1"`); these values flow to staff reconciliation exports. Also `<script>alert(1)</script>` is stored verbatim in `note` (UI escaping to be checked in the UI pass).
- Evidence: batch CBT-10008 accepted.

### ISS-LPC-014 [severity: minor] Ambiguous or non-ISO execution timestamps are accepted and interpreted silently (US month/day)
- Where: bulk CSV `executionAt`, single execution `executionAt` (uses `Date.parse`)
- Steps: dry-run bulk with executionAt `02/10/2026 09:30` (intended 2 Oct) and `2026-10-02` (date only).
- Expected: Require an ISO date-time or reject ambiguous formats.
- Actual: Both valid (`valid:true`); `02/10/2026` parses as 10 February 2026 in JS. A thousands separator ("1,000") gives two stacked errors ("Enter a number with at most 8 decimals" and "Quantity must be greater than zero").
- Evidence: dry-run `{"valid":true,"rowCount":1,"newCount":1}`.

### ISS-LPC-015 [severity: minor] Missing required fields on amend/cancel and many custodian validations surface raw zod text
- Where: `PATCH /custodian/executions/:id`, `POST /custodian/executions/:id/cancel`
- Steps: Send without `reason`.
- Expected: "Give a reason for the amendment/cancellation" (the schema message used for short reasons).
- Actual: `{"path":"reason","message":"Invalid input: expected string, received undefined"}`. Same style for `declaredCount: abc` ("Invalid input").
- Evidence: see above.

### ISS-LPC-016 [severity: polish] Two Draft day-end packages for the same account/date/currency can coexist
- Where: `POST /custodian/day-end`
- Steps: Create two drafts for CUST-CL-00418 / 2026-10-01 / USD (CDE-10001, CDE-10002).
- Expected: Early warning at creation if an active package already exists (only draft-vs-active is checked; it errors on submit).
- Actual: Both created (201). Reported `tradeQuantity` is `"0.00000000"` or `null` depending on the request.
- Evidence: list shows CDE-10001 Approved and CDE-10002 Draft for the same key.

### ISS-LPC-017 [severity: blocker] Custodian "Amend" dialog pre-fills the quantity with trailing zeros stripped ("500" shows "5"); saving any other change silently amends the quantity to 5
- Where: http://localhost:48225/ status panel > Amend (portals/custodian-web/public/live/custodian-live.js, `x.quantity.replace(/\.?0+$/, '')`)
- Steps: Submit execution QA-UI-EXEC-1 BUY DLTA.ZW quantity 500 price 0.184. Click Amend on it: Quantity field shows 5. Change only Price to 0.19, enter a reason, Save amendment.
- Expected: Quantity field shows 500; only the price changes.
- Actual: Dialog shows quantity `5`; save sends `quantity:"5"` along with the price; the panel then shows "BUY 5 DLTA.ZW @ 0.19 USD" (quantity 500 -> 5 with no warning). Any integer quantity ending in zero (100, 40,000, 10000 -> 1) is affected.
- Evidence: input `mxAQty` value "5"; panel text "BUY 5 DLTA.ZW @ 0.19 USD".

### ISS-LPC-018 [severity: minor] Custodian execution form ships pre-filled demo values, offers only USD/ZWG and rejects fractional quantities
- Where: http://localhost:48225/ Trade execution form
- Steps: Sign in and open the form.
- Expected: Empty form (or placeholders); same currencies as the API; fractional quantities (up to 8 decimals) allowed as the API allows.
- Actual: Real input values (not placeholders) "TRD-260904-201", account "CUST-CL-00418", ticker "DLTA.ZW", qty 10000, price 0.184, settlement 05/10/2026, broker "IH Securities" are pre-filled and the form re-fills them after every successful submit (easy to submit a demo trade by mistake). Currency list lacks ZAR (API accepts USD/ZWG/ZAR). Quantity input has min 1 ("Value must be greater than or equal to 1") so 0.5 units cannot be entered. Header still reads "Controlled counterparty workspace · Demo".
- Evidence: dropdown options USD, ZWG; browser validation message "Value must be greater than or equal to 1."

### ISS-LPC-019 [severity: minor] Custodian portal does not react to an expired/replaced session and shows no sign-in prompt for ~10 s after sign-out or reload
- Where: http://localhost:48225/
- Steps: (a) While signed in as custodian_approver, have another portal sign in/out in the same browser (shared cookie, ISS-LPC-001); click Approve on a package. (b) Click Sign out, or load the page signed-out.
- Expected: A 401 shows the sign-in card again; signed-out page shows the sign-in card promptly and no editable demo form.
- Actual: (a) toast "Not saved / Authentication required", the header still shows "Stanbic Custodial Services · Custodian Approver (approver)" and the status panel stays as if signed in; `GET /api/auth/me` is 401. (b) Page shows the pre-filled demo execution form and "Loading submissions…" for roughly 10 s before the sign-in card appears; when signed in as an account without custodian access the card says "Access not available" with only a Sign out button.
- Evidence: POST .../day-end/:id/approve -> 401; toast text above.

### ISS-LPC-020 [severity: polish] Custodian day-end flow leaves an orphan Draft when the second step (submit) fails; declared control totals not cleared after upload; status panel shows only the newest items
- Where: http://localhost:48225/ Day-end package and Bulk upload tabs, status panel
- Steps: Submit a day-end with declared quantity 999 and no executions; upload a valid bulk file with declared count 2; count items in the status panel.
- Expected: Failed submit rolls back or clearly explains the Draft; form fields reset after success; panel paginates or shows all.
- Actual: Toast "Not submitted ... quantity declared 999.00000000, received 0.00000000" but Draft CDE-10005 remains in the panel with a Submit button (it keeps the declared control totals). After bulk upload success, "Declared trade count" remains 2. Header counters say EXECUTIONS 15 / DAY-END PACKS 7 while the panel lists only a subset (seeded EXEC-DEMO1 and BULK-DEMO-001..003 never appear, no paging or "show more").
- Evidence: panel text "Day-end · CDE-10005 ... Draft ... Submit History".

### ISS-LPC-021 [severity: polish] Custodian portal copy still says "prototype"/"Demo"
- Where: header badge "Controlled counterparty workspace · Demo" (shown signed out) and the legacy page markup
- Steps: Load the portal signed out.
- Expected: No demo/prototype wording in a live portal.
- Actual: "Controlled counterparty workspace · Demo" badge; signed-out footer text "The portal creates an immutable submission record in this prototype. Production access would be authenticated, permissioned and signed by the custodian user."
- Evidence: page text.

### ISS-LPC-022 [severity: blocker] LP request detail and reply always operate on REQ-2017: any reference returns the same request, replies land on the wrong request
- Where: API `GET /api/v1/lp-portal/requests/:reference`, `POST /requests/:reference/messages` (LP Requests page detail and reply; also create response, see ISS-LPC-002). Cause visible in `backend/api/src/modules/lp-portal/services/requests.ts` `findRequest`: `where: { clientId, OR: [{ref},{id}], ...fundScopeWhere(ctx) }` - the spread of `fundScopeWhere` replaces the `OR`, so the reference is ignored.
- Steps: As lp_a_manager or lp_a_signatory GET `/requests/REQ-1082`, `/requests/REQ-9999`, `/requests/garbage`. Then POST `/requests/REQ-1082/messages {"body":"QA reply intended for REQ-1082"}`.
- Expected: Matching request, 404 for unknown references, reply appended to REQ-1082.
- Actual: All return 200 with REQ-2017 "Authorised signatory update" (CLOSED). The reply was stored on REQ-2017 (it flipped to AWAITING_INTERNAL, 3 messages) while REQ-1082 stayed AWAITING_INVESTOR with its original 2 messages. Fund scoping on request detail is also bypassed for the same reason (the lookup is no longer reference-specific).
- Evidence: `requests/REQ-9999 -> data.reference "REQ-2017"`; list afterwards: `REQ-2017 AWAITING_INTERNAL msgs=3 ; REQ-1082 AWAITING_INVESTOR msgs=2`.

### ISS-LPC-023 [severity: major] Capital-calls page shows wrong distribution types and inconsistent paid-calls totals
- Where: http://localhost:48222/lp-portal/capital-activity (Distributions table and KPI cards), as lp_a_manager
- Steps: Open Capital Calls & Distributions; compare with `GET /lp-portal/distributions` and `/capital-calls`.
- Expected: Type column equals the API type; "Paid Calls" equals the paid calls listed.
- Actual: DIST-008 shows "Return of Capital" (API: "Exit Proceeds"), DIST-007 shows "Income" (API: "Dividend"); only DIST-006 matches. "Paid Calls $750.0K / 3 Calls" but the three paid calls listed (CC-10/11/12) are $250,000 + $500,000 + $400,000 = $1,150,000 (750K is the YTD figure). "Total Distributions $1.82M" vs table total $886,400 net. Header bell says "9 portal items need attention" while the dashboard shows 10 actions.
- Evidence: table cells "DIST-008 ... Return of Capital ... $500,000 ($10,000) $490,000".

### ISS-LPC-024 [severity: major] Dashboard shows contradictory capital figures and misleading placeholders
- Where: http://localhost:48222/lp-portal (Dashboard), lp_a_manager
- Steps: Read KPI cards and "Capital Position" panel.
- Expected: One consistent set of totals covering both funds, or a clear label of what is included.
- Actual: "Current NAV $4.42M" in the KPI row but "Remaining Value $2.60M (52.0%)" in the Capital Position panel on the same page ($2.60M is only the open-ended account value); "Total Commitment $5.00M - 2 Commitments" while Equity Opportunities has a 0 commitment; "YTD Return: 0.0%" is displayed although the API value is null (no data); Recent Capital Activity lists NOTICE/DOCUMENT rows with "$0.00"; Actions Required (10) includes the already submitted "Redemption submitted" item and "Signature required" items with a due date of 20 Jul 2026 (past) that have no matching request in the Signatures inbox (inbox shows only the completed ESG-00005), so the user cannot act on them.
- Evidence: page text "Current NAV $4.42M" and "Remaining Value $2.60M (52.0%)"; "YTD Return: 0.0%".

### ISS-LPC-025 [severity: minor] Dashboard link "2 Commitments" goes to a non-existent page; sidebar briefly shows "My Investments"
- Where: Dashboard KPI "2 Commitments" -> /lp-portal/investments (no such page; the portal redirects to /lp-portal); sidebar entry "My Investments" is rendered while the shell loads and then disappears once flags are known.
- Steps: Click "2 Commitments" or open /lp-portal/investments.
- Expected: A holdings/commitments page (scope: holdings/commitments) or no link.
- Actual: Lands back on the dashboard; there is no holdings or commitments page in the LP portal at all.
- Evidence: URL ends at /lp-portal after requesting /lp-portal/investments.

### ISS-LPC-026 [severity: minor] Payment-confirmation UI cannot capture an amount or note
- Where: Capital Calls > "Submit Payment Confirmation" / row action "Payment Confirmation"
- Steps: Use the button.
- Expected: A dialog asking for amount paid, date and notes (API supports `amountClaimed`, `notes`).
- Actual: Button opens the native file picker only (hidden `input[type=file]` accepting pdf/png/jpg/txt); upload then posts with the full outstanding amount implied. When the session is invalid the toast reads "This account is not authorised to use this portal" (403 from POST .../payment-confirmations).
- Evidence: DOM `input[type=file] accept=".pdf,.png,.jpg,.jpeg,.txt" class=hidden`; no dialog element appears.

## Coverage

Method note: every API surface below was exercised with private cookie jars (no UI interference). Browser UI coverage was cut short because all testers share one `nexus_session` cookie on `localhost` (ISS-LPC-001): my LP session was replaced by another tester within seconds, repeatedly. A background browser tab also does not hydrate until a screenshot is taken ("Loading..." stays), which looked like a hang at first.

| Page / area | Tested | Result |
|---|---|---|
| LP login (invalid, empty, valid, different-account prompt) | yes (UI) | OK; ISS-LPC-001 |
| LP dashboard | yes (UI + API) | ISS-LPC-009, 024, 025 |
| Holdings / commitments page | no page exists | ISS-LPC-025 |
| Capital calls and distributions (list, detail, ack, payment confirmation, downloads) | yes (UI + API) | ISS-LPC-003, 023, 026 |
| E-sign: capital-call acknowledgement (staff-issued request, sign, sealed PDF) | yes (UI inbox + API) | ISS-LPC-004, 005 |
| E-sign: commitment signing | no (no pending commitment request; flow exists in API) | not covered |
| Signatures inbox | yes (UI) | OK |
| Distributions statement / downloads | yes (API) | OK, ISS-LPC-023 |
| Documents / Document Centre (list, download, scope) | yes (API; UI not reached) | ISS-LPC-008 |
| Notices (list, open, acknowledge) | yes (API; UI not reached) | ISS-LPC-006 |
| Requests and messages (create, detail, reply) | yes (API; UI not reached) | ISS-LPC-002, 022 |
| Statements and reports, performance, account activity, exports | partially (API) | ISS-LPC-006, 009 |
| Subscriptions and redemptions (estimate, submit, replay) | yes (API) | OK, ISS-LPC-006, 007 |
| My Organisation (colleagues invite/edit/revoke, bank change) | yes (API); bank change blocked by MFA | ISS-LPC-006, 010 |
| Settings (notifications, display, MFA info) | yes (API) | ISS-LPC-006 |
| Role differences manager / signatory / viewer | yes (API) | manager passes SIGNATORY gate by rank; viewer blocked correctly |
| Custodian login (invalid, valid, sign-out, wrong-portal account) | yes (UI) | ISS-LPC-019 |
| Custodian execution submit (UI + API validation) | yes | ISS-LPC-013, 014, 018 |
| Custodian bulk CSV (UI validate, upload, declared totals; API edge cases) | yes | ISS-LPC-013, 014, 020 |
| Custodian amend / cancel / history | yes (UI + API) | ISS-LPC-015, 017 |
| Custodian day-end create / submit / approve / SoD / control totals | yes (UI + API) | ISS-LPC-011, 012, 016, 020 |

## Counts by severity

- blocker: 2 (ISS-LPC-017, 022)
- major: 8 (ISS-LPC-001, 002, 003, 004, 011, 013, 023, 024)
- minor: 13 (ISS-LPC-005, 006, 007, 008, 009, 010, 012, 014, 015, 018, 019, 025, 026)
- polish: 3 (ISS-LPC-016, 020, 021)
- total: 26
