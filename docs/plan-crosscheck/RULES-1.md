# Plan cross-check: BR-021..BR-148 (first half, 128 of 256 BR rows)

Counts (128 rows): BUILT 56 | PARTIAL 64 | MISSING 6 | ADAPTER 1 | N/A 1.
BUILT = enforced in code by routes/services/models (grep and spot reads, not run-time proof). "unverified" = not found by grep; may exist under other wording. UI-only rules were not browser-tested. Rows not listed below are BUILT.

| id | requirement | status | what exists | what is missing | evidence |
|---|---|---|---|---|---|
| BR-021 | page jump permission-checked once; one "Access restricted" toast | PARTIAL | server permission checks | no "Access restricted" string in portals/*/src (UI unverified) | portals/*/src |
| BR-023 | liquidity floor policy param; cover = liquid/stressed outflows | PARTIAL | risk liquidity metrics | no liquidityFloor policy param or cover definition found | backend/api/src/modules/risk/risk.engine.ts |
| BR-025 | order-state vocabulary per Appendix B | PARTIAL | order statuses exist | exact vocabulary mapping unverified | backend/api/src/modules/orders/ |
| BR-026 | 0.65% buffer, 15% residual cash, 25% ADV, review thresholds configurable | PARTIAL | buffer logic in order checks | no 0.0065/15%/25% as policy params found (unverified) | backend/api/src/modules/orders/orders.checks.ts |
| BR-027 | recommendation list and single conviction scale | PARTIAL | research module | vocabulary/scale unverified | backend/api/src/modules/research/ |
| BR-028 | >=85% max-limit / <=115% min-limit = Tight; breach creates case + notifies owner | PARTIAL | BREACH/WARNING/OK with fixed 10% band | 85/115 thresholds not used; case creation and owner notification unverified | backend/api/src/modules/risk/risk.engine.ts:33 |
| BR-029 | scenario thresholds (liquidity 1.25x/1.5x, loss -8/-5%) configurable | MISSING | - | not found in portfolio-lab or risk | backend/api/src/modules/portfolio-lab/ |
| BR-031 | lock, export, methodology-version change each audited | PARTIAL | lock audited | export and methodology-version audit unverified | backend/api/src/modules/performance/perf.routes.ts |
| BR-032 | control bar period/basis/state from same record as KPI | PARTIAL | - | UI behaviour unverified | portals/admin-web/src |
| BR-033 | account close needs zero balance, no reservations, no open recon break, no suspense | PARTIAL | ledger close blocks on posted balance + live reservations (409) | recon-break and suspense checks absent; CashAccount CLOSING->CLOSED only maker-checker | backend/api/src/modules/cash/cash.routes.ts:189 |
| BR-034 | DRAFT/PENDING account cannot post, reserve or commit statements (409) | PARTIAL | ledger_not_active blocks reservations | account-level DRAFT/PENDING block on journals/statement commit unverified | backend/api/src/modules/cash/cash.routes.ts:535 |
| BR-036 | Funded/Paid capital notices stay in staff history with evidence/approvers | PARTIAL | capital call models | staff capital history list unverified | backend/api/src/modules/ops/ |
| BR-037 | KPI tiles equal listed rows | PARTIAL | - | unverified (UI/queue derivation) | portals/admin-web/src |
| BR-038 | Activation/Active cases not counted Ready to approve | PARTIAL | - | unverified | backend/api/src/modules/clients-onboarding/ |
| BR-039 | no applicant PII in browser storage | PARTIAL | - | localStorage/sessionStorage used in onboarding-web/src/lib/api.ts and admin legacy bridge; PII content unverified | portals/onboarding-web/src/lib/api.ts |
| BR-040 | KPI, chart, count, CSV from same filtered set | PARTIAL | - | unverified | portals/admin-web/src |
| BR-041 | date presets anchored to period end (production anchor open) | PARTIAL | - | decision Q-NEW unresolved; unverified | docs/srd/REGISTER.md |
| BR-042 | Review reports need human sign-off before release | PARTIAL | reports approve workflow | "Awaiting review" counting unverified | backend/api/src/modules/reports/ |
| BR-043 | perf period must be locked before report publish; material exception blocks report | PARTIAL | perf lock exists | no link from report publish to period lock found | backend/api/src/modules/reports/ |
| BR-044 | report numerics bound to source; manual edits flagged overrides; audit checkpoint per save | PARTIAL | - | override flag not found | backend/api/src/modules/reports/ |
| BR-045 | report vocabulary Draft/In review/Awaiting approval/Approved/Published | PARTIAL | report statuses | mapping unverified | backend/api/src/modules/reports/ |
| BR-050 | docs never deleted; retention 1-50; legal-hold blocks | PARTIAL | retention 1-50 default 7; no delete route seen | legal-hold blocking only in clients-onboarding vault, not documents | backend/api/src/modules/documents/documents.routes.ts:123 |
| BR-053 | publish creates Pending signature request per client when signature required | PARTIAL | SignatureRequest model | creation on publish unverified | backend/api/src/modules/documents/documents.routes.ts |
| BR-054 | upload types pdf/docx/xlsx/csv/png/jpg, <=25MB, malware scan | ADAPTER | storage runs av-scan adapter before store | strict type/size whitelist unverified; live scanner needs vendor account | backend/api/src/integrations/av-scan |
| BR-056 | custody vs IBOR qty diff shown Review and in Exceptions until resolved | PARTIAL | recon positions vs custody | Review state and Exceptions count linkage unverified | backend/api/src/modules/recon/recon.engine.ts |
| BR-063 | creator cannot mark own control task Done | MISSING | task completion has dependency check | no control-task flag or creator != completer rule | backend/api/src/modules/wiring/control.routes.ts:212 |
| BR-065 | case not classified as break until independent counterparty population received | MISSING | break classification exists | no population-received gate found | backend/api/src/modules/recon/recon.engine.ts |
| BR-066 | prototype broker price +0.01 always breaks | N/A | - | prototype note only | docs/srd/REGISTER.md |
| BR-070 | margin dispute records reason/evidence; funding needs maker != checker and creates cash expectation | PARTIAL | financing maker-checker + margin calls | dispute evidence record and cash expectation on funding unverified | backend/api/src/modules/financing/fin.routes.ts |
| BR-071 | election only before deadline, by corporate_actions.elect; approval by other user -> Instructed | PARTIAL | electionOpen deadline check | elect permission and approval -> Instructed unverified | backend/api/src/modules/corporate-actions/ca.routes.ts |
| BR-072 | attestation by two distinct users (Compliance + Finance); filer != preparer | PARTIAL | submit needs reports.submit + step-up, not preparer | two-person Compliance+Finance attestation not found | backend/api/src/modules/regulatory/reg.routes.ts:23 |
| BR-073 | source authoritative only after connectivity/auth/schema/quality checks + owner approval | PARTIAL | data fabric, integrations admin | owner-approval gate unverified | backend/api/src/modules/data-fabric/ |
| BR-078 | every amount carries as-of + valuation status; RESTATED purple | PARTIAL | valuationStatus in LP services | RESTATED never produced; visual distinctness unverified | backend/api/src/modules/lp-portal/services/ |
| BR-080 | null rate shown as dash, rates as fractions | PARTIAL | - | unverified | backend/api/src/modules/lp-portal/services/dashboard.ts |
| BR-082 | consolidated Net IRR from merged cash flows | PARTIAL | irr in dashboard/performance | merge across funds unverified | backend/api/src/modules/lp-portal/services/dashboard.ts |
| BR-084 | toggle windows YTD/1Y/3Y by date | PARTIAL | 1Y/3Y/5Y/10Y months map | no YTD window | backend/api/src/modules/lp-portal/services/performance.ts:115 |
| BR-085 | figures from latest approved snapshot <= as-of; status weakest | PARTIAL | valuationStatus/asOfDate returned | no InvestorSnapshot use in lp-portal; approved-snapshot selection unverified | backend/api/src/modules/lp-portal/services/positions.ts |
| BR-087 | presentation currency (USD/ZIG) applied by API using as-of FX rate | MISSING | presentationCurrency preference stored | no FX conversion in lp-portal | backend/api/src/modules/lp-portal/routes/settings.routes.ts:88 |
| BR-089 | period select changes figures from approved period snapshots | PARTIAL | period param passed | period snapshots unverified | backend/api/src/modules/lp-portal/services/performance.ts:31 |
| BR-090 | range buttons single period control | PARTIAL | - | unverified | backend/api/src/modules/lp-portal/services/performance.ts |
| BR-091 | benchmark series only from stored approved points | MISSING | getBenchmarks always returns configured:false | no benchmark point storage in LP path | backend/api/src/modules/lp-portal/services/performance.ts:137 |
| BR-092 | per-row benchmark column | PARTIAL | benchmark in position metrics | unverified | backend/api/src/modules/lp-portal/services/positions.ts |
| BR-093 | benchmark comparison panel same-date value | PARTIAL | - | depends on BR-091 (no series) | backend/api/src/modules/lp-portal/services/performance.ts |
| BR-094 | status card weakest status colours; RESTATED purple | PARTIAL | - | RESTATED absent | backend/api/src/modules/lp-portal/ |
| BR-095 | chart axis/money follow reporting currency | PARTIAL | - | follows BR-087 (no conversion) | backend/api/src/modules/lp-portal/ |
| BR-096 | Download Report job QUEUED/RUNNING/COMPLETED/FAILED/CANCELLED with polling | PARTIAL | synchronous job stored in settings, status always COMPLETED | no async states, no failure/cancel | backend/api/src/modules/lp-portal/services/performance.ts:151 |
| BR-097 | single job vocabulary; COMPLETED downloadable | PARTIAL | download route /reports/:jobId/download | path differs from /lp-portal/jobs/{id}/download; vocabulary reduced | backend/api/src/modules/lp-portal/routes/reports.routes.ts:83 |
| BR-101 | full account number reveal only to SIGNATORY/MANAGER, audited; VIEWER masked | MISSING | masked number only | no reveal path or audit | backend/api/src/modules/lp-portal/services/dealing.ts |
| BR-107 | next dealing date on fund business-day calendar and cut-off timezone | PARTIAL | nextDealingDate with notice days | business-day calendar and timezone unverified | backend/api/src/modules/lp-portal/services/dealing.ts:139 |
| BR-110 | one idempotency key per submit attempt; multipart hash | PARTIAL | lib/idempotency.ts | LP submit/UI key handling unverified | backend/api/src/modules/lib/idempotency.ts |
| BR-111 | full request state machine incl. staff transitions | PARTIAL | SUBMITTED/COMPLIANCE_REVIEW/AWAITING_FUNDS in LP service | staff transition endpoints unverified | backend/api/src/modules/lp-portal/services/dealing.ts |
| BR-112 | separate requested/expected funding/settlement dates | PARTIAL | estimatedSettlementDate returned | separate fields unverified | backend/api/src/modules/lp-portal/services/dealing.ts:405 |
| BR-113 | source bank account must be ACTIVE same client else 422 sourceBankAccountId | PARTIAL | - | sourceBankAccountId not found | backend/api/src/modules/lp-portal/services/dealing.ts |
| BR-114 | request currency one of fund dealing currencies | PARTIAL | - | unverified | backend/api/src/modules/lp-portal/services/dealing.ts |
| BR-116 | canonical document category enum shared by API/filter/counts | PARTIAL | - | unverified | backend/api/src/modules/lp-portal/services/documents.ts |
| BR-118 | pending-signature count and REQUIRES_SIGNATURE status | PARTIAL | - | unverified | backend/api/src/modules/lp-portal/services/documents.ts |
| BR-119 | secure downloads YTD counts only audited completed downloads | PARTIAL | - | unverified | backend/api/src/modules/lp-portal/services/documents.ts |
| BR-120 | download history DOWNLOAD only; audit events DOCUMENT_VIEWED/DOWNLOADED | PARTIAL | audit on download | event names absent (lp_report.downloaded used) | backend/api/src/modules/lp-portal/routes/reports.routes.ts |
| BR-122 | latest published version shown; SUPERSEDED reachable; RESTATED label | PARTIAL | - | SUPERSEDED only in organisation.ts, none in documents | backend/api/src/modules/lp-portal/services/documents.ts |
| BR-124 | search/dashboard/activity links use same doc ids | PARTIAL | - | unverified | backend/api/src/modules/search/registry.ts |
| BR-127 | share-class notice only to holders of that class | PARTIAL | FUND target filter | share-class targeting not found | backend/api/src/modules/lp-portal/services/notices.ts:20 |
| BR-128 | one category enum with labels; kind INFO/ACTION_REQUIRED | PARTIAL | - | unverified | backend/api/src/modules/lp-portal/services/notices.ts |
| BR-129 | open recorded only on click/deep link, not auto-select | PARTIAL | openedAt receipt | trigger rule is UI; unverified | backend/api/src/modules/lp-portal/services/notices.ts |
| BR-130 | ack keeps first acknowledgedAt, NOTICE_ACKNOWLEDGED audit | PARTIAL | acknowledgedAt receipt | audit event name absent; idempotent repeat unverified | backend/api/src/modules/lp-portal/services/notices.ts:102 |
| BR-132 | unreadCounts.notices vs awaiting-ack count | PARTIAL | unreadCounts in session | split count unverified | backend/api/src/modules/lp-portal/routes/session.routes.ts |
| BR-134 | ack audited NOTICE_ACKNOWLEDGED, opens per user | PARTIAL | receipts per user | audit event unverified | backend/api/src/modules/lp-portal/services/notices.ts |
| BR-136 | defaultAsOf codes LATEST, LATEST_ANY, PRIOR_MONTH_END | PARTIAL | defaultAsOfPreference setting | LATEST_ANY and PRIOR_MONTH_END not found | backend/api/src/modules/lp-portal/routes/settings.routes.ts |
| BR-141 | All Funds recompute TVPI/DPI/RVPI from sums | PARTIAL | tvpi in dashboard | unverified | backend/api/src/modules/lp-portal/services/dashboard.ts |
| BR-142 | valuation read from approved immutable snapshot (version, source module, approver) | PARTIAL | InvestorSnapshot models exist | not referenced by lp-portal services | backend/api/src/modules/lp-portal/services/ |
| BR-143 | status vocabulary ESTIMATED/PROVISIONAL/FINAL/RESTATED | PARTIAL | PROVISIONAL used | RESTATED absent | backend/api/src/modules/lp-portal/services/positions.ts |
| BR-144 | mixed-fund default status = least certain | PARTIAL | - | unverified | backend/api/src/modules/lp-portal/services/dashboard.ts |
| BR-145 | default as-of from preference when session built | PARTIAL | session applies preference | limited codes (see BR-136) | backend/api/src/modules/lp-portal/routes/session.routes.ts |
