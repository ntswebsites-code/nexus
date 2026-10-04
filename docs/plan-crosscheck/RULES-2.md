# RULES-2: business rules BR-149 to BR-276 (second half of REGISTER.md) and build-plan cross-check

Method: static code check (grep and targeted reads), no browser. "unverified" = the file named was not read to line level or no code located; treat as unconfirmed, not as proven missing. Statuses count rules BR-149..BR-276 (128 rows).

## Counts (rules)

| BUILT | PARTIAL | MISSING | ADAPTER | N/A | total |
|---|---|---|---|---|---|
| 63 | 51 | 12 | 1 | 1 | 128 |

BUILT rules are not listed. Several BUILT calls rest on a grep hit plus the module's existence rather than a line-by-line formula check (for example BR-149 to 151, 162, 163, 165, 168, 178, 198, 203, 232 to 238, 266, 269): enforcement was located, exact arithmetic was not re-derived.

## Rules that are PARTIAL, MISSING, ADAPTER or N/A

| id | requirement (short) | status | what exists | what is missing | evidence |
|---|---|---|---|---|---|
| BR-152 | Ledger keeps original currency and the historical FX rate and date | PARTIAL | Read-time ledger with each row's currency | No FX rate or rate date on ledger rows | `backend/api/src/modules/lp-portal/services/activity.ts` |
| BR-157 | Due-soon window is configurable and shared by row and summary | PARTIAL | Fixed constant of 7 days | Not configurable | `lp-portal/services/capital.ts:18` |
| BR-159 | Notices and statements are real PDF documents | PARTIAL | Statement PDF generator | Capital-call and distribution notice PDFs unverified | `lp-portal/services/statement-pdf.ts` |
| BR-164 | Minimum balance defaults 1,000,000.00 and 100,000 units | PARTIAL | Check is enforced from fund rules | Default is 0 when the fund has no rule | `lp-portal/services/dealing.ts:121` |
| BR-170 | Four currencies kept apart, display currency changes presentation only | PARTIAL | `presentationCurrency` preference stored and returned | No conversion applied to any figure | `lp-portal/routes/settings.routes.ts`, `session.routes.ts` |
| BR-171 | Conversion uses transaction-date FX stored with the record | MISSING | none | No FX use in any LP service | `lp-portal/services/*` (no fx hits) |
| BR-172 | Money formatting uses row currency, no hard-coded "$" | PARTIAL | unverified | Formatter not inspected | `portals/investor-web/src/lib` |
| BR-176 | Document stores SHA-256, MIME, size, page count | PARTIAL | hash, mime, size, verify call | `pageCount: null` | `lp-portal/services/documents.ts:85` |
| BR-177 | Uploads scanned for malware | ADAPTER | Every upload goes through av-scan adapter | Only fake adapter; live is a stub | `lib/storage.ts`, `integrations/av-scan/` |
| BR-179 | Notice targeting incl. SHARE CLASS | PARTIAL | ALL, FUND, ORG, USER | Share-class target not in visibility filter | `lp-portal/services/notices.ts:19-22` |
| BR-183 | Unlinked attachment uploads purged after 24 h | PARTIAL | Upload-then-attach ownership checks | No purge job found | `lp-portal/services/requests.ts:103-110` |
| BR-184 | Last active MANAGER cannot be demoted or revoked | PARTIAL | Only staff grant MANAGER, invite roles limited | No last-manager guard found | `lp-portal/services/organisation.ts` |
| BR-185 | Bank change flow SUBMITTED, UNDER_VERIFICATION, APPROVED, ACTIVATED, old ARCHIVED | PARTIAL | Submit creates "Pending verification", staff notified, staff page exists | Callback record, ACTIVATED/ARCHIVED hand-over not confirmed | `lp-portal/services/organisation.ts:341-400`, `/ops/bank-instructions` |
| BR-186 | `requireMfaForLp` forces enrolment at first sign-in, 5-min step-up for bank and colleague changes | PARTIAL | Flag echoed; bank change needs an enrolled factor | No forced enrolment, no step-up window on bank or colleague routes | `lp-portal/routes/settings.routes.ts:66`, `organisation.ts:341` |
| BR-189 | Rate limits 60/20/10 per minute per user and IP, 100 kB bodies | PARTIAL | Global IP limiter 600/min, uploads 30/min in prod | Not per user or per read/write class; JSON limit is 1 MB | `middleware/observability.ts:73-90`, `app.ts:34` |
| BR-191 | Owners at or above 25 percent and one controller required, sum at most 100 | PARTIAL | At least one owner required, pct clamped 0..100 | No 25 percent or sum check | `kyc/public-form.ts:234`, `kyc/public.routes.ts:122` |
| BR-200 | Action centre items (period due, questions, signatures, governance) | PARTIAL | Dashboard exists | Composition of all four sources unverified | `investee-portal/investee.service.ts` |
| BR-201 | KPI definitions investee-agreed and locked, change needs CFO and staff | PARTIAL | `kpiDefinitionSchema` and listing | Lock and dual approval unverified | `investee-portal/investee.contract.ts:447` |
| BR-202 | Derived KPIs formulas v1 | PARTIAL | Margins and runway only | Remaining derived formulas absent | `investee.service.ts:446-463` |
| BR-205 | KPI status vocabulary On track, Above target, Watch, Submitted | PARTIAL | unverified | Not located | `portals/company-web/src` |
| BR-207 | Month locks at close day (day 5) or when prior actuals accepted | PARTIAL | Manual lock by approver, unlock by administrator | No automatic close-day rule | `investee-portal/workspace/records.ts:83`, `workspace.routes.ts` |
| BR-208 | Forecast versions immutable once submitted, new working version from latest | MISSING | Forecast cells plus month locks | No versions or submit step | `workspace/records.ts` |
| BR-209 | Opening cash of month n+1 equals closing cash of month n | MISSING | Forecast holds revenue only | No cash roll-forward | `workspace/records.ts:18,45` |
| BR-210 | Accepted actuals post to month input rows, month becomes actual-locked | PARTIAL | Revenue actuals read from accepted periods | Only revenue; stage is index-based, not status-driven | `workspace/records.ts:36,53` |
| BR-211 | Liquidity alert below minimum cash; runway over next 3 months | PARTIAL | Runway as KPI from last cash flow | No threshold, no alert, not forecast-based | `investee.service.ts:463` |
| BR-212 | Both signatures at term sheet stage advance deal to UNDER_BOARD_REVIEW | MISSING | Term sheet signing | No deal stage or advance | `modules/term-sheets/` |
| BR-214 | Pre-money, post-money and ownership display | PARTIAL | `valuation` and `simulateRound(preMoney)` | Post-money and ownership display rule unverified | `investee.routes.ts:1003,1054` |
| BR-215 | "Pending" reserved-matters badge counts open consents | PARTIAL | Static reserved-matter list, consents list | Badge count unverified | `workspace/records.ts:147,215` |
| BR-217 | Consent lifecycle with information request, board review, withdrawn | PARTIAL | Approved or Declined decisions | Other states and reasons | `workspace/records.ts:125` |
| BR-218 | Decision due defaults to submission plus notice period | MISSING | none | Not found | `workspace/records.ts` |
| BR-219 | Next board meeting days, materials due = meeting minus 8 days | PARTIAL | Board meetings and pack | Calculation unverified | `workspace/records.ts:177` |
| BR-220 | Board actions closed percentage | PARTIAL | Board actions exist | Calculation unverified | `workspace/records.ts` |
| BR-221 | Compliance health ratio | MISSING | none | Not found | none |
| BR-223 | Authority matrix (funding CEO+CFO, resolutions Chair+Secretary) | PARTIAL | `signingAuthority` on company links checked at e-sign request | No named matrix by document type | `esign/esign.service.ts:257` |
| BR-226 | Requisition lifecycle to VC review, auto-RFQ to top five vendors, PO | PARTIAL | DRAFT, SUBMITTED, APPROVED, REJECTED, FULFILLED, staff queue | No PENDING_VC_EXECUTIVE_REVIEW, RFQ, vendor rating, PO conversion | `workspace/records.ts:381-434`, `/ops/investee-requests` |
| BR-227 | Requisition create/submit validation | PARTIAL | `requisitionSchema` | Attachment-before-submit and portfolio-owner check unverified | `workspace/records.ts` |
| BR-228 | Kanban status mapping | PARTIAL | Reduced status set | Mapping for full vocabulary and reason badge | `workspace/records.ts` |
| BR-229 | Approved this quarter = sum of drawdown amounts | MISSING | none | Not found | `workspace/records.ts` |
| BR-230 | 48 hour SLA queue for staff | MISSING | none | Not found | `/ops/investee-requests` |
| BR-231 | Company-side approval route displayed (Q-NEW) | N/A | open question in the register | Owner decision | `docs/DECISIONS-NEEDED.md` |
| BR-240 | Segregation of duties inside the company, configurable approval route | PARTIAL | Staff reviewer not equal submitter; cap-table second signer | Company preparer not equal approver, route config | `company/company.staff.routes.ts:114`, `workspace/cap.ts` |
| BR-241 | Invitation 7 days, MFA before access, one admin remains | PARTIAL | Invite, `already_member` conflict | Expiry, forced MFA and last-admin guard unverified | `investee.routes.ts:776` |
| BR-243 | Letterhead used on generated documents | PARTIAL | Letterhead save and contract | Use on board packs, certificates unverified | `investee.contract.ts:166` |
| BR-244 | Logo upload types, signed stored URL | PARTIAL | unverified | not located | `investee.routes.ts` |
| BR-245 | Notification preferences (deadline reminders, decisions, signatures) | PARTIAL | Reminders at 14, 7, 3, 1 days | Preference matrix and channel choice unverified | `company/reminders.ts:5` |
| BR-248 | Bundle submit of DRAFT, NEEDS_REVISION, REJECTED reports | PARTIAL | Pack submit, statuses DRAFT, NEEDS_REVISION, SUBMITTED, ACCEPTED | No REJECTED state, no bundle message | `investee.contract.ts:323`, `investee.service.ts:247` |
| BR-249 | Edit only by owner, "Report does not belong to you" | PARTIAL | Company-scoped access | Per-owner check not found | `investee.service.ts` |
| BR-253 | Review ACCEPT, REJECT, NEEDS_REVISION with accounting automation on accept | PARTIAL | Accept and return, note required on return, SoD | No REJECT, no valuation/dividend automation | `company/company.staff.routes.ts:109-135` |
| BR-254 | Notifications and VIEWED_BY_INVESTEE read receipts | PARTIAL | Outcome notifications | Read-receipt log not found | `company/company.staff.routes.ts` |
| BR-256 | Upload types, core statements xlsx only, naming convention | PARTIAL | Accept lists per item | Core-statement xlsx rule and stored-name pattern unverified | `company/company.service.ts:14-16` |
| BR-257 | Income-statement derived lines | PARTIAL | Totals copied into pack (revenue) | Full COGS, GP, opex chain unverified | `investee.service.ts:406` |
| BR-258 | Balance-sheet derived lines | PARTIAL | Equation check at 0.02 on current period | Prior-period check, subtotal derivation | `investee.service.ts:496-503` |
| BR-259 | Cash-flow derived lines | PARTIAL | unverified | not located | `investee.service.ts` |
| BR-260 | Ratio set (margins, current, quick, debt) | PARTIAL | Margins and runway | Liquidity and leverage ratios | `investee.service.ts:446-463` |
| BR-261 | Operational KPIs (LTV, CAC, retention) | PARTIAL | unverified | not located | `investee.service.ts` |
| BR-263 | Full P&L forecast (revenue, GP, EBITDA, margin) | MISSING | Revenue-only forecast cells | Cost and EBITDA lines | `workspace/records.ts:18` |
| BR-264 | Month stage window and percent input parsing | PARTIAL | Stage from index | Calendar window and "x%" parsing | `workspace/records.ts:36` |
| BR-265 | Scenario summary computed from overrides | PARTIAL | Base, Upside, Downside | Fixed multipliers (x1.15, x0.8), not override-driven | `workspace/records.ts:69-71` |
| BR-267 | Dilution simulator = CapTableDilutionEngine | PARTIAL | Simplified `simulateRound` | Engine port | `investee.routes.ts:1054` |
| BR-270 | Committed, reserved and available drawdown | MISSING | none | Not found | `workspace/records.ts` |
| BR-271 | Requisition validation incl. attachment, portal-user submit | PARTIAL | Schema validation | Attachment rule, owner check unverified | `workspace/records.ts` |
| BR-272 | Ledger approval total | MISSING | none | Not found | `workspace/records.ts` |
| BR-273 | Resubmission needs changed fingerprint | MISSING | none | Not found | `workspace/records.ts` |
| BR-275 | Authority matrix display | PARTIAL | See BR-223 | Same | `esign/esign.service.ts:257` |
| BR-276 | Invitation, one pending per email, MFA coverage, 90-day review | PARTIAL | MFA coverage and access review routes | Cadence and one-pending rule unverified | `workspace/workspace.routes.ts:193` |

