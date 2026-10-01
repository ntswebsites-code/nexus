# GAP VS NEXUS API (from the 5D draft)

Nexus equivalent = `/api/v1/company/*` and `/api/v1/private-markets/*` as audited (admin audit sections on the company portal, private markets, reporting model and state machines). Status: **Covered** (works for the V8 need), **Partial** (exists but cannot serve the V8 page without change), **Missing** (nothing exists).

| # | Page | Capability | Nexus equivalent today | Status | What is missing |
|---|---|---|---|---|---|
| 1 | 5.D.0 | Company-scoped access guard (active company) | `companyContext`: first `company_users` link; 403 `no_company_access`; other companies 404 (`/api/v1/company/*`) | Partial | Only the first linked company is reachable; no company switcher; the Next path performs no scope check |
| 2 | 5.D.0 | Company card (name, fund) | `GET /company/workspace` -> `company{name,legalName,sector,country,relationship JSON}` | Covered | Fund name must be a stable field, not inside `relationship` JSON |
| 3 | 5.D.0 | Period selector data | `workspace.periods[{id,label,due,status}]` | Covered | Selector must drive every period-aware page |
| 4 | 5.D.0 | In-app notifications drawer | Shared notifications module (`notify.users` on period opened, pack accepted/returned, question raised) | Partial | Events for term sheet, requests, consents, signatures, vault; unread count; read state per user |
| 5 | 5.D.0 | Global search / command palette | None (FR-NOT-002 not built) | Missing | Company-scoped search over reports, requests, documents, clauses, threads, members |
| 6 | 5.D.0 | Help guide / templates | `library` documents (`kind` guide, template, legal, board) + `GET /library/:ref/download-url` | Covered | Support-request entry point (Messages thread) |
| 7 | 5.D.1 | Overview aggregates (metrics, readiness, upcoming submissions, activity) | `workspace` returns `activity` (6), `deadlines`, `cashRunway`, `volumeSeries`, `history` | Partial | Period-scoped metrics from accepted data; readiness %; computed action items |
| 8 | 5.D.1 | Investment snapshot (invested, ownership, valuation, lead) | `relationship JSON`, `contacts JSON` (free-form) | Partial | Typed fields: invested amount, FD ownership (from cap table), last valuation, governance right, portfolio lead |
| 9 | 5.D.2 | KPI register (definitions, values, series) | `company_kpis` (key,label,unit,invert,prev,budget,series) + `reporting_periods.kpiValues` | Partial | Category, frequency, owner, per-period target, status vocabulary, evidence link, lock/approval of definitions |
| 10 | 5.D.2 | Submit period KPIs | `PUT /periods/:period` (`kpis` key->number) and `POST /periods/:period/submit` | Partial | Named revenue/net profit/cash flow net fields, open-request gate, numeric strictness messages, recompute of derived KPIs |
| 11 | 5.D.2 | Derived KPIs and ratios | None | Missing | Server-side formulas (margins, ratios, burn, runway, LTV/CAC, NDR) from accepted statements |
| 12 | 5.D.2 | KPI history and scorecard export | `series JSON` only | Missing | History by period, xlsx/csv export from a signed URL |
| 13 | 5.D.3 | Staff opens a reporting period | `POST /private-markets/companies/:ref/periods` (`period` YYYY-MM, `due`; copies 5-item template; notifies company users; 409 duplicate) | Partial | Mandatory-attachment catalogue, period type (monthly/quarterly/annual), reminder phases, calendar view across companies, nudges |
| 14 | 5.D.3 | Period schedule and submission history for the company | `workspace.periods`, `workspace.history`, `GET /periods/:period` | Covered | Per-period owner, completion %, version label if kept |
| 15 | 5.D.3 | Checklist file upload / remove with accepted extensions | `POST/DELETE /periods/:period/items/:key/files` (accept lists per item, 25 MB cap, Draft/Submitted/Accepted/Returned submissions) | Covered | Type-specific accept lists for the 6 builder types; scan status |
| 16 | 5.D.3 | Typed statements with line items (income statement, balance sheet, cash flow, operational KPIs) | None | Missing | `reporting_reports` with canonical line-item JSON, numeric strictness, balance equation check, per-line notes |
| 17 | 5.D.3 | Server-side report draft and restore | `PUT /periods/:period` stores `kpis` and `notes` only | Partial | Per-report draft with owner, version conflict handling, multi-member editing |
| 18 | 5.D.3 | Submit pack with validation | `POST /periods/:period/submit` (all required items need a file; moves submissions to Submitted; notifies `research.edit`) | Partial | Balance-sheet equation, variance rule (> 50% revenue fall), report-type completeness, bundle semantics |
| 19 | 5.D.3 | Staff review (accept / return) with SoD | `POST /private-markets/reporting-packs/:id/accept` and `/return` (reviewer != submitter, return needs note) | Covered | Per-report review and NEEDS_REVISION state only if report-level review is adopted |
| 20 | 5.D.3 | Post-accept sync (KPIs, forecast actuals, accounting hooks) | None | Missing | Write accepted figures to KPI values and forecast actual cells; optional valuation/dividend payload (NVCCZ) is out of scope until accounting integration |
| 21 | 5.D.3 | Report templates download | `library` documents of kind `template` | Partial | Template per report type with version; signed download for xlsx |
| 22 | 5.D.3 | Reporting reminders and read receipts | Outbox/worker and notifications exist; no reminder schedule; no view receipts | Missing | 14/7/3/1-day reminders, manual nudge with message, VIEWED_BY_INVESTEE log for staff |
| 23 | 5.D.3 | Reporting audit trail | Audit events `reporting.*` (hash-chained); company file downloads not audited | Covered | Audit company-own file downloads; field-level change diff for statements |
| 24 | 5.D.4 | Forecast model (sheets, rows, cells, versions, scenarios) | None (`cashRunway`/`volumeSeries` JSON on the company only) | Missing | Entire model and persistence |
| 25 | 5.D.4 | Actuals posting and month locking | None | Missing | Link accepted reports to actual cells; lock rules; close day |
| 26 | 5.D.4 | Forecast export (xlsx) | None | Missing | Signed-URL export |
| 27 | 5.D.5 | Term sheet record, structured terms, key dates, documents | None | Missing | `term_sheets`, `term_sheet_terms`, `term_sheet_dates`, published documents, company read endpoint |
| 28 | 5.D.5 | Staff issues / finalises a term sheet | None | Missing | Staff create/edit/finalise endpoints and UI in Private Markets |
| 29 | 5.D.5 | Clarification question to the fund | `reporting_questions`: only staff create; company replies/resolves | Partial | Company-created threads related to a term-sheet clause |
| 30 | 5.D.6 | Cap-table registry, share classes, holders, FD %, option pool | None | Missing | Full register read model (reference: NVCCZ `capTable` services) |
| 31 | 5.D.6 | Cap-table transactions, certificates, GL posting, maker-checker | None | Missing | Issuance/transfer with draft -> pending -> executed; certificate with SHA-256; GL journal; creator != approver |
| 32 | 5.D.6 | Dilution simulator and waterfall | None | Missing | Server simulator (notes, pool top-up) and waterfall |
| 33 | 5.D.7 | Consent / reserved-matter requests and decisions | None | Missing | `consent_requests`, decisions, reserved-matter definitions |
| 34 | 5.D.7 | Board calendar, actions and board packs | None | Missing | Meetings, actions, pack compilation |
| 35 | 5.D.7 | Covenant tracking | `covenants` table, `workspace.covenants`, staff `PATCH /companies/:ref/covenants/:key` | Covered | No V8 page shows covenants; decide placement (Governance or Term Sheet) |
| 36 | 5.D.8 | Signature requests visible to the company | `signature_requests`/`signatures` exist but are scoped by `clientId` (investor documents) | Partial | `company_id` scope, signatory list, status model, company list endpoint |
| 37 | 5.D.8 | Native signing record (consent, MFA time, document hash, IP) | `signatures` table (signer, authority, consentAt, mfaAt, docSha256, ip); step-up MFA | Partial | Drawn-signature image, certificate generation, document lock, sequential/parallel order |
| 38 | 5.D.8 | Company-initiated requests and signing authority matrix | None | Missing | Create endpoint, `signing_authorities`, decline/remind/void |
| 39 | 5.D.9 | Drawdown/capital request lifecycle and tranche (committed, reserved, available) | None (`capital_events` are investor calls/distributions) | Missing | `drawdown_requests`, items, documents, tranche calculation, statuses |
| 40 | 5.D.9 | Fund drill-down questions on a request | `reporting_questions` pattern (staff raise, company reply) | Partial | Attach to a request; evidence uploads; open-question flag on cards |
| 41 | 5.D.9 | Staff queue and approval (VC CFO gate) for requests | None | Missing | Staff list, SLA 48 h, approve/reject/return with reason |
| 42 | 5.D.10 | Company reads published documents | `GET /library/:ref/download-url` (companyId, classification Client/Public, status Approved/Published; 300 s HMAC) | Covered | Folders and access profiles shown in V8 |
| 43 | 5.D.10 | Company upload, versioning, folders, access profiles | `documents` + `document_versions` + classification exist (staff-only `POST /documents`); company uploads only as reporting-item files | Partial | Company upload endpoint, `company_folders`, `accessProfile`, per-document audit view |
| 44 | 5.D.10 | Share link and in-browser preview | None | Missing | 7-day share links; preview renderer with watermark |
| 45 | 5.D.11 | Company <-> fund-team message threads | `reporting_questions` + `reporting_question_messages` (company reply/resolve); `message_threads` client-scoped | Partial | Company-created threads, team routing, subject, attachments, unread counts |
| 46 | 5.D.12 | Company membership model | `company_users(company_id,user_id)`; invitation with `companyId`, `roleKeys: []` | Covered | Access profile column |
| 47 | 5.D.12 | Invite company users | Staff `POST /private-markets/companies/:ref/users`; invitation accept creates `company_users` | Partial | Company-administrator invite, profile selection, remove/disable, last-administrator guard |
| 48 | 5.D.12 | MFA coverage, access review, external access log | MFA factors and audit events exist | Missing | Aggregations and endpoints; access-review certification record |
| 49 | 5.D.13 | Company profile edit | None (no company update endpoint; seed-only companies) | Missing | Whitelisted update with version check |
| 50 | 5.D.13 | User profile edit | None for company portal (user `name` single field) | Missing | First/last name vs single `name`; e-mail change with re-verification |
| 51 | 5.D.13 | Letterhead and logo | None | Missing | Letterhead table, logo upload and signed URL, delete |
| 52 | 5.D.13 | Notification preferences | None (outbox exists) | Missing | Per-user preferences and reminder schedule |
| 53 | 5.D.13 | Security information (MFA, session timeout) | MFA enrol/verify/step-up and policy settings exist | Partial | Read endpoint for the user's factor status and platform timeouts |
| 54 | All | Uploads: cap, extension allow-list, signed downloads | `MAX_UPLOAD_MB` 25; per-item accept lists; HMAC 300 s URLs | Covered | Malware scan (`scanStatus` hard-coded clean); reconcile UI copy 50/100 MB |
| 55 | All | Append-only audit with hash chain | `audit_events` with chain; company events listed in the audit | Covered | New event names for the V8 actions |
| 56 | All | Idempotency and optimistic concurrency | `expectVersion` only when supplied; `Idempotency-Key`/`ETag` not implemented | Missing | Header support for create/submit/sign and `If-Match` on edits |
| 57 | All | Outbox notifications and e-mail | Worker consumes outbox (production container); not started by `npm run dev` | Covered | New templates (term sheet, requests, consents, signatures) |

