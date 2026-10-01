# 11.3-RECONCILE (from the backend draft)

**Identity and admin**

| Proposed row | Status | Actual path / difference |
| --- | --- | --- |
| POST /api/auth/mfa/enroll, /verify | Exists-as | Plus /mfa/step-up and /mfa/status |
| POST /api/auth/password/forgot, /reset | Exists-differently | Forgot returns 200, not 202 |
| POST /api/auth/invitations/{token}/accept | Exists-differently | POST /api/auth/invitations/accept (token in body) plus GET /api/auth/invitations/:token |
| GET/DELETE /api/auth/sessions[/{id}] | Not started | — |
| GET/POST/PATCH /api/v1/admin/users[/{id}] | Exists-differently | No GET by id; POST sends an invitation; PATCH `{isActive}` only; plus POST /users/:id/mfa-reset |
| PUT /api/v1/admin/users/{id}/roles | Exists-differently | Body `{roles: [key]}`; no `confirm` flag (step-up instead) |
| GET/POST/PATCH /api/v1/admin/roles[/{id}] | Exists-differently | GET, POST; PUT /roles/:key/permissions instead of PATCH |
| GET /api/v1/admin/permissions | Exists-differently | Returns codes in use, not a catalogue |
| GET/PUT /api/v1/admin/policy | Exists-differently | GET needs no permission; PUT adds step-up |
| GET /api/v1/admin/sod-scan | Exists-as | — |
| GET /api/v1/admin/access-review.csv | Exists-as | — |
| GET/PUT /api/v1/admin/settings | Exists-differently | GET needs no permission |
| GET/PUT /api/v1/users/me/saved-views, /notification-preferences | Not started | — |
| GET/POST /api/v1/notifications, /{id}/read | Exists-as | Plus /read-all |
| GET /api/v1/search | Not started | — |
| GET /api/v1/audit-events | Exists-differently | /api/v1/admin/audit-events (+ .csv, /verify) |
| GET /api/v1/jobs/{id} | Not started | — |

**Onboarding and KYC**

| Proposed row | Status | Actual path / difference |
| --- | --- | --- |
| POST /api/v1/public/applications | Exists-differently | 201 `{id, token}`; no captcha |
| GET/PATCH /api/v1/public/applications/{id} | Exists-as | — |
| POST …/evidence | Exists-differently | Multipart file plus slot (no uploadId) |
| POST …/submit | Exists-as | — |
| GET /api/v1/kyc/cases | Exists-differently | No `sla` filter; plus /cases/legacy |
| GET /api/v1/kyc/cases/{id} | Exists-as | — |
| POST /api/v1/kyc/cases | Exists-as | — |
| POST …/advance | Exists-as | — |
| POST …/request-evidence | Exists-as | — |
| POST …/decision | Exists-as | Plus step-up |
| POST …/activate | Exists-as | — |
| POST /api/v1/webhooks/screening | Not started | — |

**Clients and cash accounts**

| Proposed row | Status | Actual path / difference |
| --- | --- | --- |
| GET/POST/PATCH /api/v1/clients[/{id}] | Exists-differently | No GET by id |
| GET /api/v1/clients/{id}/360 | Exists-as | — |
| GET/POST /api/v1/clients/{id}/mandates | Exists-as | — |
| GET/POST/PATCH /api/v1/cash-accounts[/{id}] | Exists-differently | No GET by id, no PATCH |
| POST /api/v1/cash-accounts/{id}/{action} | Exists-differently | No step-up; submit also allowed with cash.approve |
| POST /api/v1/cash-accounts/{id}/reveal-identifier | Exists-as | — |

**Portfolio, IBOR, construction, private markets, research, risk, performance**

| Proposed row | Status |
| --- | --- |
| /dashboard/summary | Not started |
| /portfolios | Not started |
| /ibor/positions | Not started |
| /ibor/settlement-ladder | Not started |
| /ibor/refresh | Not started |
| /construction/scenarios (all) | Not started |
| /construction/scenarios/{id}/optimise | Not started |
| /construction/scenarios/{id}/promote | Not started |
| /private/* | Not started |
| /securities | Not started |
| /research/issuers | Not started |
| /research/cases | Not started |
| /risk/scenarios | Not started |
| /risk/limits | Not started |
| /risk/breaches | Not started |
| /risk/cases | Not started |
| /performance/returns, /attribution | Not started |
| /performance/periods/{id}/lock | Not started |

**Orders, cash, operations and later modules**

| Proposed rows | Status |
| --- | --- |
| Orders: all rows | Not started |
| Cash: all rows | Not started |
| Operations, recon, corporate actions, NAV, accounting, financing, regulatory: all rows | Not started |

**Documents, reports, investor services**

| Proposed row | Status | Actual path / difference |
| --- | --- | --- |
| POST /api/v1/uploads | Exists-differently | Direct multipart upload; returned ids are not consumed anywhere |
| /api/v1/documents[/{id}], /versions, /download-url | Exists-differently | No PATCH; plus submit/approve/return/publish/withdraw |
| /api/v1/reports… | Not started | — |
| /api/v1/report-templates | Not started | — |
| /api/v1/report-schedules | Not started | — |
| /api/v1/capital-events + approve/publish/match | Exists-differently | `/settle` instead of `/match`; plus `/allocate`; different permissions (see 11.2) |
| /api/v1/publications | Not started | Via POST /documents/:id/publish |
| /api/v1/investor-users | Exists-as | — |
| /api/v1/service-requests | Exists-differently | Writes need clients.edit |
| /api/v1/threads (staff) | Exists-differently | /api/v1/message-threads |

**Investor portal**

| Proposed row | Status | Actual path / difference |
| --- | --- | --- |
| /investor/overview | Exists-differently | No `currency` parameter |
| /investor/investments | Exists-as | — |
| /investor/performance | Exists-differently | No parameters |
| /investor/capital-events | Exists-differently | No filters |
| /investor/capital-events/{id}/funding-evidence | Exists-differently | By ref; multipart file plus confirm |
| /investor/bank-instructions | Exists-as | — |
| /investor/holdings, /transactions | Exists-differently | /holdings returns both |
| /investor/documents, /download-url, /bulk-download | Exists-differently | No filters, no bulk-download; plus /read |
| /investor/documents/{id}/sign | Exists-differently | Body `{name, authority, consent}` |
| /investor/requests | Exists-as | Plus /reply |
| /investor/threads, /messages | Exists-as | Plus /read |
| /investor/profile | Not started | Data comes from /bootstrap |
| /investor/profile/change-requests | Exists-differently | /investor/profile-change-requests |
| /investor/users | Exists-differently | Invite is POST /users/invite |

**Company portal and staff review**

| Proposed row | Status | Actual path / difference |
| --- | --- | --- |
| /company/companies | Not started | Replaced by /company/workspace |
| /company/companies/{id}/periods/current | Exists-differently | /company/workspace (currentPeriod) and /company/periods/:period |
| /company/periods/{id}/items/{key}/draft | Exists-differently | POST/DELETE …/items/:key/files and PUT /company/periods/:period |
| /company/periods/{id}/submit | Exists-as | — |
| /company/periods/{id}/questions | Exists-differently | /company/questions/:ref/{messages,resolve} |
| Admin /companies/{id}/periods, accept/return, questions | Exists-differently | /api/v1/private-markets/*; writes need research.edit |

**Platform**

| Proposed rows | Status |
| --- | --- |
| /integrations | Not started |
| /data-quality | Not started |
| /models | Not started |
| /copilot | Not started |