## Build-plan items not complete (BUILD-PLAN.md, DEV-PLAN-1DAY.md, 5A-admin.md)

Admin page list: all 28 pages in 5A-admin.md section 5.A.0.1 have a native `/ops` route (portals/admin-web/src/app/(ops)/ops/*; valuation is `/ops/nav`, reconciliations is `/ops/reconciliation`). Rows below are the gaps recorded inside those pages plus plan items. Source for page gaps: `docs/ADMIN-REAL-PAGES.md` "Not done" sections (some lines are superseded by later WP notes; flagged where unclear).

| plan item | requirement | status | what exists | what is missing | evidence |
|---|---|---|---|---|---|
| BP S3 | CSV import of funds, commitments, valuations with dry-run | MISSING | Funds screens | No import endpoints | `backend/api/src/modules` (no imports route) |
| BP S4 | Valuation publication with maker/checker and ESTIMATED to FINAL | PARTIAL | Funds page, NAV runs | Dedicated publish/restate workflow for LP fund valuations unverified | `/ops/funds`, `/ops/nav` |
| BP S10 | Ledger corrections and FX stamping view | MISSING | none | Screen and FX stamping | none |
| BP S12 | Benchmark and performance publication (staff) | PARTIAL | `benchmarkSeries` read by LP performance | Staff publication screen unverified | `lp-portal/services/performance.ts`, `/ops/performance` |
| BP S13 | Statements and report jobs monitor | PARTIAL | `/ops/reports`, worker health | LP report-job monitor and regenerate unverified | `/ops/reports`, `/ops/health` |
| BP S15 | Portal access admin: LP and company users, revoke, MFA reset | PARTIAL | RBAC, clients, investor-services | Company-user admin and MFA reset screen unverified | `/ops/rbac`, `/ops/investor-services` |
| BP S20 | Staff cap-table administration | MISSING | Company-side cap table only | "No staff-side screen for cap-table data" | `docs/ADMIN-REAL-PAGES.md:1271` |
| BP S23 | Data-room administration and document requests | PARTIAL | `/ops/vault` | Company-targeted requests unverified; no vault upload UI in screen | `docs/ADMIN-REAL-PAGES.md:1142` |
| BP S24 | Company message desk | PARTIAL | Company question threads | Staff console screen unverified | `modules/company/company.routes.ts` |
| BP S26 | Portal flags and demo-mode switches panel | MISSING | Env flags (`LP_LIVE_DOMAINS`, `INVESTEE_LIVE_ACTIONS`) | No staff panel | `docs/TODO.md` M9 |
| BP N19 | Procurement requests with goods-received notes | PARTIAL | Requisitions, staff decision | GRN, RFQ, PO | `workspace/records.ts` |
| BP N18 | Forecast workbook (sheets, scenarios, close-day lock) | PARTIAL | Revenue cells, locks, 3 scenarios | Sheets, versions, cost lines | `workspace/records.ts` |
| BP N16 | Convertibles, dilution engine | PARTIAL | Cap table, waterfall, certificates | Convertibles, full dilution engine | `workspace/cap.ts` |
| BP N17 | Governance (board approvals, reserved matters) | PARTIAL | Consents, board meetings and pack | Full consent lifecycle | `workspace/records.ts` |
| BP N20 | Company vault (folders, versions, access profile) | PARTIAL | Documents, versions | Download, preview, delete (INO-021 open) | `docs/FIXES-LOG.md:248` |
| BP P9 | Custodian intake: staff lists bulk batches | PARTIAL | Bulk upload, day-end, executions | `/ops/custodian` does not list bulk batches | `docs/ADMIN-REAL-PAGES.md:1291` |
| BP P10 | Pen-test fixes, load test, backup restore drill, monitoring | PARTIAL | `deploy.sh`, `rollback.sh`, health page | No load test, pen test or restore drill artefacts found | `deploy/` |
| BP 12.6 | UAT Playwright journeys J0, J1A, J2, J3, J5 | PARTIAL | `custodian.spec.ts`, `onboarding.spec.ts` only; Vitest jsdom suite | No Playwright specs for LP, admin or investee journeys; written suites never run (docs) | `tools/uat/e2e/` |
| BP 12.6 | Nightly `reset-uat.sh` | MISSING | `deploy.sh`, `rollback.sh` | reset script | `deploy/` |
| BP M9 | Live data on for all portals (flags) and full UAT | MISSING | Local env only | Not done on UAT | `docs/TODO.md` |
| BP M10 / A01-A13 | Real vendors (market data, SWIFT/API custodian, KYC, payments, email/SMS, SSO, LLM, AV, regulator filing, broker) | ADAPTER | Fake adapters plus call log | Live adapters are `NotConfigured` stubs | `backend/api/src/integrations/*/live.ts` |
| BP legacy | Retire legacy V56 `/` prototype | PARTIAL | `/ops` native pages | Legacy markup and `(legacy)` route still in tree (GAP-021) | `portals/admin-web/src/legacy`, `docs/GAP-ANALYSIS.md:103` |
| 5A command | Command Centre performance, allocation, scenario panels | MISSING | KPI and queue panels | Three panels | `docs/ADMIN-REAL-PAGES.md:954` |
| 5A operations | Calendar, workload charts, task comments, CSV button | MISSING | Task list and control | Listed items | `docs/ADMIN-REAL-PAGES.md:953` |
| 5A orders | FIX feed, CSV import, allocation and contract-note matching, stop-limit | PARTIAL | Order lifecycle, settle | Items listed under "Not done" (may be partly superseded) | `docs/ADMIN-REAL-PAGES.md:271` |
| 5A reconciliations | Effective-dated tolerances (BR-067), scheduled-source registry, evidence upload, partial-fill aggregation | PARTIAL | Families, breaks, sign-off | Listed items | `docs/ADMIN-REAL-PAGES.md:564,747,1237` |
| 5A nav | Scheduled runs, approval limits, pack export, per-share-class NAV | PARTIAL | NAV runs and approval | Listed items | `docs/ADMIN-REAL-PAGES.md:719` |
| 5A accounting | Automatic journals from NAV, fees, trades; FX revaluation; attachments | PARTIAL | Manual journals, close | Listed items | `docs/ADMIN-REAL-PAGES.md:808` |
| 5A corporate-actions | Tax on non-dividend actions, rights take-up, automatic feed | PARTIAL | Process, reverse, cash in lieu | Listed items | `docs/ADMIN-REAL-PAGES.md:903` |
| 5A cash | CAMT.053 parser, holds and pending-withdrawal availability, GL tie-out | PARTIAL | Ledgers, reservations (WP-2) | Listed items | `docs/ADMIN-REAL-PAGES.md:913` |
| 5A performance | Linked (Carino) attribution, composites, scheduled refresh | PARTIAL | Returns, attribution | Listed items | `docs/ADMIN-REAL-PAGES.md:1109` |
| 5A research / private-markets / portfolio-lab / financing | Market-data feed, J-curve and look-through, optimiser, interest accrual | PARTIAL | Cases, calls, rebalancing, facilities | Listed items | `docs/ADMIN-REAL-PAGES.md:1119-1124` |
| 5A clients / vault | Checker on dealing-hold and mandate changes; vault upload UI; configurable risk factors | PARTIAL | Audited single-step changes | Listed items; ADB-012 drawer actions open | `docs/ADMIN-REAL-PAGES.md:1142`, `docs/FIXES-LOG.md:245` |
| 5A reports / regulatory / data / models | Official regulator XML, SECZ/FIU upload, ingestion engine, cross-table rules, automatic model usage | PARTIAL | HTML/PDF reports, working filing layouts | Listed items | `docs/ADMIN-REAL-PAGES.md:1153,1282` |
| 5A copilot | LLM-backed Copilot | ADAPTER | Keyword router | LLM adapter live | `docs/ADMIN-REAL-PAGES.md:1170` |
| 5A settings / rbac | Settings enforced by modules; scheduled purge; custom permission change requests; `If-Match` everywhere | PARTIAL | Many settings enforced after WP-4 | Retention, notification and flag settings; purge; create-role via change request | `docs/ADMIN-REAL-PAGES.md:1170,1257` |
| 5A onboarding | Screening provider (stub), configurable risk factors | ADAPTER | Manual checks, stub provider | Live screening | `docs/ADMIN-REAL-PAGES.md:1145` |
