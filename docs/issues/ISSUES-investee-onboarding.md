# Issues: Investee portal + Onboarding portal (prefix INO)

Tester: automated QA run, local stack, 2026-10-03. No product code changed.

Environment note (not a product issue): the browser pane is shared by several testers and the API session cookie
(`nexus_session`, host `localhost`) is shared by all portals and all tabs, so another tester's sign-in/sign-out
repeatedly ended my session mid-test (401 on /api/auth/me). Next dev servers also compile pages on first hit (login page
took ~20s to hydrate, showing "Checking session..." meanwhile).

## Issues

### ISS-INO-001 [severity: major] Investee portal shell renders (and login offers "Continue") for a signed-in user from another portal who has no company link
- Where: http://localhost:48224/ and /login
- Steps: with a custodian_approver session active (shared cookie), open the investee portal root, then /login.
- Expected: access-denied page / redirect, or at minimum no portal chrome.
- Actual: full portal shell (sidebar, company switcher "Zambezi Pay", header avatar "Custodian Approver") renders with an error card
  "dashboard: This account is not linked to a portfolio company (403 no_company_access)"; 14 parallel API calls return 403. /login says
  "Signed in as custodian_approver@uat.matanho.test. Continue / Sign out" (enforcePortalAccess is off for company).
- Evidence: console "Failed to load resource: 403" x14; sidebar still shows mock company name.

### ISS-INO-002 [severity: major] Submit-report modal is driven by hard-coded demo data (period list, owners, pre-filled financials) that does not match the live reporting request
- Where: http://localhost:48224/reports > "Submit report" (persona investee_101_approver)
- Steps: open Reporting Centre, click Submit report, inspect Reporting period / Submission owner / values, click Save draft with defaults.
- Expected: periods come from /reporting/requests (open period 2026-08, due 2026-09-05, plus returned 2026-05), owners from /team, empty or saved values.
- Actual: period list is a fixed "July/August/September 2026 · Actual · Locked, October 2026 · Current actuals"; the real OPEN period (Aug 2026) is labelled "Locked"; default selection (Oct 2026) has no request, so Save draft fails with "There is no reporting request for this period (404 not_found)". Owners "Chipo Banda / Nyasha Chikore" are fixed strings (API contact is Chipo Dube; profile title is "Chief Financial Officer" hard-coded). Income statement is pre-filled with demo figures (revenue $4,260 etc.) which are saved as the company's draft when the user clicks Save draft.
- Evidence: toast "Request failed - There is no reporting request for this period (404 not_found)".

### ISS-INO-003 [severity: major] Draft is accepted but "Validate & submit" fails on the pre-filled balance sheet which cannot balance; failed submit closes the modal
- Where: /reports > Submit report > August 2026
- Steps: select August 2026, Save draft (201 x3), then click Validate & submit without changes.
- Expected: same validation on draft/submit or an inline error next to the Balance check, modal stays open with entered values.
- Actual: draft endpoints return 201 for income-statement, balance-sheet and cash-flow; submit then POSTs balance-sheet/draft and gets 400 "Balance sheet does not balance: total assets must equal total liabilities plus equity". Modal is closed after the error (re-opened it shows Total assets $5,045 vs Liabilities+equity $2,505, Balance check $2,540 with all line inputs blank, i.e. totals are not computed from the visible lines).
- Evidence: toast "Request failed - Balance sheet does not balance ... (400 bad_request)". Balance-sheet line item inputs are empty but totals show non-zero numbers.

### ISS-INO-004 [severity: minor] Reporting Centre "Draft workspace" and "Templates" tabs are static mock content, statuses and ids shown raw
- Where: /reports tabs
- Steps: open Draft workspace, Submission history, Templates.
- Expected: draft workspace reflects the live Aug 2026 reports (all DRAFT / due 2026-09-05); templates link to downloadable files.
- Actual: Draft workspace lists a fixed "1. Executive summary ... Complete - last updated 01 Aug", banner "Two validation items need attention - Revenue bridge is missing a source file" (not from API). Templates tab lists hard-coded "Quarterly investor report / ESG & impact questionnaire..." Submission history shows UUIDs under each title and raw enums (REPORTING_OPEN, CHANGES_REQUESTED, MANAGEMENT_ACCOUNTS).
- Evidence: visible text.

