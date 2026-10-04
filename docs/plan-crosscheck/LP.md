# Plan cross-check: FR-LP-001..113 (LP portal)

Counts (113 rows): BUILT 93 | PARTIAL 16 | MISSING 3 | ADAPTER 1 | N/A 0.
BUILT is by evidence of routes, services, Prisma models and UI screens, not row-by-row proof; no sampling was done on UI micro-behaviours (toasts, tooltips, ARIA). Items marked "unverified" were not confirmed in code.

Where checked: backend/api/src/modules/lp-portal/{routes,services,lp.context.ts}, ops/notices.routes.ts, ops/capital.*, investor/staff.routes.ts, portals/investor-web/src/components/lp-portal/*, lib/api/lp-portal-api.ts, docs/FIXES-LOG.md.

| id | requirement | what exists | what is missing | evidence |
|---|---|---|---|---|
| FR-LP-004 | client switcher for multi-client users | server honours `?client=` for multi-client users | no switcher control or client param sent by UI (no hit in portals/investor-web/src) | lp-portal/lp.context.ts:48 |
| FR-LP-010 | KPI info popover with definition and formula | not confirmed | no "formula" text found in investor-web (unverified: may use different wording) | portals/investor-web/src |
| FR-LP-018 | performance KPI popover with formula, period, as-of | same | same (unverified) | portals/investor-web/src |
| FR-LP-029 | ledger returns original/reporting amounts, historic exchange rate | amount and currency per entry | no exchange-rate / reportingAmount fields found | services/activity.ts |
| FR-LP-032 | activity API accepts sortBy/sortDirection, filters, paging | date-desc sort fixed in API; filters/paging present | no sortBy / sortDirection anywhere in lp-portal | services/activity.ts:104 |
| FR-LP-033 | export CSV, XLSX and PDF | CSV and XLSX (`lib/xlsx`) | PDF export of account activity (415 for other formats) | routes/activity.routes.ts:32 |
| FR-LP-054 | structured wire fields, masked, unmasked only on explicit reveal | masked account number (`accountNumberMasked`) | no explicit reveal path found (unverified) | services/dealing.ts:300 |
| FR-LP-055 | refresh page on new capital activity event | `/realtime` poll and SSE stream, shared bumpRefresh | capital-specific event name (Q-114) not confirmed | routes/session.routes.ts:111 |
| FR-LP-058 | staff dealing status transitions, maker-checker on unit allocation | `investor/staff.routes.ts` has capital-event allocate with maker id | dealing-request status endpoints and maker-checker on unit allocation not confirmed (unverified) | investor/staff.routes.ts |
| FR-LP-062 | dealing history sortable by Submitted/Amount/Status server-side | paging and status filter exist | server sort missing (no sortBy) | services/dealing.ts |
| FR-LP-064 | `lp_dealing_updated` event or 60 s poll | generic realtime poll/SSE | `lp_dealing_updated` not in event list (list has lp_notification, lp_notice_updated, lp_request_*) | routes/session.routes.ts:111 |
| FR-LP-073 | `lp_document_published` event refreshes documents | generic lp_notification | event name absent | routes/session.routes.ts:111 |
| FR-LP-082 | Socket.IO contract | Server-Sent Events stream + `/realtime?since=` polling | Socket.IO not used (no dependency) | routes/stream.routes.ts |
| FR-LP-095 | `activationEmailSent` + Resend invitation | invite create/edit/revoke | resend action and `activationEmailSent` not confirmed (unverified) | services/organisation.ts |
| FR-LP-096 | bank change: step-up TOTP, staff task, maker-checker | step-up on POST `/bank-instructions/changes`; BankInstruction rows with version | staff verification task / maker-checker approval not found in lp-portal (unverified in ops) | routes/organisation.routes.ts:59 |
| FR-LP-099 | bank form: currency, SWIFT, IBAN, letter upload, confirm-account field | IBAN/SWIFT in service | confirm-account-number field and supporting letter upload not found | services/organisation.ts |
| FR-LP-042 | virus scan of payment-confirmation uploads | scan hook calls `integrations/av-scan` (ADAPTER) | only `fake.ts` adapter, no real scanner | integrations/av-scan/fake.ts |
| FR-LP-102 | MFA enrolment (QR, backup codes), active sessions, password change pages | `/settings/mfa` returns factor info; manageUrl points to `/lp-portal/settings?tab=security` | no enrolment/sessions/password UI found; `sessionsUrl` is null | routes/settings.routes.ts:70 |
| FR-LP-104 | Save enabled only when changed, Discard, leave-page warning | not confirmed | no `beforeunload` handler in investor-web | portals/investor-web/src |
| FR-LP-072 | documents `sortBy` (publishedAt, name, fundName) | fixed publishedAt-desc sort | sortBy/sortDirection params | services/documents.ts:106 |

Notes
- FR-LP-042 is status ADAPTER (rest of the requirement, 413 and SHA-256 audit, is present in services/capital.ts).
- FR-LP-089 (notices) is BUILT: ops/notices.routes.ts has create, submit, approve, publish, withdraw with receipts (LpNotice, LpNoticeReceipt).
- FR-LP-111 BUILT: CapitalCall, CapitalCallAllocation, CapitalCallPayment, CapitalEvent models exist.
- Not checked: 5B business-rules numeric formulas against code; run-time behaviour.