**Totals (57 capabilities):** Covered 13, Partial 18, Missing 26.

| Page | Covered | Partial | Missing | Total |
|---|:-:|:-:|:-:|:-:|
| 5.D.0 | 3 | 2 | 1 | 6 |
| 5.D.1 | 0 | 2 | 0 | 2 |
| 5.D.2 | 0 | 2 | 2 | 4 |
| 5.D.3 | 4 | 4 | 3 | 11 |
| 5.D.4 | 0 | 0 | 3 | 3 |
| 5.D.5 | 0 | 1 | 2 | 3 |
| 5.D.6 | 0 | 0 | 3 | 3 |
| 5.D.7 | 1 | 0 | 2 | 3 |
| 5.D.8 | 0 | 2 | 1 | 3 |
| 5.D.9 | 0 | 1 | 2 | 3 |
| 5.D.10 | 1 | 1 | 1 | 3 |
| 5.D.11 | 0 | 1 | 0 | 1 |
| 5.D.12 | 1 | 1 | 1 | 3 |
| 5.D.13 | 0 | 1 | 4 | 5 |
| All | 3 | 0 | 1 | 4 |

Reading: the Nexus API serves the checklist-reporting part of the portal (periods, files, questions, covenants, library) and company membership. The V8 portal additionally needs new backend areas: typed statements, derived KPIs, forecast model, term sheets, cap table, governance, requests/drawdown, company vault, company messaging, team administration and settings (profile, letterhead, preferences).