### ISS-INO-005 [severity: minor] Shell chrome is hard-coded: fund name, period selector, status footer, role title
- Where: sidebar/header on all investee pages
- Steps: compare sidebar card, header selector and footer to API (/company, /profile).
- Expected: fund "Matanho Growth Partners I" (API company.fund.name), reporting period selector from real periods, health from API.
- Actual: sidebar says "Africa Payments / Matanho Venture Fund I"; header period select is fixed "Q2 2026 / Q1 2026 / FY 2025" (today is Oct 2026); footer says "All systems operational" statically; avatar subtitle "Portfolio company user" / "Chief Financial Officer" while API titles are null. Runtime file still contains Zambezi Pay demo company data (mock).
- Evidence: runtime shows "Africa Payments" in card but fund text from shell.ts.

### ISS-INO-006 [severity: major] investee_101_approver opens PC-100 "Africa Payments" by default; no company switcher, so the approver cannot reach PC-101 (the company of the contributor/viewer personas) from the UI
- Where: any investee page, sidebar company card (drawer "Company workspace")
- Steps: sign in as investee_101_approver; GET /api/v1/investee-portal/profile returns company PC-100 / workspace_administrator; the same user via `?company=PC-101` is executive_approver of PC-101 "Zambezi Pay Technologies". Open the company card in the UI.
- Expected: docs/LOCAL-STACK.md says the approver is in PC-101; if linked to two companies the UI offers both.
- Actual: the account has two active memberships; backend picks the oldest (PC-100). The drawer shows a hard-coded "Zambezi Pay Technologies - Matanho Venture Fund I - Current - One authorised workspace" while the page data is Africa Payments (PC-100). UI never sends `?company=`, so maker-checker pairs (contributor in PC-101 + approver) cannot be exercised end to end in the UI; team list differs per session (contributor sees 3 members, approver sees only himself).
- Evidence: contributor GET /team lists "Tariro Moyo, Chief Executive Officer, executive_approver"; approver GET /team lists only Tariro Moyo with title null.

### ISS-INO-007 [severity: major] Cap Table page cannot record transactions or show/decide pending ones; "Add a holder" always fails with 409 register_locked
- Where: http://localhost:48224/cap-table (investee_101_contributor, PC-101)
- Steps: open Cap Table; enter Name "QA UI Holder", Class Ordinary, Shares 500; click "Save holder".
- Expected: either a working add or a clear control that routes to the maker-checker transaction flow (POST /cap-table/transactions, decide).
- Actual: PUT /cap-table returns 409 "The register has transactions. Record a new transaction instead of replacing the baseline." and the toast shows the raw "(409 register_locked)". The page has no UI for transactions, pending approvals (CTX-0006 option-pool top-up "awaiting a second approver" is invisible), certificates, class terms or waterfall although the API supports them (verified via API: contributor create -> 201 PENDING_APPROVAL; contributor decide -> 403 "cannot sign"; approver decide -> 200 APPROVED with GL ref; maker deciding own tx -> 403 maker_checker). "Export register" is client-side only (toast "Register exported - 3 holders" with no network call/download).
- Evidence: toast "Request failed - The register has transactions... (409 register_locked)".

### ISS-INO-008 [severity: minor] A maker cannot withdraw or reject their own pending cap-table transaction
- Where: POST /api/v1/investee-portal/cap-table/transactions/:ref/decide
- Steps: investee_101_approver creates CTX-0011 in PC-101, then tries REJECT on it.
- Expected: maker can withdraw/cancel their own pending entry (or a documented path).
- Actual: 403 maker_checker for both APPROVE and REJECT; with only one signer in the company the item stays pending forever. (CTX-0011 "QA Self Holder" left pending as evidence.)
- Evidence: "The person who entered a transaction cannot approve it".

