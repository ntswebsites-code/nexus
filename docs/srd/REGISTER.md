# SRD v2 — register of new requirements, rules, questions and defects

Generated from the section drafts. IDs continue the numbering in `docs/SRD.md`. "Source" is the draft and the section heading it came from.

## New functional requirements (377)

### AUD

| ID | Requirement | Acceptance criterion | Source |
| --- | --- | --- | --- |
| FR-AUD-003 | Filters for role and approval state, and a *Portal* select. | filtering "Portal = investor" returns only investor-portal events. | 5A-19-30 5.A.28 |
| FR-AUD-004 | Export includes a signed hash manifest (FR-AUD-002). | the manifest hash matches the CSV SHA-256 and the chain head. | 5A-19-30 5.A.28 |
| FR-AUD-005 | Audit chain verification endpoint recomputes the hash chain and returns rows checked and the first broken id. | altering any hashed field of a row makes `brokenAt` equal that row's id. | backend |
| FR-AUD-006 | Audit and access-review exports are themselves audited, and CSV cells are escaped against formula injection. | the export creates an `audit.exported` / `access_review.exported` event. | backend |

### AUTH

| ID | Requirement | Acceptance criterion | Source |
| --- | --- | --- | --- |
| FR-AUTH-018 | Custodian portal access — `custodian` portal id, counterparty-scoped users invited by operations, MFA, `/login`, `/invite`, `/reset-password` | an unauthenticated request to `/` redirects to `/login?next=/`; a user of counterparty A cannot see or submit for accounts of counterparty B. | 5C5E 5.E.0 |
| FR-AUTH-019 | Step-up confirmation endpoint re-verifies a TOTP code and marks the session step-up valid for 5 minutes; `GET /auth/mfa/status` reports enrolment. | approval call after a code more than 5 minutes old returns `step_up_required`; after `POST /auth/mfa/step-up` with a valid code the same call succeeds. | backend |
| FR-AUTH-020 | Invitation preview shows email, portal, expiry and whether an account already exists; an existing account accepts with its current password. | expired, revoked or used token returns 404; wrong password for an existing account returns 401. | backend |

### CASH

| ID | Requirement | Acceptance criterion | Source |
| --- | --- | --- | --- |
| FR-CASH-009 | The context bar filters balances, tiles, proof card and all four tables by client, portfolio, cash account and currency, and the *As of* control reconstructs balances at a past time | changing any selector refreshes every number from `GET /api/v1/cash/balances` within 2 seconds and an as-of in the past reproduces the figures reported at that time. | 5A-8-18 5.A.15 |
| FR-CASH-010 | Each tile's *Explain* shows the exact journals, reservations, holds and policy lines contributing to that state, and the available figure equals the displayed formula | for every state the sum of displayed contributing lines equals the tile value to the minor unit. | 5A-8-18 5.A.15 |
| FR-CASH-011 | Journal entry supports two or more lines, a mandatory reason and evidence reference, value date picker, currency locked to the account currency, amount greater than 0, and records direction from the lines instead of always as an outflow | a three-line journal that balances is accepted; a journal with currency different from the account is rejected with 400. | 5A-8-18 5.A.15 |
| FR-CASH-012 | Journal *Reject* requires a reason and moves the journal to REJECTED with an audit entry | rejecting without a reason returns 400; the rejected journal is read-only and shows the reason. | 5A-8-18 5.A.15 |
| FR-CASH-013 | Maker-checker for journals, reversals, reservations released on behalf of others, account lifecycle and statement commits is enforced on the authenticated user id | the same user approving their own journal or committing their own import receives 403 `sod_violation`. | 5A-8-18 5.A.15 |
| FR-CASH-014 | Reservation creation checks live available cash atomically, saves account, currency, required date and expiry, and updates all tiles | two concurrent reservations that together exceed available cash result in exactly one success and one 409. | 5A-8-18 5.A.15 |
| FR-CASH-015 | Submitting a buy order creates a linked cash reservation and the order ticket reads availability from the same service as the cash page | after submission the cash page RESERVED tile increases by notional plus estimated fees and the ticket shows the same available figure as the cash page for that account. | 5A-8-18 5.A.15 |
| FR-CASH-016 | Expected movements are persisted, gated by `cash.journal.create`, listed in the table and transition EXPECTED → DUE → POSTED when the linked journal posts | creating an expectation adds a row and changes only EXPECTED NET. | 5A-8-18 5.A.15 |
| FR-CASH-017 | Statement import parses CAMT.053 and CSV, maps the account and currency, normalises signs (positive = Matanho cash increased), checks opening + movements = closing within the account's tolerance profile, rejects duplicate file hash, statement and line, and freezes the reviewed staging version before commit | a file whose arithmetic is outside tolerance cannot reach PENDING_APPROVAL; re-uploading the same file returns 409. | 5A-8-18 5.A.15 |
| FR-CASH-018 | A close day / close period control with a blockers pre-check (statement coverage, balance variance, suspense, aged open items, sub-ledger-to-GL, checker approval) available to `cash.close` holders | close is refused with every blocker itemised until all pass; after close a journal dated in the period returns 409. | 5A-8-18 5.A.15 |
| FR-CASH-019 | Table filters, search and column sort on all four tabs, an empty-state message, and keyboard-accessible tabs with `aria-selected` | each tab filters by status and account and shows "No records" when empty. | 5A-8-18 5.A.15 |

### CLI

| ID | Requirement | Acceptance criterion | Source |
| --- | --- | --- | --- |
| FR-CLI-008 | The Relationships KPI shows the real count of non-archived clients, and the *Needs attention* KPI uses the same rule as the *Needs attention* tab | with 6 clients and 2 not Current the tile equals the number of attention items listed in the tab; the count matches the API total. | 5A-8-18 5.A.9 |
| FR-CLI-009 | Client creation assigns the reference only on the server (`CL-#####`) and the UI shows the server record once, without a local duplicate | creating two clients in one session yields two distinct references and two rows. | 5A-8-18 5.A.9 |
| FR-CLI-010 | Cash-account creation assigns the reference only on the server (`CCA-####`) and refuses a second active or draft account with the same provider, identifier and currency | duplicate request returns 409 and the form shows the message. | 5A-8-18 5.A.9 |
| FR-CLI-011 | The cash-account drawer offers *Reactivate* for SUSPENDED accounts to `cash.approve` holders (≠ maker) and offers *Submit for approval* only for DRAFT | SUSPENDED account shows *Reactivate*; no submit control for SUSPENDED/CLOSED. | 5A-8-18 5.A.9 |
| FR-CLI-012 | The client detail account rows and the registry show the account state badge next to the reconciliation text | a DRAFT account shows "DRAFT" and an amber badge. | 5A-8-18 5.A.9 |
| FR-CLI-013 | The cash-account list supports state filters for SUSPENDED and CLOSED and the CSV export honours the active search and state filter | exporting with filter ACTIVE yields only ACTIVE rows; the file name carries the export date. | 5A-8-18 5.A.9 |
| FR-CLI-014 | The cash-account list refreshes after any lifecycle action and after returning to the page | after *Approve account* the row shows ACTIVE without any further click. | 5A-8-18 5.A.9 |
| FR-CLI-015 | The relationship documents list reads the client's documents from `GET /api/v1/clients/{id}/360` (Document Vault) and previews the stored document | a document uploaded in the Vault for the client appears with its real date; generated placeholders are not shown. | 5A-8-18 5.A.9 |
| FR-CLI-016 | The Client second layer and Client 360 read live data (mandates, KYC cases, requests, portal users, pending invitations) from `GET /api/v1/clients/{id}/360` and drop the hard-coded constants | no constant metric remains; every value traces to a record. | 5A-8-18 5.A.9 |
| FR-CLI-017 | The relationship list gains a KYC / risk filter and server-side `q` search | filter "Enhanced review" lists only those clients. | 5A-8-18 5.A.9 |
| FR-CLI-018 | The client profile editor does not change KYC state; KYC state changes only through the KYC case workflow and relationship owner is chosen from staff users | no KYC select in the editor; owner is a user reference. | 5A-8-18 5.A.9 |
| FR-CLI-019 | The cash-account create form includes ownership model (SEGREGATED, OMNIBUS, HYBRID), portfolio list limited to the client's portfolios, and a reveal control for the identifier for `cash.approve` holders with step-up | reveal writes the audit event `cash_account.identifier_revealed`. | 5A-8-18 5.A.9 |
| FR-CLI-020 | A "Client portal" action opens the investor portal for the client on the correct host or is removed | the link never opens a not-found page. | 5A-8-18 5.A.9 |
| FR-CLI-021 | Sidebar and notification links open the Clients page directly (URL routing, `/#clients`) | following the notification link lands on Clients. | 5A-8-18 5.A.9 |
| FR-CLI-022 | Staff management of investor portal access per client: list members and pending invitations, invite with role and scope, remove a member or revoke an invitation. | removed member loses the investor role when they have no other client. | backend |

### CMP

| ID | Requirement | Acceptance criterion | Source |
| --- | --- | --- | --- |
| FR-CMP-008 | Every investee page loads only data of the active company and returns 403 `no_company_access` otherwise | a user without a `company_users` link sees an access screen, never fixtures. | 5D 5.D.0 |
| FR-CMP-009 | Remove the mock mode from production builds | `liveOnly:false` cannot be enabled when `NODE_ENV=production`; a visible "Demo data" ribbon is shown whenever any fixture is rendered. | 5D 5.D.0 |
| FR-CMP-010 | Notifications drawer lists the user's in-app notifications with read state and an unread badge | a staff action that notifies company users (e.g. period opened, report accepted/returned, term sheet issued, request decision) appears within 60 s. | 5D 5.D.0 |
| FR-CMP-011 | Global search is company-scoped and live | results contain only the company's reports, requests, vault documents, term-sheet sections and threads. | 5D 5.D.0 |
| FR-CMP-012 | Overview aggregates are served by one company-scoped endpoint | response contains metrics, readiness, upcoming submissions, investment snapshot, action items and the last six activities for the selected period, all derived from stored records. | 5D 5.D.1 |
| FR-CMP-013 | KPI register is built from staff-maintained KPI definitions plus accepted period values | each row shows value, target, direction-aware variance, owner, frequency, status (On track / Above target / Watch) and evidence flag; changing a definition is rejected for company users with `permission_denied`. | 5D 5.D.2 |
| FR-CMP-014 | *Submit period KPIs* stores revenue, net profit and cash flow net for a period that has an open request and recomputes derived KPIs | success toast "Period KPIs submitted"; no open request → 409 with message "No open reporting request found for reportingPeriod {date}. Matanho must open a request before KPI/file submission." | 5D 5.D.2 |
| FR-CMP-015 | Typed statement reports (income statement, balance sheet, cash flow, operational KPIs, narrative) belong to a reporting period | each has status Draft → Submitted → Accepted / Returned (+ Needs revision), line items stored as numeric JSON with per-line notes, and the period's pack status is derived from them. | 5D 5.D.3 |
| FR-CMP-016 | Report builder saves server-side drafts and restores them | reload shows the saved values, owner and notes; two members editing the same draft see "version conflict" (409 `version_conflict`). | 5D 5.D.3 |
| FR-CMP-017 | Evidence files upload through a real file control with extension/size validation before submit | invalid extension or size shows the error inline; accepted files appear in the report drawer after submit. | 5D 5.D.3 |
| FR-CMP-018 | Template downloads serve the correct `.xlsx` file for each report type via a signed URL | the downloaded workbook opens in Excel and carries the template version. | 5D 5.D.3 |
| FR-CMP-019 | Submit is blocked client- and server-side for balance-sheet imbalance, missing mandatory attachments and unexplained > 50% revenue falls | error text as in Business rules. | 5D 5.D.3 |
| FR-CMP-020 | Forecast model is persisted per company with versions, scenarios (Base, Upside, Downside, custom), sheets and cells | reload restores the last working version; submitted versions are read-only and visible to staff in Private Markets. | 5D 5.D.4 |
| FR-CMP-021 | Actuals months are populated only from accepted reports and are locked | editing a locked cell is refused server-side with `locked`. | 5D 5.D.4 |
| FR-CMP-022 | Export produces an `.xlsx` with all sheets and formulas | file downloads from a signed URL. | 5D 5.D.4 |
| FR-CMP-023 | Term sheet view shows structured terms (security, liquidation preference, participation, conversion, anti-dilution, dividend, vesting, information rights, reserved matters, board rights, ESG) and key dates from stored records | each section renders only the fields the fund published; unpublished sections are hidden. | 5D 5.D.5 |
| FR-CMP-024 | The company can download the executed term sheet and governing documents via signed URLs | URL expires in 300 s; download is audited. | 5D 5.D.5 |
| FR-CMP-025 | A clarification question creates a Messages thread to the fund legal team | thread visible to both sides; toast "Question sent". | 5D 5.D.5 |
| FR-CMP-026 | Cap table page renders the published register | holders, classes, FD %, option pool and "as at" date come from the registry; shares × price reconcile to the register; unpublished registries show an empty state. | 5D 5.D.6 |
| FR-CMP-027 | Dilution simulator uses the server simulator with the company's actual FD count, notes and pool top-up | result equals the NVCCZ formulas above for identical inputs. | 5D 5.D.6 |
| FR-CMP-028 | Cap-table export (xlsx) and stock-certificate download (signed URL) | certificate hash (SHA-256) is verifiable. | 5D 5.D.6 |
| FR-CMP-029 | Governance register stores consent requests, decisions, actions and the board calendar | a submitted request is visible to fund staff in Private Markets with the company, matter, memo and papers, and the decision returns to the company page and notifies the requester. | 5D 5.D.7 |
| FR-CMP-030 | Reserved-matter definitions (name, threshold, basis, notice period) are maintained by fund staff per company | the Approval category list and the guide are generated from them. | 5D 5.D.7 |
| FR-CMP-031 | General signature requests (funding documents, written resolutions, acknowledgements) are created by fund staff or company authority holders and signed natively | each signatory signs once; the last signature locks the document and issues a certificate; both sides see the audit trail. | 5D 5.D.8 |
| FR-CMP-032 | Decline requires a reason and notifies the requester | status Declined; request can be voided and re-issued. | 5D 5.D.8 |
| FR-CMP-033 | Signing authorities per company are configurable by fund staff | a user outside the authority sees the request but no *Review & sign* button. | 5D 5.D.8 |
| FR-CMP-034 | Requests persist as Draft, Submitted, Under review, Approved, Fulfilled, Returned/Rejected with reason | refresh shows the same state; rejection reason is visible on the card and drawer; resubmission requires an edit. | 5D 5.D.9 |
| FR-CMP-035 | Tranche panel shows committed, reserved, available and approved-to-date and blocks over-draw | submitting an amount above *available* is refused with "Drawdown Request Exceeds Available Investment Tranche." | 5D 5.D.9 |
| FR-CMP-036 | Drill-down thread — fund staff ask for evidence (quotations, budgets), the company answers with files, each answer audited | card shows "Drill-down requested" while a question is open. | 5D 5.D.9 |
| FR-CMP-037 | Search, type and priority filters work client- or server-side | filtering by *Procurement requests* hides capital cards and updates counts. | 5D 5.D.9 |
| FR-CMP-038 | Company users upload, version, share and download documents with access profiles | uploaded file appears in the folder with version, owner and size; fund staff see it only when the access profile permits; each upload/download/share is an audit event. | 5D 5.D.10 |
| FR-CMP-039 | Staff-published documents (term sheet, SHA, board packs, guides, templates) appear in the vault read-only | documents published to the company (Nexus `documents.companyId`, status Published) show with Final version and signature state. | 5D 5.D.10 |
| FR-CMP-040 | Folder search and access filter operate on name, folder, owner, version and access | typing filters rows within 200 ms. | 5D 5.D.10 |
| FR-CMP-041 | Company ↔ fund-team threads persist with participants, read state and notifications | a message posted by staff appears for company members within 60 s with an unread count; reload preserves history. | 5D 5.D.11 |
| FR-CMP-042 | Search filters threads by subject, participant and text | matching threads only. | 5D 5.D.11 |
| FR-CMP-043 | Members list, invite, profile change, disable and removal for company administrators | invited user receives a link; accepting adds a `company_users` row with the chosen profile; removal revokes access immediately and invalidates sessions of that company context. | 5D 5.D.12 |
| FR-CMP-044 | External-access log shows fund-side users who viewed or downloaded company data | derived from audit events (`document.downloaded`, `reporting.file.downloaded`). | 5D 5.D.12 |
| FR-CMP-045 | Settings load and save the company profile, user profile, letterhead (with logo) and notification preferences | reload shows the saved values; invalid e-mail/URL are rejected with field messages; a non-administrator cannot change company fields (403). | 5D 5.D.13 |
| FR-CMP-046 | Security card shows the real MFA state and session timeout of the account | values equal the platform policy and the user's factor status. | 5D 5.D.13 |
| FR-CMP-047 | Staff open a reporting period (YYYY-MM, due date) from the 5-item template, invite company users, update covenants and download submitted files (audited). | duplicate period returns 409 `duplicate`. | backend |
| FR-CMP-048 | Company users can remove non-accepted files while a pack is open or returned, and resolve question threads. | removing an Accepted file returns 409. | backend |

### COP

| ID | Requirement | Acceptance criterion | Source |
| --- | --- | --- | --- |
| FR-COP-002 | Conversations persisted with question, answer, cited object IDs, model version and the user's entitlement snapshot. | reopening history shows the same citations; a citation outside current entitlement renders as "restricted". | 5A-19-30 5.A.25 |

### DASH

| ID | Requirement | Acceptance criterion | Source |
| --- | --- | --- | --- |
| FR-DASH-001 | KPI tiles, scope chips and chart come from `GET /api/v1/dashboard/summary?scope=` and `GET /api/v1/performance/series?range=&scope=` | changing scope changes every scope-dependent number including the sub-text; no scope uses a client-side scale factor. | 5A-0-7 5.A.1 |
| FR-DASH-002 | chart ranges 1M/3M/YTD/1Y show period returns | the 1M end value equals the 1-month return, not the YTD level. | 5A-0-7 5.A.1 |
| FR-DASH-003 | a KPI tile changes colour when its control is within 15 % of the limit (amber) or breached (red) | liquidity cover below 1.25× turns the tile red. | 5A-0-7 5.A.1 |
| FR-DASH-004 | worklist and decision queue are served per user from the work-item API and show "Nothing needs your decision" when empty | items open an existing screen; no item opens a fallback screen. | 5A-0-7 5.A.1 |
| FR-DASH-005 | the *Investment pack* button generates and downloads a PDF using the Investment Committee Pack template | file is produced for users with `reports.create`; others see the button disabled with a tooltip. | 5A-0-7 5.A.1 |

### DATA

| ID | Requirement | Acceptance criterion | Source |
| --- | --- | --- | --- |
| FR-DATA-003 | Connection register persisted with test result, timestamp and owner (FR-DATA-001). | after reload the saved connection shows its last test time. | 5A-19-30 5.A.23 |
| FR-DATA-004 | Integration registry persisted server-side with secret references, test history and health (FR-DATA-001). | the secret never appears in any API response; *Test* records a timestamp and outcome. | 5A-19-30 5.A.27 |

### DOC

| ID | Requirement | Acceptance criterion | Source |
| --- | --- | --- | --- |
| FR-DOC-007 | *+ Report* opens a definition form requiring title, type, audience, frequency, reporting period and data products, and creates a report in status Draft owned by the current user | submitting with any required field empty shows the field error and creates nothing; a valid submit adds the row to the library with status *Draft* and an audit event. | 5A-8-18 5.A.12 |
| FR-DOC-008 | report editor reachable from a report row (Edit/Open) for Draft reports and from Clients for a client report; Save persists content and increments a version; Submit moves Draft → In review | reopening a saved draft shows the saved content; Submit disabled without `reports.create`. | 5A-8-18 5.A.12 |
| FR-DOC-009 | report approval enforces maker ≠ checker and the approval route (Review · Compliance, Approve · Investment Director, Publish · Client Services) | the maker cannot approve their own report; a published report cannot return to Draft without a new version. | 5A-8-18 5.A.12 |
| FR-DOC-010 | *Schedules* opens a schedule manager (report/template, frequency, run time, reviewer, due offset, recipients) producing a Draft report for review on each run | a schedule due today creates one Draft and no Published output. | 5A-8-18 5.A.12 |
| FR-DOC-011 | report previews render per report type (Investor, Investment committee, Risk, Management, Regulatory) with report-specific data and explicit source lineage | two reports of different types show different sections; every metric shows its source. | 5A-8-18 5.A.12 |
| FR-DOC-012 | *Export register* and *Export PDF package* produce the filtered CSV and an approved PDF with evidence manifest from the API | PDF generated only for an Approved or Published report and audited. | 5A-8-18 5.A.12 |
| FR-DOC-013 | `reports.create` gates +Report, Save draft, Submit; Auditor is view-only | with only `reports.view` these controls are disabled with title "Not permitted for <role>". | 5A-8-18 5.A.12 |
| FR-DOC-014 | row click opens the document modal (metadata, access, version history, lifecycle) over the live document list | clicking any row loads the document by reference and shows its API metadata and versions. | 5A-8-18 5.A.13 |
| FR-DOC-015 | *Upload document* opens a form capturing name, type, classification (required), client, related record, document date, requires-signature, retention years and file | submit with a missing required field shows the field error and sends nothing; a valid submit creates a Draft with version 1, an audit event and a toast "Document uploaded". | 5A-8-18 5.A.13 |
| FR-DOC-016 | upload validation allows pdf, docx, xlsx, csv, png, jpg up to 25 MB, requires a malware scan result of clean before the file is available for preview or download | an infected or unscanned file is held and cannot be downloaded. | 5A-8-18 5.A.13 |
| FR-DOC-017 | *Retention policy* opens a screen listing retention schedules and legal holds with create/edit and a hold flag that blocks deletion/expiry | a document under hold cannot be purged; schedule changes are audited. | 5A-8-18 5.A.13 |
| FR-DOC-018 | wire Updated from, Signature state and a classification filter, add a filter reset and an empty-state message "No documents match the selected filters." | each filter changes the result set; clearing restores all rows. | 5A-8-18 5.A.13 |
| FR-DOC-019 | compute KPI tiles from data (documents, needs signature, expiring in 30 days, restricted, evidence packs, retention holds) | tile values equal the corresponding counts of the filtered or total register as specified. | 5A-8-18 5.A.13 |
| FR-DOC-020 | preview renders the original file (PDF/image) alongside metadata for uploaded documents and business-specific templates for system-generated records, with access logging | opening a document records an audit event; an uploaded PDF displays its own pages. | 5A-8-18 5.A.13 |
| FR-DOC-021 | enforce `documents.edit` on Upload, Create new version, Edit and lifecycle actions in the UI, disabled with title "Not permitted for <role>" | Dealer and Auditor see these controls disabled. | 5A-8-18 5.A.13 |
| FR-DOC-022 | replace `prompt()` dialogs with modal forms (reason min 3 characters; client picker for publish) | submit disabled until the reason has at least 3 characters. | 5A-8-18 5.A.13 |
| FR-DOC-023 | Report editor persists versions, binds numeric fields to approved data for the chosen period and currency, and flags manual overrides. | changing *Reporting currency* to USD re-renders the bound values; an edited bound number shows an "override" marker and is audited. | 5A-19-30 5.A.30 |
| FR-DOC-024 | Documents can be returned (with reason) from In review or Approved, and withdrawn per client or globally (cancelling pending signature requests). A new version resets the document to Draft and withdraws its publications. | investor loses access immediately after withdrawal or after a new version. | backend |
| FR-DOC-025 | All binaries are stored AES-256-GCM encrypted with a SHA-256 of the plaintext, and downloaded only through HMAC-signed URLs (5 min) issued after an entitlement check. | a tampered or expired signature returns 403 `invalid_signature`. | backend |

### FIN

| ID | Requirement | Acceptance criterion | Source |
| --- | --- | --- | --- |
| FR-FIN-004 | Margin disposition (resolve dispute / mark funded) requires `financing.manage` (Q-04), a reason, and an independent checker. | the maker cannot fund their own proposed disposition (403); an audit event with before/after state is written. | 5A-19-30 5.A.20 |
| FR-FIN-005 | Statement import parses rows into margin calls after schema and control-total validation. | a CSV with a mismatched control total is rejected and no call changes. | 5A-19-30 5.A.20 |

### IBOR

| ID | Requirement | Acceptance criterion | Source |
| --- | --- | --- | --- |
| FR-IBOR-001 | As-of control in the *Historical snapshot* drawer with date and time | choosing a past business timestamp reloads the table, KPIs, ladder and control bar from effective-time records and labels the page "As-was" **[P]**. | 5A-8-18 5.A.14 |
| FR-IBOR-002 | Position list from `GET /api/v1/ibor/positions` with server-side search (ticker, name, portfolio, asset class, ISIN), filters, sorting and paging | a 50 000-position book returns the first page in the response-time target of section 8.1; filters AND-combine; the count label shows the total matching rows. | 5A-8-18 5.A.14 |
| FR-IBOR-003 | As-of snapshot | choosing a past timestamp returns the positions, cash, unsettled activity and prices at that time, and the page is labelled as a historical view. | 5A-8-18 5.A.14 |
| FR-IBOR-004 | *Refresh IBOR* as an asynchronous job with visible status | the button shows queued / running / complete / failed; on completion the table, KPIs, as-of and ladder reload; an operations permission is required. | 5A-8-18 5.A.14 |
| FR-IBOR-005 | KPI tiles and chip computed from the position aggregates | Positions, Market value, Available cash, Unsettled buys, Accrued income and Exceptions equal the aggregates of the data in scope. | 5A-8-18 5.A.14 |
| FR-IBOR-006 | Position detail with real tax lots, reconciliation difference and event history per position | the Lots tab quantities sum to the position quantity; the Reconciliation tab shows the actual custodian difference; the History tab lists the sequenced events for that position. | 5A-8-18 5.A.14 |
| FR-IBOR-007 | Column chooser | selected column groups persist per user and the table shows exactly the chosen groups. | 5A-8-18 5.A.14 |
| FR-IBOR-008 | Settlement ladder in base currency with a currency breakdown | each bucket total equals the sum of pending settlements for that date. | 5A-8-18 5.A.14 |

### INV

| ID | Requirement | Acceptance criterion | Source |
| --- | --- | --- | --- |
| FR-INV-011 | The page shall provide a portal-access management panel (list members and pending invitations per client; invite with email, name, role admin, investment, finance or auditor, and scope; revoke) for users with `clients.edit` | inviting creates a pending invitation visible in the list; revoking removes access and the user can no longer sign in to that client's data; each action is audited. | 5A-8-18 5.A.10 |
| FR-INV-012 | The capital event form shall let the maker choose the vehicle from the private-investment register and show the calculated per-investor allocation before the drafts are created | preview rows sum exactly to the gross amount; the preview shows an error when no investor holds an open commitment. | 5A-8-18 5.A.10 |
| FR-INV-013 | The notice date and an optional notice document shall be stored on every capital event | the investor portal shows the notice date and can download the attached notice. | 5A-8-18 5.A.10 |
| FR-INV-014 | The service desk KPI tiles shall be computed from live data | each tile equals the count or amount of the rows it summarises, and the sidebar badge equals the count of open work items for the signed-in role. | 5A-8-18 5.A.10 |
| FR-INV-015 | *New secure message* shall create a thread through `POST /api/v1/message-threads` and show "Message sent" | the thread appears in the investor portal messages with an unread badge and in the staff queue after the investor replies. | 5A-8-18 5.A.10 |
| FR-INV-016 | The workspace shall include a capital-event list with status filter and history (including `Funded` and `Paid`) | a settled notice remains listed with approver, matcher and evidence file. | 5A-8-18 5.A.10 |
| FR-INV-017 | Action buttons shall be hidden or disabled when the user lacks the required permission, with a tooltip stating the permission | a user without `clients.edit` does not see *+ Service request*, or sees it disabled with a tooltip. | 5A-8-18 5.A.10 |
| FR-INV-018 | The Investor portal button shall open the investor portal at the configured portal URL | the button opens a working login page in a new tab in every environment. | 5A-8-18 5.A.10 |
| FR-INV-019 | Investor portfolio data is served from a **published investor snapshot** (valuation-dated import of investments, holdings, transactions, performance, allocation, FX, metrics). A different user (policy `client_publish_approval`) publishes it with step-up; publishing supersedes the previous snapshot. | investors see only the latest Published snapshot; the importer publishing their own snapshot gets 403 `sod_violation`. | backend |
| FR-INV-020 | Fund-level capital event allocation creates one Draft notice per investor holding the vehicle, pro-rata to unfunded commitment (calls) or commitment (other types). | allocations sum exactly to the fund amount. | backend |
| FR-INV-021 | Capital notice lifecycle: staff create → independent approve (step-up) → publish (email to investors) → settle/match (step-up; matcher ≠ evidence submitter). | see 7.3. | backend |
| FR-INV-022 | A single investor bootstrap endpoint returns all entitled portal data in one call, with sections empty where the role lacks the permission. | an auditor role receives no capital or requests data. | backend |
| FR-INV-023 | Document read receipts and unread flags per investor user. | after download or mark-read the document is no longer unread. | backend |

### LP