### ISS-INO-009 [severity: major] KPI Centre shows raw metric ids, no units, no periods; history/export are empty
- Where: http://localhost:48224/kpis; GET /kpis/history, /kpis/export
- Steps: open KPI Centre; call the export.
- Expected: labels/units from definitions (API returns label "Annual recurring revenue", unit "USD"), period of each value; export has numbers.
- Actual: cards show "annual_recurring_revenue / Financial - Period / Submitted / 32.1" (no unit, "Live record" subtitle), same for gross_margin 72.4 etc. ARR budget in the API is 30,000,000 vs value 32.1 (unit mismatch). Export CSV and history return all-empty columns for the 3 accepted periods (revenue, grossMargin, runwayMonths all blank) and history labels are wrong ("2025-12" and "2026-03" both labelled "Jan - Mar 2026"). No export button exists on the page.
- Evidence: CSV body "2025-09,accepted,,,,,,,," ; labels from /kpis/history.

### ISS-INO-010 [severity: minor] Forecast accepts negative revenue
- Where: http://localhost:48224/forecasts (PUT /api/v1/investee-portal/forecast)
- Steps: as investee_101_contributor type -100 in the Oct 2026 forecast cell, click "Save forecast".
- Expected: validation error for negative revenue.
- Actual: 200 "Forecast saved"; GET /forecast then returns {"2026-10":-100} and the scenario totals include it. (I restored the value to 0 afterwards.)
- Evidence: toast "Forecast saved - Forecast revenue was stored for the open months."
- Also: months Jul-Sep 2026 show stage "Actual" with actual revenue "-" even though accepted reports exist; scenario headline cards (Base/Upside/Downside) are fixed multiples of the Base sum.

### ISS-INO-011 [severity: minor] Silent no-ops and generic validation messages in several forms
- Where: /workspace "Signature requests" (Send for signature with nothing selected: no request, no message), public /sign/<token> (click Sign without ticking the consent box: nothing happens), /requests new request (negative amount -> "Validation failed (400 bad_request)" with no field named), /workspace signature request with bad email ("Validation failed" only; API details name signers.0.email but UI hides them).
- Expected: inline field-level messages.
- Actual: as above; also "Save draft" / "Attach board or decision papers" / "Request pack" controls are simulated (data-action=simulate-upload) and do not upload anything.
- Evidence: toast texts above.

### ISS-INO-012 [severity: minor] Public e-sign accepts a typed name that differs from the invited signer
- Where: http://localhost:48224/sign/<token> (signer "QA Signer")
- Steps: open the emailed link (logged in worker.log), type "Wrong Name", tick consent, click Sign.
- Expected: typed name must match (or be confirmed against) the invited signer name, or a warning.
- Actual: "Thank you. Your signature is recorded." and the request moved to COMPLETED. Re-using the token afterwards correctly returns 409 invalid_state "This request is completed"; invalid token shows "This link is not valid".
- Evidence: visible text.

### ISS-INO-013 [severity: minor] Workspace Cap table "Register" briefly says "Nothing recorded yet." while loading; approval text promises an authentication code that is never asked
- Where: http://localhost:48224/workspace > Cap table
- Steps: open the tab as investee_101_approver (PC-100 has 2 holders).
- Expected: loading state; approve prompts for the code the text mentions or the text is conditional on MFA.
- Actual: for ~2s "Register: Nothing recorded yet." then the 2 holders appear (same flash on Share links / Signature requests "Nothing recorded yet."). Text "Approval needs an administrator or approver and an authentication code" but clicking Approve on CTX-0003 immediately returned 200 with no code prompt (local MFA is off). (CTX-0003 option-pool top-up in PC-100 was approved by me during this test.)

### ISS-INO-014 [severity: minor] Share links list shows no copy/open link and the link URL is a raw API URL
- Where: /workspace > Share links; POST /share-links response
- Steps: create a link, view the Links table.
- Expected: link to the portal/public share page with copy button visible in the list.
- Actual: table columns are Document, Recipient, Status, Expires, Opened, Revoke only; the API returns url "http://localhost:48211/api/v1/investee-public/share/<token>/file" (direct file download from API host, no landing page / watermark text). Public GET .../share/<token> returns metadata JSON.
- Evidence: response `url` field.

### ISS-INO-015 [severity: minor] Request detail drawer shows fabricated attachment/owner info
- Where: http://localhost:48224/requests > open "INO QA equipment" (REQ-2055)
- Expected: attachments and owner reflect the record.
- Actual: "Request pack: Financial model and cash impact - Integrated funding case attached - Attached; Investment memorandum - Action required before review can continue" shown for a request with no attachments; "Fund owner" equals the requester (Nyasha Chikore); "Decision target" equals the required-by date; "Drill-down response" is a mock form.
- Evidence: drawer text.

### ISS-INO-016 [severity: major] Overview falls back to hard-coded demo data (other company, other user) whenever live flags/dashboard fail
- Where: http://localhost:48224/ (investee_101_contributor)
- Steps: load "/" while the flags/dashboard call fails or is slow (twice observed: first load right after login, and a 500 from /dashboard).
- Expected: loading/error state.
- Actual: page renders "Good morning, Tariro ... Zambezi Pay", Revenue Q2 $3.42m, Cash $2.84m, "Total invested $28M", "Q2 2026 Investor Report RPT-026", "Nyasha Moyo portfolio lead" etc. as if real (only a small ribbon "Demo data - this page shows sample records, not your live data - live settings could not be loaded"). The logged-in user was Nyasha Chikore. After Retry the live overview is correct ("Good morning, Nyasha ... Live portfolio status for Zambezi Pay Technologies").
- Evidence: ribbon text above; one GET /investee-portal/dashboard returned "Internal server error (500 internal_error)" with no userId in api.log (14:22:00), and POST /api/auth/login returned 500 after 1.7s at 14:11:01 - both transient, under concurrent logins from several sessions.

### ISS-INO-017 [severity: major] Term sheets cannot be signed locally: "Set up two-factor authentication before signing" and there is no investee UI to enrol
- Where: POST /api/v1/investee-portal/term-sheets/:id/sign (TS-1001, PC-101, approver with canSign=true); /signatures page
- Steps: approver (via `?company=PC-101`) sends a valid sign body.
- Expected: LOCAL-STACK.md states "MFA is not required"; signing works or the UI guides MFA enrolment.
- Actual: 401 mfa_enrolment_required. /settings says "Multi-factor auth - Required for all users" (static text) and /team shows MFA "Off / 0%"; no enrolment control found in the investee portal (login only offers enrolment when the server demands it at sign-in). Signatures page shows "Identity verification: MFA + verified company account" as a safeguard. Note: for the default (PC-100) approver session the Signatures page and /term-sheets/my are empty, so the flow is also unreachable via the UI there.
- Evidence: `{"code":"mfa_enrolment_required","message":"Set up two-factor authentication before signing"}`.

### ISS-INO-018 [severity: minor] Signatures page ignores workspace e-signature requests; static "Authority matrix" and security claims
- Where: http://localhost:48224/signatures vs /workspace > Signature requests
- Steps: create a signature request in Workspace (SIG-0001, signed via public link).
- Expected: listed/counted on Signatures ("Completed this quarter").
- Actual: Signatures page shows "Awaiting your signature 0 / Other signatures pending 0 / Completed this quarter 0 / Audit certificates -", only lists term sheets. "Authority matrix: Funding documents CEO + CFO; Board resolutions Chair + Company Secretary" is hard-coded text.
- Evidence: counts stay 0 after SIG-0001 COMPLETED.

### ISS-INO-019 [severity: major] Settings save is not atomic and cannot succeed for companies without a letterhead city
- Where: http://localhost:48224/settings > "Save changes" (investee_101_approver, workspace administrator)
- Steps: change Description (or anything) and click Save changes; also try invalid contact email.
- Expected: one validation pass; inline field errors; save works.
- Actual: the page fires PUT /profile (200, saved) then PUT /company (200, saved) then the letterhead step fails with "Letterhead needs a street, city and country." (City is empty in seed data) so every save ends with the red toast "Request failed" although two of three parts were saved. With an invalid contact email PUT /profile = 200 but PUT /company = 400 "Validation failed (400 bad_request)" (no field named). Website "javascript:alert(1)" is accepted (PUT /company 200; no http/https check). "Security: Multi-factor auth - Required for all users, Session timeout 30 minutes" is static text (MFA coverage 0%; session cookie lives ~12h).
- Evidence: toast "Request failed - Letterhead needs a street, city and country."