| ID | Requirement | Acceptance criterion | Source |
| --- | --- | --- | --- |
| FR-LP-001 | the as-of date is limited to dates that have an approved valuation snapshot, no later than the latest approved `asOfDate` | a future or unsnapshotted date shows an inline message and is not sent | 5B 5.B.0 |
| FR-LP-002 | the LP session (`GET /lp-portal/session`) is derived from the signed-in Nexus user (`client_users` membership → client, LP role, entitled funds, unread counts), never from a constant | two users of two clients receive disjoint `client` and `funds`; a user with no membership receives 403 `no_client_access` and the shell shows an access-denied page. | 5B 5.B.0 |
| FR-LP-003 | show a full-width error banner with a *Retry* action when the session load fails, and a skeleton while it loads | with the API stopped the shell shows "Unable to load your portal session" and *Retry* refetches. | 5B 5.B.0 |
| FR-LP-004 | a user who belongs to several clients (Q-23) gets a client switcher in the identity block; the selected client is sent as `?client=`/header and revalidated on the server | switching client reloads every screen with disjoint data. | 5B 5.B.0 |
| FR-LP-005 | persist sidebar collapsed state and last selected fund per user (browser storage or `display` settings) | after reload the same fund is selected. | 5B 5.B.0 |
| FR-LP-006 | realtime or polling — the shell refreshes `unreadCounts` and notifications at least every `pollingIntervalMs` (default 30 000 ms) when the tab is visible | a staff reply raises the *Messages* badge within 30 s without reload. | 5B 5.B.0 |
| FR-LP-007 | The dashboard KPI payload is computed from approved, immutable investor snapshots for the investor's entitled funds, with the formulas of Business rules | for a seeded investor with commitment 5 000 000, called 3 900 000, paid-in 3 750 000, distributions 1 820 000 and NAV 4 420 000 the API returns unfunded 1 100 000, outstandingCalled 150 000, DPI 0.49, RVPI 1.18 and TVPI 1.66. | 5B 5.B.1 |
| FR-LP-008 | The consolidated dashboard (*All Funds*) sums the amounts across entitled funds and recomputes the multiples from the sums | with two PRIVATE_CAPITAL funds the tile values equal the sum of the two single-fund dashboards and TVPI equals (Σ distributions + Σ NAV) ÷ Σ paid-in. | 5B 5.B.1 |
| FR-LP-009 | The KPI strip and the history subtitle show the as-of date and the valuation status of the figures, with a distinct badge for ESTIMATED, PROVISIONAL and RESTATED | a fund whose latest snapshot is PROVISIONAL shows *PROVISIONAL* next to every value derived from it. | 5B 5.B.1 |
| FR-LP-010 | Each KPI and chart info control opens a popover with the definition and formula of the measure (commitment, paid-in, unfunded, NAV, distributions, DPI, RVPI, TVPI, Net IRR) and the as-of date | activating the control by mouse or keyboard shows the text and Escape closes it. | 5B 5.B.1 |
| FR-LP-011 | The dashboard shows the operating-model-specific KPI set (see Business rules) | selecting an OPEN_ENDED fund hides commitment, DPI, RVPI and TVPI and shows Account Value, Units Held, NAV Per Unit and YTD Return. | 5B 5.B.1 |
| FR-LP-012 | Recent-activity rows show the item title, status and a link to the specific record, and omit the amount for non-monetary items | a published document row shows its title, status *PUBLISHED* and no amount, and opens `/lp-portal/documents?document={id}`. | 5B 5.B.1 |
| FR-LP-013 | Actions Required is empty-state aware, shows overdue items distinctly from upcoming ones and respects the fund selector when a fund is selected | with no open items the panel shows *No actions required*; with a fund selected only that fund's items and fund-less items show. | 5B 5.B.1 |
| FR-LP-014 | The document download shows a toast on failure and saves the file with its extension | a failed request shows an error toast; a PDF is saved as `{name}.pdf`. | 5B 5.B.1 |
| FR-LP-015 | Latest Documents & Notices lists the most recent documents and notices together, newest first | a notice published after the newest document appears at the top with a link to `/lp-portal/notices?id={id}`. | 5B 5.B.1 |
| FR-LP-016 | The Performance page loads the performance, history, by-fund and benchmark data from approved snapshots with period, as-of date and fund filters honoured by the API | changing *Period* from *Since Inception* to *1 Year* changes the KPI values and the history window; changing the as-of date to a prior quarter-end returns the figures of the snapshot at that date. | 5B 5.B.2 |
| FR-LP-017 | The KPI row shows the measure set of the selected fund's operating model, and shows *—* for any measure that is null | selecting an OPEN_ENDED fund shows Account Value, Units Held, NAV Per Unit and YTD Return and no IRR, TVPI, DPI or RVPI; a null Net IRR on a private-capital fund shows *—*. | 5B 5.B.2 |
| FR-LP-018 | Each KPI and chart info popover shows the definition, formula, period and as-of date of the measure | the TVPI popover reads "(Distributions + residual NAV) ÷ Paid-In capital" and the as-of date. | 5B 5.B.2 |
| FR-LP-019 | The trend arrow on a KPI shows the direction of change against the previous approved snapshot (up, down, none) or is removed | a Net IRR lower than the previous snapshot shows a red down arrow; no previous snapshot shows no arrow. | 5B 5.B.2 |
| FR-LP-020 | The valuation status card shows the real status with a colour per status, and the page shows the snapshot's calculation date, version, source module and approver | a PROVISIONAL snapshot shows an amber *PROVISIONAL* card and the approver is displayed for a FINAL snapshot. | 5B 5.B.2 |
| FR-LP-021 | The Benchmark Comparison panel plots the investor's value and the benchmark value of the chosen metric for the as-of date and the series over time, with an axis that follows the metric, and states when no approved series exists | with an approved Cambridge series the fund bar and the benchmark bar for the same date are shown; without a series the message *No approved CAMBRIDGE series is configured for NET_IRR.* is shown and no bars. | 5B 5.B.2 |
| FR-LP-022 | The Benchmark column of the fund table shows the benchmark value per fund for the as-of date, or *—* | two funds with different benchmarks show different values; a fund without an approved series shows *—*. | 5B 5.B.2 |
| FR-LP-023 | The Capital Activity chart shows called capital (capital calls) and paid-in separately, using the called amount as the calls bar | for called 3 900 000 and paid-in 3 750 000 the bars read *($3.90M)* and *($3.75M)*. | 5B 5.B.2 |
| FR-LP-024 | The performance report is generated as an asynchronous job with the selected fund, period, benchmark and as-of date, and one status vocabulary (QUEUED, RUNNING, COMPLETED, FAILED, CANCELLED) | *Download Report* with Period *1 Year* produces a PDF whose period is 1 year; FAILED shows the job's error text in a toast; CANCELLED shows "Report generation was cancelled"; after the timeout a toast states the report is still being prepared. | 5B 5.B.2 |
| FR-LP-025 | The *Download Report* button shows progress while the job runs | label changes to *Preparing report…* and the button is disabled until a terminal state. | 5B 5.B.2 |
| FR-LP-026 | The downloaded file uses the server file name | the saved file is named `fund-performance-{fund}-{as-of date}.pdf`. | 5B 5.B.2 |
| FR-LP-027 | Performance report generation and download write audit events | an audit record exists for each download with the user, client, fund, period and job id. | 5B 5.B.2 |
| FR-LP-028 | Define one status vocabulary for ledger entries and give every value a badge colour per the design legend (green completed / paid / posted, blue active / issued / allocated, amber pending, red cancelled / rejected, purple under review) and a filter option. | no row renders an unstyled badge; every status returned by the API appears in the Status filter; an unknown status renders a neutral grey badge with its text. | 5B 5.B.3 |
| FR-LP-029 | The activity API returns `entryId`, business `reference`, controlled `entryType`, `transactionDate`, `effectiveDate`, `originalAmount` + `originalCurrency`, `reportingAmount` + `reportingCurrency`, historic `exchangeRate` + `fxDate`, `status`, `postedDate`, `postedBy` (display name or "System"), `notes` and `documents[]`; the UI shows them without derivation. | a multi-currency entry shows distinct original and reporting amounts and its historic rate; changing the display currency never changes the stored rate. | 5B 5.B.3 |
| FR-LP-030 | Entries of type other than the five tile kinds are not counted as contributions; tiles list only the five kinds; an "Other" line is not added to the net. | txn-1000 ("OTHER", 0.00) is excluded from every tile's count. | 5B 5.B.3 |
| FR-LP-031 | The KPI tiles, the transactions count and the exports respect the same filters as the table (or the tiles state "All entries in scope"). | after selecting Status "Posted" the tile counts equal the number of Posted rows, or the tile caption reads "{n} in scope"; an export after filtering contains exactly the rows shown. | 5B 5.B.3 |
| FR-LP-032 | The activity list is sorted by transaction date descending (then entry id descending) by the API, accepts `sortBy`, `sortDirection`, `type`, `status`, `currency`, `structure`, `search` and `page` / `pageSize`, and the UI pages server side with the real `total`. | with more than 100 entries every entry is reachable; the *Transaction Date ↓* header matches the order. | 5B 5.B.3 |
| FR-LP-033 | Export returns real files: CSV (`text/csv`), XLSX (`application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`) and PDF (`application/pdf`) with the columns of the table (Transaction Date, Effective Date, Fund, Type, Reference, Currency, Original Amount, Reporting Amount, Exchange Rate, Status); error body `LP_EXPORT_FAILED`. | each file opens in its native application; the CSV header names match the column titles. (The real NVCCZ endpoint returns a CSV with blank id and type columns and JSON for xlsx / pdf.) | 5B 5.B.3 |
| FR-LP-034 | closing the drawer keeps it closed until another row is chosen; `?entry=` selects that entry (loading it by id even when it is outside the current filter) and scrolls it into view. | closing leaves no drawer; a shared link opens with the entry selected. | 5B 5.B.3 |
| FR-LP-035 | compact money places the sign before the symbol (`-$666.4K`); min / max compare absolute amounts. | `-666400` -> `-$666.4K`; Min 100 000 shows the 490 000 distribution. | 5B 5.B.3 |
| FR-LP-036 | the detail response has a typed shape per entry type (capital call: allocation, payments, notice; payment; distribution: allocation, payments, statement; subscription / redemption: request summary) and the drawer titles the block by type and formats money. | every entry type opens without error; subscription and redemption entries no longer answer 404. | 5B 5.B.3 |
| FR-LP-037 | ignore responses for a row that is no longer selected. | rapid row changes always show the last-selected row's detail. | 5B 5.B.3 |
| FR-LP-038 | the call badge supports ISSUED (blue), ACKNOWLEDGED (blue), PARTIALLY_PAID (amber), PAID (green), OVERDUE (red) and CANCELLED (grey), and OVERDUE is evaluated before ACKNOWLEDGED (any unpaid past-due call is OVERDUE). | an acknowledged, unpaid call past its due date shows *Overdue* in red and counts in the *Overdue Calls* tile. | 5B 5.B.4 |
| FR-LP-039 | the line reads "(in {n} days)" for 2 or more days, "(in 1 day)", "(due today)", "({n} days overdue)" / "(1 day overdue)" for unpaid past-due calls, and nothing for paid calls. | due 20 Jul with today 1 Oct and unpaid -> "(73 days overdue)". | 5B 5.B.4 |
| FR-LP-040 | closing the panel keeps it closed until a row is selected; the first call is auto-selected only on the first load. | clicking X leaves no panel. | 5B 5.B.4 |
| FR-LP-041 | *Submit Payment Confirmation* opens a dialog with the file (required), *Amount claimed* (optional, greater than 0, at most 2 decimals, not above the outstanding amount) and *Notes* (optional), a file summary (name, size), a progress state and the validations "File too large (maximum 25 MB)", "Unsupported file type", "Enter an amount greater than 0 and not above the outstanding amount". | oversized or wrong-type files are rejected before upload; the sent form contains `file`, `amountClaimed`, `notes`. | 5B 5.B.4 |
| FR-LP-042 | reject oversize with 413 `LP_FILE_TOO_LARGE`, hash the file content into the idempotency check, virus-scan and audit the SHA-256. | a 26 MB file returns 413 with `fieldErrors.file`. | 5B 5.B.4 |
| FR-LP-043 | The call detail lists previous payment confirmations (file name, amount claimed, uploaded at, SHA-256 prefix) so the investor sees what was sent; a confirmation changes no status. | after an upload the confirmation is listed in the panel and the timeline is unchanged. | 5B 5.B.4 |
| FR-LP-044 | the notice endpoint streams the published call-notice PDF (`application/pdf`) and the UI names files from the response's `Content-Disposition`. | the saved file opens as a PDF with the correct name. | 5B 5.B.4 |
| FR-LP-045 | Distribution detail drawer (required by the design: fund, reference, gross, adjustments, net, payment date, currency, masked bank destination, supporting document) opened by clicking a row, backed by `GET /lp-portal/distributions/{id}`. | clicking DIST-008 shows all eight fields and the masked bank "•••• 7719"; account numbers are never shown in full. | 5B 5.B.4 |
| FR-LP-046 | Distribution type and status: show *Return of Capital*, *Realisation Proceeds*, *Dividend*, *Interest*, *Income*, *Other* as sent by the API and a status badge (PENDING amber, PAID green). | an `INTEREST` distribution does not display "Return of Capital". | 5B 5.B.4 |
| FR-LP-047 | compute from `gross`/`netPaid`, currency from the fund, and *Paid Calls* by payment date. | the *Total Distributions* tile equals the sum of the listed net-paid amounts. | 5B 5.B.4 |
| FR-LP-048 | "All Funds" aggregates every entitled fund; empty tables show "No capital calls for the selected scope." and "No distributions for the selected scope." | the tiles equal the sum over the funds in scope. | 5B 5.B.4 |
| FR-LP-049 | Loading and empty states for both tables (skeleton rows) and a visible error for a partial failure ("Could not load distributions" with *Try Again*). | a failed distributions request is visible while calls still display. | 5B 5.B.4 |
| FR-LP-050 | Paging: the UI requests `page` / `pageSize` and the *View all* control loads further pages; `status` filter (Issued, Acknowledged, Partially Paid, Paid, Overdue) on the calls table; default sort by issue date descending, then call number descending; distributions by payment date descending. | more than 50 calls are reachable; the order is stable. | 5B 5.B.4 |
| FR-LP-051 | the line shows the document's real file type and a formatted date. | "PDF · Jul 1, 2026". | 5B 5.B.4 |
| FR-LP-052 | one key per user intent, reused for automatic retries. | a retried acknowledgement never produces a duplicate record. | 5B 5.B.4 |
| FR-LP-053 | Disabled controls for a VIEWER carry a tooltip "Only authorised signatories can acknowledge capital calls" / "...submit payment confirmations", and write controls stay disabled until the session has loaded. | a VIEWER sees the explanation; no write control is enabled while the role is unknown. | 5B 5.B.4 |
| FR-LP-054 | the service returns structured wiring fields plus a display text in which the account number is masked, and the unmasked number only on an explicit reveal. | the preview never contains more than the last four digits. | 5B 5.B.4 |
| FR-LP-055 | Refresh when new capital activity is published (a new call, a status change, a new distribution) — a realtime event or a refresh interval; today nothing refreshes the page. Q-114: Which event name? — default: reuse the notification event and refresh on `lp_notification`. | — | 5B 5.B.4 |
| FR-LP-056 | amounts use the call's or distribution's currency with the currency symbol and 2 decimals. | a EUR call shows "€150,000.00". | 5B 5.B.4 |
| FR-LP-057 | The compliance block is computed at request time from the client's accreditation, KYC status, open capital calls past due and legal holds, and the same checks are enforced on estimate and submit. | for a client with an unmet check the estimate and submit calls fail with `LP_COMPLIANCE_HOLD` and the page shows each failed check, the hold reason and disables both submit buttons. | 5B 5.B.5 |
| FR-LP-058 | Staff-side endpoints (not part of the investor portal) move a dealing request through its statuses with a recorded actor, timestamp and reason, enforce maker-checker where the actor who allocates units is not the actor who submitted the request on the investor's behalf, and write the allocated units, final NAV and settlement date back to the request. | an investor-visible status changes only through those endpoints; each change appears in the audit log and raises the investor notification "Redemption {reference} {status}" and, for `AWAITING_FUNDS`, an action on the investor dashboard. | 5B 5.B.5 |
| FR-LP-059 | The export honours all three filters (fund, type, status), quotes and escapes CSV values, returns an `.xlsx` workbook when `format=xlsx`, and is not truncated to the first page. | the file for "Subscriptions + Allocated" contains exactly the rows the table shows with those filters, in the same order, and opens in a spreadsheet without column shifts. | 5B 5.B.5 |
| FR-LP-060 | The page applies the investor's role: for *VIEWER* the two forms stay usable for estimates but both submit buttons and the document upload are disabled with the text "Your role can view and estimate. Submitting requests requires an Authorised Signatory." | a *VIEWER* session cannot trigger a submit call from the UI and a forced call returns 403. | 5B 5.B.5 |
| FR-LP-061 | The page keeps the selected fund in the URL (`?fund=`), honours the topbar fund selector when it holds an open-ended fund, and applies `?type=` also to the history type filter. | opening `?type=redemptions` pre-selects *Redemptions* in the type filter and scrolls the redemption card into view. | 5B 5.B.5 |
| FR-LP-062 | The history is paginated (page size 25, page controls, total count) and sortable by *Submitted On*, *Amount / Units* and *Status*; the status filter is applied on the server and passed to the export. | a client with 120 requests can reach every request; filter and export produce the same rows. | 5B 5.B.5 |
| FR-LP-063 | The request detail shows the request reference, type, fund, share class, requested amount or units and mode, estimate (with the estimate date and "indicative" label), bank account (masked), dealing date, expected funding date, expected settlement date, allocated units and final NAV once known, status history with timestamps, uploaded documents with download links, and the investor notes. | every field is present for a request in each status and read from the request API, not from the list row. | 5B 5.B.5 |
| FR-LP-064 | The page refreshes when a request changes status (real-time event `lp_dealing_updated` or polling every 60 seconds), updating the KPIs, the table and an open dialog. | a status change made by staff is visible within 60 seconds without reloading. | 5B 5.B.5 |
| FR-LP-065 | An investor note field is offered on both forms and sent as `investorNotes` (subscription) / `notes` (redemption). | the note appears in the request detail. | 5B 5.B.5 |
| FR-LP-066 | A human-readable request reference (for example `SUB-000024`, `RDM-000016`) is generated per request and used in the table, the notifications and Account Activity. | the reference in the notification text equals the ID column. | 5B 5.B.5 |
| FR-LP-067 | the register is paged on the server with the same page size for fetch and display, and the range text is built from the response's `page`, `pageSize` and `total` | with 45 documents and pageSize 20, page 2 reads "Showing 21 to 40 of 45 documents"; a search with no hits reads "Showing 0 to 0 of 0 documents". | 5B 5.B.6 |
| FR-LP-068 | `?document={id}` selects and loads the requested document even when it is not on page 1 | opening `/lp-portal/documents?document=doc-104` highlights doc-104 and shows its checksum; an unknown id shows the toast "Document not found" and selects the first row. | 5B 5.B.6 |
| FR-LP-069 | the close button closes the detail column and keeps it closed until a row is clicked | after *Close details* no row is highlighted and the grid is a single column. | 5B 5.B.6 |
| FR-LP-070 | *Verify checksum* action in the *Details* tab | *Verify integrity* calls `GET /lp-portal/vault/{id}/verify`; on `verified: true` it shows the toast "Checksum verified"; on false it shows "Checksum mismatch — contact Investor Relations"; with no stored hash it shows "No checksum on file". Texts are proposed. **[P]** | 5B 5.B.6 |
| FR-LP-071 | *Sign document* for REQUIRES_SIGNATURE rows, SIGNATORY/MANAGER only, with step-up MFA (FR-DOC-006) | the row leaves *Requires Signature* and the KPI decrements after a successful signature; a VIEWER sees the status but no sign control. | 5B 5.B.6 |
| FR-LP-072 | `GET /lp-portal/documents` supports `sortBy` (`publishedAt`, `name`, `fundName`), `sortDirection` and the response includes `version`, `period`, `status`, `accessScope`, `mimeType`, `fileSizeBytes`, `pageCount` | sorting by name orders all pages, not only the current one. | 5B 5.B.6 |
| FR-LP-073 | realtime event `lp_document_published` (or the shared `lp_notification`) bumps the `documents` refresh key so a newly published document appears without a reload | a document published by staff appears in the open register within the polling interval. | 5B 5.B.6 |
| FR-LP-074 | *Export* downloads the filtered request list as CSV with the visible columns | file contains exactly the filtered rows; *Filters* opens a panel with type, fund, priority and date range | 5B 5.B.7 |
| FR-LP-075 | enforce the allowed types (PDF, DOC, DOCX, XLS, XLSX, PNG) and the 20 MB limit before upload, support drop, show each file with size and a remove button | a 21 MB file is rejected with a visible message and is never sent. | 5B 5.B.7 |
| FR-LP-076 | show subject, description, created date and a chronological timeline of request messages (investor and staff) in *Request Details* | a staff reply posted through the staff API appears in the investor's *Request Details* without opening a thread. | 5B 5.B.7 |
| FR-LP-077 | mark a thread read only when it is visible and opened, then update the thread row, KPI and session counter | badge decrements by the number of messages marked. | 5B 5.B.7 |
| FR-LP-078 | server-side pagination (`page`, `pageSize` up to 200) with a footer "Showing a to b of total" using the server total | with 120 requests the footer reads "Showing 1 to 50 of 120 requests" and next/previous pages are reachable. | 5B 5.B.7 |
| FR-LP-079 | disable *Submit Request*, *Send*, the attachment controls and *Add participant* for `VIEWER`, with the hint "Viewers cannot submit requests or send messages" | no 403 can be triggered from the UI by a VIEWER. | 5B 5.B.7 |
| FR-LP-080 | show the author's real name and role; label own messages "You" only when `authorId` equals the signed-in user | a colleague's message shows the colleague's name. | 5B 5.B.7 |
| FR-LP-081 | attachment download is an authenticated, client-scoped endpoint (`GET /lp-portal/attachments/{id}/download`) that works with the portal session | another organisation's attachment id answers 404. | 5B 5.B.7 |
| FR-LP-082 | implement the Socket.IO contract above | a staff reply raises the unread pill without reloading. | 5B 5.B.7 |
| FR-LP-083 | row selection switches the detail pane, records the open of the clicked notice, updates the row badge and sets `?id=` in the URL | clicking notice B shows B within one render, B's row badge becomes *Opened*, and reloading the URL reopens B. | 5B 5.B.8 |
| FR-LP-084 | *Acknowledge Notice* is shown enabled only to SIGNATORY and MANAGER; a VIEWER sees the notice and a disabled control with the hint "Only authorised signatories can acknowledge notices" (proposed text) | a VIEWER session cannot trigger the request. | 5B 5.B.8 |
| FR-LP-085 | after acknowledging, the screen refreshes the session counts, the bell and the dashboard actions (`refreshSession`, `bumpRefresh(["notices","notifications","dashboard"])`) without a spinner flash | the sidebar badge decrements immediately. | 5B 5.B.8 |
| FR-LP-086 | paginate notices (`page`, `pageSize` 20, `totalPages`) and send the status, type, fund, date and search filters to the API so counts and filters cover every notice | the *All Notices* tile equals `total` of the list response. | 5B 5.B.8 |
| FR-LP-087 | `GET /lp-portal/notices` returns `requiresAcknowledgement`, `kind`, `category`, `audience` (a text such as "All investors", "Matanho Growth Fund I investors", "Your organisation"), `openedAt`, `acknowledgedAt`, `shareClass`, `fundName` | the detail line shows the real audience instead of "Fund investors". | 5B 5.B.8 |
| FR-LP-088 | a notice may link to a document (`documentId`) so *Open in Documents* opens that document (`/lp-portal/documents?document={id}`) | the link opens the exact document, not the generic category. | 5B 5.B.8 |
| FR-LP-089 | notice publication, targeting and receipts exist in Nexus (staff create/list/withdraw endpoints, investor list/get/acknowledge, receipts per organisation and user, delivered/opened/acknowledged counts, `lp_notice_updated` realtime event) | a staff-published FUND notice appears for entitled investors only and the staff counts match the receipts. | 5B 5.B.8 |
| FR-LP-090 | map API membership states to *Active*, *Invited*, *Suspended*, *Revoked* and exclude *Suspended* and *Revoked* from "active" | after revoking, the row shows *Revoked* (or *Suspended*) and the active count falls by one. | 5B 5.B.9 |
| FR-LP-091 | show "All funds" when the restriction is null | Funds column and details aside read "All funds". | 5B 5.B.9 |
| FR-LP-092 | value = number of distinct funds the organisation is entitled to | with funds A and B and three colleagues the card shows 2. | 5B 5.B.9 |
| FR-LP-093 | confirm dialog "Revoke access for {name}? They will be signed out immediately." and hide the action for the signed-in user and for Managers | no revoke request is sent before confirmation. | 5B 5.B.9 |
| FR-LP-094 | invitation dialog with Role (*Viewer*, *Signatory*), Fund access (multi-select within the inviter's scope) and, per colleague, an *Edit access* action calling the update endpoint | an invited Signatory with fund A only can see only fund A. | 5B 5.B.9 |
| FR-LP-095 | return `activationEmailSent` and offer *Resend invitation* for colleagues who have not signed in | when delivery fails the manager sees a warning toast and a resend action. | 5B 5.B.9 |
| FR-LP-096 | bank instruction submission requires a fresh TOTP code (step-up, FR-AUTH-011) and creates a staff verification task with maker–checker approval | submission without a valid code is refused; approval by the requester is refused; activation archives the old instruction. | 5B 5.B.9 |
| FR-LP-097 | list returns `{id, fundId, fundName, bankName, accountNumberMasked, requestedBy, submittedAt, status}` | table renders without blank cells. | 5B 5.B.9 |
| FR-LP-098 | add status labels *Draft* and *Activated* | each design status has its own label and colour. | 5B 5.B.9 |
| FR-LP-099 | bank form adds Currency, SWIFT/BIC or routing number, IBAN where applicable, supporting letter upload, and a confirm-account-number field | mismatching confirmations block submission. Q-145: required bank fields per currency — default: Bank name, Account name, Account number, SWIFT/BIC, Currency. | 5B 5.B.9 |
| FR-LP-100 | for non-Managers hide the colleague table and show "Only Managers can view colleagues." | no empty-table message for non-Managers. | 5B 5.B.9 |
| FR-LP-101 | align the contract — `GET /lp-portal/settings` returns `notifications.digest` as `daily`, `weekly` or `off` and an `mfa` object with `manageUrl`, `sessionsUrl`, `passwordUrl` pointing at portal pages | saving digest *Off* and reloading shows *Off*; the three buttons are enabled. | 5B 5.B.10 |
| FR-LP-102 | provide pages (or an in-portal drawer) for MFA enrolment (QR code, code confirmation, backup codes), active sessions with *Sign out other devices* (FR-AUTH-017) and password change | *Manage* opens MFA enrolment and a confirmed factor flips *MFA Status* to *Enabled*. | 5B 5.B.10 |
| FR-LP-103 | the session returns the saved presentation currency and default as-of date, the portal context reloads after saving, and amounts and the as-of date follow the preference | choosing ZAR and saving shows ZAR amounts on the dashboard without a manual reload. | 5B 5.B.10 |
| FR-LP-104 | *Save Changes* is enabled only when something changed, with a *Discard* action and a leave-page warning | with no edits *Save Changes* is disabled. | 5B 5.B.10 |
| FR-LP-105 | save as one atomic request or report which part failed | a failed display save shows "Display preferences not saved" while notification changes remain saved. | 5B 5.B.10 |
| FR-LP-106 | every LP route declares one permission code and one minimum role; the matrix in section E of the reference contract is the acceptance test | for every route, a VIEWER session receives 403 on SIGNATORY routes and a SIGNATORY session receives 403 on MANAGER routes, with the same error body as other permission failures. | 5B |
| FR-LP-107 | the LP UI disables or hides every control whose server gate the current role fails, including *Acknowledge* (notices), submit buttons (dealing), reply and new request (requests, messages), and *Request Change* (bank instructions) for roles below SIGNATORY | with a VIEWER session no write request is ever sent. | 5B |
| FR-LP-108 | while the LP session is loading, write controls are disabled (`lpRole` null is treated as no rights) | no write control is enabled before `lpRole` is known. | 5B |
| FR-LP-109 | add a response adapter for `/api/v1/lp-portal/*` | every route returns the envelope. | 5B |
| FR-LP-110 | publishing a call or distribution to LPs requires the approver permission (`cash.approve`) and step-up | a user who is neither approver nor holder of the publish permission receives 403. | 5B |
| FR-LP-111 | introduce `capital_calls` and `capital_call_allocations` and keep `capital_events` as the investor-facing projection (Q-NEW) | two investors of one call see the same call number and different amounts. | 5B |
| FR-LP-112 | store the LP vocabulary and map the Nexus labels for the legacy investor routes | a staff PATCH to `AWAITING_INVESTOR` shows "Awaiting Investor" in the LP table. | 5B |
| FR-LP-113 | add `fund_id`, `category`, `period` to `documents` (or a view) | the LP document list filters by category and fund. | 5B |

### MOD

| ID | Requirement | Acceptance criterion | Source |
| --- | --- | --- | --- |
| FR-MOD-002 | Model lifecycle actions *Record validation findings*, *Approve for production* (committee, `models.approve`) and *Retire*. | a model with an open high-severity finding cannot be approved (409). | 5A-19-30 5.A.24 |
| FR-MOD-003 | Overdue validation is flagged in the registry and on the Command Centre (FR-MOD-001). | a model with a validation date in the past shows an amber "Validation due" chip. | 5A-19-30 5.A.24 |

### NOT

| ID | Requirement | Acceptance criterion | Source |
| --- | --- | --- | --- |
| FR-NOT-003 | Mark all notifications read. | unread count becomes 0. | backend |

### OMS

| ID | Requirement | Acceptance criterion | Source |
| --- | --- | --- | --- |
| FR-OMS-013 | submitted orders are created through `POST /api/v1/orders` (+ `/validate`, `/submit`) and appear in the blotter, Approvals tab and *Working orders* | reload keeps the order; creator, time and snapshot of controls are stored. | 5A-0-7 5.A.5 |
| FR-OMS-014 | `orders.create`, `orders.approve` and `orders.route` are enforced in the UI and API; the approver must differ from the creator | a creator pressing *Approve* gets 403 "Maker-checker conflict"; Compliance cannot create orders. | 5A-0-7 5.A.5 |
| FR-OMS-015 | *Reject* with required reason and *Cancel* with reason | cancel releases the cash reservation; rejected orders show the reason in Order 360. | 5A-0-7 5.A.5 |
| FR-OMS-016 | securities with status *Suspended* or *Delisting review* cannot be ordered | *New order* is disabled with tooltip naming the status. | 5A-0-7 5.A.5 |
| FR-OMS-017 | pre-trade result per control is *Pass* / *Review* / *Fail* with an overall *Within* / *Review* / *Blocked*; Review items require a documented reason before submit | Blocked cannot be submitted; Review needs reason text. | 5A-0-7 5.A.5 |
| FR-OMS-018 | ticket validation — quantity integer and multiple of board lot; price within ±10 % of last unless an override reason is given; stop price required for *Stop limit* | violations show inline field errors. | 5A-0-7 5.A.5 |
| FR-OMS-019 | saved drafts are listed and restorable by their creator | reopening the ticket offers "Resume draft". | 5A-0-7 5.A.5 |
| FR-OMS-020 | the blotter has status, portfolio, security and date filters, sort and CSV export | export matches the filters. | 5A-0-7 5.A.5 |
| FR-OMS-021 | broker routing is reachable from an *Approved* order in the blotter and requires `orders.route` | the preview shows the stored instruction; send changes status to *Routing* and records delivery. | 5A-0-7 5.A.5 |

### ONB

| ID | Requirement | Acceptance criterion | Source |
| --- | --- | --- | --- |
| FR-ONB-016 | Hide or disable every mutating control for users without `onboarding.manage`, and hide *Decline* and *Approve & activate* for users without the `compliance` role | a client_services user sees no *Approve & activate*; an auditor sees no mutating control. | 5A-8-18 5.A.11 |
| FR-ONB-017 | Provide an assisted (staff-captured) application form from *+ New application* using `POST /api/v1/kyc/cases` (applicant type, legal name, email, phone, country, expected investment) | created case shows channel "Assisted", stage Screening, owner = creator. | 5A-8-18 5.A.11 |
| FR-ONB-018 | Route all evidence requests (including Evidence-tab *Request* / *Ask question*) to `POST /api/v1/kyc/cases/{id}/request-evidence` and show the request on the timeline | request creates a timeline event and applicant email; toast only after server success. | 5A-8-18 5.A.11 |
| FR-ONB-019 | Preview the original uploaded file via the signed download URL (images, PDF, text) and show Accept / Reject controls using `POST .../evidence/{slot}/review` | reviewer opens the exact uploaded file; reject marks the slot rejected and the case blocker "Missing evidence" returns. | 5A-8-18 5.A.11 |
| FR-ONB-020 | Show blocker reasons list, risk, SLA state and due time, channel, and the AI/screening exception list (per check: sanctions, PEP, adverse media, document, with outcome and score) in the case detail | every blocker string returned by the API is visible next to the disabled *Approve & activate*. | 5A-8-18 5.A.11 |
| FR-ONB-021 | Add *Open enhanced review*, *Complete enhanced review* (advance EnhancedReview → ComplianceReview), *Return to review* and *Activate* (retry) actions | a High-risk case can reach Approved and Activation entirely from the UI. | 5A-8-18 5.A.11 |
| FR-ONB-022 | Persist due date, escalation and message channel and honour them in the applicant email and SLA | stored values appear on the timeline entry. | 5A-8-18 5.A.11 |
| FR-ONB-023 | Persist suitability inputs to the application and drive the *Mandate* donut from mandate state | reload shows saved values. | 5A-8-18 5.A.11 |
| FR-ONB-024 | Warn before an action that makes the user the case preparer when dual control is on | confirm text "You will not be able to record the decision on this case." | 5A-8-18 5.A.11 |
| FR-ONB-025 | Compute evidence % over required slots only, treat uploaded-unreviewed as "Under review", and make screening % case-insensitive | complete 4-required application shows 100 %. | 5A-8-18 5.A.11 |
| FR-ONB-026 | Pre-select the matching case when arriving from Clients or notifications; compute the sidebar badge from open cases; produce a real case-pack export (evidence manifest, hashes, screening references, decision rationale, audit events) | export downloads a file. | 5A-8-18 5.A.11 |
| FR-ONB-027 | Rewrite the onboarding bridge (or native React form) for the V65 DOM so that draft create/save/resume, evidence upload and submit call `/api/v1/public/applications/*` | with the API running, a draft typed in one browser is restored field-for-field (including files) from the emailed resume link in another browser. | 5C5E 5.C.0 |
| FR-ONB-028 | Forward rail click validates every intervening step and reports the first error | clicking step 6 from step 1 with an empty legal name focuses *Legal name* with its message. | 5C5E 5.C.0 |
| FR-ONB-029 | Persist every step-1 field server-side in typed columns (legal name, registration ref, jurisdiction, incorporation date, regulatory status, regulator, licence ref, website, registered address, relationship, mandate, expected investment, base currency, classification, primary contact name/email/phone, purpose) | resume restores all 19 values; admin case shows all 19. | 5C5E 5.C.1 |
| FR-ONB-030 | Store signatories (name, role, email) and owner nationality server-side | resume restores all rows; admin case lists signatories. | 5C5E 5.C.2 |
| FR-ONB-031 | Persist all four declarations (with follow-up details) and all funds/activity fields server-side | admin case shows each declaration value and narrative. | 5C5E 5.C.3 |
| FR-ONB-032 | Persist tax (residence, TIN encrypted, FATCA, GIIN, CRS, US indicia) and funding-account fields (bank, holder, jurisdiction, account encrypted, SWIFT, currency) server-side; the funding account becomes a DRAFT bank instruction on activation | activation creates a bank instruction requiring maker/checker approval (BR-001). | 5C5E 5.C.4 |
| FR-ONB-033 | Single evidence-slot catalogue (key, label, help, accepted types, required-by-investor-type) served by the API and used by UI and submit check | UI stars, readiness count, review count and server `incomplete_application` list agree for every investor type. | 5C5E 5.C.5 |
| FR-ONB-034 | Server-side OCR with candidate suggestions, never auto-applied | candidates shown only after upload succeeds; applying writes via `PATCH`. | 5C5E 5.C.5 |
| FR-ONB-035 | Display only the server-issued `ONB-######` | success panel reference equals the admin case reference. | 5C5E 5.C.6 |
| FR-ONB-036 | completeness = uploaded required ÷ required | never > 100 %. | 5C5E 5.C.6 |
| FR-ONB-037 | server runs pre-screen on submit from stored data only | changing PEP after a client triage run changes the case risk. | 5C5E 5.C.6 |
| FR-ONB-038 | Electronic declaration stores signatory name, capacity, consent text version, timestamp, IP and user agent | admin case shows all six. | 5C5E 5.C.6 |
| FR-ONB-039 | Resume via emailed link restores all fields and uploaded evidence names on any device and marks the email verified | `email_verified_at` set on first link use; files listed with name and size. | 5C5E 5.C.7 |
| FR-ONB-040 | Submission receipt email and success panel show the same `ONB-######` | identical strings. | 5C5E 5.C.7 |
| FR-ONB-041 | An onboarding draft is owned by a draft token (header `X-Draft-Token`, SHA-256 stored, 30-day expiry), delivered to the creating browser and in an emailed resume link. Staff evidence requests re-issue a 14-day token. | missing or wrong token returns 404; a submitted draft cannot be edited (409 `already_submitted`) except evidence upload while the case is in Client action. | backend |
| FR-ONB-042 | Per-slot evidence review (Accepted / Rejected with note); rejected evidence counts as missing for approval. | approval blocked while a required slot is Rejected. | backend |
| FR-ONB-043 | Staff can message the applicant by email from the case, recorded on the case timeline. | timeline event, audit event and queued email. | backend |
| FR-ONB-044 | Screening re-run on undecided cases. | on Approved, Rejected, Activation or Active returns 409. | backend |
| FR-ONB-045 | A case in Client action returns automatically to Compliance review when every requested slot has a file, and reviewers are notified. | last requested upload changes the stage. | backend |
| FR-ONB-046 | Activation completes automatically (Activation → Active) once the client has an ACTIVE cash account and at least one accepted investor user. | whichever of the two events happens second moves the case to Active. | backend |
| FR-ONB-047 | Approval blockers are computed server-side and returned with the case: missing evidence, screening running, waiting on applicant, EDD open, High risk without EDD, potential sanctions match. | approve with any blocker returns 409 `approval_blocked` with the list. | backend |

### OPS

| ID | Requirement | Acceptance criterion | Source |
| --- | --- | --- | --- |
| FR-OPS-007 | Operations task register — create, view, filter, assign, schedule, block, unblock and complete tasks with owner, deadline (CAT), area, dependency and evidence | every transition is an explicit sub-resource call, requires the stated note/evidence, writes an audit event, and the runbook reflects the new state without reload. | 5A-8-18 5.A.16 |
| FR-OPS-008 | Runbook filters and search — state (*All / Due / Blocked / Scheduled / Done*), owner, area and free-text search with deadline sort | filters combine with AND; the empty state reads "No tasks match this filter." | 5A-8-18 5.A.16 |
| FR-OPS-009 | Live status panel — KPI tiles, dependency percentages, link counts, workload and cash-deadline charts computed from live task, settlement, cash, valuation and accounting data | figures equal the source workspaces' counts at the same as-of time; changing a source updates the panel within one refresh. | 5A-8-18 5.A.16 |
| FR-OPS-010 | Task dependency and hand-off — a task may depend on other tasks or controls and hands off to a downstream owner | dependants of an incomplete task cannot be completed; completing a task notifies the next owner and moves cleared dependants from *Blocked* to *Due*. | 5A-8-18 5.A.16 |
| FR-OPS-011 | Runbook calendar and export — operating-day, month-end, quarter-end and event-driven deadlines in a calendar view, and CSV/XLSX export of the runbook | the export file contains exactly the rows visible under the active filter and records an audit event. | 5A-8-18 5.A.16 |
| FR-OPS-012 | Add an action-level permission `operations.task.manage` (create, assign, block, complete) for `operations` and `fund_accountant`, keeping `auditor` read-only | users without it see tasks read-only and the task endpoints return 403. | 5A-8-18 5.A.16 |
| FR-OPS-013 | Chart interactions — tooltips with exact values, click-through from a workload hour or cash event to the filtered tasks | hover shows the value and series name; click filters the runbook. | 5A-8-18 5.A.16 |
| FR-OPS-014 | Event book shows ex, record, pay and election-deadline dates as separate columns, with cash/position impact. | CA-26091 shows four dates and the projected cash outflow. | 5A-19-30 5.A.21 |
| FR-OPS-015 | Corporate action status vocabulary Announced → Entitlement projected → Election required → Election submitted → Instructed → Posted → Reconciled. | each transition is audited. | 5A-19-30 5.A.21 |

### PERF

| ID | Requirement | Acceptance criterion | Source |
| --- | --- | --- | --- |
| FR-PERF-001 | Portfolio, period and return-basis selectors on the control bar | changing any selector reloads every tile, chart, table and checklist for the selection and updates the *Period* and *State* values **[P]**. | 5A-8-18 5.A.8 |
| FR-PERF-002 | Returns and attribution served from the API (`GET /api/v1/performance/returns`, `/attribution`) with range, portfolio and benchmark parameters | every tile, table row and chart point equals the API response; Active return equals Portfolio − Benchmark; bridge components and Brinson rows sum to the active return within 0.01 percentage points. | 5A-8-18 5.A.8 |
| FR-PERF-003 | Governance checklist driven by live validations (IBOR reconciliation, cash reconciliation, valuation sources, composite membership, fees and flows) | the chip count equals the number of controls not done; the checklist and the explorer *Return quality* tab show the same states. | 5A-8-18 5.A.8 |
| FR-PERF-004 | *Lock official return* as a checker action | the call returns a refusal naming the open controls while any control is not done; a user who prepared the period receives 403; on success the period status is Official and the control-bar *State* and KPI *Official state* update. | 5A-8-18 5.A.8 |
| FR-PERF-005 | Export attribution in CSV and XLSX from the displayed period | file rows equal the table rows for the selected period including weights; an audit event is written. | 5A-8-18 5.A.8 |
| FR-PERF-006 | Chart event markers (*Cash flow*, *Rebalance*, *IC decision*) labelled and clickable | hovering shows the label and date; clicking opens the linked record. | 5A-8-18 5.A.8 |
| FR-PERF-007 | Keyboard operation of the chart (arrow keys move the crosshair, Enter opens the drill drawer) | all drawers reachable without a mouse. | 5A-8-18 5.A.8 |

### PLAT

| ID | Requirement | Acceptance criterion | Source |
| --- | --- | --- | --- |
| FR-PLAT-001 | Second-level pages are addressable URLs (`/{parent}/{type}/{id}`) with a 404 state for unknown IDs. | opening an unknown ID shows "Record not found" with a link back to the parent page. | 5A-19-30 5.A.29 |
| FR-PLAT-002 | Drawers and modals trap focus, close on Escape, restore focus to the opener, and announce their title to screen readers. | keyboard-only users can open, operate and close every drawer. | 5A-19-30 5.A.30 |
| FR-PLAT-003 | register `custodian` in `PORTAL_IDS`, `PORTALS`, `CUSTODIAN_PORTAL_URL` and CORS. | — | 5C5E |
| FR-PLAT-004 | Transactional outbox. Side effects (email, notifications, screening) are enqueued in the business transaction and delivered by a worker with retry (exponential back-off, max 8 attempts, last error kept). | a rolled-back transaction sends nothing; a failed handler is retried. | backend |
| FR-PLAT-005 | Human references are allocated atomically per kind from a sequence table (CL-, MND-, CCA-, ONB-, KYC-, DOC-, REQ-, CAP-, Q-). | concurrent creates never duplicate a reference. | backend |

### PM

| ID | Requirement | Acceptance criterion | Source |
| --- | --- | --- | --- |
| FR-PM-001 | private investments, pipeline, cash flows and valuations are served from the API (`/v1/private/*` do not exist today) | inventory totals equal the KPI tiles; IRR/TVPI/DPI computed from cash flows. | 5A-0-7 5.A.3 |
| FR-PM-002 | the *New investment*, *Diligence case* and *Cashflow scenario* drawers persist records and validate (name required, amount > 0, vintage 1990–current, valuation date ≤ today, fair-value level 1–3, currency incl. ZWG) | invalid input shows an inline error; saved record appears in the inventory. | 5A-0-7 5.A.3 |
| FR-PM-003 | *Export look-through* downloads a CSV of underlying exposures | file rows equal look-through table rows. | 5A-0-7 5.A.3 |
| FR-PM-004 | the hub is wired to the Investee portal: *Open company portal* opens the Investee portal and the hub exposes *open period* (`POST …/companies/{ref}/periods`) and *update covenant* (`PATCH …/companies/{ref}/covenants/{key}`) | a staff user with `research.edit` can open a period and update a covenant; both actions are audited. | 5A-0-7 5.A.3 |
| FR-PM-005 | hub review actions use proper dialogs with inline validation instead of `prompt()` | return note required inline; empty reply rejected inline. | 5A-0-7 5.A.3 |

### PORT

| ID | Requirement | Acceptance criterion | Source |
| --- | --- | --- | --- |
| FR-PORT-009 | portfolios are served by `GET /api/v1/portfolios` with search, strategy, currency, risk and manager filters and saved views per user | strategy and currency selects filter the table; the count equals the number of rows shown; a saved view restores filters for the same user. | 5A-0-7 5.A.2 |
| FR-PORT-010 | summary KPIs are computed from the rows | Total AUM equals Σ AUM in the base currency; Weighted TWR equals the AUM-weighted return; Open breaches equals the number of open breaches. | 5A-0-7 5.A.2 |
| FR-PORT-011 | portfolio creation requires a named permission and persists the wizard fields | unauthorised users do not see *+ New portfolio*; the evidence file is stored in the vault; a created portfolio survives reload with state *Setup* and creates real activation tasks. | 5A-0-7 5.A.2 |
| FR-PORT-012 | constraints are bound to effective limits and used by the optimiser | changing *Single issuer maximum* changes the proposed trades; violating a hard constraint blocks promotion. | 5A-0-7 5.A.4 |
| FR-PORT-013 | KPIs and scenario table are produced by the optimiser job | after a run, every KPI equals the job result with its as-of time. | 5A-0-7 5.A.4 |
| FR-PORT-014 | *Promote to Orders* requires `orders.create`, creates one Draft order per trade line and is idempotent | promoting twice does not create duplicates; success toast shows the number of drafts; users without `orders.create` see the button disabled with a tooltip. | 5A-0-7 5.A.4 |
| FR-PORT-015 | *Save scenario* asks for a name, persists weights and constraints and lists saved scenarios | reload shows the scenario in a list; delete is available to the owner. | 5A-0-7 5.A.4 |

### RBAC

| ID | Requirement | Acceptance criterion | Source |
| --- | --- | --- | --- |
| FR-RBAC-009 | *Disable / enable user* and *Revoke invitation* controls on the users table (the API already supports `PATCH /api/v1/admin/users/{id} {isActive}`). | a disabled user's sessions are revoked; you cannot disable yourself (409). | 5A-19-30 5.A.26 |
| FR-RBAC-010 | Matrix rows for `cash.approve` (and read-only rows for `admin.rbac` / `admin.settings`). | `cash.approve` can be granted to Compliance and appears in the access review. | 5A-19-30 5.A.26 |
| FR-RBAC-011 | MFA reset by another administrator with a reason (implemented: `POST /api/v1/admin/users/{id}/mfa-reset`). | — | 5A-19-30 |
| FR-RBAC-012 | step-up MFA on all RBAC mutations (implemented). | — | 5A-19-30 |
| FR-RBAC-013 | Administrator lost-device MFA reset removes the user's factors and sessions, with a reason, step-up and audit; self-reset is refused. | after reset the user's next login returns `mfa='enroll'` (when MFA is required); self-reset returns 409. | backend |
| FR-RBAC-014 | Enable/disable user; disabling revokes all sessions; self-disable is refused. | disabled user's next request returns 401. | backend |
| FR-RBAC-015 | Guards against self-lockout (removing your own `admin.rbac`) and against removing the last active System Administrator. | 409 `self_lockout` / 409 `last_admin`. | backend |
| FR-RBAC-016 | Access context endpoint returns the caller's admin roles, permissions and role labels/bundles, used to drive UI visibility. | matches the caller's `/me` permissions. | backend |

### REC

| ID | Requirement | Acceptance criterion | Source |
| --- | --- | --- | --- |
| FR-REC-001 | **[P]** an as-of date picker and a family selector scope every KPI, queue and run | changing the as-of date reloads the break list for that date and the KPI values are recomputed from it. | 5A-8-18 5.A.17 |
| FR-REC-002 | Provide a persisted reconciliation engine (runs, breaks, sources, imports, sign-offs) behind the `/api/v1/recon/*` endpoints | a run for a family and as-of date creates one break per unmatched or out-of-tolerance item, matched items create no queue entry, and a run record stores matched count and break count. | 5A-8-18 5.A.17 |
| FR-REC-003 | Compute every KPI from persisted data, including a match rate = matched items ÷ total items in the run population, expressed as a percentage with two decimals | the value equals the ratio of the run statistics for the selected as-of date and family. | 5A-8-18 5.A.17 |
| FR-REC-004 | Maker resolution must require a cause, a rationale and at least one evidence reference | the *Submit maker resolution* request is rejected with a validation error when any of the three is missing. | 5A-8-18 5.A.17 |
| FR-REC-005 | Checker approval must be refused when the approver equals the maker (BR-001) and must require a distinct permission | the same user receives a "Segregation of duties" error; a user without the checker permission cannot see the button. | 5A-8-18 5.A.17 |
| FR-REC-006 | Add *Assign*, *Attach evidence*, *Accept candidate match*, *Query source*, *Escalate* and *Return to maker* actions with audit events | each action records user, time and reason and appears in the case history. | 5A-8-18 5.A.17 |
| FR-REC-007 | Add a *Daily sign-off* per family and as-of date, blocked while any Critical or High break is open or any scheduled source is missing | the sign-off is recorded with the checker identity and freezes the evidence population. | 5A-8-18 5.A.17 |
| FR-REC-008 | Keep closed and matched cases out of the default queue and provide a status filter | the default list contains no case with status *Closed*. | 5A-8-18 5.A.17 |
| FR-REC-009 | Show a running state for long-running actions (*Run matching*, *Fetch now*) | the button is disabled with a progress indicator until the job completes and an error toast is shown on failure. | 5A-8-18 5.A.17 |
| FR-REC-010 | Close modals on Escape and trap focus; label the search input | Escape closes the modal and focus returns to the opener. | 5A-8-18 5.A.17 |
| FR-REC-011 | Replace the browser-storage hand-off with a server-side staging channel | a custodian submission made on the custodian portal is visible to the reconciliation staging area of the admin portal after authentication, with the submitting user, timestamp and file hash stored. | 5A-8-18 5.A.17 |
| FR-REC-012 | Counterparty execution submission API with server validation (unique reference per counterparty, account scope, security master, positive qty/price, settlement ≥ trade date) and audit | duplicate reference → 409; out-of-scope account → 403; each accepted record appears in admin Reconciliations as a counterpart Trades record within 5 s. | 5C5E 5.E.1 |
| FR-REC-013 | Day-end package submission API — store the original file encrypted, compute SHA-256 server-side, validate control totals, register the package as a counterpart source import | returned hash equals `sha256sum` of the uploaded file; package appears in admin Reconciliations source health for that account and date. | 5C5E 5.E.2 |
| FR-REC-014 | store ISO-8601 UTC and display Africa/Harare | newest first across month boundaries. | 5C5E 5.E.3 |
| FR-REC-015 | Status round-trip — manager match result and queries visible to the counterparty | a break raised on an execution shows "Exception" with the query text in the custodian portal. | 5C5E 5.E.3 |
| FR-REC-016 | Custodian submissions reach admin Reconciliations through the API (steps 1–4 above) | an execution submitted in the custodian portal is visible as a counterpart record in admin Reconciliations within 5 s and is matched on the next run. | 5C5E 5.E.4 |
| FR-REC-017 | Manual file import and broker/counterparty API connector routes [V61] share the same `counterpart_imports` pipeline | each import creates a batch with source, account, filename, record count, import time and SHA-256. | 5C5E 5.E.4 |

### REG

| ID | Requirement | Acceptance criterion | Source |
| --- | --- | --- | --- |
| FR-REG-002 | Record the regulator acknowledgement reference as stage 05 separately from submission. | *Receipt* stays active until an acknowledgement reference is entered. | 5A-19-30 5.A.22 |

### RES

| ID | Requirement | Acceptance criterion | Source |
| --- | --- | --- | --- |
| FR-RES-006 | the issuer universe, prices, financials and filings are served from `/v1/research/issuers*` with an as-of and source on every value | the Orders security master and this page show the same last price for the same security and timestamp. | 5A-0-7 5.A.6 |
| FR-RES-007 | saving a model requires `research.edit`, validates ranges (growth −100…500 %, margin −100…100 %, discount 0–50 %, target > 0 in the quote unit), keeps a version history and updates the hero target and upside | a role without `research.edit` sees *Save model assumptions* disabled; each save creates a version with author and time. | 5A-0-7 5.A.6 |
| FR-RES-008 | analyst notes are a timestamped, attributed list with catalysts and risks as structured entries | *+ Catalyst* adds a catalyst record with date and trigger; history lists all entries newest first. | 5A-0-7 5.A.6 |
| FR-RES-009 | *Import filing* collects issuer, document type and period, stores the file in the vault and lists it in the filings tab | the document appears in the list and in Document Vault with the same version. | 5A-0-7 5.A.6 |
| FR-RES-010 | *New investment case* opens a creation form and an IC workflow with vote, dissent and decision lock | a case has quorum, votes and a decision record; the layer title always matches the ticker. | 5A-0-7 5.A.6 |

### RSK

| ID | Requirement | Acceptance criterion | Source |
| --- | --- | --- | --- |
| FR-RSK-006 | limits are served and managed by `/v1/risk/limits` with states *Draft*, *Pending approval*, *Active*, *Retired*, require `risk.manage` to draft and a different user to approve, and are versioned with an effective date | amending a limit creates a new version and keeps the effective rule until the new version is approved. | 5A-0-7 5.A.7 |
| FR-RSK-007 | limit evaluation distinguishes maxima and minima | *30d liquidity cover* with current 1.84× and floor 1.25× shows usage ≤ 100 % and headroom 0.59×. | 5A-0-7 5.A.7 |
| FR-RSK-008 | the limit form validates metric from a catalogue, scope from existing portfolios, threshold > 0, unit, action, owner and effective date | invalid input shows inline errors; effective date is stored. | 5A-0-7 5.A.7 |
| FR-RSK-009 | compliance cases can be created, assigned and tracked (*Open*, *Investigating*, *Resolved*, *Closed*) from the page | *+ Case* modal has *Create case* and *Cancel*; the description is required ("Record the issue before creating a controlled case."); the case appears in the queue and opens its case layer; only `risk.manage` can create. | 5A-0-7 5.A.7 |
| FR-RSK-010 | scenario runs are persisted and listed with presets (*liquidity*, *equity*, *fx*) and deterministic results from positions and shocks | *Save scenario* adds a named entry; *Run scenario* returns the same result for the same inputs. | 5A-0-7 5.A.7 |
| FR-RSK-011 | the banner, KPIs, budget and signals are computed from the same source as the limit book and scenario lab | banner *Severe stress* equals the latest saved severe scenario result; *Closest limit* equals the highest usage. | 5A-0-7 5.A.7 |
| FR-RSK-012 | imports validate columns, reject invalid rows and update the risk numbers | importing a positions file changes the position count and the exposures; duplicates in a limits file are rejected. | 5A-0-7 5.A.7 |
| FR-RSK-013 | the compliance report is generated from live data and can be printed or downloaded | report values equal the limit book at the as-of time. | 5A-0-7 5.A.7 |

### SET

| ID | Requirement | Acceptance criterion | Source |
| --- | --- | --- | --- |
| FR-SET-002 | Letterhead stored as a structured setting with the logo as an uploaded asset reference. | saving a 500 KB logo succeeds and the report editor shows it after reload. | 5A-19-30 5.A.27 |

### UI

| ID | Requirement | Acceptance criterion | Source |
| --- | --- | --- | --- |
| FR-UI-001 | nav badges show live counts of the user's open work items per page | each badge equals the count returned by the work-item API for that page and is hidden when 0. | 5A-0-7 5.A.0.1 |
| FR-UI-002 | collapse state and focused/all workspace mode are stored per user | reload restores both for the same user and not for another user. | 5A-0-7 5.A.0.1 |
| FR-UI-003 | the health line reflects integration status | shows *Degraded* with the failing integration name when any integration is `degraded` or `failed`; last-sync time equals the latest successful sync. | 5A-0-7 5.A.0.1 |
| FR-UI-004 | global search queries a server endpoint and returns only entities the user can view, with working *Open →* navigation | a user without `orders.view` never receives order results; clicking a result opens the entity's page or drawer. | 5A-0-7 5.A.0.2 |
| FR-UI-005 | the bell shows the count and list of the user's unread notifications with links and mark-as-read | badge equals unread count; clicking an item navigates and marks it read; honours the user's notification settings. | 5A-0-7 5.A.0.2 |
| FR-UI-006 | the profile button shows the signed-in user's name, initials and roles | no static name remains in markup. | 5A-0-7 5.A.0.2 |
| FR-UI-007 | palette lists only commands the user may run and also searches securities, portfolios and orders | a command for a forbidden page is not offered; typing "DLTA" lists the security and its position. | 5A-0-7 5.A.0.3 |
| FR-UI-008 | a single accessible dialog/drawer component with focus trap, Esc, `aria-live` toasts and a maximum of 4 visible toasts | keyboard-only user can open, operate and close any dialog; screen reader announces toasts. | 5A-0-7 5.A.0.4 |
| FR-UI-009 | toast and drawer content are HTML-escaped | a company name containing `<script>` renders as text. | 5A-0-7 5.A.0.4 |
| FR-UI-010 | second-layer pages have URLs | `/?layer=<type>&id=<id>` restores the layer after reload and respects permissions. | 5A-0-7 5.A.0.5 |
| FR-UI-011 | unknown layer names are rejected with an error toast | no fallback screen is shown. | 5A-0-7 5.A.0.5 |

### VAL

| ID | Requirement | Acceptance criterion | Source |
| --- | --- | --- | --- |
| FR-VAL-008 | minimum length and non-blank validation with an inline error | blank or whitespace-only rationale shows an inline error and does not submit | 5A-8-18 5.A.18 |
| FR-VAL-009 | Gate *Recalculate* / *Resolve exception* with `valuation.run`, *Submit maker review* with `valuation.maker` and *Release NAV* with `valuation.release` (Q-04), and enforce checker ≠ maker honouring the `navApproval` policy | a same-user release returns 403 and `auditor` sees all action buttons disabled with tooltip "Not permitted for `<Role>`". | 5A-8-18 5.A.18 |
| FR-VAL-010 | Compute Draft NAV, NAV/unit (4 dp, rounded) and price coverage from governed positions, cash, prices/FX, fees and units | NAV/unit = Draft NAV ÷ units; bridge components sum exactly to Draft NAV, including an override adjustment line. | 5A-8-18 5.A.18 |
| FR-VAL-011 | Persist each exception with rationale, evidence document, resolver and timestamp, and route a material override to an independent approver | resolving without rationale returns validation error "Resolution rationale is required."; evidence upload accepts pdf, csv, xlsx, xls, png, jpg, jpeg and is linked to the exception. | 5A-8-18 5.A.18 |
| FR-VAL-012 | Recalculation after maker review or release creates a new calculation version and clears the maker review (released runs are superseded, FR-VAL-005) | after *Recalculate*, *Maker reviewed* returns to *Submit maker review* and *Release NAV* is disabled. | 5A-8-18 5.A.18 |
| FR-VAL-013 | Show the release state as *Blocked*, *Ready for maker*, *Ready for checker* or *Released* | a fund with no unresolved exception and no maker review shows *Ready for maker*. | 5A-8-18 5.A.18 |
| FR-VAL-014 | Link the exception to its reconciliation break and the Operations runbook task, and add outbound links to Reconciliations and Accounting | resolving the NAV exception updates the break status and the runbook row. | 5A-8-18 5.A.18 |
| FR-VAL-015 | Reinstate *NAV history* (prior official NAVs, re-runs, release evidence) and *Valuation policy* (price hierarchy, stale-price thresholds, override governance) | both open from the page head and show data from the API. | 5A-8-18 5.A.18 |
| FR-VAL-016 | Replace the preview documents with generated evidence from source snapshots (position snapshot, cash certificate, ZSE/VFEX closes, FX rates with numeric values, fee/unit control, private valuation statement, NAV pack) with source timestamps and version | each *Preview* shows real values and a version-stamped footer. | 5A-8-18 5.A.18 |
| FR-VAL-017 | Variance = External NAV − ABOR value, and State = Agree when \|Variance\| ≤ tolerance (Q-13). | a fund with ABOR 9.558M and external 9.552M shows variance US$ 6k and a non-Agree state. | 5A-19-30 5.A.19 |
| FR-VAL-018 | *Close period* enabled only when every checklist gate passes and the user holds the close permission (Q-04 `accounting.close`). | with one "!" gate the button is disabled, with tooltip naming the blocker. | 5A-19-30 5.A.19 |
| FR-VAL-019 | Accounting journal control drawer lists pending journals with *Approve* / *Reject (reason)* for a checker ≠ maker. | the maker gets 403 on approve; the audit event is written. | 5A-19-30 5.A.19 |

## New non-functional requirements (7)

| ID | Requirement | Acceptance criterion | Source |
| --- | --- | --- | --- |
| NFR-OPS-006 | Every response carries an `X-Request-Id` (a caller value is accepted when it matches `[\w.-]{8,64}`), and the id is stored on audit events. | an audit row links to the response header value. | backend |
| NFR-SEC-012 | Optimistic concurrency: `If-Match` (or `version` in the body) is compared to the row version on transitions, and a mismatch returns 409 `version_conflict`. | a stale version returns 409. | backend |
| NFR-PERF-005 | **Pagination** on every list endpoint (`page`, `pageSize` ≤500, default 50; response `{data, page, pageSize, total}` where `total` is the full count). Today lists are silently capped at 200–500 rows and `total` equals the returned length. | a list with 600 rows returns total 600 and pages through all of them. | backend |
| NFR-OPS-007 | **Structured request logging and metrics.** JSON log line per request (request id, user id, portal, route, status, latency) with no secrets or PII; RED metrics; worker queue depth and age. Today logs are plain console output and mail tokens appear in logs when SMTP is unset. | every request produces one JSON log line; no token appears in any log. | backend |
| NFR-AV-005 | **Idempotent, single-delivery worker.** Claim rows with locking so several workers can run; handlers are idempotent (notifications are not duplicated on retry). | two workers processing the same queue produce each notification exactly once. | backend |
| NFR-SEC-013 | **Portal security headers** (CSP, frame-ancestors none, referrer policy, permissions policy) at nginx or in Next.js. Today only the API sends helmet headers. | every portal response carries the headers. | backend |
| NFR-SEC-014 | **General rate limits**: 600 requests per minute per user and 30 uploads per minute per user (NFR-SEC-009). | exceeding either returns 429. | backend |

## New business rules (256)

| ID | Rule | Source |
| --- | --- | --- |
| BR-021 | a page jump is permission-checked once; a refusal produces exactly one "Access restricted" toast. | 5A-0-7 5.A.1 |
| BR-022 | a portfolio cannot receive orders while in state *Setup*. | 5A-0-7 5.A.2 |
| BR-023 | house liquidity floor is a policy parameter, not a constant, and "cover" is defined as liquid assets ÷ stressed outflows over the horizon. | 5A-0-7 5.A.3 |
| BR-024 | a scenario whose weights do not sum to 100 ± 0.01 cannot be saved, optimised or promoted. | 5A-0-7 5.A.4 |
| BR-025 | the displayed order-state vocabulary is the one in Appendix B (*Draft*, *Validated*, *Awaiting approval*, *Approved*, *Rejected*, *Routing*, *Partially filled*, *Filled*, *Settled*, *Cancelled*); *Pre-trade checked* maps to *Validated*. | 5A-0-7 5.A.5 |
| BR-026 | the dealing cost buffer (0.65 %), residual-cash warning (15 %), ADV advisory (25 %) and review thresholds (12 %, 450k/1.2m, 9.5 %) are configurable policy parameters. | 5A-0-7 5.A.5 |
| BR-027 | recommendation list is *Buy*, *Accumulate*, *Hold*, *Reduce*, *Sell*, plus *Review* as an explicit status if kept; conviction scale is defined once (letters or 1–5). | 5A-0-7 5.A.6 |
| BR-028 | usage ≥ 85 % of a maximum limit (or ≤ 115 % of a minimum limit) is *Tight*; a breach creates a case and notifies the limit owner. | 5A-0-7 5.A.7 |
| BR-029 | the scenario state thresholds (liquidity 1.25× / 1.5×, loss −8 % / −5 %) are configurable policy parameters. | 5A-0-7 5.A.7 |
| BR-030 | A performance period may be locked only when all five controls (IBOR positions reconciled, cash reconciled, valuation sources approved, composite membership review, fees and flows validated) are done, and only by a user other than the preparer; once Official the period is immutable and corrections create a new version with a reason **[P]**. | 5A-8-18 5.A.8 |
| BR-031 | Locking, export and methodology-version changes each write an audit event with user, time, period and result **[P]**. | 5A-8-18 5.A.8 |
| BR-032 | Period, return basis and State shown on the control bar must come from the same record as the KPI *Official state* **[P]**. | 5A-8-18 5.A.8 |
| BR-033 | Cash-account closure requires zero posted balance, no active reservations, no open reconciliation break and no suspense on the account, enforced by the server for the CLOSING → CLOSED step — AC: closing an account with posted 5.00 returns 409 with the blocker list. | 5A-8-18 5.A.9 |
| BR-034 | A cash account in DRAFT or PENDING_APPROVAL cannot post journals, reserve cash or commit statement imports — AC: such calls return 409. | 5A-8-18 5.A.9 |
| BR-035 | The cash-account maker is the signed-in user (not a fixed text) and the SoD check compares user ids — AC: a maker cannot approve, suspend, reactivate or close their own account; the drawer shows the maker's name. | 5A-8-18 5.A.9 |
| BR-036 | A capital notice, once `Funded` or `Paid`, must stay visible to staff in a capital history list with its evidence and approver names. | 5A-8-18 5.A.10 |
| BR-037 | KPI tiles must be calculated from the same queue data the page lists, so that each tile count equals the number of rows it summarises. | 5A-8-18 5.A.10 |
| BR-038 | Cases in Activation and Active must not count as "Ready to approve". | 5A-8-18 5.A.11 |
| BR-039 | The production UI must not store applicant PII in browser storage. | 5A-8-18 5.A.11 |
| BR-040 | KPI tiles, chart counts, the result count and the CSV export are all derived from the same filtered set so they always agree. **[O]** | 5A-8-18 5.A.12 |
| BR-041 | date presets are anchored to the period end (fixed 2026-08-31 in the prototype), not the system clock. **[O]** Production anchor is a decision (see Q-NEW below). | 5A-8-18 5.A.12 |
| BR-042 | a report whose status is *Review* is counted as "Awaiting review" and requires a human sign-off before release; client and regulatory outputs need a human reviewer. **[I]** (text only) | 5A-8-18 5.A.12 |
| BR-043 | the official NAV / performance period must be locked before a report is published; one material data exception blocks a report. **[I]** (text only; ties to 5.A.8 *Lock official return* and 5.A.18) | 5A-8-18 5.A.12 |
| BR-044 | numeric fields in a report are bound to approved source data; manual edits are flagged as overrides; every save creates an audit checkpoint. **[I]** (editor copy only) | 5A-8-18 5.A.12 |
| BR-045 | workflow vocabulary for reports is Draft, In review, Awaiting approval, Approved, Published (Appendix B); the running UI uses Draft, Review, Published only. The target must map *Review* → *In review* (or *Awaiting approval*) and render the full chain. | 5A-8-18 5.A.12 |
| BR-046 | document lifecycle is Draft → In review → Approved → Published; *Return* sends In review or Approved back to Draft with a reason; *Withdraw* removes publications and reverts to Approved; a new version always resets to Draft (and withdraws a Published document from investors until re-approved). **[O]** (server) | 5A-8-18 5.A.13 |
| BR-047 | only documents classified *Client* or *Public* can be published to investors; *Internal* and *Restricted* cannot (error "<classification> documents cannot be published to investors"). **[O]** (server) | 5A-8-18 5.A.13 |
| BR-048 | a *Restricted* document can be downloaded only by a user holding `audit.view` or by its maker; every download is audited. **[O]** (server) | 5A-8-18 5.A.13 |
| BR-049 | download links are short-lived signed URLs (expiry 300 seconds). **[O]** (server) | 5A-8-18 5.A.13 |
| BR-050 | documents are never deleted through the API; retention years per document default to 7 (range 1–50). **[O]**; legal-hold blocking is | 5A-8-18 5.A.13 |
| BR-051 | file storage is encrypted at rest with a recorded SHA-256 per version. **[O]** | 5A-8-18 5.A.13 |
| BR-052 | optimistic locking — a lifecycle call supplying a stale version returns "This record was changed by someone else. Reload and try again." **[O]** | 5A-8-18 5.A.13 |
| BR-053 | publish creates a Pending signature request per client when the document requires a signature. **[O]** | 5A-8-18 5.A.13 |
| BR-054 | allowed upload types pdf, docx, xlsx, csv, png, jpg; ≤ 25 MB; malware scan before availability; classification required. **[P]** (the server accepts a wider MIME list and performs no scan) | 5A-8-18 5.A.13 |
| BR-055 | Position quantity must equal settled + unsettled quantity, and the Position count, Market value and Available cash KPIs must equal the aggregates of the positions in scope **[P]**. | 5A-8-18 5.A.14 |
| BR-056 | A position whose custodian quantity differs from the IBOR quantity is shown as *Review* and appears in the Exceptions count until the break is resolved; the reconciliation tab shows the actual difference **[P]**. | 5A-8-18 5.A.14 |
| BR-057 | Historical snapshots are read-only reconstructions from effective-time records; they never change current positions **[P]**. | 5A-8-18 5.A.14 |
| BR-058 | Order-eligible available cash is a single server-calculated value shared by the cash page, the order ticket, reservations and withdrawals (rule version recorded with every result). | 5A-8-18 5.A.15 |
| BR-059 | Journal posting, reservation creation and statement commit are atomic with row-level locking of the cash account so concurrent requests cannot over-reserve or double-post. | 5A-8-18 5.A.15 |
| BR-060 | A cash account in status SUSPENDED, CLOSING or CLOSED accepts no new reservations or manual journals; reconciliation postings remain allowed. | 5A-8-18 5.A.15 |
| BR-061 | A task is **overdue** when the current CAT time is later than its deadline and its state is not *Done*; overdue tasks show a red *Overdue* flag and count towards *Due today*. | 5A-8-18 5.A.16 |
| BR-062 | A task whose dependency is not *Done* cannot be marked *Done*; completing a task re-evaluates dependants and automatically moves *Blocked* tasks whose blockers have cleared to *Due*. | 5A-8-18 5.A.16 |
| BR-063 | A task creator may not mark their own task *Done* when the task is flagged as a control task (extends BR-001). | 5A-8-18 5.A.16 |
| BR-064 | KPI and dependency values are computed server-side from live data: *Due today* = tasks due today with state ≠ *Done*; *Close blockers* = tasks and controls with state *Blocked* that gate period close; *Settlement* readiness % = settled or matched instructions ÷ total instructions for today; *Cash* % = share of bank feeds received within their schedule; *Valuation* % = priced positions ÷ total positions; *Accounting* % = completed close-checklist items ÷ total items. | 5A-8-18 5.A.16 |
| BR-065 | a reconciliation case may not be classified as a break until the independent counterparty population has been received and validated. | 5A-8-18 5.A.17 |
| BR-066 | the prototype assumes the broker price is always the instruction price plus 0.01, so a trade break is always created at stage 8; production must create a break only when a real difference exists. | 5A-8-18 5.A.17 |
| BR-067 | Quantity and order-reference matching are exact; price tolerance, amount tolerance, as-of tolerance and NAV materiality are effective-dated configuration per family, not constants in code. | 5A-8-18 5.A.17 |
| BR-068 | recalculating a run after maker review or after release invalidates the maker review, and a released run may only be corrected by a new superseding version (FR-VAL-005) **[P]**. | 5A-8-18 5.A.18 |
| BR-069 | the NAV exception list, price coverage and release gates (*Source evidence current*, *Cash reconciled*, *Material exceptions*, *Maker review*) are computed from live source status, reconciliation sign-off and exception state, not static labels **[P]**. | 5A-8-18 5.A.18 |
| BR-070 | A margin dispute resolution records reason, counterparty evidence and the house calculation; funding a call requires maker ≠ checker and creates a cash expectation (FR-FIN-002). | 5A-19-30 5.A.20 |
| BR-071 | An election can be submitted only before the election deadline and only by `corporate_actions.elect` (Q-04). Approval by a different user moves the event to *Instructed*. | 5A-19-30 5.A.21 |
| BR-072 | Attestation must be recorded by two distinct users (Compliance and Finance); the filer must hold `regulatory.submit` (Q-04) and differ from the preparer. | 5A-19-30 5.A.22 |
| BR-073 | A source is authoritative only after connectivity, authentication, schema and quality checks pass and the named owner approves. | 5A-19-30 5.A.23 |
| BR-074 | The validator and the approval committee must be independent of the model owner. Production promotion requires closed high-severity findings and committee approval recorded by `models.approve` (Q-04). | 5A-19-30 5.A.24 |
| BR-075 | Copilot answers may cite only objects the requesting user is entitled to read. A question whose sources are all out of entitlement returns guidance without data. | 5A-19-30 5.A.25 |
| BR-076 | A setting change is audited with before/after values (the server already writes `settings.updated`); settings with no consumer must be removed or wired before release. | 5A-19-30 5.A.27 |
| BR-077 | Exporting audit evidence is itself an audited event (implemented as `audit.exported`). | 5A-19-30 5.A.28 |
| BR-078 | every monetary figure on every screen carries the as-of date and valuation status of the snapshot it was read from; PROVISIONAL, ESTIMATED and RESTATED must be visually distinct from FINAL (amber, amber, purple) and may never be shown without the label. | 5B 5.B.0 |
| BR-079 | fund, share class and as-of parameters sent by the browser are advisory; the API recomputes the allowed set from the user's entitlements and returns a generic 404 for anything outside it. | 5B 5.B.0 |
| BR-080 | a null or unavailable rate (Net IRR on a fund with no cash flows) is shown as *—*, never as 0.0 %; rates are always sent as fractions so the heuristic can be removed. | 5B 5.B.1 |
| BR-081 | *Total Commitment* = sum of the investor's contractual commitments (status ACTIVE or PENDING) in scope. *Paid-In Capital* = cash contributions received and posted. *Called* = capital formally called and visible to the investor (calls at ISSUED or later). *Unfunded Commitment* = Total Commitment − Called (never − Paid-In). *Outstanding called* = Called − Paid-In (floored at 0). So Paid-In + Outstanding called + Unfunded = Total Commitment. **[I]** | 5B 5.B.1 |
| BR-082 | the consolidated Net IRR is computed from the merged dated cash flows of all in-scope funds, or shown as *—* when it cannot be computed. **[P]** | 5B 5.B.1 |
| BR-083 | the Capital Position donut shows a partition of the commitment (Paid-In, Called Not Yet Paid, Unfunded) so the shares sum to 100 %; distributions and residual value are shown as separate figures, not as extra slices of the commitment. **[P]** | 5B 5.B.1 |
| BR-084 | the toggle windows are time based (YTD = from 1 January of the as-of year; 1Y = 12 months; 3Y = 36 months, each ending at the as-of date), applied to dated points, and the subtitle shows the active window instead of the static *Since Inception*. **[P]** | 5B 5.B.1 |
| BR-085 | the figures are those of the latest approved snapshot dated on or before the selected as-of date for each fund; the response `asOfDate` and `valuationStatus` are displayed, and for *All Funds* the status shown is the weakest status among the funds (ESTIMATED weaker than PROVISIONAL weaker than RESTATED weaker than FINAL) with the oldest snapshot date. **[P]** The real service currently picks the latest snapshot regardless of the requested as-of date. **[I]** | 5B 5.B.1 |
| BR-086 | for a selected OPEN_ENDED fund the KPI strip shows Account Value, Units Held, NAV Per Unit, YTD Return and net contributions and redemptions instead of commitment, called, DPI, RVPI and TVPI; the Capital Position panel is hidden; for a PRIVATE_CAPITAL fund the open-ended panel is absent; for *All Funds* with both models both blocks show. The API returns `openEndedSummary: null` (not zeros) when no OPEN_ENDED fund is in scope. **[P]** (design guardrail: never show commitment, DPI or TVPI for an open-ended fund unless configured). **[I]** | 5B 5.B.1 |
| BR-087 | the presentation currency (USD or ZIG) is applied by the API to every amount of the dashboard payload using the exchange rate of the as-of date, and the screen formats with the returned currency; the compact formats use the currency symbol or code, and chart axes show the currency. **[P]** | 5B 5.B.1 |
| BR-088 | when a single OPEN_ENDED fund is selected the KPI row shows the open-ended measures (Account Value, Units Held, NAV Per Unit, YTD Return, and 1M, 3M, 1Y, SI returns) instead of Net IRR, TVPI, DPI and RVPI; with *All Funds* and both models the private-capital KPIs cover the PRIVATE_CAPITAL funds only and the open-ended panel covers the OPEN_ENDED funds. **[P]** | 5B 5.B.2 |
| BR-089 | the *Period* select changes the figures: Net IRR, TVPI, DPI, RVPI and NAV change reflect the chosen window from approved period snapshots (or are marked as unavailable for that window), and the helper under each tile names the active period instead of the static *Since Inception*. **[P]** | 5B 5.B.2 |
| BR-090 | the range buttons are time windows ending at the as-of date and are the single period control of the history chart; selecting *Period* in the filter bar sets the same window. **[P]** | 5B 5.B.2 |
| BR-091 | a benchmark series exists only when approved points are stored for the pair (benchmark id, metric); the API then returns `configured: true`, `valuationStatus: FINAL`, the points with their date and label, the source and approval date; otherwise `configured: false`, `valuationStatus: UNAVAILABLE`, an empty series and the note *No approved {BENCHMARK} series is configured for {METRIC}.* The platform never generates a benchmark series. **[I]** | 5B 5.B.2 |
| BR-092 | the column shows the benchmark value for the fund's own benchmark and as-of date, per row. **[P]** | 5B 5.B.2 |
| BR-093 | the *Benchmark Comparison* panel compares the investor's (or selected fund's) value of the chosen metric with the selected benchmark's value for the same as-of date, in one chart, and the axis scale follows the metric (percent or multiple). **[P]** | 5B 5.B.2 |
| BR-094 | the card shows the real status of the snapshot (weakest status among the funds for *All Funds*) with a colour per status (green FINAL, amber PROVISIONAL or ESTIMATED, purple RESTATED), and the page shows the snapshot's calculation date, version, source module and approver (for example in the Valuation Notes card or a popover). **[P]** Historic approved figures remain visible and unchanged after later valuations. **[I]** | 5B 5.B.2 |
| BR-095 | the chart axis titles and money symbols follow the reporting currency. **[P]** | 5B 5.B.2 |
| BR-096 | *Download Report* creates a server-side report job that captures the selected fund, period, benchmark and as-of date; job states are QUEUED, RUNNING, COMPLETED, FAILED, CANCELLED; the screen polls until a terminal state or a timeout and treats every terminal state explicitly (COMPLETED downloads; FAILED shows the job error; CANCELLED shows a cancellation message; timeout shows a "still preparing" message and keeps the job id so the file can be fetched later). **[P]** | 5B 5.B.2 |
| BR-097 | one job vocabulary is used by the API and the screen (QUEUED, RUNNING, COMPLETED, FAILED, CANCELLED), and a COMPLETED performance-report job is downloadable by `GET /lp-portal/jobs/{jobId}/download` (or the `downloadUrl` returned by the job), with `Content-Type: application/pdf` and `Content-Disposition: attachment; filename="fund-performance-{fund or consolidated}-{as-of date}.pdf"`. **[P]** | 5B 5.B.2 |
| BR-098 | the API returns every ledger amount as a positive magnitude and the kind carries the direction; the demo data returns outflows as negative numbers, which makes the net formula add them. **[O] / [P]** | 5B 5.B.3 |
| BR-099 | Ledger amounts are positive magnitudes; the type determines direction; Net Cash Flow = contributions + subscriptions - distributions - redemptions - fees over settled (posted) rows only. — AC: for the demo data the net equals contributions + subscriptions minus the absolute distributions, redemptions and fees. | 5B 5.B.3 |
| BR-100 | all dates in the register are shown in UTC date form `MMM d, yyyy`. — AC: the step date equals the date stored. | 5B 5.B.4 |
| BR-101 | The full account number in the wiring dialog is shown only to roles that may pay (SIGNATORY, MANAGER) and each reveal is audited; VIEWER sees only the masked number. Q-113: Is a VIEWER allowed to see the full wiring text? — default: no. | 5B 5.B.4 |
| BR-102 | a snapshot binds the fund, share class, amount (subscription) or mode/amount/units/earliest dealing date (redemption) and currency; the hash must be computed over a fixed canonical field list that excludes `estimateSnapshotId` and unrelated keys, so that the same request produces the same hash at estimate time and at submit time. The real backend hashes the whole redemption body (including `estimateSnapshotId` at submit time), which can never match; the Nexus implementation must not copy that. | 5B 5.B.5 |
| BR-103 | a snapshot is single-use: after a successful submit it is marked consumed and cannot back a second request. (The real backend leaves it reusable for 15 minutes.) | 5B 5.B.5 |
| BR-104 | on submit the server re-checks every rule that the estimate checked (notice period, minimum balance, units available net of pending redemptions, compliance gate), because the position and the rules can change within the 15-minute life of a snapshot. (The real backend re-checks only the compliance gate.) | 5B 5.B.5 |
| BR-105 | the estimate never allocates units; units are confirmed only after funds are received and the dealing-date NAV is approved; every pre-dealing figure is labelled as an estimate (`isEstimate` true on estimates, and rows created from an estimate stay labelled "(Est.)" until the units are allocated). **[I]** | 5B 5.B.5 |
| BR-106 | "available to redeem" and the insufficient-units check use units held minus units of redemption requests not yet settled, so that several pending requests cannot together exceed the position. | 5B 5.B.5 |
| BR-107 | the next eligible dealing date is the first dealing date of the fund's frequency that is on or after (submission date + notice days), computed on the fund's business-day calendar and cut-off time zone; the earliest-dealing-date field accepts only dealing dates on or after it. | 5B 5.B.5 |
| BR-108 | estimated settlement date = dealing date + `settlementLagDays` business days (seed 2; design example 3; real backend hard-codes 3 calendar days). | 5B 5.B.5 |
| BR-109 | the `kycStatus` value set and the strings in `blockers` are a closed list with human-readable text (for example "Compliance hold", "Dealing suspended for this fund", "Investor not accredited", "KYC update required", "Unsettled capital call"); the page prints the text, not codes. | 5B 5.B.5 |
| BR-110 | the UI keeps one idempotency key per submit attempt (reused when the same attempt is retried after a timeout) and discards it after a response; the hash for multipart requests covers the form fields and the file hashes (the real backend hashes an empty body for multipart because its middleware runs before the file parser). | 5B 5.B.5 |
| BR-111 | transitions allowed: `SUBMITTED` → `COMPLIANCE_REVIEW` \| `REJECTED` \| `CANCELLED`; `COMPLIANCE_REVIEW` → `AWAITING_FUNDS` (subscription) \| `UNDER_REVIEW` (redemption) \| `REJECTED`; `AWAITING_FUNDS` → `FUNDS_RECEIVED` \| `REJECTED` \| `CANCELLED`; `FUNDS_RECEIVED` → `AWAITING_NAV`; `UNDER_REVIEW` → `AWAITING_NAV` \| `REJECTED`; `AWAITING_NAV` → `ALLOCATED`; `ALLOCATED` → `SETTLED`. No transition leaves `REJECTED`, `CANCELLED` or `SETTLED`. | 5B 5.B.5 |
| BR-112 | the history exposes separate `requestedDealingDate`, `expectedFundingDate` (subscriptions) and `expectedSettlementDate`, and the column *Expected Settlement* shows the settlement date once known and otherwise the estimate. | 5B 5.B.5 |
| BR-113 | the source bank account must be an ACTIVE account of the same client (and fund scope) or the submit fails with 422 and a field error on `sourceBankAccountId`. | 5B 5.B.5 |
| BR-114 | Currency of a request is one of the fund's dealing currencies; the estimate converts nothing and the history shows the request's own currency. — AC: a request in GBP is shown in GBP. | 5B 5.B.5 |
| BR-115 | unpublished (draft) and withdrawn documents are never returned by list, summary, detail, preview or download. The reference list query does not filter `publishedAt` today. **[P]** | 5B 5.B.6 |
| BR-116 | one canonical category enum is used by the API, the filter and the counts: `STATEMENTS`, `CAPITAL_CALLS`, `DISTRIBUTIONS`, `FUND_REPORTS`, `TAX`, `LEGAL`, `GOVERNANCE`, `FINANCIAL_STATEMENTS`, `NOTICES`, `SUBSCRIPTION`, `REDEMPTION`, `DEALING`, `OTHER` (the first eleven are the reference design list, `FINANCIAL_STATEMENTS` and `DEALING` are present in the seed data); the UI label is a lookup; *Distributions* must not share `MANUAL` with *Other*; every More item maps to a category (`SUBSCRIPTION` for *Subscription Documents*, `NOTICES`, `OTHER`). **[P]** | 5B 5.B.6 |
| BR-117 | the summary accepts the same `fundId` and (for tab counts) ignores `category` and `q`, so tiles and counts follow the fund selector. **[P]** | 5B 5.B.6 |
| BR-118 | the count of visible documents that have an open (Pending) signature request for the signed-in user's organisation (Nexus `signature_requests` status Pending); status REQUIRES_SIGNATURE for the same documents; the tile helper "Awaiting your signature" stays. **[P]** | 5B 5.B.6 |
| BR-119 | only downloads that completed and were audited are counted, and the figure refreshes after a download. **[P]** | 5B 5.B.6 |
| BR-120 | the history card shows DOWNLOAD events only (heading *Download History*), user shown as display name, and VIEW/PREVIEW remain in the audit log (SRDUI events `DOCUMENT_VIEWED`, `DOCUMENT_DOWNLOADED`); audit rows are append-only with a retention of at least 7 years. **[P]** | 5B 5.B.6 |
| BR-121 | the download endpoint either streams the bytes or answers a 5-minute HMAC-signed URL, always after the entitlement check and always writing the audit event; failures are not counted in *Secure Downloads YTD*; a download rate limit of N per minute per user returns 429 `rate_limited` (default N = 30). **[P]** | 5B 5.B.6 |
| BR-122 | the register shows the latest published version; SUPERSEDED versions stay reachable and labelled (SRDUI §19) and RESTATED documents show "Restated". **[P]** | 5B 5.B.6 |
| BR-123 | allowed values are `INVESTOR_ORGANISATION` and `INVESTOR_ACCOUNT`; the badge text is Title-Cased ("Investor organisation", "Investor account"). **[P]** | 5B 5.B.6 |
| BR-124 | the topbar search, dashboard panel and Capital/Account Activity links use the same document ids as this screen. **[P]** | 5B 5.B.6 |
| BR-125 | a thread's `relatedId` for type `REQUEST` is the request `reference`, and the screen matches by reference. | 5B 5.B.7 |
| BR-126 | an empty description is stored empty and creates no first message. | 5B 5.B.7 |
| BR-127 | a FUND-targeted notice is visible only to organisations with an active or pending commitment in that fund, and a share-class notice only to holders of that class. **[P]** | 5B 5.B.8 |
| BR-128 | one category enum (`CAPITAL_CALL`, `DISTRIBUTION`, `REPORT`, `VALUATION`, `NAV`, `AGM`, `POLICY`, `DEALING`, `REDEMPTION_SUSPENSION`, `SYSTEM`, `GENERAL`) with Title-Case labels, and `kind` (INFO / ACTION_REQUIRED) is a separate field that never replaces the category. **[P]** | 5B 5.B.8 |
| BR-129 | the open is recorded only when the user has the detail visible for at least one selection made by a click or a deep link, not by auto-selection. **[P]** | 5B 5.B.8 |
| BR-130 | acknowledgement keeps the first `acknowledgedAt`; a repeat answers 200 with the original timestamp; the organisation is *Acknowledged* when any SIGNATORY or MANAGER of the organisation has acknowledged; an `NOTICE_ACKNOWLEDGED` audit event records user, time and IP. **[P]** | 5B 5.B.8 |
| BR-131 | `requires_acknowledgement` is a stored boolean set by the publisher (default false); capital-call and policy notices default true. **[P]** | 5B 5.B.8 |
| BR-132 | the session `unreadCounts.notices` equals the number of visible notices with status *Unread* (not opened), and a separate count of notices awaiting acknowledgement drives dashboard actions and the bell. **[P]** | 5B 5.B.8 |
| BR-133 | add edit-before-open, withdraw and `expires_at`. **[P]** | 5B 5.B.8 |
| BR-134 | acknowledgement is audited (`NOTICE_ACKNOWLEDGED`) and opens are recorded per user. **[P]** | 5B 5.B.8 |
| BR-135 | store the account number encrypted, expose only the last four characters, and never return it. | 5B 5.B.9 |
| BR-136 | valid codes are `LATEST`, `LATEST_ANY`, `PRIOR_MONTH_END`; `LATEST_FINAL` is read as `LATEST`. | 5B 5.B.10 |
| BR-137 | Every LP request is resolved as user → active membership → organisation (client) → fund entitlement → resource. Client and fund identifiers sent by the browser are advisory; the server recomputes the allowed set and answers a generic 404 for anything outside it (403 `LP_FORBIDDEN` only for an explicit fund filter the user is not entitled to). **[I]** (reference: 403 for explicit `fundId`, silent filtering for lists, no check on ledger detail, vault list, request replies — Nexus must apply it uniformly) | 5B |
| BR-138 | A membership's `fundIds` is an explicit subset of the organisation's fund commitments; an empty or null list means no fund access in Nexus (the reference treats empty as all funds, which lets a scoped manager create an unscoped colleague). **[P]** | 5B |
| BR-139 | The funds in the session are the organisation's commitments in status ACTIVE or PENDING, filtered by the membership scope, one row per fund (the reference returns only the first commitment amount when a fund has several). **[I]** | 5B |
| BR-140 | Each fund carries an operating model, PRIVATE_CAPITAL or OPEN_ENDED. Private-capital funds show commitment, called, paid-in, unfunded, distributions, NAV, net IRR, TVPI, DPI and RVPI; open-ended funds show account value, units held, NAV per unit, YTD return and dealing, and their IRR, TVPI, DPI and RVPI are null (shown "—", never 0). **[I]** The Nexus UI shows the private-capital tiles for open-ended funds as well. DEFECT in 5.B.1. | 5B |
| BR-141 | A consolidated view ("All Funds") sums money across funds and recomputes TVPI, DPI and RVPI from the sums; net IRR is computed from the merged dated cash flows, not taken from one fund or averaged. **[P]** (reference: last fund's IRR) | 5B |
| BR-142 | Every valuation figure is read from an approved, immutable snapshot (client, fund, as-of date, valuation status, calculation date, version, source module, approver). The requested as-of date selects the latest approved snapshot dated on or before it; a published snapshot is never recalculated, and a restatement is a new snapshot that supersedes the original while the original stays visible. **[I]** (reference: performance honours `asOfDate`; dashboard always takes the latest snapshot) | 5B |
| BR-143 | Valuation status vocabulary ESTIMATED, PROVISIONAL, FINAL, RESTATED; a figure is never shown without its status and as-of date; PROVISIONAL and ESTIMATED are visually distinct from FINAL. **[I]** (the reference only ever emits FINAL, plus UNAVAILABLE for benchmarks) | 5B |
| BR-144 | The default status of a mixed set of funds is the least certain status among them (ESTIMATED, then PROVISIONAL, then FINAL), not FINAL. **[P]** (reference: FINAL unless all funds agree) | 5B |
| BR-145 | The default as-of date is the latest approved as-of date among the in-scope funds; the user's `defaultAsOfPreference` (LATEST, LATEST_FINAL, a fixed month-end) is applied when the session is built. **[P]** | 5B |
| BR-146 | Unfunded commitment = total commitment − called capital (never − paid-in). Outstanding called = max(0, called − paid-in). Paid-in = Σ received payments on the investor's allocations. Called counts only calls visible to the investor. **[I]** | 5B |
| BR-147 | DPI = distributions ÷ paid-in; RVPI = NAV ÷ paid-in; TVPI = (distributions + NAV) ÷ paid-in; each is null when paid-in ≤ 0 or the fund is open-ended; ratios are decimal strings to 4 dp. **[I]** | 5B |
| BR-148 | Net IRR is computed from the investor's dated cash flows with the ending NAV as terminal value, stored as a decimal fraction (0.1840 = 18.4 %) to 4 dp; the UI multiplies by 100 only for display. The reference stores a percent number for computed values (16.7) and a fraction for seeded values; Nexus must use one convention. **[P]** | 5B |
| BR-149 | Open-ended account value = Σ over share classes of units × NAV per unit (never summed before pricing); YTD return = NAV per unit now ÷ NAV per unit at the prior 31 December − 1 (1M, 3M, 1Y and since-inception analogously); distributions use the fund-approved total-return method. **[I]** (reference: always 0) | 5B |
| BR-150 | Capital-call allocation is pro-rata by commitment: call amount = min(round2(commitment × call percent ÷ 100), commitment − Σ prior calls), rounded half-up to 2 dp, skipped when ≤ 0; the sum of allocations equals the call total or the remainder goes to the last investor. **[I]** | 5B |
| BR-151 | Distribution split: net to investors = gross − carry (carry = (gross − hurdle) × carry rate); each investor's share is pro-rata by paid-in (by commitment when no paid-in), rounded half-up, last investor takes the remainder. The investor sees gross (their share before adjustments), adjustments (withholding or fees, stored, not derived) and net paid. **[I]**/[P] (reference derives "adjustments" from unpaid remainder) | 5B |
| BR-152 | The investor ledger is read from posted records (calls, payments, distributions, payouts, subscriptions, redemptions, fees); amounts keep their original currency and amount, the historical conversion rate and its date, and the reporting amount; ledger rows are never restated by later FX. **[I]** (reference: no FX fields) | 5B |
| BR-153 | A call or distribution is visible to investors only after staff approval and issue; drafts and cancelled records never appear in lists, summaries, notifications, activity or the ledger. **[I]** (reference applies this to calls only, and not to the ledger and activity feeds) | 5B |
| BR-154 | Acknowledging a call records who and when; it needs the SIGNATORY or MANAGER role and the call must be issued and not cancelled; it never changes `paid` or the status other than the acknowledged marker; a second acknowledgement returns 409 `LP_CALL_ALREADY_ACKNOWLEDGED` (per allocation, by anyone in the organisation). **[I]** | 5B |
| BR-155 | A payment confirmation is evidence only (file, claimed amount, notes, SHA-256, uploader, time). It does not change `paid`; staff matching does. Accepted file types and size are limited (default 25 MB; PDF, image, CSV, XLSX), the file is scanned before it is available, and a second confirmation for the same call is allowed. **[P]** (reference: no type check, no scan, no staff queue) | 5B |
| BR-156 | Derived call status order (target): CANCELLED, then PAID (paid ≥ amount > 0), then PARTIALLY_PAID (paid > 0), then OVERDUE (due date before today and unpaid), then ACKNOWLEDGED, then ISSUED. Acknowledgement must not hide an overdue call. **[P]** (reference puts ACKNOWLEDGED above OVERDUE) | 5B |
| BR-157 | "Due soon" is a configured window (default 7 days) used identically by the row highlight and by the summary (the UI uses 7, the reference summary 14). **[P]** | 5B |
| BR-158 | A call number is a sequential, per-fund number (CC-013). **[P]** (reference: derived from the date; no column) | 5B |
| BR-159 | Notice and statement downloads are real documents (PDF) generated or attached by staff; the reference returns text stubs. **[P]** | 5B |
| BR-160 | A request is created only from a valid estimate: estimate → snapshot (id, client, fund, type, canonical payload hash, result, expiry 15 minutes) → submit with `estimateSnapshotId`. The hash is computed over a fixed canonical field list that excludes `estimateSnapshotId`; a snapshot is single-use; the server repeats every check at submit time. **[I]**/[P] (reference: redemption hash can never match; snapshot reusable) | 5B |
| BR-161 | Estimates never allocate units, never change the ledger and always carry `isEstimate: true`; units and settlement become final only after funds are received and the dealing-date NAV is approved. **[I]** | 5B |
| BR-162 | Subscription estimate: management or subscription fee = amount × fee rate; other fees = flat fee; units = amount ÷ NAV per unit (fees are added on top, total investment = amount + fees); NAV per unit has 8 dp, units 6 dp, money 2 dp; NAV comes from the fund and share class dealing NAV, never a constant. **[I]** (the mock deducts fees from units; the reference uses NAV 1 when there is no holding) Q-NEW in 5.B.5. | 5B |
| BR-163 | Redemption estimate: mode AMOUNT (units = amount ÷ NAV), UNITS (value = units × NAV) or FULL (all units and the whole account value); fee = value × redemption fee rate; settlement amount = value − fee; settlement date = earliest dealing date + settlement lag business days (seed 2, design 3; the reference hard-codes 3 calendar days). **[I]**/ | 5B |
| BR-164 | Minimum balance: unless the redemption is FULL, the remaining account value must be at least the minimum balance amount and the remaining units at least the minimum balance units (defaults 1,000,000.00 and 100,000 units in the reference; both must hold). Breach returns 422 `LP_MIN_BALANCE_BREACH`. **[I]** | 5B |
| BR-165 | Available to redeem = max(0, account value − minimum balance amount), net of unsettled redemption requests, so that several pending requests cannot together exceed the position; available units = that value ÷ NAV. **[P]** | 5B |
| BR-166 | Notice period and dealing windows: the earliest dealing date must be on or after the first dealing date of the fund's frequency (default MONTHLY_LAST_BUSINESS_DAY) that falls on or after submission date + notice days (default 30 calendar days), evaluated on the fund calendar and cut-off time zone; otherwise 422 `LP_NOTICE_PERIOD`. **[P]** (reference: only today + notice days; frequency is informational; no cut-off time) | 5B |
| BR-167 | Compliance gate on estimate and submit: legal hold → 403 `LP_COMPLIANCE_HOLD`; dealing suspended → 403 `LP_DEALING_SUSPENDED`; inactive investor account → 409 `LP_ACCOUNT_INACTIVE`; not accredited, KYC not current and past-due unsettled capital calls are also enforced. **[P]** (reference: only the first three; KYC, accreditation and unsettled calls are display-only; unsettled calls always "true") | 5B |
| BR-168 | A submit for a source or destination bank account requires an ACTIVE account of the same client and fund scope. **[P]** | 5B |
| BR-169 | The dealing status workflow is staff-driven: SUBMITTED → COMPLIANCE_REVIEW → AWAITING_FUNDS → FUNDS_RECEIVED → AWAITING_NAV → ALLOCATED (subscription); SUBMITTED → COMPLIANCE_REVIEW → UNDER_REVIEW → AWAITING_NAV → ALLOCATED → SETTLED (redemption); REJECTED and CANCELLED terminal. **[I]**/[P] (reference: only SUBMITTED exists) | 5B |
| BR-170 | Four currencies are kept apart: transaction currency, fund base currency, investor reporting currency and the temporary display currency (`presentationCurrency`). Display currency changes presentation only, never records. **[I]** | 5B |
| BR-171 | Conversion uses the FX rate of the snapshot or transaction date, stored with the record; a missing rate shows the original currency with a note, never a silent USD value. **[P]** (reference: ZIG falls back to USD with "FX rate unavailable") | 5B |
| BR-172 | Money formatting uses the row's currency symbol; the compact format must not hard-code "$". **[P]** DEFECT in the mock formatter. | 5B |
| BR-173 | `Idempotency-Key` (8 to 200 printable ASCII characters) is required on: acknowledge call, upload payment confirmation, submit subscription, submit redemption, request performance report, acknowledge notice, create request, submit bank-instruction change, invite colleague. Scope = client + action + method + path + key; the same key and the same canonical payload (for multipart: fields plus file SHA-256) replays the first 2xx response with `Idempotent-Replay: true`; the same key with a different payload returns 409 `LP_IDEMPOTENCY_KEY_REUSED`; keys expire after a configured TTL (default 24 hours | 5B |
| BR-174 | Every document view, preview and download is audited (user, action VIEW, PREVIEW or DOWNLOAD, time, IP, user agent) after the file has been served successfully; the detail shows the last 20 entries with user names, not ids. `secureDownloadsYtd` counts DOWNLOAD rows of the calendar year. **[I]** | 5B |
| BR-175 | Downloads are entitlement-checked at issue time and either streamed or served by a user-bound, short-lived (≤ 300 s) signed URL; file name and `Content-Type` come from the stored name and MIME type (the reference names every file `.bin` because MIME is never stored). Preview is limited to PDF and image types and returns 415 `LP_UNSUPPORTED_MEDIA` otherwise. **[P]** | 5B |
| BR-176 | Each document stores SHA-256, MIME type, size and page count at publication; the vault `verify` call recomputes the hash of the stored bytes and returns `verified`, `expectedSha256`, `actualSha256`. **[I]** | 5B |
| BR-177 | Uploads (payment confirmation, request attachment, subscription documents) are limited to 25 MB by default, validated against an allow-list and scanned for malware before they become available; oversize returns 413 `LP_FILE_TOO_LARGE`, wrong type 415. **[P]** (reference: 500 on oversize, no allow-list, no scan) | 5B |
| BR-178 | The following LP actions write an audit event in the same transaction: capital-call acknowledgement, payment-confirmation upload (with SHA-256), dealing submit (payload hash and estimate snapshot id), document view/preview/download, notice open and acknowledge, request create and reply, thread reply, colleague invite/update/revoke, bank-instruction change request, settings changes that affect security, fund switch. Investor financial artefacts are retained at least 7 years. **[I]**/[P] (reference: only document access rows and notice receipts) | 5B |
| BR-179 | A notice targets ALL investors with a live commitment, a FUND (investors with ACTIVE or PENDING commitment in it), a SHARE CLASS (enforced), an ORG or a USER; recipients are materialised as receipts at publication; a FUND notice is never visible to an organisation without a commitment in that fund. **[P]** (reference leaks FUND notices to unscoped clients and stores but ignores share class) | 5B |
| BR-180 | Notice status per user is derived from that user's receipt: PUBLISHED → OPENED (first detail read) → ACKNOWLEDGED (SIGNATORY or MANAGER); organisation-level display shows the strongest status among colleagues only where the notice is addressed to the organisation; re-acknowledging does not overwrite the first timestamp. **[P]** (reference: any colleague's acknowledgement acknowledges for everyone and is overwritten on repeat) | 5B |
| BR-181 | A request has a reference "SR-" + 10 characters (reference) or a sequential "REQ-nnnn" in Nexus; types and priorities are closed lists; status vocabulary SUBMITTED, OPEN, ASSIGNED, UNDER_REVIEW, AWAITING_INVESTOR, AWAITING_INTERNAL, RESOLVED, CLOSED; an investor reply to a RESOLVED or CLOSED request reopens it to AWAITING_INTERNAL (the reference sets AWAITING_INVESTOR, which hands the turn back to the wrong party). **[I]**/ | 5B |
| BR-182 | Message read state is per user and per message; the unread count of the sidebar badge is the number of staff messages the current user has not read; threads are created by staff or by the investor from a record. **[P]** (reference: per message, organisation-wide, no creation path) | 5B |
| BR-183 | Attachments use upload-then-attach: `POST /requests/attachments` returns an id owned by the client; `attachmentIds` on create or reply must all belong to the client; unlinked uploads are purged after 24 hours. **[I]**/ | 5B |
| BR-184 | Only a MANAGER (and staff) may invite, change or revoke colleagues; a MANAGER may grant VIEWER or SIGNATORY only; MANAGER is granted by staff; the last active MANAGER can neither be demoted nor revoked; granted `fundIds` must be a subset of the actor's own scope; revocation invalidates all of the user's sessions at once; an invitation e-mail carries a one-time activation link only (never a password) and expires after 7 days; a pending invitation shows status INVITED. **[I]**/[P] (reference: temporary password e-mailed in clear, no last-manager guard, INVITED never shown) | 5B |
| BR-185 | A bank-instruction change never replaces the active instruction on submission. Flow: SUBMITTED → UNDER_VERIFICATION (callback to a number on file) → APPROVED → ACTIVATED (old instruction ARCHIVED) or REJECTED; submission requires SIGNATORY or MANAGER and a verified MFA factor when `requireMfaForLp` is on; the account number is encrypted at rest and returned masked (last 4) in every response. **[I]**/[P] (reference: raw body stored and returned in clear, only SUBMITTED) | 5B |
| BR-186 | `requireMfaForLp` makes enrolment mandatory at first sign-in for every LP user and adds a 5-minute step-up for bank-instruction changes and colleague changes. **[P]** (reference: challenge only for already-enrolled users) | 5B |
| BR-187 | The session endpoint returns `unreadCounts` {requests, messages, notices, notifications}; `notifications` = the number of items the bell can list; counts are numbers. **[I]** | 5B |
| BR-188 | Realtime events `lp_notification`, `lp_notice_updated`, `lp_request_created`, `lp_request_updated`, `lp_request_message`, `lp_thread_message`, `lp_thread_read`, `lp_thread_updated` are delivered to authenticated sockets only, with room joins authorised against the client; where no socket transport exists the UI polls every 30 s. **[I]**/[P] (reference: unauthenticated sockets and unauthorised detail rooms) | 5B |
| BR-189 | Rate limits (per user and per IP): 60 requests per minute on read routes, 20 per minute on write routes and 10 per minute on uploads and report jobs; list pages are capped at 200 rows; JSON bodies at 100 kB. **[P]** (reference: none) | 5B |
| BR-190 | The applicant-side triage is advisory and must never set or display a case decision; the authoritative pre-screen runs server-side after submit (FR-ONB-007) and its result is not shown to the applicant. | 5C5E 5.C.0 |
| BR-191 | Every natural person holding ≥ 25 % (directly or indirectly) and at least one controller must be listed; Σ ownership ≤ 100 %. | 5C5E 5.C.2 |
| BR-192 | PEP = Yes or Unsure, or sanctions ≠ No, routes the case to EnhancedReview before any approval. | 5C5E 5.C.3 |
| BR-193 | A submitted execution is immutable; corrections are new versions that supersede the earlier one with a reason, both retained. | 5C5E 5.E.1 |
| BR-194 | Day-end trade count must equal the number of executions received for the same account and statement date; a difference opens a Trades control exception. | 5C5E 5.E.2 |
| BR-195 | A day-end package, once submitted, can only be superseded by a newer package for the same (account, date, currency) with a reason; the earlier one is retained. | 5C5E 5.E.2 |
| BR-196 | every page and drawer is scoped to one *active company*; changing company reloads all data and clears client state (drafts excluded). | 5D 5.D.0 |
| BR-197 | the period selector defines the *reporting period in focus* for every period-aware page (YYYY-MM keys as in the Nexus API). | 5D 5.D.0 |
| BR-198 | Overview metrics are read from the **latest accepted** period (not drafts); a metric without an accepted value shows "—" and never a sample value. | 5D 5.D.1 |
| BR-199 | Reporting readiness = sections opened / sections required for the selected report type, as defined in 5.D.3. | 5D 5.D.1 |
| BR-200 | Action-centre items: (a) period items with status Due and due date within 14 days or overdue; (b) drill-down questions awaiting company response; (c) signature requests awaiting this user; (d) governance requests in status "Information requested". | 5D 5.D.1 |
| BR-201 | KPI definitions (name, category, unit, frequency, owner, target, direction higher/lower-is-better, evidence requirement) are **investor-agreed**: staff-managed, locked for the company; a change requires CFO (company) and portfolio-lead (fund) approval (as the UI copy states). Variance sign must respect direction (Nexus `company_kpis.invert`). | 5D 5.D.2 |
| BR-202 | Derived KPIs computed server-side from accepted statements (NVCCZ ref `utils/reportingDerivedKpis.ts`, formulas version 1): `TOTAL_REVENUE_COMPUTED = grossSales − returns + otherRevenue`; `COGS = goodsPurchased + materials + labour + overhead`; `GROSS_PROFIT = revenue − COGS`; `GROSS_PROFIT_MARGIN = GP/revenue`; `NET_PROFIT_MARGIN = net income / revenue` where `net income = operating income + non-operating − interest − \|income tax\| + below-the-line`; `EBITDA = operating income + D&A`, `EBITDA_MARGIN = EBITDA/revenue`; `CURRENT_RATIO = current assets / current liabilities`; `QUICK_RATIO = (ca | 5D 5.D.2 |
| BR-203 | Churn entered above 1 is interpreted as a percentage (5 → 0.05). | 5D 5.D.2 |
| BR-204 | The latest-period live view excludes `manualEntries`, `derived` and object-valued entries and flattens `AUTO_KPI_FLAT`; derived rows are tagged "Financial (derived)". | 5D 5.D.2 |
| BR-205 | KPI status vocabulary — *On track* (value within tolerance of target), *Above target* (beats target in the favourable direction), *Watch* (adverse variance beyond tolerance), *Submitted* (value present, no target). | 5D 5.D.2 |
| BR-206 | staff open a period with a due date and a mandatory-attachment list (name + allowed formats); a period can be on the calendar only once; opening notifies the company users. | 5D 5.D.3 |
| BR-207 | A month locks when the previous month's actuals are accepted (reporting request closed) or on the *close day* (day 5 of the following month, the unused `forecastCloseDay` default) — whichever is later; the lock can be lifted only by staff. | 5D 5.D.4 |
| BR-208 | Forecast versions are immutable once submitted; a new working version is created from the latest submitted one; the fund sees only submitted versions. | 5D 5.D.4 |
| BR-209 | Opening cash of month *n+1* equals closing cash of month *n* (the mock treats opening cash as an independent input). | 5D 5.D.4 |
| BR-210 | Accepted income-statement and cash-flow actuals (5.D.3) post to the matching month's input rows; month status becomes *actual-locked*. | 5D 5.D.4 |
| BR-211 | Liquidity alert when forecast closing cash < minimum cash threshold; runway = closing cash / average monthly net burn of the next three forecast months. | 5D 5.D.4 |
| BR-212 | when both parties have signed while the deal is still at stage TERM_SHEET or TERM_SHEET_NEGOTIATION the deal advances to UNDER_BOARD_REVIEW (never regress a deal that already moved on); e-mail and in-app notification to the company; provisioning of the investment memo and deal execution pack. | 5D 5.D.5 |
| BR-213 | required term-sheet fields: title, investment amount, equity %, valuation (staff-entered); optional key terms, conditions, timeline text and a document (≤ 50 MB; PDF, DOC, DOCX, XLS, XLSX, JPG, JPEG, PNG). | 5D 5.D.5 |
| BR-214 | pre-money value = valuation field (NVCCZ labels `valuation` as pre-money without a stated rule); post-money = pre-money + investment; ownership % shown to the company = equity % of the term sheet until a cap table exists. | 5D 5.D.5 |
| BR-215 | the "3 pending" reserved-matters badge counts open governance consent requests (5.D.7). | 5D 5.D.5 |
| BR-216 | Only the fund's legal/corporate-secretary and administrator users can configure share classes and stakeholders; only CIO/CFO/administrator roles can approve and execute transactions (NVCCZ matrix). | 5D 5.D.6 |
| BR-217 | A consent request lifecycle Draft → Submitted → Information requested ↔ Submitted → Investor review / Board review → Approved \| Rejected \| Withdrawn; decision recorded by fund staff with reason and decision date; the company cannot change a submitted request except to withdraw or respond to an information request. | 5D 5.D.7 |
| BR-218 | Decision due defaults to submission date + the contractual notice period of the matter (Q-NEW). | 5D 5.D.7 |
| BR-219 | "Next board meeting" days = meeting date − today; "Materials due" = meeting date − 8 days (28 Aug vs 05 Sep in the fixture). | 5D 5.D.7 |
| BR-220 | Board actions closed = actions with status Complete / all actions of the latest meeting; completion % = rounded ratio. | 5D 5.D.7 |
| BR-221 | Compliance health = obligations satisfied on time / obligations due in the last 12 months (definition to confirm). | 5D 5.D.7 |
| BR-222 | signature images accepted as PNG, JPEG, JPG, GIF or WEBP; a signature once applied is immutable; a party cannot sign twice. | 5D 5.D.8 |
| BR-223 | authority matrix — Funding documents: CEO + CFO; Board resolutions: Chair + Company Secretary; Investor acknowledgements: CEO or CFO (display values; enforcement by named-signatory records). | 5D 5.D.8 |
| BR-224 | signing requires step-up MFA within 5 minutes (Nexus `requireStepUp` semantics) and a verified company account. | 5D 5.D.8 |
| BR-225 | term-sheet signing by the fund uses an investor-side signatory with permission (NVCCZ: admin or Fund Manager role). | 5D 5.D.8 |
| BR-226 | Procurement/drawdown requisition lifecycle (NVCCZ): DRAFT → (submit) PENDING_VC_EXECUTIVE_REVIEW → APPROVED (VC CFO or SYSADMIN final gate, auto-RFQ to the top five eligible vendors by rating) → RFQ_SENT → CONVERTED_TO_PO; REJECTED/RETURNED can be resubmitted only by the requester and only after the content changed (content fingerprint); the investee may cancel a DRAFT or PENDING_VC_EXECUTIVE_REVIEW request, which returns it to DRAFT and releases the reservation. | 5D 5.D.9 |
| BR-227 | required for create: title; ≥ 1 line item with a name and quantity > 0; drawdown amount > 0; use-of-funds / business-case attachment before submit; only the company's portal user may submit (portfolio-owner check); an item estimate may not be negative. | 5D 5.D.9 |
| BR-228 | status mapping for the Kanban — Draft (DRAFT, REJECTED, RETURNED with a visible reason badge, CANCELLED), Under review (PENDING_VC_EXECUTIVE_REVIEW, PENDING_APPROVAL), Approved (APPROVED, RFQ_SENT), Fulfilled (CONVERTED_TO_PO with goods received / completed); amounts always in the commitment currency, FX shown when different. | 5D 5.D.9 |
| BR-229 | "Approved this quarter" = Σ `drawdownRequestAmount` where `approvedAt` falls in the current calendar quarter or status is APPROVED/RFQ_SENT/CONVERTED_TO_PO (ledger rule `isApprovedForLedger`). | 5D 5.D.9 |
| BR-230 | SLA — requests pending fund executive review for more than 48 hours appear in the staff SLA-breached queue. | 5D 5.D.9 |
| BR-231 | company-side approval (CFO then CEO) is a displayed route; Q-NEW whether it is enforced. | 5D 5.D.9 |
| BR-232 | documents are versioned (a new upload to the same name adds version n+1) with SHA-256 per version; classification maps to Nexus Document classification (Public, Client, Internal, Restricted) and to the V8 access profiles (Investor Reporting → Client; Executive & Board and Board → Restricted-to-named-members; Company only → Internal to company, invisible to fund staff). | 5D 5.D.10 |
| BR-233 | download links are HMAC-signed with 300 s expiry and audited (Nexus FR-DOC-002); share links expire in seven days and respect the access profile. | 5D 5.D.10 |
| BR-234 | allowed types and size per BR in 5.D.3 (platform cap 25 MB; the UI copy "100 MB" must be corrected or the cap raised for the vault). | 5D 5.D.10 |
| BR-235 | signed documents are immutable; a signed copy and certificate are added to the same folder automatically. | 5D 5.D.10 |
| BR-236 | the application documents in NVCCZ live mode are read-only deal documents (type, submitted flag, uploaded date) and are not part of the vault. | 5D 5.D.10 |
| BR-237 | a thread has a subject, a fund team, participants, status Open/Resolved, optional related object (period, request, term sheet); staff and company users post; messages are immutable; unread counts per user via read markers. | 5D 5.D.11 |
| BR-238 | a staff post notifies company members (in-app and e-mail); a company post notifies the owning staff role. | 5D 5.D.11 |
| BR-239 | access profiles (no admin roles are created, section 4.4): *Workspace administrator* (manage members, all pages), *Executive approver* (approve reports, forecast, requests, sign), *Report contributor* (prepare and submit reports), *KPI owner* (submit KPIs), *Finance editor* (statements, forecast, requests drafts), *Read only* (view). Stored as `company_users.profile`. | 5D 5.D.12 |
| BR-240 | segregation of duties inside the company — report preparer ≠ approver; forecast owner = CFO; board submission = Company Secretary + CEO; the approval route is configurable by the fund. | 5D 5.D.12 |
| BR-241 | invitation e-mail contains a one-time link (7 days); new members must enrol MFA before accessing company data when the MFA policy is on; at least one *Workspace administrator* must remain. | 5D 5.D.12 |
| BR-242 | MFA coverage = members with a verified factor / active members; access review certifies the member list at least every 90 days (Q-NEW). | 5D 5.D.12 |
| BR-243 | the letterhead (legal name, registration, tax number, e-mail, phone, website, logo, address lines, city, state, postal code, country, social links) is used on generated documents (board packs, certificates, signed copies); one letterhead per company; replaced as a whole. | 5D 5.D.13 |
| BR-244 | logo upload types and sizes per BR above; the stored URL is signed. | 5D 5.D.13 |
| BR-245 | notification preferences cover at least: reporting deadline reminders at 14, 7, 3 and 1 day before the due date, new investor requests/questions, decisions on requests and consents, signature requests; channels e-mail and in-app. | 5D 5.D.13 |
| BR-246 | A report, KPI save or file upload is allowed only for a period with an **open reporting request** (exact period key). Message: "No open reporting request found for reportingPeriod {YYYY-MM-DD}. {Organisation} must open a request before KPI/file submission." The period list in the portal is the set of open requests (not free calendar months). | 5D |
| BR-247 | One reporting calendar per period; opening requires `reportingPeriod`, `dueDate` and a non-empty mandatory-attachment list (`{name, formats[]}` or catalogue ids); duplicates → 409. | 5D |
| BR-248 | Bundle submit moves every DRAFT, NEEDS_REVISION and REJECTED report of the company+period to PENDING in one transaction; nothing eligible → "No draft, needs-revision, or rejected reports found to submit". | 5D |
| BR-249 | Editable only in DRAFT, NEEDS_REVISION, REJECTED; the owner (portfolio owner or original submitter) only; others → "Report does not belong to you". | 5D |
| BR-250 | Numeric strictness — blank = 0 (default per field), non-numeric = reject "Invalid Input: Please enter a numerical value for this KPI."; churn above 1 is treated as percent (÷100). | 5D |
| BR-251 | Balance sheet equation \\|Σ assets − (Σ liabilities + equity)\\| ≤ 0.02, checked for the current period and (if any prior value is non-zero) the prior period; message "Accounting Error: Balance Sheet is out of balance by $x.xx. ({period label})". | 5D |
| BR-252 | Revenue variance — if current revenue < 50% of the prior posted period revenue, submit requires a variance note ≥ 20 characters (`varianceExplanationNote` in `manualEntries`) or a PDF whose title contains "variance" or "explanation" or a VARIANCE_EXPLANATION report; else "Variance validation: Revenue is more than 50% below the prior reporting period. …". Prior period = the previous `YYYY-MM-DD` key in the company's KPI values; prior revenue from `TOTAL_REVENUE`, `TOTAL_REVENUE_COMPUTED` or `derived.financial.TOTAL_REVENUE_COMPUTED`, ignored when ≤ 0. | 5D |
| BR-253 | Review actions ACCEPT, REJECT, NEEDS_REVISION; reviewer ≠ submitter; return/reject needs a comment; ACCEPT (core statements) must carry accounting automation (valuation adjustment and/or dividend) in NVCCZ; operational and document types skip it; ACCEPT writes `TOTAL_REVENUE`, `NET_PROFIT`, `CASH_FLOW_NET` into the period's KPI values and `latestKpiValues`, recomputes derived KPIs, notifies the company; on failure → NEEDS_REVISION with the error in the reviewer comment. | 5D |
| BR-254 | Notifications — submit notifies Investments staff (roles BOARD_CHAIR, CIO, INV_ANALYST in NVCCZ; `research.edit` holders in Nexus); outcome e-mails the company contact; read receipts (`VIEWED_BY_INVESTEE`) are logged at most once per 15 minutes per period. | 5D |
| BR-255 | Reminders — scheduled reminders at 14, 7, 3 and 1 day before the due date plus manual nudges with a mandatory message (UI copy "14, 7, 3 and 1 day reminders"). | 5D |
| BR-256 | Statement/report uploads accept `.xlsx .xls .csv .pdf`; core statements (income statement, balance sheet, cash flow) must be `.xlsx`/`.xls`; PDF allowed for narrative/compliance types; stored name `{YYYY-MM}_{Company}_{ReportType-id8}_v01.{ext}`; up to 25 files per request; applicant-route cap 10 MB (NVCCZ) / platform `MAX_UPLOAD_MB` 25 (Nexus). Term sheet document ≤ 50 MB, types PDF, DOC, DOCX, XLS, XLSX, JPG, JPEG, PNG. Signature image PNG/JPEG/JPG/GIF/WEBP. Letterhead logo ≤ 10 MB (NVCCZ) → ≤ 2 MB image (proposed). V8 copy "50 MB per file" (reports) and "100 MB" (vault) conflict and must fo | 5D |
| BR-257 | Income lines: revenue = grossSales − returnsRefundsAndAllowances + otherRevenue; COGS = goodsPurchased + materials + labour + overhead; gross profit = revenue − COGS; operating expenses = Σ the 20 operating-expense lines (advertisingAndPromotion … depreciationAndAmortisation, including D&A); operating income = GP − opex; EBITDA = operating income + D&A; net income ≈ operating income + nonOperatingRevenuesAndExpenses − lessInterestExpense − \\|lessIncomeTaxExpense\\| + (discontinued + accounting changes + extraordinary); S&M proxy = advertisingAndPromotion + researchAndDevelopment. | 5D |
| BR-258 | Balance sheet: current assets = cash + AR + inventory + prepaid + short-term investments; fixed = long-term investments + PP&E + (less) accumulated depreciation + intangibles; other assets = deferred tax + other; total assets = current + fixed + other; current liabilities = AP + short-term loans + income taxes payable + accrued salaries + unearned revenue + current portion of LT debt; total liabilities = current + long-term debt + deferred tax + other LT; equity = owner's investment + retained earnings + other. | 5D |
| BR-259 | Cash flow: operating receipts = customers + other operations; payments = inventory + G&A + wages + interest + income taxes; operating net ≈ receipts − payments. | 5D |
| BR-260 | Ratios: GROSS_PROFIT_MARGIN = GP/revenue; NET_PROFIT_MARGIN = net income/revenue; EBITDA_MARGIN = EBITDA/revenue; CURRENT_RATIO = current assets/current liabilities; QUICK_RATIO = (cash + AR)/current liabilities; DEBT_TO_EQUITY = total liabilities/equity; INTEREST_COVERAGE = EBIT/\\|interest\\| (interest > 0); ROA = net income/total assets; ROE = net income/equity; WORKING_CAPITAL = current assets − current liabilities; MONTHLY_BURN_OPERATING = \\|operating net\\|/months when operating net < 0 with months = max(1, (end − start + 1 day)/30); CASH_RUNWAY_MONTHS = (balance-sheet cash if > 0 else  | 5D |
| BR-261 | Operational: CUSTOMER_RETENTION_RATE = 1 − churn; LTV = ARPU/churn; CAC = S&M spend/new customers; LTV_CAC_RATIO = LTV/CAC; CONVERSION_RATE = customersFromLeads/leads; UNIT_CONTRIBUTION = price − variable cost; NET_DOLLAR_RETENTION = revenue from existing customers this period / same cohort prior period. | 5D |
| BR-262 | KPI card variance (UI) = (value − target)/max(target, 1) × 100; status vocabulary On track / Above target / Watch / Submitted; direction-aware (`invert`) in Nexus. | 5D |
| BR-263 | Total revenue = merchant + enterprise + other; gross profit = total revenue − processing costs − support/fraud losses; EBITDA = gross profit − S&M − P&E − G&A; EBITDA margin = EBITDA / max(total revenue, 1); closing cash = opening + operating − capex + financing; liquidity headroom = closing − minimum cash; total headcount = Σ four groups; cost per employee = payroll / max(total headcount, 1); annual column = sum (flows), last (balances, headcount, runway, minimum cash, headroom) or average (rates, FX, cost per employee). | 5D |
| BR-264 | Month stage: before the current calendar month → actual-locked; current month → actual-open; after → forecast; window = current − 3 … current + 8 months; percent inputs accept "x" or "x%" (÷100 when percent); inputs that are not numeric are rejected (the prototype coerces to 0). Report-builder cash movement = operating − capex + financing; closing = opening + movement (the NVCCZ host's `operating + capex + financing` is wrong). | 5D |
| BR-265 | Scenario summary fields (rolling revenue, rolling EBITDA, runway months, financing need) are computed from the version's cells under that scenario's overrides; Base case = board-approved. | 5D |
| BR-266 | FD shares = Σ issued (ACTIVE classes) + Σ authorised shares of OPTION_POOL classes; holder FD % = (shares + options granted − exercised − cancelled)/FD × 100; option pool granted = Σ granted − cancelled; unallocated = authorised − granted (+ cancelled). | 5D |
| BR-267 | Dilution simulator = NVCCZ `CapTableDilutionEngine` (formulas in 5.D.6); UI simplified model `post = pre + amount; new% = amount/post; existing × pre/post` is acceptable only for holders whose holdings are known (no hard-coded constants). | 5D |
| BR-268 | Waterfall = NVCCZ `CapTableWaterfallEngine` (seniority order, `min(remaining, issued × cost × multiple)`, pro-rata over common + participating preferred; add the non-participating "greater of preference or as-converted" test before Nexus relies on it). | 5D |
| BR-269 | Cap-table writes follow DRAFT → PENDING_APPROVAL → EXECUTED with CIO/CFO/administrator approval; seller balance and authorised-share checks at create and execute; creator ≠ approver (to add). | 5D |
| BR-270 | committed = `totalCommittedAmount` (> 0) else Σ APPROVED + DISBURSED disbursements; reserved = Σ drawdown of PENDING_VC_EXECUTIVE_REVIEW, PENDING_APPROVAL, APPROVED, RFQ_SENT, CONVERTED_TO_PO (excluding the request being checked); available = max(committed − reserved, 0); create/submit require reserved + amount ≤ committed; message "Drawdown Request Exceeds Available Investment Tranche." | 5D |
| BR-271 | A request requires a title, ≥ 1 item with a name and quantity > 0 (unit estimate ≥ 0), `drawdownRequestAmount` > 0 and an attachment explaining use of funds before submit; only the company's portal user submits; the VC CFO (or SYSADMIN) is the final approval gate for investee requests regardless of amount (no threshold table exists for investee requisitions: Q-NEW); SLA 48 h for the fund executive review. | 5D |
| BR-272 | Ledger approval — a request counts as approved when `approvedAt` is set or status ∈ {APPROVED, RFQ_SENT, CONVERTED_TO_PO}; `totalApprovedDrawdownAmount` = Σ their drawdown amounts. | 5D |
| BR-273 | Resubmission after REJECTED/RETURNED needs a changed content fingerprint (header + items) and only the requester may resubmit. | 5D |
| BR-274 | Term-sheet signature requires FINAL status; each party signs once; image types PNG, JPEG, JPG, GIF, WEBP; the term sheet is SIGNED only with both signatures. General signatures require named signatories, consent, step-up MFA ≤ 5 minutes and record document SHA-256, IP and timestamps; the final signature locks the document and issues a certificate. | 5D |
| BR-275 | Authority matrix (display): funding documents CEO + CFO; board resolutions Chair + Company Secretary; investor acknowledgements CEO or CFO. | 5D |
| BR-276 | Invitation token valid 7 days; one pending invitation per e-mail per company; at least one administrator per company; MFA coverage = verified factors / active members; access review certification interval 90 days (to confirm). | 5D |

## New open questions (176)

| ID | Question | Proposed default | Raised in |
| --- | --- | --- | --- |
| Q-26 | should the sidebar section headers hide when empty? | yes. | 5A-0-7 5.A.0.1 |
| Q-27 | should Focus mode default to on? | on, stored per user. | 5A-0-7 5.A.0.2 |
| Q-28 | should the Auditor (no `dashboard.view`) have a landing page of their own? | Whole Portfolio. | 5A-0-7 5.A.1 |
| Q-29 | which of the two settlement narratives (Zimplats US$ 412k VFEX fail vs private valuation exception) is the canonical top item? | both appear, ranked by financial impact. | 5A-0-7 5.A.1 |
| Q-30 | should ZAR be offered as base currency in the wizard while the SRD baseline is {USD, ZWG}? | keep ZAR (present in the wizard). | 5A-0-7 5.A.2 |
| Q-31 | where does the hub live now that the V16 hub is removed and company reporting is the Investee portal's counterpart — keep in Private Markets? | keep the hub on this page and always render it (empty state when offline). | 5A-0-7 5.A.3 |
| Q-32 | should `research.edit` remain the permission for company-reporting review? | introduce a dedicated `investee.review` permission; keep `research.edit` until seeded. | 5A-0-7 5.A.3 |
| Q-33 | can short weights be allowed per mandate? | no (slider minimum 0). | 5A-0-7 5.A.4 |
| Q-34 | should ZSE buys be allowed from a portfolio with no ZWG dealing account (e.g. USD Equity Fund)? | no (fail). | 5A-0-7 5.A.5 |
| Q-35 | which of the two cash estimates (V54 dead, V56 live) is canonical? | V56 (0.65 % buffer). | 5A-0-7 5.A.5 |
| Q-36 | should Compliance and Auditor have read access to research evidence? | yes, read-only (`research.view`). | 5A-0-7 5.A.6 |
| Q-37 | is conviction a letter grade (A…C) or a 1–5 score? | letter grade as implemented. | 5A-0-7 5.A.6 |
| Q-38 | which approver may activate a draft limit (Compliance, Risk, Investment Director)? | a user with `risk.manage` who is not the maker. | 5A-0-7 5.A.7 |
| Q-39 | is the severe scenario in the banner a fixed preset or the latest saved run? | a fixed preset named *Severe cross-asset*. | 5A-0-7 5.A.7 |
| Q-40 | Which user may lock an official return (new permission code or `reports.create`) and must the locker differ from the preparer? | `reports.create` plus maker ≠ checker, per existing Q-04. | 5A-8-18 5.A.8 |
| Q-41 | Is factor exposure part of the scope of this page? | no; it is mentioned only in the superseded subtitle and is not built. | 5A-8-18 5.A.8 |
| Q-42 | Which benchmark and composite apply per portfolio, and how often is the composite membership reviewed? | one approved composite per portfolio, reviewed monthly. | 5A-8-18 5.A.8 |
| Q-43 | Should operations and fund_accountant (prototype approvers) hold `cash.approve`, or is approval limited to investment_director and compliance as seeded? | seed stays (investment_director, compliance); prototype approver list is dropped. | 5A-8-18 5.A.9 |
| Q-44 | Should creating a cash account require only `clients.edit` (client_services, compliance, system_admin) or also operations? | `clients.edit` only. | 5A-8-18 5.A.9 |
| Q-45 | Is the full set of account types limited to CLIENT_BANK, CUSTODY_CASH, BROKER_SETTLEMENT, SUSPENSE, or must FX_SETTLEMENT, INCOME_RECEIPT and FEE_COLLECTION (present in the V43 form and original V56 form) remain? | all seven are allowed by the API; the form offers the three used by V49 plus SUSPENSE. | 5A-8-18 5.A.9 |
| Q-46 | Is the omnibus pool account (`POOL-01`) linked to a vehicle record instead of a client? | yes, a client-type "vehicle" record. | 5A-8-18 5.A.9 |
| Q-47 | Does the weekly/monthly reporting cadence workspace of V61 (see below) replace or extend the V49 page? | extend as a tab after the cash-account lifecycle is complete. | 5A-8-18 5.A.9 |
| Q-48 | Should *Investment director* and *Portfolio manager* be able to create service requests and reply to messages (they hold `clients.view` only)? | no; keep `clients.edit` for creation and replies. | 5A-8-18 5.A.10 |
| Q-49 | Is Investor Services to be split into the V61 sub-tabs (*Service queue*, *Capital*, *Publications*) in the production build? | yes, following V61. | 5A-8-18 5.A.10 |
| Q-50 | Should publishing a document to several clients at once be supported from this page? | yes, multi-select audience; the API already accepts a list of client ids. | 5A-8-18 5.A.10 |
| Q-51 | Should the queue show a SLA-breach indicator and default sort by blockers, risk and SLA (as the V33 header claimed)? | sort by SLA due ascending, show "Overdue" chip. | 5A-8-18 5.A.11 |
| Q-52 | Is the "Applicant portal" link intended for staff to demonstrate or to onboard on behalf of a client? | demonstration only; assisted flow handled by the new form. | 5A-8-18 5.A.11 |
| Q-53 | should presets anchor on the system date, the last locked period end, or a user-chosen as-of date? | system date in the Africa/Harare timezone, with an optional as-of override. | 5A-8-18 5.A.12 |
| Q-54 | is "Awaiting review" a single state or the pair In review + Awaiting approval? | count both as "Awaiting review". | 5A-8-18 5.A.12 |
| Q-55 | which of the four editor templates (client, compliance, investment, management) are in scope for phase 1? | all four, selected from the template catalogue. | 5A-8-18 5.A.12 |
| Q-56 | should the Regulatory report type link to 5.A.22 filings (the V33 link *Regulatory reporting* was dropped)? | restore a header link to the Regulatory Reporting workspace. | 5A-8-18 5.A.12 |
| Q-57 | what is the retention and versioning policy for generated report PDFs? | store each published PDF as a document version in the vault with the vault's default retention (7 years). | 5A-8-18 5.A.12 |
| Q-58 | should document type taxonomy in the UI be the five categories (Client, Investment, Operations, Regulatory, Governance) or the API types/folders (research, ic, clients, compliance, valuations, legal, …)? | keep the API types as the stored value and show the five categories as a derived filter. | 5A-8-18 5.A.13 |
| Q-59 | is the *Restricted* download rule (`audit.view` or maker) sufficient, or should it use entitlement groups? | keep `audit.view` or maker plus an explicit entitlement list per document. | 5A-8-18 5.A.13 |
| Q-60 | does *Needs signature* / *Expiring* status belong to the lifecycle status or to separate flags? | separate flags (signature state, expiry date) alongside the lifecycle status. | 5A-8-18 5.A.13 |
| Q-61 | statutory retention periods per class (see Q-15) | 7 years audit/financial, 5 years KYC post-exit. | 5A-8-18 5.A.13 |
| Q-62 | Which permission and roles may refresh the IBOR and start a holdings reconciliation? | `operations.view` holders (Operations, Dealer, Fund Accountant, Compliance, Auditor read-only), matching the proposed `POST /ibor/refresh` gate. | 5A-8-18 5.A.14 |
| Q-63 | Should position quantities be shown as numbers with currency columns rather than preformatted strings? | yes; numeric fields with formatting in the UI. | 5A-8-18 5.A.14 |
| Q-64 | Source for the "Last event" and "Processing lag" values | the position-event stream metadata. | 5A-8-18 5.A.14 |
| Q-65 | Is a separate permission needed for committing statement imports (checker) distinct from uploading them (maker)? | statement commit requires `cash.journal.approve` and the maker may not commit. | 5A-8-18 5.A.15 |
| Q-66 | Should `cash.approve` (held by `investment_director` and `compliance`) gate any cash-ledger action, or only cash-account lifecycle and capital-event approval? | only account lifecycle and capital events. | 5A-8-18 5.A.15 |
| Q-67 | Should expected movements be creatable by roles that cannot post journals (for example `portfolio_manager`, `dealer`)? | only holders of `cash.journal.create`. | 5A-8-18 5.A.15 |
| Q-68 | Are minimum buffer and pending-withdrawal amounts configured per account (tolerance profile) or per portfolio mandate? | per cash account, versioned with the availability rule. | 5A-8-18 5.A.15 |
| Q-69 | Which cash accounts feed order-ticket availability when a portfolio has several accounts in one currency? | sum of ACTIVE accounts of that portfolio and currency. | 5A-8-18 5.A.15 |
| Q-70 | Is the runbook per fund/portfolio, per business unit, or firm-wide, and are tasks generated automatically from scheduled events (settlement dates, capital-call due dates, election deadlines) or only created manually? | firm-wide, mix of system-generated recurring tasks and manual tasks. | 5A-8-18 5.A.16 |
| Q-71 | Which roles may complete or block a task, and is maker/checker required for control tasks such as *Prepare NAV close readiness*? | `operations` and `fund_accountant` may create/complete; control tasks require a different completer than the creator. | 5A-8-18 5.A.16 |
| Q-72 | Should *Service health* come from `GET /api/health?deep=1`, from the integration registry (5.A.23), or both? | both, as the lowest of the two. | 5A-8-18 5.A.16 |
| Q-73 | Operating-day hours and cut-offs (the workload chart spans 09:00-18:00 CAT; tasks run 15:50-17:30) — are they configurable per calendar and holiday set? | configurable operating window 08:00-18:00 CAT, ZSE/VFEX holiday calendar. | 5A-8-18 5.A.16 |
| Q-74 | Is a missing counterparty record a break (V61 wording) or a source-completeness exception that blocks matching (V56 behaviour)? | a source-completeness exception that blocks matching and daily sign-off, shown separately from value breaks. | 5A-8-18 5.A.17 |
| Q-75 | Which permission codes gate resolve, approve, sign-off and source management? | reuse `operations.view` plus maker ≠ checker until `recon.signoff` is approved (Q-04). | 5A-8-18 5.A.17 |
| Q-76 | Which families are in scope for the first release? | the six families present in the running UI (Trades, Settlement, Cash, Holdings, Units, Pricing / NAV); the other six V33 families are deferred. | 5A-8-18 5.A.17 |
| Q-77 | Where do the unit register and valuation book appear as internal sources? | add internal sources `SRC-UNITS` and `SRC-VAL`. | 5A-8-18 5.A.17 |
| Q-78 | Which value is authoritative for the Growth Equity IV exception (administrator US$ 4.31m or approved valuation US$ 4.46m), and in which direction does resolution move the NAV | the maker documents the authoritative value; the resolved value is recorded and the draft NAV recalculated from it. | 5A-8-18 5.A.18 |
| Q-79 | What are the stale-price threshold, NAV-movement tolerance and override materiality per asset class (refines Q-13) | 1 % or US$ 50k. | 5A-8-18 5.A.18 |
| Q-80 | Is the NAV maker a role (`fund_accountant`) or a permission, and who is the independent NAV checker | permissions `valuation.maker` and `valuation.release` held by different users. | 5A-8-18 5.A.18 |
| Q-81 | Should the valuation currency for *Zimbabwe Opportunities* (ZWG fund) be displayed in ZWG with a USD equivalent | show the fund currency with a USD-equivalent line using the valuation-date FX (BR-018). | 5A-8-18 5.A.18 |
| Q-82 | should the V61 three-tab structure (*Service queue*, *Capital*, *Publications*) be adopted? | yes. *(from 5.A.10)* | 5A-8-18 |
| Q-83 | which roles may create service requests and reply to threads? | roles with `clients.edit` (compliance, client_services, system_admin). *(from 5.A.10)* | 5A-8-18 |
| Q-84 | Is collateral posted per facility or per counterparty CSA? | per counterparty CSA. | 5A-19-30 5.A.20 |
| Q-85 | Are the visible obligations (Quarterly investment return, AML transaction summary, Capital adequacy return, Offshore exposure return) the SECZ/RBZ/FIU catalogue for Q-06? | yes, configurable. | 5A-19-30 5.A.22 |
| Q-86 | Should the Data page connection form and the Settings integration registry be one register? | one `integrations` table; the Data page shows it read-only with lineage, Settings edits it. | 5A-19-30 5.A.23 |
| Q-87 | Should permission-bundle changes require a second administrator's approval (maker-checker on RBAC)? | yes for monetary codes. | 5A-19-30 5.A.26 |
| Q-88 | Should `mfa_required` default to true for the admin portal, matching the prototype UI? | true in production. | 5A-19-30 4.5 |
| Q-89 | what should a user with zero fund entitlements see? | a full-page "No funds are linked to your account" empty state and no navigation other than *Settings*, *Requests* and *Notices*. | 5B 5.B.0 |
| Q-90 | Is the LP-role badge (viewer, authorised signatory, administrator) shown in the profile menu? | yes, "Viewer", "Authorised signatory" or "Administrator" under the user name, replacing the Nexus investor-role label. | 5B 5.B.0 |
| Q-91 | Does the notification bell total include `unreadCounts.notifications`? | the badge shows `unreadCounts.notifications` (items in the list) and the sidebar badges keep their own counts. | 5B 5.B.0 |
| Q-92 | Which realtime transport does Nexus provide (Socket.IO as in the source product, Server-Sent Events, or polling)? | polling every 30 s until a transport exists. | 5B 5.B.0 |
| Q-93 | What is the Nexus API prefix and source of the LP endpoints (the LP UI calls `/lp-portal/*`; the Nexus investor API is `/api/v1/investor/*` backed by published `InvestorSnapshot` records)? | implement `/api/v1/lp-portal/*` as in the NVCCZ contract, backed by the approved investor snapshot tables, and keep `/api/v1/investor/*` for the legacy pages until they are retired. | 5B 5.B.1 |
| Q-94 | How are LP roles mapped to Nexus investor roles (*VIEWER*, *SIGNATORY*, *MANAGER* versus *admin*, *investment*, *finance*, *auditor*)? | *MANAGER* = Investor Admin, *SIGNATORY* = Finance, *VIEWER* = Investment Viewer, all holding the four dashboard permissions listed under Access. | 5B 5.B.1 |
| Q-95 | How are amounts of funds in different currencies consolidated on *All Funds*? | convert each amount to the presentation currency at the as-of date's approved rate and disclose the rate and date. | 5B 5.B.1 |
| Q-96 | Which treatment applies to a consolidated Net IRR when funds have different currencies and valuation dates? | merged dated cash flows converted at their own dates; *—* if any fund's cash flows are missing. | 5B 5.B.1 |
| Q-97 | Does the Nexus API produce period figures (1Y, 3Y, 5Y, YTD) from stored period snapshots or compute them from dated cash flows? | compute from approved dated cash flows and NAV snapshots, and mark a window as unavailable when the data does not cover it. | 5B 5.B.2 |
| Q-98 | Where does benchmark index data come from and who approves it? | a maintained table of approved index points per benchmark id and metric (as in the NVCCZ `lp_benchmark_series_points`), approved by Investor Relations with a four-eyes check. | 5B 5.B.2 |
| Q-99 | Is the GIPS compliance statement correct for Matanho funds? | show it only for funds flagged as GIPS-compliant; otherwise show a neutral methodology note. | 5B 5.B.2 |
| Q-100 | Is the report a single PDF per fund or a multi-fund pack for *All Funds*, and who composes it (staff-approved fund report versus generated on demand)? | generated on demand from approved snapshots, a consolidated pack for *All Funds*. | 5B 5.B.2 |
| Q-101 | Which benchmark options does the investor see? | only those with an approved series for the selected metric; the fixed three-item list (*Cambridge Associates U.S. PE Index*, *S&P 500*, *Russell 3000*) is replaced by an API-provided list. | 5B 5.B.2 |
| Q-102 | What is the 3Y, 5Y, 10Y and MAX behaviour for an investor with less history than the window? | show all available points and label the range with the actual window. | 5B 5.B.2 |
| Q-103 | Which `postedBy` value may an investor see (internal staff names are normally hidden)? | show "System" or the role name, never a staff user name. | 5B 5.B.3 |
| Q-104 | Should `?entry=` widen the as-of date to the entry date? | yes, the entry's detail is shown independently of the date range. | 5B 5.B.3 |
| Q-105 | Should Currency, Structure and Status options be derived from the data? | yes. | 5B 5.B.3 |
| Q-106 | keep `/ledger` as an alias? | yes during migration. | 5B 5.B.3 |
| Q-107 | One due-soon window? The row highlight uses 7 days and the summary uses 14 days. | a single configurable constant of 14 days shared by the row highlight and the *Upcoming Due Amount* tile. | 5B 5.B.4 |
| Q-108 | Notes length limit and allowed types for payment confirmations (the server allows any type up to 25 MB; the picker offers pdf, png, jpg, jpeg, txt). | server enforces the same five types and 25 MB, notes at most 2 000 characters, error 415 `LP_UNSUPPORTED_MEDIA` / 413 `LP_FILE_TOO_LARGE`. | 5B 5.B.4 |
| Q-109 | Should *Total Distributions* be net paid or gross? | net paid to the investor (consistent with the table's *Net Paid*). | 5B 5.B.4 |
| Q-110 | Which five tiles? | keep the five shown and label *Paid Calls* "Paid (year to date)" with a year-to-date count. | 5B 5.B.4 |
| Q-111 | Sort order of the call register | newest first (the service orders by allocation creation time; the demo by call number descending). | 5B 5.B.4 |
| Q-112 | Canonical steps | ISSUED, ACKNOWLEDGED, PAYMENT_RECEIVED, CLOSED with labels "Call Issued", "Acknowledged", "Payment Received", "Call Closed". | 5B 5.B.4 |
| Q-113 | Is a VIEWER allowed to see the full wiring text? | no. | 5B 5.B.4 |
| Q-114 | Which event name? | reuse the notification event and refresh on `lp_notification`. | 5B 5.B.4 |
| Q-115 | Are subscription fees paid on top of the invested amount (design example: 2,000,000 + 20,000 + 5,000 = 2,025,000; real backend) or deducted from it (prototype)? | on top, units = amount ÷ NAV, matching the design document formula "Units Allocated = Net Subscription Amount / NAV Per Unit". | 5B 5.B.5 |
| Q-116 | Is the rate labelled *Management Fee (Est.)* a one-off subscription fee or a recurring management fee? The real backend feeds it from the subscription-fee setting (`subscriptionFeeBps`), the prototype from `mgmtFeeRate`. | relabel as *Subscription Fee (Est.)* and keep a separate recurring management fee out of this estimate. | 5B 5.B.5 |
| Q-117 | Does the notice period run in calendar days from the submission date (as the page text "Calendar Days" and the real backend say) and is there a cut-off time of day on the notice date? | calendar days from submission date, no time-of-day cut-off. | 5B 5.B.5 |
| Q-118 | May an investor cancel a request that is still `SUBMITTED` from this page? The design lists `CANCELLED` but the page has no cancel action. | no investor-side cancel in this release; cancellation is requested through the Requests screen. | 5B 5.B.5 |
| Q-119 | What are the minimum initial and additional subscription amounts per share class, and is a subscription document set mandatory (for example a signed subscription agreement and proof of payment) before the request leaves `SUBMITTED`? | no minimum enforced in this release; documents optional and visible to staff. | 5B 5.B.5 |
| Q-120 | Which documents are "proof of payment"? The page offers only "Supporting Documents" and the NVCCZ design lists no distinct proof-of-payment field. | treat all uploads as supporting documents; staff mark funds received. | 5B 5.B.5 |
| Q-121 | Which maximum file size applies? The prototype shows 10 MB (rules `maxFileMb`), the real backend hard-codes 25 MB and the design example is 25 MB. | take `maxFileMb` from the fund rules, default 25, enforce it on the client and the server. | 5B 5.B.5 |
| Q-122 | Is the redemption fee rate (design example 0.208613 %, seed 0.50 %, real backend 0 by default) charged on the gross redemption value, and who may change the fee, notice, minimum balance and suspension flag? | gross value; fund rules edited by Fund Operations with maker-checker. | 5B 5.B.5 |
| Q-123 | Should the redemption minimum balance test use amount, units, or both? The prototype tests amount only; the real backend tests both. | both. | 5B 5.B.5 |
| Q-124 | Is a fund the investor holds through several share classes redeemable per class on this page? The page supports one class per fund. | one class per fund in this release; additional classes appear as extra options in *Share Class* and the estimate is per class. | 5B 5.B.5 |
| Q-125 | Should an investor with a pending redemption be allowed to submit another one for the same dealing date? | yes, provided the sum of pending requests stays within the available position. | 5B 5.B.5 |
| Q-126 | `termsUrl` — where are the dealing terms hosted, and is the link per fund or per share class? | a document in the Documents vault per fund, opened through the document viewer. | 5B 5.B.5 |
| Q-127 | how are *Distributions* distinguished from *Other* in the target data (the prototype maps both to `MANUAL`)? | a dedicated `DISTRIBUTIONS` category. | 5B 5.B.6 |
| Q-128 | do SUPERSEDED, RESTATED and WITHDRAWN documents appear in the register? | SUPERSEDED and RESTATED are listed with their label; WITHDRAWN is hidden and its download answers 404. | 5B 5.B.6 |
| Q-129 | how does the Nexus `documents` / `publications` / `signature_requests` / `document_versions` model supply `period`, `version`, `status` and `accessScope`? | `period` from the report period, `version` from the latest version, `status` from the publication and signature state, `accessScope` constant `INVESTOR_ORGANISATION`. | 5B 5.B.6 |
| Q-130 | blob streaming or 5-minute signed URL for download and preview? | keep the blob contract in `lpPortalApi` and have the API return the file bytes (or a 302 to a signed URL). | 5B 5.B.6 |
| Q-131 | should `VIEWER` be allowed to download? | yes (reference rule; both permissions are in the VIEWER set). | 5B 5.B.6 |
| Q-132 | are threads created automatically one-per-request, or does the investor see request replies only in *Request Details*? | create one thread per request automatically (related type `REQUEST`, related id = request id) and write staff and investor replies to both the request timeline and the thread. | 5B 5.B.7 |
| Q-133 | should *Messages (n)* show unread or total threads, and should *Closed / Resolved* be limited to the current month | *Messages (n)* shows the number of threads with unread messages; *Closed / Resolved* stays all-time. | 5B 5.B.7 |
| Q-134 | should it show the related record (capital call, document) | show the fund and request type, and link to the type's screen. | 5B 5.B.7 |
| Q-135 | which request-type and priority values may the API accept | the four types above and priorities `LOW`, `NORMAL`, `HIGH`, `URGENT` (UI *Medium* sent as `NORMAL`), rejecting other values with 422. | 5B 5.B.7 |
| Q-136 | reference format `SR-…` (real service), `REQ-nnnn` (prototype and Nexus staff service requests) | keep the Nexus `REQ-` sequence so that investor and staff views agree. | 5B 5.B.7 |
| Q-137 | Nexus today exposes `/api/v1/investor/threads` and staff `/service-requests`; the LP contract (`/lp-portal/requests`, `/lp-portal/messages`) must either be implemented as a facade over them or replace them | implement the LP contract paths on the Nexus API and map them to the existing tables. | 5B 5.B.7 |
| Q-138 | is acknowledgement recorded per person or per organisation? | per person, with organisation status = acknowledged once any SIGNATORY or MANAGER has acknowledged. | 5B 5.B.8 |
| Q-139 | which notices require acknowledgement? | publisher-set flag, true for capital-call and policy notices. | 5B 5.B.8 |
| Q-140 | do notices expire or can staff withdraw them? | yes, `expires_at` and a withdraw action; withdrawn notices disappear from the list and the bell. | 5B 5.B.8 |
| Q-141 | should notices follow the top-bar fund selector? | yes, notices with a fund follow the selector and notices without a fund (ALL, ORG, USER) are always shown. | 5B 5.B.8 |
| Q-142 | should the portal email or push a notice on publication? | yes, honouring the in-app and email notification preferences (`emailNotices`, `inAppNotices`) on the Settings screen. | 5B 5.B.8 |
| Q-143 | should an invitation create a pending membership that is activated on first sign-in | yes; status *Invited* until the first sign-in or activation, *Active* afterwards. | 5B 5.B.9 |
| Q-144 | who may submit a bank instruction change | SIGNATORY and MANAGER (service behaviour), and the UI is aligned to it. | 5B 5.B.9 |
| Q-145 | required bank fields per currency | Bank name, Account name, Account number, SWIFT/BIC, Currency. | 5B 5.B.9 |
| Q-146 | should these fields be shown (read-only) | yes, read-only card; changes go through a *Profile / Access* request. | 5B 5.B.9 |
| Q-147 | Nexus today stores investor users as `client_users` with roles `admin`, `investment`, `finance`, `auditor` and a scope string, managed by staff only (`/investor-users`); how do these map to `VIEWER`, `SIGNATORY`, `MANAGER` | `admin` → MANAGER, `finance` → SIGNATORY, `investment` and `auditor` → VIEWER. | 5B 5.B.9 |
| Q-148 | which presentation currencies are offered | USD, ZAR, ZWG (the currencies with a published rate in the valuation snapshot), restricted to currencies for which an FX rate exists. | 5B 5.B.10 |
| Q-149 | should capital calls and distributions have separate rows | keep merged, and show the switch as on only when both are on (as implemented). | 5B 5.B.10 |
| Q-150 | are notification preferences per user or per organisation | per user (as in the service). | 5B 5.B.10 |
| Q-151 | does the portal enforce MFA for Signatories and Managers (design: "MFA is mandatory for signatories, administrators and bank-detail changes") | yes; when `requireMfaForLp` is on, a user without a confirmed factor is taken to MFA enrolment at sign-in (FR-AUTH-010), whereas the current service only checks at bank-change submission. | 5B 5.B.10 |
| Q-152 | which notification categories exist in the Nexus notification table (`notification_preferences` exists but is not read or written) | use it with `channel` ∈ {email, in_app} and the four alert types plus digest. | 5B 5.B.10 |
| Q-153 | keep `/api/v1/investor/*` as an alias for the four legacy routes | no alias). The reference router has 83 routes: the 70 below, 13 not called by the UI (listed in the second table) and one cron route; a `lp-portal-swagger-paths` file documents only 22 of them and is not a source of truth. Every number inside `data` is serialised as a string in the reference backend; the UI coerces a fixed list of count keys back to numbers. | 5B |
| Q-154 | Replace the four Nexus investor roles by VIEWER, SIGNATORY and MANAGER (migration of `user_roles` and `client_users.investor_role`), or keep the four roles and derive `lpRole` by the table above? | derive for the first release (no data migration), then converge on the three roles. | 5B |
| Q-155 | Is `fundIds` stored on `client_users` (JSON) or in a join table `client_user_funds`? | join table with a unique (membership, fund) key so that fund deletion and audits are relational. | 5B |
| Q-156 | Does LP document publication follow the Nexus approval workflow (draft, in review, approved, published) or publish immediately as in the reference backend? | Nexus workflow (`document_approval` policy). | 5B |
| Q-157 | Who owns fund master data, share classes and dealing rules in Nexus (Private Markets page, NAV & Valuation page, or a new Funds page)? | a new "Funds" administration page under 5.A.3 with maker-checker, because all LP screens depend on it. | 5B |
| Q-158 | keep `/api/v1/investor/*` as an alias for the four legacy routes). Existing routes `/api/v1/investor/bootstrap`, `/overview`, `/investments`, `/performance`, `/holdings`, `/capital-events`, `/documents`, `/requests`, `/threads`, `/users`, `/bank-instructions`, `/capital-events/:ref/funding-evidence`, `/documents/:ref/{read,download-url,sign}`, `/requests/:ref/reply`, `/threads/:id/{messages,read}`, `/users/invite`, `/profile-change-requests` remain in the API but are no longer called by any UI. | — | 5B |
| Q-159 | Keep a theme toggle on the public onboarding portal? | no (retire FR-ONB-015). | 5C5E 5.C.0 |
| Q-160 | Should the applicant see the advisory risk badge ("High review risk")? | no; show only completeness. | 5C5E 5.C.0 |
| Q-161 | Is suitability (risk profile, liquidity) captured at onboarding or later in mandate setup? | later, in mandate setup. | 5C5E 5.C.1 |
| Q-162 | Upload size limit per evidence file? | 25 MB (matches API and nginx). | 5C5E 5.C.5 |
| Q-163 | Which evidence set is mandatory per investor type (7 types)? | the "Target required set" column above. | 5C5E 5.C.5 |
| Q-164 | Enhanced-review value threshold? | 1,000,000 USD equivalent, configurable in policy. | 5C5E 5.C.6 |
| Q-165 | Custodian user roles (single submitter, or submitter + approver for day-end packages)? | submitter and approver; day-end package requires approver ≠ submitter at the counterparty. | 5C5E 5.E.0 |
| Q-166 | Minimum execution fields (ISIN, venue ZSE/VFEX, gross/net consideration, fees, ClOrdID/ExecID)? | add ISIN, venue, gross consideration, fees and optional ClOrdID/ExecID. | 5C5E 5.E.1 |
| Q-167 | Day-end file formats to parse (MT535/MT536, CSV template)? | CSV template + PDF evidence; MT535/536 later. | 5C5E 5.E.2 |
| Q-168 | remove or keep). Custodian — no roles or permissions exist [O]; see Q-NEW custodian roles (5.E.0). | — | 5C5E |
| Q-169 | Should the portal support users linked to several companies (company switcher)? | yes, the Company drawer becomes a switcher; the API honours `?company=<ref>` for members only. | 5D 5.D.0 |
| Q-170 | What is the Help & Support destination (guide document, support thread, external URL)? | guide = library document; support = new Messages thread to the investment team. | 5D 5.D.0 |
| Q-171 | Which five headline metrics are mandatory (Revenue, Gross margin, Cash available, Runway, Burn)? | those five, each tied to an investor-agreed KPI key. | 5D 5.D.1 |
| Q-172 | Is "Last valuation" shown to the company? | yes when the fund has published a valuation; otherwise "—". | 5D 5.D.1 |
| Q-173 | What is the tolerance for *Watch* (per-KPI or global)? | per KPI, default 5% adverse. | 5D 5.D.2 |
| Q-174 | Are KPIs reported monthly only (Nexus period model) or at the frequencies shown (Weekly, Monthly, Quarterly)? | stored per period key with `frequency` metadata; weekly values roll up to the month. | 5D 5.D.2 |
| Q-175 | Reconcile the V8 simplified statements (8/11/4 lines) with the canonical NVCCZ schemas (33/23/21 lines) | the server stores canonical keys; the builder shows grouped inputs that map onto them, with an "advanced lines" disclosure. | 5D 5.D.3 |
| Q-176 | Is the "Quarterly investor report" a separate pack from monthly management accounts or a roll-up? | separate period type (quarter-end key) with its own request. | 5D 5.D.3 |
| Q-177 | Do the existing Nexus five checklist items (Management accounts, Operating KPIs, Debt & cash, Board pack, Compliance certificates) remain? | yes as the *mandatory attachments* of a period; typed statements are additional. | 5D 5.D.3 |
| Q-178 | Is the forecast model an investor-reviewed deliverable (staff comment/accept like a report) or company-internal? | submitted versions are reviewed (accept/return) like reports. | 5D 5.D.4 |
| Q-179 | Are scenario definitions (driver overrides) company-defined or fund-defined? | company-defined, fund may require named Base/Upside/Downside. | 5D 5.D.4 |
| Q-180 | Should cells hold formulas (Excel-like) or only values with calculated rows? | values + fixed calculated rows (as built). | 5D 5.D.4 |
| Q-181 | Do Nexus companies have a deal/application pipeline (application → DD → term sheet) or are companies created directly in Private Markets? | companies are created by staff in Private Markets; a term sheet is a record on the company with a signature workflow. | 5D 5.D.5 |
| Q-182 | Is the term sheet the same object as the executed SHA (legal documents) shown under *Governing documents*? | separate published documents linked to the term sheet. | 5D 5.D.5 |
| Q-183 | Who maintains the cap table in Nexus — fund staff (legal), the company, or both with approval? | company proposes (draft transaction), fund legal approves and executes. | 5D 5.D.6 |
| Q-184 | Is the "Verified {date}" attestation a staff sign-off? | yes, set by the fund at each executed transaction batch. | 5D 5.D.6 |
| Q-185 | Where does the Series structure (Seed, Series A, Series B) come from — rounds as first-class records? | share classes carry round label; add a `rounds` read model. | 5D 5.D.6 |
| Q-186 | Who owns the board calendar and board pack — the company secretary (company) or the fund? | company secretary creates meetings; the fund is invited. | 5D 5.D.7 |
| Q-187 | Are consent requests legally binding records or workflow aids (signed resolutions via 5.D.8)? | workflow aids; a formal written resolution is created as a signature request. | 5D 5.D.7 |
| Q-188 | Native drawn signature versus an external e-signature provider (Nexus section 12)? | native for internal documents, provider integration for third-party legal documents. | 5D 5.D.8 |
| Q-189 | Are company-initiated signature requests in scope (the UI offers them) or only fund-initiated? | both, company-initiated limited to company-internal approvals. | 5D 5.D.8 |
| Q-190 | Is a "capital request" a different object from a "procurement requisition"? | one `requests` table with `type`, capital requests following the investment-committee route and procurement following the VC-CFO/RFQ route. | 5D 5.D.9 |
| Q-191 | Currency list (USD, ZAR, ZWG) — are requests allowed in non-commitment currencies with FX at approval? | yes, converted at the system rate on the decision date. | 5D 5.D.9 |
| Q-192 | Does Nexus (investment OS) contain a procurement module, or are requisitions handed to an external procurement system (NVCCZ proxies to `PROCUREMENT_API_BASE_URL`)? | requests are staff-reviewed in Nexus; sourcing is out of scope until a procurement module exists. | 5D 5.D.9 |
| Q-193 | Is the company vault the same store as Nexus `documents` (staff vault, 5.A.13) with a `company_id` scope, or a separate company-owned store? | same store, new `company_folders` and `access_profile` fields. | 5D 5.D.10 |
| Q-194 | Maximum file size — 25 MB (current platform) versus 100 MB shown? | 25 MB, correct the copy. | 5D 5.D.10 |
| Q-195 | Messages vs Q&A questions — one thread model? | one model; questions are threads with `type=question` and a Resolve action. | 5D 5.D.11 |
| Q-196 | Are attachments allowed in threads? | yes via the vault. | 5D 5.D.11 |
| Q-197 | Who provisions the first company user — the fund (Nexus `POST /companies/:ref/users`) — and may the company administrator invite others? | yes, within the same company only. | 5D 5.D.12 |
| Q-198 | Are profiles an entitlement list or a replacement for roles (4.4 says no roles)? | scoped profiles on `company_users`, evaluated by the API; no role catalogue entries. | 5D 5.D.12 |
| Q-199 | Which company fields can the company edit versus only the fund (legal name, registration number)? | contact and descriptive fields editable; legal name and registration changes go through a staff-approved change request. | 5D 5.D.13 |
| Q-200 | Reminder schedule (14, 7, 3, 1 days) — configurable per fund? | fixed as shown, owned by the reporting-request settings. | 5D 5.D.13 |
| Q-201 | Should invitation and reset lifetimes follow the SRD (72 h / 30 min) or the code (7 d / 60 min)? | SRD values. | backend |

## Defects found in the prototypes and current code (532)

| ID | Where | Defect |
| --- | --- | --- |
| DEF-001 | 5A-0-7 5.A.0.1 | sidebar badges (4, 5, 7, 3, 5, 8, 4, 3, 3, 4, 14, 8, 2, 4, 3, 2) are hard-coded and never update. |
| DEF-002 | 5A-0-7 5.A.0.1 | health line *All services operational* and *Last sync just now* are static strings; no health or sync call is made. |
| DEF-003 | 5A-0-7 5.A.0.1 | the collapse button's initial `aria-label`/`title` says *Expand sidebar* while the sidebar is expanded (corrected only after the first click). |
| DEF-004 | 5A-0-7 5.A.0.1 | the *28 available* count in the workspace toggle is a constant and ignores RBAC. |
| DEF-005 | 5A-0-7 5.A.0.1 | icon-only collapsed items have no `title`/tooltip. |
| DEF-006 | 5A-0-7 5.A.0.1 | mobile sidebar has no backdrop, outside-click close or Escape close. |
| DEF-007 | 5A-0-7 5.A.0.1 | an empty section header remains when RBAC hides all of its items outside focused mode. |
| DEF-008 | 5A-0-7 5.A.0.1 | live and demo data are indistinguishable in the UI; a failed bridge silently shows demo data. |
| DEF-009 | 5A-0-7 5.A.0.2 | search result buttons (*Open →*) have no click handler; nothing opens. |
| DEF-010 | 5A-0-7 5.A.0.2 | search is not permission-filtered, contradicting its own subtitle "across authorised records". |
| DEF-011 | 5A-0-7 5.A.0.2 | Enter in search opens the search drawer and the command palette simultaneously. |
| DEF-012 | 5A-0-7 5.A.0.2 | notification bell badge (*4*) and drawer text are hard-coded; the Settings notification toggles (`notifyRisk`, `notifyOrders`, `notifySettlement`, `notifyResearch`) do not affect them; server-created notifications (e.g. company-portal events for `research.edit` holders) are never displayed. |
| DEF-013 | 5A-0-7 5.A.0.2 | the profile button always shows *Tendai Moyo* / *TM*, even for another signed-in user. |
| DEF-014 | 5A-0-7 5.A.0.2 | the Focus preference is stored per browser origin in `localStorage['matanhoFocus']`, not per user, and in the default (on) state hides every page subtitle quoted elsewhere in this document. |
| DEF-015 | 5A-0-7 5.A.0.2 | the ZSE session indicator ignores public holidays and never reports VFEX. |
| DEF-016 | 5A-0-7 5.A.0.2 | the clock ignores the Settings timezone. |
| DEF-017 | 5A-0-7 5.A.0.2 | the role switcher and market clock vanish ≤ 1280 px. |
| DEF-018 | 5A-0-7 5.A.0.3 | palette command *DLTA.ZW market workspace* only navigates; the legacy selector it calls no longer exists and throws in a timer. |
| DEF-019 | 5A-0-7 5.A.0.3 | palette command *New order* and Shift+O only navigate (or show "Permission denied" / "{Role} cannot create orders." when `orders.create` is missing); no ticket opens because `#marketTradePanel` no longer exists. |
| DEF-020 | 5A-0-7 5.A.0.3 | palette command *Reconciliations* opens the Operations page. |
| DEF-021 | 5A-0-7 5.A.0.3 | palette has no focus trap and no recent items. |
| DEF-022 | 5A-0-7 5.A.0.4 | toast HTML is unescaped (injection risk with API-supplied text). |
| DEF-023 | 5A-0-7 5.A.0.4 | toasts have no close button, no pause-on-hover, no maximum stack and no `aria-live`. |
| DEF-024 | 5A-0-7 5.A.0.4 | "Not saved" is also shown for failed reads. |
| DEF-025 | 5A-0-7 5.A.0.4 | `#chartTooltip` is dead code: no element carries `data-tip`. |
| DEF-026 | 5A-0-7 5.A.0.4 | several independent modal systems coexist with inconsistent Esc and focus behaviour. |
| DEF-027 | 5A-0-7 5.A.0.4 | report editor selects (period, currency, classification), toolbar note "Autosave on · audit history enabled" and the live-data bindings are not functional; *Save draft* and *Submit for approval* persist nothing and do not check `reports.create`. |
| DEF-028 | 5A-0-7 5.A.0.4 | most outline buttons in the Investment Committee Pack template scroll nowhere. |
| DEF-029 | 5A-0-7 5.A.0.5 | an unknown layer name (e.g. `valuation-exception`, used by two Command Centre items after V37) silently opens the *Prioritised work queue*. |
| DEF-030 | 5A-0-7 5.A.0.5 | the breadcrumb setting can remove the only Back control. |
| DEF-031 | 5A-0-7 5.A.0.5 | layer content is static and not role- or user-specific. |
| DEF-032 | 5A-0-7 5.A.1 | *Run scenario* only navigates to Risk; it does not run a scenario. |
| DEF-033 | 5A-0-7 5.A.1 | *Investment pack* opens the Report Editor (no PDF download, no `reports.create` check). |
| DEF-034 | 5A-0-7 5.A.1 | V37 attaches a duplicate listener to every page-jump control, so `navigate()` runs twice and restricted roles get two "Access restricted" toasts. |
| DEF-035 | 5A-0-7 5.A.1 | worklist item 1 and decision-queue item 1 point to the non-existent layer `valuation-exception` and open the work queue instead. |
| DEF-036 | 5A-0-7 5.A.1 | tab badge *9* is stale (queue shows 6). |
| DEF-037 | 5A-0-7 5.A.1 | tile 6 (*Approval queue* 6) ignores scope changes after V37; its markup original *Control exceptions* values per scope are lost. |
| DEF-038 | 5A-0-7 5.A.1 | KPI *Active return* per scope disagrees with the chart's computed active (listed: +3.02 % on the tile vs +4.09 % on the chart; fixed: +0.84 % vs −1.37 %; private: +1.48 % vs +0.61 %; liquidity: +0.18 % vs −4.35 %). |
| DEF-039 | 5A-0-7 5.A.1 | 1M, 3M and YTD all end at 12.84 % / 10.74 % because the series are cumulative YTD levels, not period returns; series are synthetic. |
| DEF-040 | 5A-0-7 5.A.1 | ring *91.6 % invested* contradicts the allocation list (100 − 13.8 = 86.2 %). |
| DEF-041 | 5A-0-7 5.A.1 | mini-liquidity chart "Now" = 2.08× but the KPI and footer say 1.84×. |
| DEF-042 | 5A-0-7 5.A.1 | waterfall closes at $4.78M while its callout says US$ 5.36M. |
| DEF-043 | 5A-0-7 5.A.1 | *Mandate headroom* colours: 91 % bar is blue while the 93 % bar is amber (no thresholds). |
| DEF-044 | 5A-0-7 5.A.1 | default heat detail *Growth × Listed 90/100 → Within capacity* contradicts the > 80 → *Review concentration* rule; the detail strip and its instruction are dead because V50 intercepts the click. |
| DEF-045 | 5A-0-7 5.A.1 | *Mandate headroom* "Single issuer · Delta 91 %" vs order record risk note *Issuer 97.2% used*; worklist "4 proposed orders" and strip "2 orders" vs one seeded order awaiting approval (and V37 control queue *Orders 2*); work-queue stats and decision queue disagree on the settlement item (still listed in the work queue and order-approval layers although removed from the page by V37). |
| DEF-046 | 5A-0-7 5.A.1 | *Attribution waterfall* is not scope-aware although its subtitle says "Contribution bridge for the current portfolio scope."; *Volatility* 8.6 % and *Books synchronized 15:43 CAT* are static. |
| DEF-047 | 5A-0-7 5.A.1 | heat drill opens over Command Centre when the role lacks `risk.view`. |
| DEF-048 | 5A-0-7 5.A.1 | settlement layer wording (*Age 1h 08m*, *REC-66102*) differs from Command Centre text (*2h overdue*, *cash short T+1*). |
| DEF-049 | 5A-0-7 5.A.1 | no loading, empty or error states and no live data; `/v1/dashboard/summary`, `/v1/performance/series`, `/v1/work-items` do not exist. |
| DEF-050 | 5A-0-7 5.A.2 | strategy and currency selects are rendered but not wired; *6 active portfolios* never updates. |
| DEF-051 | 5A-0-7 5.A.2 | *Save view* stores only the search text in `matanho-portfolio-view-v8` and never restores it; not per user. |
| DEF-052 | 5A-0-7 5.A.2 | the *More filters* drawer evaluates the wrong records after the main search narrowed the table (row-index match). |
| DEF-053 | 5A-0-7 5.A.2 | *+ New portfolio* has no permission check; the evidence file is not stored; the new portfolio and its activation "tasks" are not persisted or created; the wizard has no Esc handler; numeric limits are not validated (no min ≤ max checks). |
| DEF-054 | 5A-0-7 5.A.2 | KPI *Available cash* (US$ 7.12M / 8.4 %) and *Weighted TWR* (12.84 % / +2.10 %) do not reconcile with the six rows (≈ US$ 8.11M / 9.6 %; ≈ 13.22 % / +1.84 %); the Command Centre repeats 12.84 % and 84.62M. |
| DEF-055 | 5A-0-7 5.A.2 | *YTD return* is always styled positive, including negative values. |
| DEF-056 | 5A-0-7 5.A.2 | layer stat *YTD return* sub-text says "Benchmark {x}" but shows the active return. |
| DEF-057 | 5A-0-7 5.A.2 | the original layer holdings table reads a non-existent `profile.holdings`; replaced at runtime by V55 through a MutationObserver. |
| DEF-058 | 5A-0-7 5.A.2 | Portfolio 360 allocation bars are hard-coded for all portfolios and can exceed 100 %. |
| DEF-059 | 5A-0-7 5.A.2 | V55 *Weight shown* sums all rows even when filtered. |
| DEF-060 | 5A-0-7 5.A.2 | new *Setup* portfolios inherit Balanced Growth profile, holdings and mandate headroom. |
| DEF-061 | 5A-0-7 5.A.2 | rows are not keyboard-focusable; global search result buttons do nothing. |
| DEF-062 | 5A-0-7 5.A.2 | Portfolio 360 and layer text "Benchmark {ret − active}%" uses string maths on formatted values. |
| DEF-063 | 5A-0-7 5.A.3 | KPI *12 vehicles* vs 6 inventory rows; *Private NAV* US$ 18.12M vs Σ inventory NAV 14.67M; *Unfunded* US$ 8.74M vs Σ 5.07M; *90-day net cashflow* −US$ 1.46M (V15) vs V44 −US$ 1.00m (90D) / −1.65m (6M); opening liquid assets 7.12 (bridge) vs 7.20 (forecast); Growth Equity IV call 07 Sep (table) vs 08 Sep (forecast). |
| DEF-064 | 5A-0-7 5.A.3 | exception 1 states NAV US$ 2.46M while inventory shows US$ 4.46M; exception 2 opens PC-018 (tone green) so its drawer shows "Evidence current." with no covenant data. |
| DEF-065 | 5A-0-7 5.A.3 | underlying cards (U-101…U-104) and pipeline items (PIPE-01…03) open a drawer titled with the raw id and "—" values; the `\|\|'US$ 0.84M'` fallback never fires. |
| DEF-066 | 5A-0-7 5.A.3 | *Export look-through →* produces no file (shows the intake form). |
| DEF-067 | 5A-0-7 5.A.3 | draft drawers persist nothing; "Draft created" is a toast only; amount allows 0; currency list has no ZWG; no vintage, valuation-date or fair-value-level fields. |
| DEF-068 | 5A-0-7 5.A.3 | "cover" is `min closing cash / peak monthly outflow` (3–6×), not a coverage ratio, and the floor line `min(cash)/1.25` is not a policy floor. |
| DEF-069 | 5A-0-7 5.A.3 | V17 *↗ Drill* on the forecast is destroyed by the V35 rewrite and never re-added. |
| DEF-070 | 5A-0-7 5.A.3 | Funding-plan modal and others have no Esc handler. |
| DEF-071 | 5A-0-7 5.A.3 | V16 hub removal makes company reporting unreachable when the API is down, the user is signed out or lacks `portfolio.view`; the hub has no loading indicator. |
| DEF-072 | 5A-0-7 5.A.3 | the hub's *Open company portal* still targets the replaced Portfolio Company portal URL (port 3103 / `company.{host}`) instead of the Investee portal. |
| DEF-073 | 5A-0-7 5.A.3 | company-portal notifications link to `/?page=private-markets`, which the admin app ignores. |
| DEF-074 | 5A-0-7 5.A.3 | toasts built from API data (company names, e-mail addresses) use unescaped HTML. |
| DEF-075 | 5A-0-7 5.A.3 | `overdue` is styled as a status chip but the backend defines no `overdue` status. |
| DEF-076 | 5A-0-7 5.A.3 | hub failure wording "Not saved" is also used for read failures; accept/return/question/reply/invite use browser `prompt()`. |
| DEF-077 | 5A-0-7 5.A.3 | nav badge *5* is static. |
| DEF-078 | 5A-0-7 5.A.4 | KPI strip is static; sliders and the optimiser never change any KPI, scenario row or trade. |
| DEF-079 | 5A-0-7 5.A.4 | *Run optimiser* performs no computation (only the 100 % check, then jumps to *Scenarios*); constraint inputs are ignored and reset on every re-render. |
| DEF-080 | 5A-0-7 5.A.4 | *Save scenario* is toast-only (no name, no persistence, no validation); `matanho-scenarios-v8` belongs to dead V8 code. |
| DEF-081 | 5A-0-7 5.A.4 | *Promote to Orders* creates no orders, checks no `orders.create` (the SRD's 5.A.4 rule applied only to dead V9 code), and never resets `optimised`. |
| DEF-082 | 5A-0-7 5.A.4 | the implementation trade table is static and independent of the targets. |
| DEF-083 | 5A-0-7 5.A.4 | *PM approval* gate is cosmetic. |
| DEF-084 | 5A-0-7 5.A.4 | constraint inputs have no units; the strategy limits do not reference existing risk limits. |
| DEF-085 | 5A-0-7 5.A.4 | no permission gates on *Run optimiser* / *Save scenario* / *Promote*. |
| DEF-086 | 5A-0-7 5.A.5 | submitted orders are written only to localStorage and never appear in the blotter, Approvals tab or *Working orders*. |
| DEF-087 | 5A-0-7 5.A.5 | no RBAC or segregation of duties on the page: any `orders.view` role (including Compliance, Operations, Auditor, Fund Accountant, System Administrator) can open the ticket, submit and press *Approve*; `orders.create`, `orders.approve` and `orders.route` are never checked by V33–V56; the approver may equal the creator (violates BR-003 / FR-OMS-006). |
| DEF-088 | 5A-0-7 5.A.5 | *Approve* has no *Reject*, no reason capture and only approves the first awaiting order. |
| DEF-089 | 5A-0-7 5.A.5 | the broker modal cannot be reached from the Orders page; *Send* only sets status *Routing* and transmits nothing. |
| DEF-090 | 5A-0-7 5.A.5 | the saved draft (`matanho-v56-order-draft`) is never restored. |
| DEF-091 | 5A-0-7 5.A.5 | suspended (CFI, COTT, HCCL, PPC, TRUW, BIND) and delisting-review (EDGR) securities are orderable. |
| DEF-092 | 5A-0-7 5.A.5 | V44 *Review* flags (> 12 % ADV, consideration > 450,000 USD / 1,200,000 ZWG, issuer > 9.5 %) disagree with V56 blocking rule (cash only; ADV > 25 % advisory); *Mandate eligibility* is always *Pass*. |
| DEF-093 | 5A-0-7 5.A.5 | Stop limit has no stop price; Market orders still require a price; no integer, board-lot or price-tolerance check. |
| DEF-094 | 5A-0-7 5.A.5 | sub-tab labels differ before and after selecting a security; the initial pane's range and Line/Area buttons have no effect; *More metrics* label desynchronises after re-render. |
| DEF-095 | 5A-0-7 5.A.5 | the hidden V45 listener shows "Order added to lifecycle" before the confirmation with a different id. |
| DEF-096 | 5A-0-7 5.A.5 | ticket and confirmation have no Esc handler; platform-setting defaults (portfolio, order type) are not applied. |
| DEF-097 | 5A-0-7 5.A.5 | the KPI strip, Import and Post-trade are hidden, so FR-OMS-010 and FR-OMS-011 have no reachable UI; the blotter has no filters or export (FR-OMS-012). |
| DEF-098 | 5A-0-7 5.A.5 | blotter limit prices are inconsistent with the security master (DLTA 63.5 vs 3.73); Research page shows DLTA ZWG 31.94 vs 3.73 here. |
| DEF-099 | 5A-0-7 5.A.5 | legacy order array vs Orders-page seed are two unrelated stores (order-approval layer, Portfolio layer and Portfolio Construction operate on the legacy array); V9 *Promote to orders* wrote to the legacy array which this blotter never displayed. |
| DEF-100 | 5A-0-7 5.A.5 | palette/Shift+O *New order* and *DLTA.ZW market workspace* open nothing; `N` fires twice; issuer logos call external services (`logos.hunter.io`, Google favicon). |
| DEF-101 | 5A-0-7 5.A.5 | security master prices are synthetic ("Exchange security-master snapshot · refresh required"); ZSE quotes in ZWG and VFEX in USD; no `/v1/securities` or `/v1/brokers`. |
| DEF-102 | 5A-0-7 5.A.6 | `research.edit` is not enforced; any `research.view` role (including Dealer and System Administrator) can save models and notes; saves are in memory only (lost on reload), with no versioning, approval or audit although the toast says "controlled model update". |
| DEF-103 | 5A-0-7 5.A.6 | the Auditor, Compliance and Operations cannot see research evidence at all (no `research.view`). |
| DEF-104 | 5A-0-7 5.A.6 | *Import filing* is a file picker + toast only (no upload, metadata, validation, list update). |
| DEF-105 | 5A-0-7 5.A.6 | *New investment case* opens a static case layer for DLTA.ZW; no creation form; the case layer's title maps every non-DLTA/ZIM ticker to "Innscor Africa"; layer stats and drivers are static and not linked to the saved model; the IC tab has no vote actions. |
| DEF-106 | 5A-0-7 5.A.6 | recommendation badge always blue; MEIK seed *Review* outside the option list; hero *Internal target*/*Upside* not refreshed after *Save model*. |
| DEF-107 | 5A-0-7 5.A.6 | *Reset* restores the last saved values, not the original seed. |
| DEF-108 | 5A-0-7 5.A.6 | "Autosave simulated in session" text; no autosave; note history shows a single entry without author or time. |
| DEF-109 | 5A-0-7 5.A.6 | model validation ranges (SRD: growth −100…+500 %, margin −100…100 %, discount 0–50 %, conviction 1–5) are not implemented; conviction is letter grades; empty numbers save as 0. |
| DEF-110 | 5A-0-7 5.A.6 | price conflict between pages: DLTA ZWG 31.94 here and in legacy order data vs ZWG 3.73 in the Orders security master; DLTA issuer utilisation 91 % here vs 97.2 % on the order record. |
| DEF-111 | 5A-0-7 5.A.6 | universe tab *VFEX* is always empty; source bar counts (*4 issuer workspaces*, *4 loaded*, *2*, *4*) are static. |
| DEF-112 | 5A-0-7 5.A.6 | price history only for DLTA and CBZ; status text *Delayed public observations* never changes; filings have no files, downloads or vault links; *Refresh sources* is toast-only. |
| DEF-113 | 5A-0-7 5.A.6 | dead legacy code (`renderResearch`, segmented filter) remains. |
| DEF-114 | 5A-0-7 5.A.7 | `risk.manage` is never enforced (only a catalogue label); any `risk.view` role can draft/amend limits, import sources and open the case form; FR-RSK-002 (limits require approval) and FR-RSK-004 (cases require `risk.manage`) are not implemented. |
| DEF-115 | 5A-0-7 5.A.7 | the V37 *+ Case* modal has no footer or submit button, so a compliance case can never be created; its subtitle promises due date, portfolio and evidence fields that do not exist. |
| DEF-116 | 5A-0-7 5.A.7 | the `risk-case` layers (AML, mandate) are unreachable from the page; the compliance-queue rows now navigate to onboarding and orders. |
| DEF-117 | 5A-0-7 5.A.7 | the limit modal has no validation, ignores the *Effective date* it shows and has no *Owner*; amend overwrites the effective row; there is no approve/activate step, so "draft awaiting approval" is copy only; all limit state is in memory. |
| DEF-118 | 5A-0-7 5.A.7 | the 30-day liquidity cover limit (a floor) is evaluated as a maximum (usage 147 %, headroom 0.00×). |
| DEF-119 | 5A-0-7 5.A.7 | banner *Severe stress −8.42 %* disagrees with the lab default −6.99 %; budget footer *Stress buffer 3 bps* disagrees with V44 headroom 0.06×; liquidity numbers differ between V37 (min stress 1.28), V38 (1.28), V44 (1.31) and the Command Centre mini chart (2.08× now vs 1.84×); heat labels (75/50) vs V50 severity (80/55); report pack VaR limit 3.00 % has no counterpart in the limit book. |
| DEF-120 | 5A-0-7 5.A.7 | *Save scenario* persists nothing; the scenario library and presets (*liquidity*, *equity*, *fx*) were removed; scenario portfolio, horizon and name inputs were removed; *Decision state* has no reason text or colour. |
| DEF-121 | 5A-0-7 5.A.7 | imports change only the source cards and add *Draft* limits without validation or de-duplication; positions never affect any risk number. |
| DEF-122 | 5A-0-7 5.A.7 | the compliance report is a static preview (static timestamp "01 Sep 2026 · 04:08 CAT", fixed numbers) with no print/download and does not reflect session changes; it is not the Report Editor *Compliance Monitoring Report* any more. |
| DEF-123 | 5A-0-7 5.A.7 | banner, KPIs, budget, signals and compliance queue are static (e.g. *Open compliance 3*, *Human action 5*, nav badge *3*). |
| DEF-124 | 5A-0-7 5.A.7 | `/v1/risk/*` endpoints do not exist; no breaches are created (FR-RSK-003). |
| DEF-125 | 5A-0-7 5.A.7 | no Esc handler on modal37 / V44 modals; no focus management. |
| DEF-126 | 5A-8-18 5.A.8 | *Lock official return* always shows "Official return blocked"; it never evaluates the checklist, has no maker-checker, role gate, confirmation or success path, and is never disabled. |
| DEF-127 | 5A-8-18 5.A.8 | Control bar *State* "PBOR current" (green) contradicts KPI *Official state* "Provisional" and the "1 pending" chip. |
| DEF-128 | 5A-8-18 5.A.8 | *Tracking error* is 6.42% ("Ex-post") on the page and 6.90% ("Annualised") in the explorer. |
| DEF-129 | 5A-8-18 5.A.8 | Brinson totals do not reconcile with the headline: segment totals 84 + 15 + 46 − 21 = 124 bps against active return 210 bps; allocation column sums to 17 bps against the bridge's +0.64%; selection column sums to 101 bps against +1.31%; segment weights sum to 61% (other segments omitted). |
| DEF-130 | 5A-8-18 5.A.8 | Explorer contributor totals (Consumer +0.96%) differ from the Brinson table (Consumer equities +84 bps); the explorer *Return quality* tab shows every control as Pass while the page shows one pending. |
| DEF-131 | 5A-8-18 5.A.8 | *Period* "01 Jan–28 Aug" differs from the chart series end date of 30 Aug. |
| DEF-132 | 5A-8-18 5.A.8 | Bridge bar widths are fixed percentages, not proportional to the values. |
| DEF-133 | 5A-8-18 5.A.8 | Range *1Y* equals *YTD*; range control affects only the chart. |
| DEF-134 | 5A-8-18 5.A.8 | Export is a fixed CSV literal, not derived from the displayed table; it omits the weight columns and offers no XLSX. |
| DEF-135 | 5A-8-18 5.A.8 | The Brinson "Cash" row has no colour class on *Total active* while the other rows are green. |
| DEF-136 | 5A-8-18 5.A.9 | (see Gaps). **[O]** |
| DEF-137 | 5A-8-18 5.A.9 | (see Gaps). **[O]** |
| DEF-138 | 5A-8-18 5.A.9 | V49 numeric parsing keeps the hyphen, so `n("CL-00418")` = −418 and every new client id is computed as `CL-00434` (maximum of existing ids and 433, plus 1); duplicates occur from the second creation. V43 parsed correctly. Production ids come only from the server sequence. |
| DEF-139 | 5A-8-18 5.A.9 | V49 `n("CCA-1001")` = −1001, so every new prototype cash account is `CCA-1001`, colliding with the seeded account. |
| DEF-140 | 5A-8-18 5.A.9 | the bridged create flow leaves duplicate local rows (client `CL-00434` next to the server client; two account entries sharing the server id) until reload. |
| DEF-141 | 5A-8-18 5.A.9 | bridged lifecycle result does not re-render the V49 lists and KPIs. |
| DEF-142 | 5A-8-18 5.A.9 | a client with KYC *Pending* is shown as "Relationship is current" in the next-action panel while counted in *Needs attention*. |
| DEF-143 | 5A-8-18 5.A.9 | the account status is not shown in the client detail account rows; DRAFT and PENDING_APPROVAL accounts display a green reconciliation badge. |
| DEF-144 | 5A-8-18 5.A.9 | SUSPENDED and CLOSED accounts offer *Submit for approval* (409 from the API); no *Reactivate* control although the server supports it. |
| DEF-145 | 5A-8-18 5.A.9 | prototype `cashAccountLifecycle` has no permission checks on submit, reject, suspend, close, and the maker-checker test compares with the hard-coded name "T. Moyo"; new drafts carry the maker text "Client Services", so the test never fires. |
| DEF-146 | 5A-8-18 5.A.9 | the cash state filter lacks SUSPENDED and CLOSED; the export ignores filters and its toast says "current controlled cash-account view". |
| DEF-147 | 5A-8-18 5.A.9 | Client 360 subtitle shows "&middot;" literally; *Client portal* link targets a missing `client-portal.html`; profile editor logo not persisted when bridged; created clients not persisted in prototype mode. |
| DEF-148 | 5A-8-18 5.A.9 | profile editor lets a `clients.edit` user set the KYC state directly (including *Current*), bypassing the KYC workflow, and relationship owner is free text. |
| DEF-149 | 5A-8-18 5.A.9 | the cash-summary tiles use the wrong element selector in the stylesheet (no card style). |
| DEF-150 | 5A-8-18 5.A.9 | *Relationships* KPI is a constant 184 and the Client 360 / second-layer metrics (net flows, YTD performance, headroom, pending withdrawal, secure messages) are constants. |
| DEF-151 | 5A-8-18 5.A.10 | the bridge always sends `owner`, so every save records an "Assigned" event and sets the owner id to the saving user, even when the owner text is unchanged. |
| DEF-152 | 5A-8-18 5.A.10 | publish performs no optimistic-lock check and no step-up on the server. |
| DEF-153 | 5A-8-18 5.A.10 | the tabs are inert and have no handlers. |
| DEF-154 | 5A-8-18 5.A.10 | in live mode the portal state is never "Restricted", so *KYC current* always shows "Yes" even when the client's KYC is not current. |
| DEF-155 | 5A-8-18 5.A.10 | no empty state). In live mode, capital events in `Funded` or `Paid` and closed requests never appear in the queue. |
| DEF-156 | 5A-8-18 5.A.10 | the six KPI tiles and the sidebar badge "5" are hard-coded and contradict live data. |
| DEF-157 | 5A-8-18 5.A.10 | the *KYC / access* chip is always empty in live mode; no KYC or portal-access task source exists in the bridge. |
| DEF-158 | 5A-8-18 5.A.10 | *New secure message* does not persist (the API exists), and the demo *Save service update* does not persist. |
| DEF-159 | 5A-8-18 5.A.10 | the *Investor portal* button opens the relative address `client-portal.html`, which is not served by the Next.js admin portal (the public folder holds only `assets` and `legacy`); it probably returns 404. The bridge helper for sibling-portal URLs exists but is not used. |
| DEF-160 | 5A-8-18 5.A.10 | the capital event *Notice date* is ignored; the vehicle list is hard-coded; vehicle matching is by substring. |
| DEF-161 | 5A-8-18 5.A.10 | *Publish to client* preselects the first client when the document has none. |
| DEF-162 | 5A-8-18 5.A.10 | the Investor 360 tabs are inert; *Latest approved statement* and *Open service requests* are hard-coded; *KYC current* is always "Yes" when live; *Bank instructions verified* is always "Yes". |
| DEF-163 | 5A-8-18 5.A.10 | the relationship list does not re-render after a refresh; it has no empty state. |
| DEF-164 | 5A-8-18 5.A.10 | *+ Service request*, *Create capital call / distribution* and *New secure message* have no UI permission gating; unauthorised roles see a 403 "Not saved" toast. |
| DEF-165 | 5A-8-18 5.A.10 | capital notice *publish* has no optimistic-lock check and no step-up on the server. |
| DEF-166 | 5A-8-18 5.A.10 | every request save records an "Assigned" event and re-assigns the request to the saving user. |
| DEF-167 | 5A-8-18 5.A.10 | opening a thread does not remove its task until the next refresh. |
| DEF-168 | 5A-8-18 5.A.10 | no Escape-key handler for the dialog. |
| DEF-169 | 5A-8-18 5.A.11 | Evidence-tab *Request* / *Ask question* / *Request evidence* only write to `localStorage["matanho-v53-evidence-requests"]` yet toast "<item> was sent to the secure applicant portal."; no API call, email or timeline entry. |
| DEF-170 | 5A-8-18 5.A.11 | Evidence *Preview* always shows a generated mock page titled "APPLICANT EVIDENCE" (applicant literally "Applicant", random "KYC-<6 digits>" reference), never the uploaded file, and the footer text wrongly states the original opens; the bridge's signed-URL path is bypassed by the later evidence layer. |
| DEF-171 | 5A-8-18 5.A.11 | The V53 request dialog subtitle shows the wrong applicant name (global drawer title, default "Record"). |
| DEF-172 | 5A-8-18 5.A.11 | Live queue chip always reads "Digital", hiding risk. |
| DEF-173 | 5A-8-18 5.A.11 | Blocker reasons returned by the server are ignored; users see only a count and a disabled *Approve & activate*. |
| DEF-174 | 5A-8-18 5.A.11 | No UI for enhanced review, advance, assisted creation, evidence accept/reject or activation retry, although the API supports them. |
| DEF-175 | 5A-8-18 5.A.11 | Offline *Decline* cannot decline; offline *Refresh screening* turns "Not run"/"Queued" into "Clear" without a provider; offline approve is lost on reload. |
| DEF-176 | 5A-8-18 5.A.11 | Due date (hard-coded 2026-09-04), escalation and message channel are never persisted; *Export case pack* produces no file; *+ Party* is a toast only; suitability selects and digitised-mandate limits are static and identical for every case. |
| DEF-177 | 5A-8-18 5.A.11 | Evidence % counts all 8 slots and counts rejected files; screening % is case-sensitive; evidence "Current" does not distinguish uploaded from accepted. |
| DEF-178 | 5A-8-18 5.A.11 | Sidebar badge "8" and hidden KPI "Median cycle time 2.4d" / "Final authority Human" are static. |
| DEF-179 | 5A-8-18 5.A.11 | No UI RBAC: auditor and other view-only roles see all mutating controls; offline anyone can "approve". |
| DEF-180 | 5A-8-18 5.A.11 | Empty live list injects six demo cases (see Edge cases). |
| DEF-181 | 5A-8-18 5.A.11 | Message modal does not refresh the timeline after sending. |
| DEF-182 | 5A-8-18 5.A.11 | *Decision & audit* tab has no audit trail. |
| DEF-183 | 5A-8-18 5.A.12 | the page ships two incompatible report datasets (14-row V34 array in use; V33 six-row and original five-row arrays dead). Only one source of truth should exist. |
| DEF-184 | 5A-8-18 5.A.12 | *+ Report* → *Create draft* does nothing (no validation, no row, no toast, no persistence); the subtitle promises "period" and "publication authority" fields that do not exist. |
| DEF-185 | 5A-8-18 5.A.12 | *Schedules* is a toast with no screen or form. |
| DEF-186 | 5A-8-18 5.A.12 | every preview shows the same hard-coded metrics (US$ 84.62m, 12.84%, 10.74%, +2.10%) regardless of report; the V33 audience-specific papers were lost when V34 replaced the page. |
| DEF-187 | 5A-8-18 5.A.12 | *Export PDF package* produces no file; *Print / PDF* prints the whole page. |
| DEF-188 | 5A-8-18 5.A.12 | editor *Save draft* and *Submit for approval* show success toasts but persist nothing and enforce no permission or workflow; editor caption "Autosave on · audit history enabled" is untrue; document controls (period, currency, classification) have no handler; the data bindings and approval route are static. |
| DEF-189 | 5A-8-18 5.A.12 | editor default reporting currency is *ZWG* (first option) while the template text says base currency USD. |
| DEF-190 | 5A-8-18 5.A.12 | *Publication control* card states rules that are not enforced (period lock, material exception, human reviewer). |
| DEF-191 | 5A-8-18 5.A.12 | the report editor is unreachable from the Reports page; only the `client` template is reachable (from Clients). |
| DEF-192 | 5A-8-18 5.A.12 | `reports.create` is not enforced on any control; Dealer and Operations are denied but Auditor (view only) sees enabled create/export controls. |
| DEF-193 | 5A-8-18 5.A.12 | the *Create report* dialog and V34 workbench modals do not close on Escape. |
| DEF-194 | 5A-8-18 5.A.12 | date presets anchor on the fixed date 2026-08-31. |
| DEF-195 | 5A-8-18 5.A.13 | the vault table renders six hard-coded rows and ignores the live `/api/v1/documents` list; the bridge-loaded array is unused on this page. |
| DEF-196 | 5A-8-18 5.A.13 | *Upload document* and *Retention policy* are informational toasts; the working upload, versioning, lifecycle and export code is unreachable because the document modal cannot be opened from the vault. |
| DEF-197 | 5A-8-18 5.A.13 | *Updated from* and *Signature state* filters render but are not wired; no empty-state message; no reset. |
| DEF-198 | 5A-8-18 5.A.13 | KPI tiles are static (1,284 / 7 / 12 / 96 / 31 / 4) and inconsistent with the six-row table. |
| DEF-199 | 5A-8-18 5.A.13 | `documents.edit` is not enforced on the vault page controls (the original and bridged upload paths do enforce it). |
| DEF-200 | 5A-8-18 5.A.13 | server and client upload rules diverge (client picker accept lists differ; server accepts webp and zip and octet-stream, performs no malware scan, defaults classification to *Client*). |
| DEF-201 | 5A-8-18 5.A.13 | the document-modal *Edit* button opens the report editor on a copy of the preview HTML with no persistence and no permission check; prototype *Create new version* only bumps a label. |
| DEF-202 | 5A-8-18 5.A.13 | lifecycle uses browser `prompt()` dialogs for reasons and the client reference; the *Publish* prompt accepts free text. |
| DEF-203 | 5A-8-18 5.A.13 | the bridge shows *Return to maker* only for In review although the API also allows return from Approved. |
| DEF-204 | 5A-8-18 5.A.13 | the document-modal version list is hard-coded v3 / v2 / v1 in prototype mode. |
| DEF-205 | 5A-8-18 5.A.13 | global search lists documents but result buttons have no handler. |
| DEF-206 | 5A-8-18 5.A.14 | Search placeholder promises ISIN search but ISIN is neither in the data nor searched. |
| DEF-207 | 5A-8-18 5.A.14 | *Historical snapshot* has no date input; *Columns* has no selector; both are descriptive text only. |
| DEF-208 | 5A-8-18 5.A.14 | *Reconcile positions* goes to Operations Control rather than Reconciliations and shows its success toast when navigation is denied. |
| DEF-209 | 5A-8-18 5.A.14 | *Refresh IBOR* is a local re-render, not a job; as-of and KPIs do not update. |
| DEF-210 | 5A-8-18 5.A.14 | Quantity does not equal settled plus unsettled for DLTA.ZW, INN.ZW and ZIM.VX (quantity equals settled while unsettled is non-zero); USD-CASH shows quantity 7,000 against value US$ 10,000; USD-CASH available ignores its -3,000 unsettled. |
| DEF-211 | 5A-8-18 5.A.14 | Lots, Reconciliation and History tabs are hard-coded to DLTA.ZW data for all positions; the Break value is always 0 even for ZIM.VX in Review. |
| DEF-212 | 5A-8-18 5.A.14 | KPIs (US$ 84.62M, 438 positions) do not match the eight-row table (about US$ 16.85M). |
| DEF-213 | 5A-8-18 5.A.14 | All values are display strings, so no sorting or totals are possible. |
| DEF-214 | 5A-8-18 5.A.14 | Sidebar badge "4" and the Exceptions KPI are static. |
| DEF-215 | 5A-8-18 5.A.14 | *Trade security* does not pre-select the security on the Order Management page. |
| DEF-216 | 5A-8-18 5.A.15 | The context bar (client, portfolio, cash account, currency) has no listeners; no figure or table responds, and the currency defaults to ZWG while all values are USD. |
| DEF-217 | 5A-8-18 5.A.15 | All six tiles, the *Available cash proof* card and the ledger control strip are static markup for CCA-1001; they are not recomputed after approving a journal, creating a reservation or committing a statement. |
| DEF-218 | 5A-8-18 5.A.15 | The ledger control strip contradicts the seed (posted outflows 480.00 although POSTED journal JRN-260826-031 is −3,005.00; closing 10,000.00 versus committed statement closing 9,995.00); EXPECTED NET +480.00 does not equal the sum of the four expectation rows. |
| DEF-219 | 5A-8-18 5.A.15 | Seed account CCA-1042 subtracts an expected outflow (−52,000.00) in *available*, and CCA-1188 *withdrawable* is 25,000.00 below *available* with no stated reason. |
| DEF-220 | 5A-8-18 5.A.15 | *Explain* subtotal shows the stored available value instead of computing it from the displayed lines; *Reproduce number* therefore does not reproduce anything. |
| DEF-221 | 5A-8-18 5.A.15 | *Trace source* in the ledger card opens the balance explanation, not a source trace; *Trace source* in the reservation drawer is a toast only. |
| DEF-222 | 5A-8-18 5.A.15 | Maker-checker compares against the literal "T. Moyo" instead of the authenticated user; in-session drafts, reversals and uploads can never be approved or committed, and BR-001 is not enforced against real users. |
| DEF-223 | 5A-8-18 5.A.15 | Journal *Reject* is a toast only (no state, no reason, drawer stays open); statement *Validate staging*, *Submit for approval* and *Reject batch* have no permission check; *Add expected movement* has no permission gate. |
| DEF-224 | 5A-8-18 5.A.15 | The balance line in the journal drawer is styled green even for "× UNBALANCED — posting blocked". |
| DEF-225 | 5A-8-18 5.A.15 | Reservation availability is the constant 7,000.00 and is not reduced by created reservations; the "Required / expiry" field is ignored; the account and currency are fixed to CCA-1001 / USD. |
| DEF-226 | 5A-8-18 5.A.15 | New journals are always recorded as an outflow; the *Reason* field is not saved; only two lines can be entered; a zero amount passes; currency is not checked against the account. |
| DEF-227 | 5A-8-18 5.A.15 | V8 expectation form creates nothing (toast only) and lists accounts in every status. |
| DEF-228 | 5A-8-18 5.A.15 | Statement upload does not read or parse the file; *Validate staging* always passes; the commit gates and the four control tiles are text only; REJECTED is shown with the blue (not red) badge. |
| DEF-229 | 5A-8-18 5.A.15 | The same permission `cash.import` authorises uploading and committing; the maker-checker split relies only on the name check. |
| DEF-230 | 5A-8-18 5.A.15 | The orphan `period-close-precheck` handler is unreachable; no close day/period control exists, so `cash.close` has no effect. |
| DEF-231 | 5A-8-18 5.A.15 | The order ticket's cash check uses its own hard-coded balances (e.g. Balanced Growth Fund USD 1,862,400) that contradict the cash page (US$ 7,000.00 for the same portfolio's account), applies a fixed 0.65 % cost buffer, creates no reservation on submit and has no link to the cash page. |
| DEF-232 | 5A-8-18 5.A.15 | The sidebar badge "3" on *Cash* is static; the page copy replacement by Focus mode hides the original description permanently. |
| DEF-233 | 5A-8-18 5.A.16 | Mark done / mark blocked with note, reassign and any task lifecycle are not implemented anywhere; there is no *Done* state, so completion is never audited (current SRD FR-OPS-001 label [O] overstated). |
| DEF-234 | 5A-8-18 5.A.16 | *+ Operations task* inserts a fixed placeholder with no form, owner, time or title entry; *Calendar* and *Export runbook* only show toasts and *Export runbook* claims "Runbook exported" although nothing is exported. |
| DEF-235 | 5A-8-18 5.A.16 | KPI tiles, dependency percentages, link counts and chart series are static and mutually inconsistent: *Due today* 12 vs 7 listed tasks; *Cash deadlines* 3 vs 4 chart events; "US$ 1.6m gross flows" vs 3.18m in the chart; *Settlement exposure* US$ 842k vs the single US$ 412k fail; quick link "6 open" vs sidebar badge 14 vs superseded V33 "14 breaks"; sidebar *Operations Control* badge "4" matches nothing on the page. |
| DEF-236 | 5A-8-18 5.A.16 | No action-level permission: auditor, compliance, system_admin and portfolio_manager (read-only in practice) can press *+ Operations task* and *Export runbook*. |
| DEF-237 | 5A-8-18 5.A.16 | Six or more inbound links labelled "Reconciliations" / "Reconciliation evidence" route to `operations` instead of `reconciliations`: command-palette item *Reconciliations*, IBOR *Reconcile positions*, 360-drawer *Open reconciliations* and *Reconciliation health*, order-drawer *Reconciliation evidence*, position-layer *Reconciliations →*, accounting-layer *Resolve blockers*. |
| DEF-238 | 5A-8-18 5.A.16 | Task detail modal cannot be closed with Esc; no focus trap or initial focus; no keyboard handling for runbook rows (they are `div` elements, not buttons). |
| DEF-239 | 5A-8-18 5.A.16 | The filter and any manually added task are lost on reload; no empty-state message; no overdue indication. |
| DEF-240 | 5A-8-18 5.A.16 | Dead legacy code on this page key (reconciliation workbench builders, V16 hub strip *Receipt matching / Unit register / Fee engine / Complaints*, and a read of `matanho-recon-v12` in localStorage) targets selectors that no longer exist; it must not be carried into production. |
| DEF-241 | 5A-8-18 5.A.16 | Items that depend on another workspace (*Valuation*, *Accounting*) are not hidden or disabled when the user lacks the destination permission. |
| DEF-242 | 5A-8-18 5.A.17 | Forced rebuilds (*Fetch now*, *Refresh all*, *Save source*, *Fetch missing source*) hide the page because the `active` class is lost. |
| DEF-243 | 5A-8-18 5.A.17 | The v46 re-application loop never stops and also triggers the body-wide V53 observer. |
| DEF-244 | 5A-8-18 5.A.17 | The v36 rebuild shows the page stacked over another page for about 1.4 s at boot. |
| DEF-245 | 5A-8-18 5.A.17 | A source registered through the form has no kind, is invisible in the hub, never reaches `Current` and permanently gates *Run matching* until reload. |
| DEF-246 | 5A-8-18 5.A.17 | *Refresh all* marks a never-received source `Current`. |
| DEF-247 | 5A-8-18 5.A.17 | Maker resolution requires no rationale, no evidence reference, no root cause and no prior match; checker approval has no maker ≠ checker test and no role or permission test; the read-only Auditor can act. |
| DEF-248 | 5A-8-18 5.A.17 | *Close readiness* ignores pending-checker items and missing sources. |
| DEF-249 | 5A-8-18 5.A.17 | *Matched today* (142) and the sidebar badge (14) are constants. |
| DEF-250 | 5A-8-18 5.A.17 | The toast helper writes its message as HTML, and the registered provider name is inserted unescaped into the "Source registered" toast (HTML injection). |
| DEF-251 | 5A-8-18 5.A.17 | The v45 modal does not close on Escape and does not trap focus; the search box has no label. |
| DEF-252 | 5A-8-18 5.A.17 | Order stage 8 overwrites and reopens the first case regardless of its state and does not update its keys list. |
| DEF-253 | 5A-8-18 5.A.17 | Command-page *Reconciliations →*, the command-palette *Reconciliations* entry and IBOR *Reconcile positions* navigate to Operations. |
| DEF-254 | 5A-8-18 5.A.17 | The seeded Units and NAV cases use the OMS as their internal source. |
| DEF-255 | 5A-8-18 5.A.17 | The custodian portal sorts activity by a string compare of the formatted date, which is not chronological across months; *Clear* blanks the date and time defaults; there is no authentication, no maker/checker step and no signing. |
| DEF-256 | 5A-8-18 5.A.17 | Cross-portal hand-off through `localStorage` cannot work across ports 3100 and 3104 (see SRD 13.4). |
| DEF-257 | 5A-8-18 5.A.18 | No action-level permission on this page; all seven roles holding `valuation.view` (including `auditor`, `compliance`, `investment_director`, `portfolio_manager`, `system_admin`) can recalculate, resolve, submit maker review and release. |
| DEF-258 | 5A-8-18 5.A.18 | Maker and checker are not separated: the same user can submit maker review and release; the `navApproval` policy is stored but never consulted (BR-001, BR-005, FR-VAL-004). |
| DEF-259 | 5A-8-18 5.A.18 | NAV / unit is hard-coded and inconsistent for *Zimbabwe Opportunities* (shown 4.2281, computed 4.2289); *Balanced Growth* is truncated (2.4187 vs 2.41876) rather than rounded. |
| DEF-260 | 5A-8-18 5.A.18 | After resolution Draft NAV and NAV/unit are overwritten with constants and the bridge no longer sums; there is no "valuation adjustment / override" bridge line. |
| DEF-261 | 5A-8-18 5.A.18 | Recalculate changes only the version and does not recompute figures or reset maker/released state. |
| DEF-262 | 5A-8-18 5.A.18 | Resolution rationale and evidence are discarded; no audit record, no independent approval of the override. |
| DEF-263 | 5A-8-18 5.A.18 | *Release state* shows "Blocked" (amber) for funds that are only awaiting maker review. |
| DEF-264 | 5A-8-18 5.A.18 | *Price coverage* never changes on resolution; 99.6 % for *Zimbabwe Opportunities* is described as fully controlled. |
| DEF-265 | 5A-8-18 5.A.18 | Source-row statuses, release gates *Source evidence current* / *Cash reconciled* and per-fund IBOR/cash evidence are static; the FX evidence has no rate. |
| DEF-266 | 5A-8-18 5.A.18 | Dashboard items *Resolve private valuation exception* and *Valuation release exception* open the generic work queue because `valuation-exception` has no layer definition. |
| DEF-267 | 5A-8-18 5.A.18 | The exception (REC-66155 / REC-NAV-GEIV, "Pricing / NAV", US$ 150k, owner Fund Accounting) appears on Reconciliations (shown "Pending checker" in later layers) and in the Operations runbook ("16:30 Valuation – Review private asset price exception – Blocked", "17:00 Close – Prepare NAV close readiness – Blocked") with unlinked state; resolving one does not update the others. |
| DEF-268 | 5A-8-18 5.A.18 | Status text is printed twice in the source rows (text and chip); evidence date "Q3 valuation statement" is inconsistent with a 31 Aug valuation; negative compact amounts render "US$ -55K"; the `ccy` field is ignored; the *NAV pack* omits the "+" sign on market movement. |
| DEF-269 | 5A-8-18 5.A.18 | *NAV history* and *Valuation policy* entry points existed in V33 and are absent from the final UI. |
| DEF-270 | 5A-8-18 5.A.18 | Dead code references an unrelated OMU.ZW stale price (`price-exceptions`, `start-nav-run`, `review-valuation-evidence`, `startNavRunV9`); exclude from requirements. |
| DEF-271 | 5A-8-18 5.A.18 | The page has no link to Reconciliations, Accounting, Operations, Vault or Audit. |
| DEF-272 | 5A-19-30 5.A.19 | *Close period* does not close the period and is never disabled. It opens the same second-level workspace as *Run close pre-check*. |
| DEF-273 | 5A-19-30 5.A.19 | The close-checklist click binder targets `.close-checklist button` / `[data-close-control]`, which match nothing. The checklist items are inert. |
| DEF-274 | 5A-19-30 5.A.19 | The Variance column shows "US$ 0" for funds whose IBOR and ABOR values differ. |
| DEF-275 | 5A-19-30 5.A.19 | Journal IDs differ between the page and the second level. |
| DEF-276 | 5A-19-30 5.A.20 | *Collateral after haircut* is hard-coded (4.18) and does not derive from the pool tiles (2.10 + 3.42 + 1.86 = 7.38). |
| DEF-277 | 5A-19-30 5.A.20 | Funding-decision rows are static text and do not follow facility edits. |
| DEF-278 | 5A-19-30 5.A.20 | Funding-curve point click does nothing; tooltips are lost after a scenario switch. |
| DEF-279 | 5A-19-30 5.A.20 | Zero committed/cost values are rejected; zero facilities yields "NaN%". |
| DEF-280 | 5A-19-30 5.A.20 | No permission or maker-checker on margin disposition or on facility creation. |
| DEF-281 | 5A-19-30 5.A.21 | *Import notice* and *+ New event* open the CA-26091 election drawer instead of an import or a create flow. |
| DEF-282 | 5A-19-30 5.A.21 | The *All / Election / Income / Reorg* filter does not filter and shows a misleading "Chart period updated / Performance view set to …" toast. |
| DEF-283 | 5A-19-30 5.A.21 | Submit election / Acknowledge change no state; the election values are not read. |
| DEF-284 | 5A-19-30 5.A.21 | On Mandatory rows the "Inspect →" button is hidden by the row-click layer; the only affordance is the clickable row. |
| DEF-285 | 5A-19-30 5.A.22 | *Submit filing* stays enabled after filing and can be re-submitted. |
| DEF-286 | 5A-19-30 5.A.22 | *+ Obligation* and *Calendar* are toast-only. |
| DEF-287 | 5A-19-30 5.A.22 | The V15 regulatory renderer targets a non-existent container (also in 13.4); the v16 regulatory hub is never injected. |
| DEF-288 | 5A-19-30 5.A.22 | The *Attestations* KPI stays "2 pending" after attestation; the selected obligation row is not highlighted. |
| DEF-289 | 5A-19-30 5.A.23 | A successful *Test connection* re-renders the form and wipes every field, so *Save connection* stores "New connection" / "REST API" / "endpoint" / "Data Engineering" instead of the entered values. |
| DEF-290 | 5A-19-30 5.A.23 | *Environment* and *Schedule* are never captured; every saved connection is Sandbox. |
| DEF-291 | 5A-19-30 5.A.23 | *+ Data product* has no behaviour. |
| DEF-292 | 5A-19-30 5.A.24 | *Clone as new version* copies seed models that have no `datasetVersion` or `assumptions`. Pressing *Continue* on step 2 or step 3 without typing into those fields throws a TypeError (`undefined.trim()`). The wizard silently stops advancing. |
| DEF-293 | 5A-19-30 5.A.24 | The clone version is computed as floating-point number + 0.1 (for example 4.300000000000001). |
| DEF-294 | 5A-19-30 5.A.24 | *Data exclusions / transformations*, *Change class* and *Acceptance standard* are captured on screen but never stored. |
| DEF-295 | 5A-19-30 5.A.24 | *Discard* has no confirmation. *Save draft* is not persisted. |
| DEF-296 | 5A-19-30 5.A.24 | The Owner select ignores the draft value, so a cloned model owned by Valuation shows Risk Analytics. |
| DEF-297 | 5A-19-30 5.A.25 | Answers are not filtered by the user's entitlements, although the context bar and the *Source permissions* toast claim they are. |
| DEF-298 | 5A-19-30 5.A.25 | The user avatar is hard-coded "TM" instead of the signed-in user's initials. |
| DEF-299 | 5A-19-30 5.A.25 | *Conversation history* and *Source permissions* are toast-only; the draft-scenario form saves nothing. |
| DEF-300 | 5A-19-30 5.A.26 | Prototype *Reset defaults* restores bundles cloned **before** `onboarding.manage` was added, so Investment Director, Compliance and Client Services lose `onboarding.manage` until the page is reloaded. |
| DEF-301 | 5A-19-30 5.A.26 | The *Access policy* KPI tile is static "Enforced" and never reflects relaxed policies. |
| DEF-302 | 5A-19-30 5.A.26 | The v52 row-click layer hides the users-table *Preview* button (whenever it is the only row button) and turns the whole row into a preview trigger. |
| DEF-303 | 5A-19-30 5.A.26 | Session-timeout min/max are not enforced client-side. The role *Description* is not stored. |
| DEF-304 | 5A-19-30 5.A.26 | The matrix card copy says "Sensitive changes are retained in the local audit log for this prototype", but no local audit log exists. |
| DEF-305 | 5A-19-30 5.A.27 | In live mode every *Save settings* fails. The settings payload contains a nested `letterhead` object (and a logo data URL far over 200 characters), but the server only accepts scalar values (string ≤200, number, boolean, null). The request is rejected with "Not saved" and no setting is applied. *Reset defaults* also sends a nested `letterhead` and fails server-side after already resetting locally. |
| DEF-306 | 5A-19-30 5.A.27 | 13 of the settings have no consumer: research evidence, liquidity horizon, warning utilisation, auto re-run, three ingestion toggles, research freshness, and four notification toggles. Timezone and default landing page have only a cosmetic effect. |
| DEF-307 | 5A-19-30 5.A.27 | *Reset defaults* and *Disconnect* have no confirmation. Numeric min/max are not enforced. |
| DEF-308 | 5A-19-30 5.A.27 | The Digital KYC policy values are neither saved nor used; the KYC engine hard-codes 1,000,000 and 35/65. |
| DEF-309 | 5A-19-30 5.A.27 | The Security & resilience card and drawer values are static. |
| DEF-310 | 5A-19-30 5.A.28 | In prototype mode *Filter* is a text-only drawer, and actions elsewhere never add audit rows. |
| DEF-311 | 5A-19-30 5.A.29 | An unknown layer type (for example `valuation-exception` from the v37 Command Centre) silently opens the *Prioritised work queue* instead of an error or the intended record. |
| DEF-312 | 5A-19-30 5.A.29 | An unknown record ID silently shows another record (the first one), so users can act on the wrong record. |
| DEF-313 | 5A-19-30 5.A.29 | Hiding breadcrumbs through Settings also hides the back button. |
| DEF-314 | 5A-19-30 5.A.30 | The report editor's *Save draft*, *Submit for approval* and "Autosave on" persist nothing and create no approval task. The data bindings and the override marking are static. |
| DEF-315 | 5A-19-30 5.A.30 | The document outline buttons only change the highlight; they do not scroll to the section. |
| DEF-316 | 5A-19-30 5.A.30 | The prototype version history is static and not tied to the document. |
| DEF-317 | 5A-19-30 5.A.30 | Toast messages are rendered as unescaped HTML (injection risk with user-entered names). |
| DEF-318 | 5A-19-30 5.A.30 | The drawer has no focus trap and does not return focus to the opener on close. |
| DEF-319 | 5B 5.B.0 | a failed session load is invisible. **[O]** |
| DEF-320 | 5B 5.B.0 | the mobile logo links to `/home`, which is not a route of this portal (404). |
| DEF-321 | 5B 5.B.0 | notification hrefs in the demo data use `/lp-portal/requests?thread=…` and `/lp-portal/documents?doc=…`; the routes read `ref` and `document`, so those two alerts open the screen without selecting the record. |
| DEF-322 | 5B 5.B.0 | `sessionError` and `sessionLoading` are never rendered; a failed session leaves an apparently empty portal with "As of —". |
| DEF-323 | 5B 5.B.0 | the valuation-status dot is always green; PROVISIONAL, ESTIMATED and RESTATED are not visually distinguished. |
| DEF-324 | 5B 5.B.0 | the as-of date is overwritten by the fund's `asOfDate` whenever the fund changes, and the Settings preference `defaultAsOfPreference` is ignored by the shell. |
| DEF-325 | 5B 5.B.0 | the search placeholder promises fund search, but only pages and documents are searched; the document search sends no `fundId`. |
| DEF-326 | 5B 5.B.0 | the per-domain data-source switch (`LP_LIVE_DOMAINS`, `LP_METHOD_DOMAIN`, `isLpDomainLive`) is not consulted by the `lpPortalApi` Proxy; flipping a flag does nothing. The stub `apiClient` rejects every call with "LP portal is running on demo data; {METHOD} {url} is not available." |
| DEF-327 | 5B 5.B.0 | the compact money formatter hard-codes "$" regardless of currency. |
| DEF-328 | 5B 5.B.1 | The whole dashboard is demo data. The *All Funds* view shows Growth Fund I only; nothing is aggregated and nothing is scoped to the real investor. |
| DEF-329 | 5B 5.B.1 | KPI tiles, Capital Position and the history chart have no operating-model branching; an open-ended fund shows commitment, DPI, RVPI and TVPI. |
| DEF-330 | 5B 5.B.1 | Capital Position slices overlap (185.4 % in the demo) and *Remaining Value* is defined as NAV minus distributions. |
| DEF-331 | 5B 5.B.1 | The KPI and panel info buttons do nothing; no formula or definition is available to the investor. |
| DEF-332 | 5B 5.B.1 | The history toggle slices by point count, never re-queries, and the subtitle always says *Since Inception*. |
| DEF-333 | 5B 5.B.1 | Recent-activity rows hide the item's descriptive title and status, show *$0.00* for documents, and all link to the same page. |
| DEF-334 | 5B 5.B.1 | Document download has no error handling or toast, and the saved file has no extension (named after the document title). |
| DEF-335 | 5B 5.B.1 | The *Latest Documents & Notices* panel never lists notices; its rows do not open the document. |
| DEF-336 | 5B 5.B.1 | Deep links to `#capital-position`, `#open-ended-account` and `#notices` do not scroll. |
| DEF-337 | 5B 5.B.1 | A null *Net IRR* shows *0.0%* and a null multiple shows *0.00x*; NAV per unit and units are shown to 2 decimals although the data has 4. |
| DEF-338 | 5B 5.B.1 | Currency is hard-coded to dollars in compact amounts and chart axes; *ZIG* presentation is not honoured by the dashboard KPIs in the real service either. |
| DEF-339 | 5B 5.B.1 | The shell as-of date is ignored by the demo layer, and the real service ignores it for KPI selection; the response as-of date is not shown. |
| DEF-340 | 5B 5.B.1 | The real service always returns an open-ended summary (zeros), which would make the open-ended panel show for every investor. |
| DEF-341 | 5B 5.B.1 | Actions ignore the fund selector; due dates are always red, also for non-payment items and overdue items (*Due Jul 20, 2026* is shown after that date has passed). |
| DEF-342 | 5B 5.B.1 | No automatic refresh (realtime is a no-op); the page does not refresh after an acknowledgement elsewhere. |
| DEF-343 | 5B 5.B.2 | All data is demo data; the *Period*, *Benchmark* and as-of controls change nothing in the demo layer (the period and as-of are only echoed), and the *All Funds* view is one fund's payload. |
| DEF-344 | 5B 5.B.2 | *Benchmark Comparison* shows the benchmark's own time series as bars; the fund's value is not plotted, so nothing is compared. Axis captions are fixed at 0–30 % also for TVPI, the *Since Inception* caption is static and the demo TVPI series is the IRR series. |
| DEF-345 | 5B 5.B.2 | The KPI row has no operating-model branching; a null Net IRR prints *0.0%* and a null multiple *0.00x*; the demo gives an open-ended fund IRR and TVPI values. |
| DEF-346 | 5B 5.B.2 | Trend arrows on four tiles are always green and always up; the valuation dot is always green; tile helpers always say *Since Inception* whatever the period. |
| DEF-347 | 5B 5.B.2 | Tile info popovers repeat the helper text and give no definition or formula (the design requires the formula behind each metric). |
| DEF-348 | 5B 5.B.2 | *Capital Calls* and *Paid-In Capital* bars carry the same number; the chart title says "over time" but it is a single snapshot; the two blue colours coincide; the tooltip shows the value without a series name. |
| DEF-349 | 5B 5.B.2 | By-fund *Benchmark* column repeats one value in every row; *As Of* is the same in every row; the table ignores the *Fund / Account* select; *View All Funds* and the dashboard's commitments link end on the dashboard; *View Rolling Returns* reloads the same page. |
| DEF-350 | 5B 5.B.2 | Report download: the real job status *READY* is not recognised as finished (the screen polls 60 seconds), the file endpoint cannot find performance-report jobs (404 "Report not found" expected), *CANCELLED* and timeouts proceed to download, the Period, Benchmark and as-of date are not sent, the button gives no progress feedback, and the saved file name ignores the server's. |
| DEF-351 | 5B 5.B.2 | Snapshot metadata (calculation date, version, source module, approver) is fetched but not displayed; the real service fills it with placeholders (*version* "1", *approvedBy* null, *valuationStatus* always *FINAL*, *reportingCurrency* always *USD*). |
| DEF-352 | 5B 5.B.2 | The real history endpoint ignores the requested period (controller passes `period`, service reads `range`), returns no NAV for past dates when no snapshot exists (null), has no YTD window, and the by-fund endpoint ignores `asOfDate`. |
| DEF-353 | 5B 5.B.2 | The real open-ended `ytdReturn` is a placeholder (always 0.0000). |
| DEF-354 | 5B 5.B.2 | Methodology and Valuation Notes cards both link to the Fund Reports category rather than to a methodology or valuation-notes document; the GIPS statement is unconditional. |
| DEF-355 | 5B 5.B.2 | `$` and `M` are hard-coded in compact amounts and chart axes; the axis title *USD (Millions)* is static. |
| DEF-356 | 5B 5.B.3 | The status badge map has four entries while the mapper passes every API status through; *Issued*, *Allocated* and *Paid* (and any other value) render unstyled and cannot be filtered. |
| DEF-357 | 5B 5.B.3 | *Transaction Type* options are free-text descriptions; *Reference* is the internal entry id; *Effective Date*, *Reporting Amount*, *Exchange Rate*, *Posted Date*, *Posted By* and *Notes* are fabricated from other fields; the FX block always says "No FX required". |
| DEF-358 | 5B 5.B.3 | The detail drawer cannot be closed because the first row is re-selected; the `?entry=` link is lost on a fresh load. FR-LP-034: closing the drawer keeps it closed until another row is chosen; `?entry=` selects that entry (loading it by id even when it is outside the current filter) and scrolls it into view. — AC: closing leaves no drawer; a shared link opens with the entry selected. |
| DEF-359 | 5B 5.B.3 | The as-of date is forced as the end of the date range, so the target of a deep link dated after the as-of date is never listed. Q-104: Should `?entry=` widen the as-of date to the entry date? — default: yes, the entry's detail is shown independently of the date range. |
| DEF-360 | 5B 5.B.3 | Negative amounts print as `$-666.4K` in tiles and a positive minimum hides outflows. FR-LP-035: compact money places the sign before the symbol (`-$666.4K`); min / max compare absolute amounts. — AC: `-666400` -> `-$666.4K`; Min 100 000 shows the 490 000 distribution. |
| DEF-361 | 5B 5.B.3 | The drawer prints allocation amounts as raw strings and, for a distribution or payment entry in the real API, would show an allocation block titled "Capital Call Allocation" with empty values. FR-LP-036: the detail response has a typed shape per entry type (capital call: allocation, payments, notice; payment; distribution: allocation, payments, statement; subscription / redemption: request summary) and the drawer titles the block by type and formats money. — AC: every entry type opens without error; subscription and redemption entries no longer answer 404. |
| DEF-362 | 5B 5.B.3 | `lpPortalApi.getLedger` is unused; the detail endpoint is `/ledger/{id}` while the backend design names `account-activity/{id}`. Q-106: keep `/ledger` as an alias? — default: yes during migration. |
| DEF-363 | 5B 5.B.3 | The route `?structure=` parameter is not applied to the request (it filters on the client only), and *Clear All* undoes it. |
| DEF-364 | 5B 5.B.3 | Stale-response race on the detail request. FR-LP-037: ignore responses for a row that is no longer selected. — AC: rapid row changes always show the last-selected row's detail. |
| DEF-365 | 5B 5.B.4 | Status model — ACKNOWLEDGED, PARTIALLY_PAID and CANCELLED display as *Issued*; Overdue is never derived on the client; the service itself cannot return OVERDUE for an acknowledged call. FR-LP-038: the call badge supports ISSUED (blue), ACKNOWLEDGED (blue), PARTIALLY_PAID (amber), PAID (green), OVERDUE (red) and CANCELLED (grey), and OVERDUE is evaluated before ACKNOWLEDGED (any unpaid past-due call is OVERDUE). — AC: an acknowledged, unpaid call past its due date shows *Overdue* in red and counts in the *Overdue Calls* tile. |
| DEF-366 | 5B 5.B.4 | The due-date line prints "(in {n} days)" for negative and zero day counts and for paid calls. FR-LP-039: the line reads "(in {n} days)" for 2 or more days, "(in 1 day)", "(due today)", "({n} days overdue)" / "(1 day overdue)" for unpaid past-due calls, and nothing for paid calls. — AC: due 20 Jul with today 1 Oct and unpaid -> "(73 days overdue)". |
| DEF-367 | 5B 5.B.4 | The detail panel cannot be dismissed (the first call is re-selected) unless the page was opened with `?call=`. FR-LP-040: closing the panel keeps it closed until a row is selected; the first call is auto-selected only on the first load. — AC: clicking X leaves no panel. |
| DEF-368 | 5B 5.B.4 | Downloads are labelled `.pdf` while the service returns `.txt` stubs; notices should be the published PDF from the document centre. FR-LP-044: the notice endpoint streams the published call-notice PDF (`application/pdf`) and the UI names files from the response's `Content-Disposition`. — AC: the saved file opens as a PDF with the correct name. |
| DEF-369 | 5B 5.B.4 | Tile semantics — *Paid Calls* shows a calendar-year amount with an all-time count; *Overdue Calls* shows a service amount with a client-counted caption; the design document lists *Upcoming Distribution Notices* as the fifth metric. Q-110: Which five tiles? — default: keep the five shown and label *Paid Calls* "Paid (year to date)" with a year-to-date count. |
| DEF-370 | 5B 5.B.4 | Fund scope — in the demo "All Funds" returns the Growth summary only; the Equity fund shows empty tables with no message. FR-LP-048: "All Funds" aggregates every entitled fund; empty tables show "No capital calls for the selected scope." and "No distributions for the selected scope." — AC: the tiles equal the sum over the funds in scope. |
| DEF-371 | 5B 5.B.4 | The timeline step codes differ between the demo (ALLOCATED) and the service (CLOSED); labels derive from the code. Q-112: Canonical steps — default: ISSUED, ACKNOWLEDGED, PAYMENT_RECEIVED, CLOSED with labels "Call Issued", "Acknowledged", "Payment Received", "Call Closed". |
| DEF-372 | 5B 5.B.4 | Step dates use the viewer's time zone while other dates are date-only. BR-100: all dates in the register are shown in UTC date form `MMM d, yyyy`. — AC: the step date equals the date stored. |
| DEF-373 | 5B 5.B.4 | The *Acknowledge* toolbar button uses a download icon; "PDF" in the document line is fixed text; the document date is shown as the raw ISO string. FR-LP-051: the line shows the document's real file type and a formatted date. — AC: "PDF · Jul 1, 2026". |
| DEF-374 | 5B 5.B.4 | A different idempotency key is created for every click, so a retry after a network error is not idempotent. FR-LP-052: one key per user intent, reused for automatic retries. — AC: a retried acknowledgement never produces a duplicate record. |
| DEF-375 | 5B 5.B.4 | Only 8 calls are shown by default and 50 are ever loaded; the rest are unreachable. (See paging above.) |
| DEF-376 | 5B 5.B.4 | The call-detail request error is invisible (no message when the detail fails; the panel shows "—"). |
| DEF-377 | 5B 5.B.4 | Money in tables is always whole USD with `$`, ignoring `currencyCode`. FR-LP-056: amounts use the call's or distribution's currency with the currency symbol and 2 decimals. — AC: a EUR call shows "€150,000.00". |
| DEF-378 | 5B 5.B.5 | Status text and colours. The row mapper turns the API values `ALLOCATED`, `UNDER_REVIEW`, `SUBMITTED` into "ALLOCATED", "UNDER REVIEW", "SUBMITTED" (it never lower-cases), while the badge colours and the status filter compare with "Allocated", "Under Review", "Submitted". Result: no badge colour, and the status filter returns nothing for any status other than *All Statuses*. (Derived from the code; the mock data are upper-case.) |
| DEF-379 | 5B 5.B.5 | `dealingFrequencyLabel` lower-cases the first letter of each word instead of capitalising it: `MONTHLY` shows "mONTHLY". |
| DEF-380 | 5B 5.B.5 | Column *Expected Settlement* shows the requested dealing date, and the mock ignores the funding date the investor entered. |
| DEF-381 | 5B 5.B.5 | The submit buttons are labelled *Review …* but submit immediately; the design requires confirmation of the notice period and the estimate before a request is created. |
| DEF-382 | 5B 5.B.5 | Compliance rows use the same check glyph for pass and fail (colour only); KYC passes only for the literal `APPROVED`, whereas the real backend's default status is `CLEAR`. |
| DEF-383 | 5B 5.B.5 | Blockers never disable the forms and the page never shows the hold reason; `valuationStatus` is delivered but not shown beside the NAV, contrary to the rule that every NAV carries its valuation status. |
| DEF-384 | 5B 5.B.5 | Money formats ignore the row, fund and holding currency (always the presentation currency) and the compact KPI format always prints `$`. |
| DEF-385 | 5B 5.B.5 | After a subscription is submitted or an estimate expires the page asks the user to "wait for a fresh estimate" but never requests one. |
| DEF-386 | 5B 5.B.5 | The documents zone has no file list, no remove control and no size/type validation; dropped files bypass the `accept` filter. |
| DEF-387 | 5B 5.B.5 | Decorative info icons next to *Allocation Estimate*, *Redemption Type*, *Minimum Balance*, *Notice Period*, *Dealing Frequency* and *Compliance Checks* look like help but have no popover. |
| DEF-388 | 5B 5.B.5 | With `?request=` in the URL the dialog reopens after the user closes it whenever the history reloads. |
| DEF-389 | 5B 5.B.5 | The real backend uses `upload.single("file")` while the UI sends parts named `files[]`; the request fails with HTTP 500 `LP_EXPORT_FAILED` and uploaded files are never stored. Files above 25 MB also return 500 instead of 413. |
| DEF-390 | 5B 5.B.5 | The real backend hashes the complete redemption body, so a redemption submit that includes `estimateSnapshotId` can never match its estimate (409 "Request body does not match estimate snapshot"). |
| DEF-391 | 5B 5.B.5 | The real backend export is limited to 200 rows, is unquoted CSV and returns JSON for `xlsx`; the UI would save that JSON as `dealing-requests.xlsx`. |
| DEF-392 | 5B 5.B.5 | The real backend returns `isEstimate: true` for every request row, so every row would display "(Est.)". |
| DEF-393 | 5B 5.B.6 | status badges are always grey and upper case. The mapper keeps the API's upper-case words ("PUBLISHED", "REQUIRES SIGNATURE", "RESTATED") while the colour map is keyed by Title-Case, so the Published, Requires Signature, New, Active and Paid styles never apply; "New", "Active", "Paid" are produced nowhere. |
| DEF-394 | 5B 5.B.6 | in the prototype the tabs *Statements*, *Capital Calls*, *Distributions*, *Fund Reports* return an empty table although their count pills show 2 (the mock tests the API enum against category labels); the sidebar *Statements & Reports* link therefore lands on an empty list. |
| DEF-395 | 5B 5.B.6 | *More* items (*Subscription Documents*, *Notices*, *Other*) send no category, so the full unfiltered list is shown; *More* does not display the selected item. *Open in Documents* on a notice therefore shows every document. |
| DEF-396 | 5B 5.B.6 | `?document={id}` is lost: the first render clears the selection (no data yet) and the first row is selected after load; stale detail/preview responses are not cancelled. |
| DEF-397 | 5B 5.B.6 | the close button (X) cannot close the detail column while rows exist (the first row is re-selected). |
| DEF-398 | 5B 5.B.6 | range text uses a page size of 10 while 20 rows are requested per page, and uses the unfiltered global total; an empty result reads "Showing 1 to 0 of N documents". |
| DEF-399 | 5B 5.B.6 | KPI tiles and tab counts ignore the fund selector, search and category; the "Across N funds" helper counts session funds, not document funds. |
| DEF-400 | 5B 5.B.6 | preview page arrows only change a counter; zoom is a CSS transform and the card (160 %) and dialog (200 %) share one value. |
| DEF-401 | 5B 5.B.6 | the saved file is named after the document title with no extension; the *Document Type* field shows the category; *Published Date* is unformatted; permissions are shown as raw codes. |
| DEF-402 | 5B 5.B.6 | the history card is headed "Download History" but, with the reference API, lists VIEW and PREVIEW events and raw user ids, and each row selection writes two audit events (VIEW and PREVIEW). |
| DEF-403 | 5B 5.B.6 | a failure of the summary call blanks the list too (one `Promise.all`). |
| DEF-404 | 5B 5.B.6 | real `accessScope` text would render in capitals; the mock preview is a fake PDF; the mock notification link uses `?doc=`. |
| DEF-405 | 5B 5.B.6 | no download progress or in-flight disable; double click downloads twice; the KPI and history are not refreshed after a download. |
| DEF-406 | 5B 5.B.7 | the *Filters* and export buttons have no behaviour. FR-LP-074: *Export* downloads the filtered request list as CSV with the visible columns — AC: file contains exactly the filtered rows; *Filters* opens a panel with type, fund, priority and date range — AC: each filter narrows the table and the footer count. |
| DEF-407 | 5B 5.B.7 | drag and drop is advertised but not implemented; no file type or size check; caption says 20 MB while the server limit is 25 MB; no way to remove a chosen file. FR-LP-075: enforce the allowed types (PDF, DOC, DOCX, XLS, XLSX, PNG) and the 20 MB limit before upload, support drop, show each file with size and a remove button — AC: a 21 MB file is rejected with a visible message and is never sent. |
| DEF-408 | 5B 5.B.7 | *Request Details* never shows the subject, description, creation date, assignee or the request's own message history; request messages returned by the API are discarded by the mapper. FR-LP-076: show subject, description, created date and a chronological timeline of request messages (investor and staff) in *Request Details* — AC: a staff reply posted through the staff API appears in the investor's *Request Details* without opening a thread. |
| DEF-409 | 5B 5.B.7 | the real service desk does not create a message thread for a request and staff replies are written to the request, not to a thread; no code creates threads. The *Messages* area therefore has no data in a real deployment. Q-132: are threads created automatically one-per-request, or does the investor see request replies only in *Request Details*? — default: create one thread per request automatically (related type `REQUEST`, related id = request id) and write staff and investor replies to both the request timeline and the thread. |
| DEF-410 | 5B 5.B.7 | in the prototype, a reply typed in a request-linked thread is stored on the request only and never shown in the thread pane (success toast "Message sent." but no visible effect). |
| DEF-411 | 5B 5.B.7 | seeded thread `relatedId` values are request references while request ids are lower-case; selection, linked reference and the *Open conversation* link do not work in the prototype. BR-125: a thread's `relatedId` for type `REQUEST` is the request `reference`, and the screen matches by reference. |
| DEF-412 | 5B 5.B.7 | opening the page auto-selects the first thread and marks it read; the unread pills, KPI and sidebar badge are not refreshed afterwards. FR-LP-077: mark a thread read only when it is visible and opened, then update the thread row, KPI and session counter — AC: badge decrements by the number of messages marked. |
| DEF-413 | 5B 5.B.7 | the *Messages* tab label shows the unread count; the design (Section A.7) lists a "Closed This Month" KPI whereas the tile counts all closed requests. Q-133: should *Messages (n)* show unread or total threads, and should *Closed / Resolved* be limited to the current month — default: *Messages (n)* shows the number of threads with unread messages; *Closed / Resolved* stays all-time. |
| DEF-414 | 5B 5.B.7 | "Showing 1 to N of N" and the absence of pagination hide anything beyond the first 50 requests and 50 threads. FR-LP-078: server-side pagination (`page`, `pageSize` up to 200) with a footer "Showing a to b of total" using the server total — AC: with 120 requests the footer reads "Showing 1 to 50 of 120 requests" and next/previous pages are reachable. |
| DEF-415 | 5B 5.B.7 | a VIEWER sees working create, attach and reply controls although the service refuses them. FR-LP-079: disable *Submit Request*, *Send*, the attachment controls and *Add participant* for `VIEWER`, with the hint "Viewers cannot submit requests or send messages" — AC: no 403 can be triggered from the UI by a VIEWER. |
| DEF-416 | 5B 5.B.7 | an empty description is stored as the text "No description provided." and, in the real service, also becomes the first message. BR-126: an empty description is stored empty and creates no first message. |
| DEF-417 | 5B 5.B.7 | sender names are fixed ("You", "Matanho Team", initials "A"); colleagues' messages show as "You" and staff members are not identified. FR-LP-080: show the author's real name and role; label own messages "You" only when `authorId` equals the signed-in user — AC: a colleague's message shows the colleague's name. |
| DEF-418 | 5B 5.B.7 | *Linked To* in *Request Details* shows the fund name, not a record. Q-134: should it show the related record (capital call, document) — default: show the fund and request type, and link to the type's screen. |
| DEF-419 | 5B 5.B.7 | downloads open a bare URL in a new tab; the prototype never provides one ("Download URL not available."). FR-LP-081: attachment download is an authenticated, client-scoped endpoint (`GET /lp-portal/attachments/{id}/download`) that works with the portal session — AC: another organisation's attachment id answers 404. |
| DEF-420 | 5B 5.B.7 | all realtime functions are no-ops, so lists update only after a user action. FR-LP-082: implement the Socket.IO contract above — AC: a staff reply raises the unread pill without reloading. |
| DEF-421 | 5B 5.B.8 | selection is stuck. After the first detail load the aside always shows that first notice, and clicking another row reverts the selection (the loaded detail takes priority and the selection is forced back to it; `?id=` is re-applied on every change). **(verify in browser)** |
| DEF-422 | 5B 5.B.8 | the list is not refreshed after the first open, so a row can read *Unread* while its detail reads *Opened*. |
| DEF-423 | 5B 5.B.8 | type labels come from `kind`, hiding the category; with the mock data the chips read "INFO"/"ACTION REQUIRED" in grey and the Type filter has two options; labels are not case-folded. |
| DEF-424 | 5B 5.B.8 | fund-less notices render an empty fund and a null filter option; the audience line is a hard-coded "Fund investors". |
| DEF-425 | 5B 5.B.8 | after *Acknowledge Notice* the session counts, bell and dashboard actions are not refreshed; the list reload flashes the spinner; the notice is fetched twice. |
| DEF-426 | 5B 5.B.8 | the detail body ignores line breaks; there is no retry on the error line; no confirmation before acknowledging. |
| DEF-427 | 5B 5.B.8 | *Open in Documents* is not specific to the notice and, because *Notices* has no API category, lists all documents. |
| DEF-428 | 5B 5.B.8 | the reference API marks every notice as requiring acknowledgement; its acknowledge is not state-idempotent (timestamp overwritten); FUND-target visibility has no commitment check and share class is ignored. |
| DEF-429 | 5B 5.B.8 | the page tile *Unread* (unopened) and the sidebar badge (unacknowledged in the reference API) use different definitions. |
| DEF-430 | 5B 5.B.8 | only 50 notices are fetched and counted; there is no pager. |
| DEF-431 | 5B 5.B.9 | a revoked colleague is shown as *Active* and is counted in "active" (mock status `REVOKED`). FR-LP-090: map API membership states to *Active*, *Invited*, *Suspended*, *Revoked* and exclude *Suspended* and *Revoked* from "active" — AC: after revoking, the row shows *Revoked* (or *Suspended*) and the active count falls by one. |
| DEF-432 | 5B 5.B.9 | a membership with no fund restriction shows "0" funds. FR-LP-091: show "All funds" when the restriction is null — AC: Funds column and details aside read "All funds". |
| DEF-433 | 5B 5.B.9 | *Fund Entitlements* adds per-colleague counts instead of counting distinct entitled funds. FR-LP-092: value = number of distinct funds the organisation is entitled to — AC: with funds A and B and three colleagues the card shows 2. |
| DEF-434 | 5B 5.B.9 | *Revoke access* acts without confirmation and is offered on the user's own row and on Manager rows. FR-LP-093: confirm dialog "Revoke access for {name}? They will be signed out immediately." and hide the action for the signed-in user and for Managers — AC: no revoke request is sent before confirmation. |
| DEF-435 | 5B 5.B.9 | the invitation dialog has no role or fund controls, always invites a `VIEWER` with all funds, says the invitee "must already have an Matanho account" (grammar and wrong: the service creates accounts) and the update action has no screen. FR-LP-094: invitation dialog with Role (*Viewer*, *Signatory*), Fund access (multi-select within the inviter's scope) and, per colleague, an *Edit access* action calling the update endpoint — AC: an invited Signatory with fund A only can see only fund A. |
| DEF-436 | 5B 5.B.9 | the response to an invitation does not say whether the e-mail was delivered. FR-LP-095: return `activationEmailSent` and offer *Resend invitation* for colleagues who have not signed in — AC: when delivery fails the manager sees a warning toast and a resend action. |
| DEF-437 | 5B 5.B.9 | *Invited* status never occurs for real data because memberships are active at once. Q-143: should an invitation create a pending membership that is activated on first sign-in — default: yes; status *Invited* until the first sign-in or activation, *Active* afterwards. |
| DEF-438 | 5B 5.B.9 | the dialog copy says bank changes "require MFA" but no MFA step exists and no verification or approval step exists on the investor or staff side. FR-LP-096: bank instruction submission requires a fresh TOTP code (step-up, FR-AUTH-011) and creates a staff verification task with maker–checker approval — AC: submission without a valid code is refused; approval by the requester is refused; activation archives the old instruction. |
| DEF-439 | 5B 5.B.9 | bank-change list contract mismatch: the screen reads `fundName`, `accountNumberMasked`, `requestedBy`, `submittedAt`; the real service returns `payload`, `createdAt`. FR-LP-097: list returns `{id, fundId, fundName, bankName, accountNumberMasked, requestedBy, submittedAt, status}` — AC: table renders without blank cells. |
| DEF-440 | 5B 5.B.9 | the clear account number is persisted unmasked in the request payload. BR-135: store the account number encrypted, expose only the last four characters, and never return it. |
| DEF-441 | 5B 5.B.9 | UI requires Manager for *Request Change* while the service allows Signatories; the design says the Administrator invites and revokes and "Cannot grant access outside organisation fund entitlements", and that a Viewer has "no bank changes". Q-144: who may submit a bank instruction change — default: SIGNATORY and MANAGER (service behaviour), and the UI is aligned to it. |
| DEF-442 | 5B 5.B.9 | statuses `DRAFT` and `ACTIVATED` fall through to *Submitted*. FR-LP-098: add status labels *Draft* and *Activated* — AC: each design status has its own label and colour. |
| DEF-443 | 5B 5.B.9 | non-Managers see "No colleagues match your filters." and KPI zeros, which looks like an empty organisation. FR-LP-100: for non-Managers hide the colleague table and show "Only Managers can view colleagues." — AC: no empty-table message for non-Managers. |
| DEF-444 | 5B 5.B.9 | the organisation profile (e-mail, country, phone, address, status) is returned but never displayed. Q-146: should these fields be shown (read-only) — default: yes, read-only card; changes go through a *Profile / Access* request. |
| DEF-445 | 5B 5.B.10 | field names differ between the screen and the real service (`digest` vs `emailDigest`, `manageUrl`/`sessionsUrl`/`passwordUrl` vs `manageUrls.{enroll, confirmEnrollment, changePassword}`), so the digest is never saved and the three security buttons stay disabled against the real service. FR-LP-101: align the contract — `GET /lp-portal/settings` returns `notifications.digest` as `daily`, `weekly` or `off` and an `mfa` object with `manageUrl`, `sessionsUrl`, `passwordUrl` pointing at portal pages — AC: saving digest *Off* and reloading shows *Off*; the three buttons are enabled. |
| DEF-446 | 5B 5.B.10 | the three seeded security URLs (`/account/security/*`) do not exist. FR-LP-102: provide pages (or an in-portal drawer) for MFA enrolment (QR code, code confirmation, backup codes), active sessions with *Sign out other devices* (FR-AUTH-017) and password change — AC: *Manage* opens MFA enrolment and a confirmed factor flips *MFA Status* to *Enabled*. |
| DEF-447 | 5B 5.B.10 | *Display currency* and *Default as-of preference* are stored but not applied; the session always reports USD and ignores the as-of preference. FR-LP-103: the session returns the saved presentation currency and default as-of date, the portal context reloads after saving, and amounts and the as-of date follow the preference — AC: choosing ZAR and saving shows ZAR amounts on the dashboard without a manual reload. |
| DEF-448 | 5B 5.B.10 | no dirty indicator, no revert and no unsaved-changes guard. FR-LP-104: *Save Changes* is enabled only when something changed, with a *Discard* action and a leave-page warning — AC: with no edits *Save Changes* is disabled. |
| DEF-449 | 5B 5.B.10 | both save requests are separate and can partially fail. FR-LP-105: save as one atomic request or report which part failed — AC: a failed display save shows "Display preferences not saved" while notification changes remain saved. |
| DEF-450 | 5B 5.B.10 | the as-of vocabularies differ (`LATEST_FINAL` in the mock, `LATEST` in the real default and design). BR-136: valid codes are `LATEST`, `LATEST_ANY`, `PRIOR_MONTH_END`; `LATEST_FINAL` is read as `LATEST`. |
| DEF-451 | 5B 5.B.10 | the display-currency list (USD, EUR, GBP, ZAR) differs from the currencies Nexus presents elsewhere (USD, ZAR, ZWG). Q-148: which presentation currencies are offered — default: USD, ZAR, ZWG (the currencies with a published rate in the valuation snapshot), restricted to currencies for which an FX rate exists. |
| DEF-452 | 5B 5.B.10 | the in-app switches and the *Capital calls & distributions* row control two keys with one switch; a mixed state cannot be shown. Q-149: should capital calls and distributions have separate rows — default: keep merged, and show the switch as on only when both are on (as implemented). |
| DEF-453 | 5B | payload-hash check cannot pass (F10) |
| DEF-454 | 5B | `totalDistributions` and `upcomingDistributionNotices` read `d.amount` and statuses DECLARED/NOTIFIED/ISSUED but distribution items expose `gross/netPaid` (no `amount`) and statuses PENDING/PARTIALLY_PAID/PAID -> both are always 0. |
| DEF-455 | 5B | cross-investor leakage). The list ignores a `fundId` query param. |
| DEF-456 | 5B | original timestamp lost; only the idempotency key protects replays). Response 200, message "Notice acknowledged", data `{acknowledgedAt}`. Emits `lp_notice_updated {status:"ACKNOWLEDGED"}`. Acknowledgement is per person (receipt per user) but ALL status displays and unread counts are per client (any acknowledgement clears it for the whole organisation). |
| DEF-457 | 5B | the unique legacy link is rewritten on every new membership). |
| DEF-458 | 5C5E 5.C.0 | Legacy data bridge disabled for onboarding (`tools/legacy-bridge.mjs` `DISABLED = {investor, onboarding, custodian}`); the retained `onboarding-bridge.js` targets the V56 DOM (`#form`, `#submit`, `#ref`, `#save`, `#next`, `#owners`, file inputs `doc1…doc8`, global `window.collect`, draft key `…-v19`) and cannot work against V65 (`#applicationForm`, `#submitBtn`, `#successRef`, `#saveBtn`, `#nextBtn`, `#ownerList`, `data-doc-input`, IIFE-private `collect`, key `…-v57`). |
| DEF-459 | 5C5E 5.C.0 | `src/legacy/extras/v57-rail-nav.js` is dead code — not published (no `extraScripts` in the extractor config), not in the manifest, and written for the V56 DOM (`#rail`, globals `step`/`validCurrent`); V65 already has a clickable rail. Delete it. |
| DEF-460 | 5C5E 5.C.0 | Rail forward navigation fails silently when the current step is invalid. FR-ONB-028: Forward rail click validates every intervening step and reports the first error — AC: clicking step 6 from step 1 with an empty legal name focuses *Legal name* with its message. |
| DEF-461 | 5C5E 5.C.0 | Theme toggle removed in V65; FR-ONB-015 has no UI. Q-159: Keep a theme toggle on the public onboarding portal? — default: no (retire FR-ONB-015). |
| DEF-462 | 5C5E 5.C.1 | Fields collected on this step but dropped from the submitted record: incorporationDate, regulatedStatus, regulator, licenceRef, website, registeredAddress, baseCurrency, investorClassification, primaryContact (the record keeps only type, name, registrationRef, email, telephone, jurisdiction as `country`, initialInvestment, relationship, mandate, purpose). |
| DEF-463 | 5C5E 5.C.1 | API `FIELD_MAP` uses V56 keys (`type`, `name`, `reg`, `phone`, `country`, `amount`, …); V65 keys `investorType`, `legalName`, `registrationRef`, `telephone`, `jurisdiction`, `initialInvestment`, `primaryEmail` map to no column, so submit would fail the server check "Legal name / Email / Country missing". |
| DEF-464 | 5C5E 5.C.1 | SRD FR-ONB-001 fields (risk profile, liquidity requirement, investment objective) no longer exist in the UI; columns `risk_profile`, `liquidity_need` have no source. Q-161: Is suitability (risk profile, liquidity) captured at onboarding or later in mandate setup? — default: later, in mandate setup. |
| DEF-465 | 5C5E 5.C.2 | API `owners` shape is `[name, id, pct]` arrays (max 3 strings, max 20 rows); V65 owners are objects with a 4th field *Nationality*, which the API cannot store. |
| DEF-466 | 5C5E 5.C.2 | ownershipNarrative and authorityNarrative are dropped from the submitted record. |
| DEF-467 | 5C5E 5.C.3 | sourceFundsNarrative (required on screen), annualVolume, transactionFrequency, expectedCurrencies are dropped from the submitted record; fundingJurisdictions is kept only as the review sub-label. |
| DEF-468 | 5C5E 5.C.3 | API has columns for `pep` only; sanctions, adverse media, enhanced-risk jurisdiction declarations have no server fields. |
| DEF-469 | 5C5E 5.C.3 | No risk-profiling questionnaire or scoring exists in V65 (V56 risk-profile select removed). |
| DEF-470 | 5C5E 5.C.4 | Tax ID and bank account number are stored in plain text in browser localStorage (draft). |
| DEF-471 | 5C5E 5.C.4 | taxId, giin, usIndicia are dropped from the submitted record (fatca, crs, bank block are kept). |
| DEF-472 | 5C5E 5.C.4 | API has no bank-account fields; FATCA and CRS are two fields in the UI but one `tax_status` column in the API. |
| DEF-473 | 5C5E 5.C.5 | Required documents differ between layers: UI requires **9** for every investor type; API `requiredSlots()` requires **3** (`doc1–doc3`) when applicant type is exactly "Individual" and **4** (`doc1–doc4`) otherwise; current SRD 5.C [P] says Individual 1–3, 5, 6 / entities 1–7. The V65 type string "Individual / HNW" never equals "Individual", so the API would apply the entity rule to individuals. |
| DEF-474 | 5C5E 5.C.5 | Slot catalogue mismatch — UI keys `legal, registry, ownership, identity, address, bank, funds, tax, authority, subscription, additional` (11) vs API `doc1…doc8` (8); the API rejects unknown slots with 400 "Unknown evidence slot". |
| DEF-475 | 5C5E 5.C.5 | Upload limit mismatch — UI none; API `MAX_UPLOAD_MB` default 25 MB (nginx `client_max_body_size 25m`); current SRD says 10 MB. |
| DEF-476 | 5C5E 5.C.5 | Malware scan not implemented — API stores `scanStatus: 'clean'` unconditionally (FR-ONB-003 unmet). |
| DEF-477 | 5C5E 5.C.5 | OCR engine and PDF renderer are fetched from third-party CDNs in the applicant's browser. |
| DEF-478 | 5C5E 5.C.5 | evidenceNote and complianceContact are dropped from the submitted record. |
| DEF-479 | 5C5E 5.C.6 | Reference format mismatch — UI `LP-YYYY-NNNNN` (random), API `ONB-######` (sequence), current SRD 5.C `ONB-####`, FR-ONB-006 `ONB-######`. FR-ONB-035: Display only the server-issued `ONB-######` — AC: success panel reference equals the admin case reference. |
| DEF-480 | 5C5E 5.C.6 | 21 collected fields are dropped from the submitted record: incorporationDate, regulatedStatus, regulator, licenceRef, website, registeredAddress, baseCurrency, investorClassification, primaryContact, ownershipNarrative, authorityNarrative, annualVolume, transactionFrequency, fundingJurisdictions, expectedCurrencies, sourceFundsNarrative, taxId, giin, usIndicia, evidenceNote, complianceContact; consent itself is not recorded. |
| DEF-481 | 5C5E 5.C.6 | `ai.documentCompleteness` can exceed 100 % because `docsDone` counts optional documents while `docsTotal` counts required ones. FR-ONB-036: completeness = uploaded required ÷ required — AC: never > 100 %. |
| DEF-482 | 5C5E 5.C.6 | Stale triage — the stored triage result is not recomputed when data changes before submit. FR-ONB-037: server runs pre-screen on submit from stored data only — AC: changing PEP after a client triage run changes the case risk. |
| DEF-483 | 5C5E 5.C.6 | Large-investment threshold mismatch — UI flag `VALUE_EDD` at ≥ 1,000,000; API screening stub rates Medium at ≥ 5,000,000. Q-164: Enhanced-review value threshold? — default: 1,000,000 USD equivalent, configurable in policy. |
| DEF-484 | 5C5E 5.C.7 | Magic-link resume (FR-ONB-002) implemented in the API but not wired in the V65 UI (bridge disabled). |
| DEF-485 | 5C5E 5.E.0 | No authentication or authorisation: no `proxy.ts`, no `/login`, no `@matanho/portal-kit` dependency; page comment "Not gated by the auth proxy yet; custodian accounts are not part of the role catalogue." |
| DEF-486 | 5C5E 5.E.0 | `custodian` missing from the portal registry (`PORTAL_IDS`, `PORTALS`), from env (`CUSTODIAN_PORTAL_URL`) and therefore from the API's default CORS allow-list. |
| DEF-487 | 5C5E 5.E.1 | No API endpoint or model for executions; the "immutable" record is editable browser storage. |
| DEF-488 | 5C5E 5.E.2 | No API, model or object storage for day-end packages; hash computed only in the browser. |
| DEF-489 | 5C5E 5.E.3 | `created` stored as a locale display string with no time zone; ordering broken. FR-REC-014: store ISO-8601 UTC and display Africa/Harare — AC: newest first across month boundaries. |
| DEF-490 | 5C5E 5.E.4 | Cross-origin localStorage hand-off; the custodian success toasts claim a delivery that never happens. |
| DEF-491 | 5C5E 5.E.4 | Admin reconciliation screen is V56; the V61 staging area described in `V61_CHANGES.md` is absent. |
| DEF-492 | 5D 5.D.0 | digit keys 1-9 pressed while the palette is open select the Nth result even when typed into this input |
| DEF-493 | 5D 5.D.0 | mock mode presents another company's data (company name, fund, KPIs, reports, cap table, term sheet) to real signed-in users as if it were theirs. |
| DEF-494 | 5D 5.D.0 | `#periodSelect` is inert; *Collapse* preference is never restored; command palette digit shortcut fires while typing and searches fixtures only; Profile drawer shows static sign-in time, MFA and approval role; Greeting is always "Good morning". |
| DEF-495 | 5D 5.D.0 | the portal path performs no company-scope check; an admin-only staff account (non-investor) can open it. |
| DEF-496 | 5D 5.D.1 | all values are fictional fixtures; "Good morning" is not time-aware; the period selector does not affect this page. |
| DEF-497 | 5D 5.D.2 | Mock Submit KPIs is dead; category filter is dead; Export and Open KPI dictionary are stubs; drawer series/source/evidence are static. |
| DEF-498 | 5D 5.D.3 | Balance-sheet seed never balances and the check is not blocking; evidence zone is simulated (no `<input type=file>`; NVCCZ looks up `#reportEvidenceFile`, which does not exist, so no file is ever uploaded); *Save draft* is not restored; mock posts actuals on submit without staff acceptance; Draft workspace tab is entirely static even in live mode. |
| DEF-499 | 5D 5.D.4 | Undo, Save, Export, Add sheet, sheet navigation are inert/stubs; formulas are unsupported though the placeholder invites them; scenarios do not drive the grid; opening cash is not chained; `forecastCloseDay` and the lock-past toggle are unused; the scenario modal is unreachable. |
| DEF-500 | 5D 5.D.5 | mock content is a fixed Series B; both download buttons and the clarification send are stubs; live mode shows only 4 stats and 4 free-text rows. |
| DEF-501 | 5D 5.D.6 | Mock holders/classes/percentages are fixtures; simulator hard-codes Matanho 16.7% and Founders 47% and ignores other holders, pool top-ups and notes; export and holder actions are stubs; NVCCZ live shows an empty card although the API exists (backend-asks doc is stale). |
| DEF-502 | 5D 5.D.7 | Entire page is static; every control after the modal is a stub; 4 metric tiles are literals. |
| DEF-503 | 5D 5.D.8 | Filter select is dead; Decline, Certificate, Signed copy are stubs; mock "signed copy in the document vault" is false; Request signatures does nothing; the authority matrix is not enforced. |
| DEF-504 | 5D 5.D.9 | toolbar controls dead; Save draft/Save response/Export/Edit draft/Download pack stubs; no validation in the modal; live status mapping mis-buckets five statuses; live card click opens nothing; `useOfFundsDocumentUrl:'pending'` is a placeholder; currency and type are lost. |
| DEF-505 | 5D 5.D.10 | upload, folders, share, download, search, access filter and View are stubs; storage and counts are literals; preview shows a lorem page; watermark name hard-coded; "100 MB" limit contradicts platform caps. |
| DEF-506 | 5D 5.D.11 | sender name and timestamp hard-coded in mock; search dead; attach and info stubs; new conversation creates nothing; messages lost on reload. |
| DEF-507 | 5D 5.D.12 | everything is a literal; no persistence; all row actions are stubs. |
| DEF-508 | 5D 5.D.13 | mock Save is a toast; switches are session-only; Security block is static; letterhead is not pre-filled from the stored record; registration number is not saved. |
| DEF-509 | backend 9.6 | Step-up and MFA-enrolment failures return **401** (`step_up_required`, `mfa_enrolment_required`), but earlier text of this section and FR-AUTH-011 specify 403. Decide which is canonical. The admin bridge already reacts to the 401. |
| DEF-510 | backend 9.6 | `sod_violation` is 409 in KYC and cash accounts but 403 elsewhere. Earlier text of this section names `maker_checker_violation` with 409. Unify the code and status. |
| DEF-511 | backend 9.6 | `validation_failed`, `locked` (423) and `dependency_unavailable` (503) are specified but not implemented. Validation errors use `bad_request`. |
| DEF-512 | backend 9.6 | Two routes (investor create-request, document upload) return raw zod issues in `details` instead of `{path, message}`. |
| DEF-513 | backend | **Idempotency not implemented.** `Idempotency-Key` is accepted by CORS but ignored, so repeated POSTs create duplicate capital events, documents and requests. — AC: a repeat POST with the same key within 24 h returns the original response and creates no new row. |
| DEF-514 | backend | **No malware scan.** Every file is recorded as "clean" and `application/octet-stream` is accepted. — AC: an EICAR test file is rejected or quarantined, and quarantined files cannot be downloaded. |
| DEF-515 | backend | **No database or file-store backups** in the deployment. — AC: a scheduled MySQL dump or binlog backup plus a file-volume backup with 35-day retention, and a documented restore test. |
| DEF-516 | backend | **No CI pipeline** (only a GitHub Pages workflow for the legacy static site). — AC: every push runs install, typecheck, smoke and e2e against an ephemeral database and builds the images. |
| DEF-517 | backend | **Orphan uploads.** `POST /api/v1/uploads` stores encrypted files whose ids no endpoint consumes; they can never be downloaded or cleaned up. — AC: either domain endpoints accept `uploadId`, or the route is removed; unreferenced files older than 24 h are purged. |
| DEF-518 | backend | **Worker not started in development.** `npm run dev` does not run the outbox worker and there is no script for it, so local email, notifications and screening never fire. — AC: `npm run dev` (or a documented `dev:worker`) starts the worker. |
| DEF-519 | backend | **MFA is off by default** (`mfa_required=false`). Step-up is skipped for users without a factor, so SRD 7.1 / NFR-SEC-008 approvals can run without a second factor. — AC: production default `mfa_required=true`, and a step-up-protected action by an unenrolled user returns `mfa_enrolment_required`. |
| DEF-520 | backend | **Invitation acceptance bypasses MFA** (it creates a fully verified session). — AC: when MFA is required for the portal, acceptance leaves the session MFA-pending with `mfa='enroll'`. |
| DEF-521 | backend | **Token TTL mismatches**: password reset 60 min (FR-AUTH-013 says 30), invitation 7 days (FR-AUTH-015 says 72 h). — AC: TTLs match the SRD, or the SRD is updated after a Q-NEW decision. |
| DEF-522 | backend | **BR-004 contradiction.** The code enforces at least one active System Administrator and flags more than two; BR-004 requires at least two `admin.rbac` holders and confirmation on system_admin changes. — AC: removing a role that would leave fewer than two active `admin.rbac` holders returns 409; the SoD scan flags fewer than two. |
| DEF-523 | backend | **Step-up status code**: 401 vs 403 (see 9.6). — AC: one status, used consistently by the API, bridge and SRD. |
| DEF-524 | backend | **Step-up missing** on cash-account approve, suspend, reactivate and close; document publish; capital publish; KYC activate. — AC: each returns `step_up_required` without a recent code. |
| DEF-525 | backend | **Audit gaps**: investor message post, public draft create/save, pre-case evidence upload, `/uploads`, step-up, failed logins, capital-evidence and company-file download URLs are not audited. The hash excludes actor role, portal, IP and request id. The table is not DB-protected against UPDATE/DELETE. — AC: every state change listed writes an audit row; the hash covers every column; the application DB user has no UPDATE/DELETE on `audit_events`. |
| DEF-526 | backend | **Investor account scope** is not applied to documents, capital events, requests or threads. — AC: a user with scope "documents" sees no capital events; a user with scope "managed" sees no private-fund documents. |
| DEF-527 | backend | **Company users are limited to their first linked company.** — AC: a user linked to two companies can switch between them (Q-01). |
| DEF-528 | backend | **Custodian portal** is deployed without auth, API or registry entry. — AC: the custodian portal is registered as a portal id, is in the CORS allow-list and has an auth gate before go-live, or is removed from the deployment. |
| DEF-529 | backend | **Investor and onboarding bridges are disabled.** The running UIs do not persist to the API (NFR-MNT-003). — AC: both portals load their bridge and the e2e journey passes through the UI. |
| DEF-530 | backend | **Dual-control gap on KYC decisions**: when no staff member has prepared a case, the preparer ≠ decider check is skipped. — AC: a case with no preparer cannot be decided until a different user has prepared it (or the submission counts as the preparer). |
| DEF-531 | backend | **Funds approval is automatic.** Approval sets `fundsApproved`, so the FR-ONB-010 funds gate never blocks. — AC: source-of-funds approval is an explicit, separately audited step. |
| DEF-532 | backend | **`.env.example` is stale** (missing file encryption, signing secret, SMTP, storage, idle-timeout and demo-seed variables). — AC: every variable the API reads is documented. |