### ISS-INO-020 [severity: minor] Pending team invitations are invisible; invite success gives no toast; messaging success has no toast
- Where: /team (invite), /messages (new conversation)
- Steps: invite qa.invitee... or an existing user's email; start a conversation.
- Expected: pending invite row, confirmation toast.
- Actual: POST /team 201 and a mail with an invite link is written to worker.log, but the Team table still lists only the existing member; no pending/revoke control; no confirmation toast. Inviting an email that already belongs to a user in another company (investee_101_viewer) is accepted silently (accept step correctly demands that account's current password). New message thread is created (201) but toast empty. "Last active" column is "-" for everyone although /workspace Access shows last sign-in dates.
- Evidence: team list unchanged after 201.

### ISS-INO-021 [severity: minor] Vault accepts spoofed file types and shows raw ids; documents cannot be opened from the list
- Where: /data-room, POST /api/v1/investee-portal/vault
- Steps: upload a file whose bytes start with "MZ" but is sent as application/pdf (named fake.pdf).
- Expected: content sniffing rejects it.
- Actual: 201 "Document stored" (DOC-3007). Valid *.exe type is rejected on declared MIME only. Document table shows UUIDs under each name and has no download/preview/delete actions; "Signature centre" button only.
- Evidence: response data.ref DOC-3007.


### ISS-INO-022 [severity: major] Onboarding step 5 "Continue" is blocked after uploading all documents in the same session (legacy handler throws on every file selection)
- Where: http://localhost:48223/ step 5 Evidence
- Steps: complete steps 1-4, choose a file in each of the 9 required evidence cards (each uploads, 201), click Continue.
- Expected: advances to Review.
- Actual: stays on step 5 with an alert "Supporting evidence still missing: Legal existence / identity, Registry..." although all cards show "uploaded securely". Console: `Uncaught TypeError: Cannot read properties of undefined (reading 'url') at handleFile (/legacy/js/01-inline.js:94)` on every selection (legacy code reads `dataset.doc` but the inputs only carry `data-doc-input`). Reloading the page (resume) makes Continue pass. Card badges stay "Not uploaded", header "0 uploaded", readiness "9 required document(s) outstanding 0/9" and review "REQUIRED EVIDENCE 0/9" even after the server accepted all files.
- Evidence: console TypeError above; uploads driven programmatically (DataTransfer) but same change event as a real picker.

### ISS-INO-023 [severity: minor] Evidence upload trusts the declared type: a file starting "MZ" named evil.pdf is accepted
- Where: POST /api/v1/public/applications/:id/evidence (public, unauthenticated draft token)
- Steps: upload bytes "MZ..." with type application/pdf; also upload script.exe (application/x-msdownload).
- Expected: content sniffing rejects the first.
- Actual: 201 "uploaded securely" with SHA-256; only the declared-MIME .exe is rejected (400 "File type application/x-msdownload is not accepted"). Same weakness as ISS-INO-021.

### ISS-INO-024 [severity: minor] Onboarding form accepts clearly invalid values
- Where: step 3 and step 4
- Steps: annual volume -500; SWIFT "BAD"; account number "abc"; mismatching bank holder name.
- Expected: field validation (min 0, SWIFT 8/11 chars, numeric account); a mismatching holder only warns.
- Actual: all accepted client-side; only the AI panel notes "Possible name mismatch". Empty required fields give only the browser tooltip; the missing-owner and missing-evidence checks use blocking alert() dialogs.

### ISS-INO-025 [severity: minor] Admin onboarding case shows "Screening: Clear", "No advisory exceptions" and Low risk with zero checks run
- Where: admin API/UI /ops/onboarding, case KYC-1001 (ONB-104830, ComplianceReview); GET /api/v1/client-ops/onboarding/cases/:id/workup
- Steps: submit an application (bank holder mismatch, 2 owners); open the case as local_admin.
- Expected: screening "Not run/Pending" (portal says provider checks pending); mismatch surfaced.
- Actual: screening "Clear", timeline "No advisory exceptions. Risk rated Low", all 8 checks outcome null (0/8), readiness 95, owner "Client Services intake". Queue otherwise held only this one case (no seeded onboarding data). Submission itself works: ONB ref shown, confirmation mail logged, case appears in the queue with 10 evidence files. I only viewed (no UI login, to avoid replacing the shared browser session; verified via API with a separate cookie jar).

### ISS-INO-026 [severity: major] No "Forgot password" entry point in any portal; reset page dead-ends
- Where: http://localhost:48224/login, /reset-password (all portals have no forgot link)
- Steps: open the login page; open /reset-password with no token, then with a bad token.
- Expected: login links to a request-reset form (API POST /api/auth/password/forgot exists and mails a link).
- Actual: no UI calls /password/forgot at all; the reset page says "Request a new one from the sign-in page" but the sign-in page has no such control and the error states have no back link. With a bad token the form submits and shows "This reset link is invalid or has expired" (correct); mismatch message "The two passwords do not match." works.

### ISS-INO-027 [severity: minor] Notifications drawer is static demo content
- Where: investee header bell
- Steps: click Notifications.
- Expected: items from the API (none / real).
- Actual: three hard-coded items ("Procurement request drill-down due soon", "Q2 report validation completed", "Consent request updated") with no network request; sidebar count badges (KPI 4, Reporting 4, Cap table 3, Messages 4) also unverified/static.

### ISS-INO-028 [severity: minor] Governance "Request approval" defaults to a stale past decision date and gives only "Request failed" when empty
- Where: http://localhost:48224/governance
- Steps: open the modal (Decision required by is pre-filled 14/08/2026); submit empty, then with just a matter and memo.
- Actual: empty submit toast "Request failed" with no field message; the request is created (GOV-0002) with due date 2026-08-14 (before today, 2026-10-03). The reporting calendar lists Aug 2026 (due 2026-09-05) as "open" with no overdue marker.

### ISS-INO-029 [severity: polish] Onboarding copy and resume behaviour
- Where: http://localhost:48223/
- Actual: UI states "Saved locally / Resume on this device" and "This client-side prototype does not fabricate external matches" / "recorded in this prototype" although the data is server-saved; resume after reload (local draft or ?resume= link) returns to step 1 not the last step; tax id and bank account are intentionally not restored and the user is not told. Public API accepted a name `<img src=x onerror=alert(1)>` (stored; admin rendering not checked).

### ISS-INO-030 [severity: polish] Investee login/session hydration is slow and unknown routes redirect to login
- Where: http://localhost:48224/login, any unauthenticated unknown path
- Actual: "Checking session..." for ~15-20s on first load in dev; unauthenticated /nonexistent redirects to /login?next=/nonexistent. API gating is correct: LP persona gets 403 on all investee-portal routes, investee persona gets 403 on /lp and client-ops routes, unauthenticated gets 401, logout invalidates the old cookie server-side (401).

## Coverage

| Page | Tested | Result |
|---|---|---|
| Investee login / session / sign-out | yes | works; no forgot link (026), slow hydrate (030) |
| Overview, Reports, KPI, Forecast | yes | ISS 002-003, 009, 010, 016 |
| Cap table, Workspace, Share links, Signature requests, public sign | yes | ISS 007, 008, 011-014, 018 |
| Requests, Data room, Messages, Team, Settings | yes | ISS 015, 019-021 |
| Signatures / Term sheet | yes | ISS 017; /terms empty state fine |
| Governance | yes | 028 |
| Notifications | yes | 027 |
| Reset password page | yes | 026 |
| Onboarding portal full flow (6 steps, upload, resume, submit) | yes | 022-025, 029 |
| Admin Onboarding review | partially (API only) | case present, 025 |
| Cross-portal gating, unauthenticated, logout | yes (API + shell) | 001, 030 |
| Role differences (viewer/contributor/approver) | partially | 006 |
| KPI export button, invite acceptance UI | partially | 009, 020 |

Counts by severity: blocker 0, major 11, minor 17, polish 2 (30 total).
