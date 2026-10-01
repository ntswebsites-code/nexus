# 11.2 (from the backend draft)

### 11.2 Built endpoints **[O]**

Guard abbreviations:

| Abbreviation | Meaning |
| --- | --- |
| anon | No session |
| draft | Valid `X-Draft-Token` |
| session | Signed in, MFA complete |
| session~ | Signed in, MFA may be pending |
| portal(x) | User holds a role in portal x |
| perm(a) | Holds permission a |
| perm(a\|b) | Holds either a or b |
| step-up | TOTP verified within 5 minutes (when the user has a factor or MFA is required) |
| inv(c) | Investor membership of a client whose investor role grants c |
| co | Company membership |
| sig | HMAC-signed URL |

Conventions that apply to every table below:
- `version` in a request body and `If-Match` are optional; when either is sent and does not match, the response is 409 `version_conflict`.
- Lists return `{data, total}`, capped at 200–500 rows, with no pagination.
- Download URL routes return `{url, expiresIn: 300}` (KYC returns `expiresAt`).

**Health and auth** (`/api`)

| Method | Path | Guard | Request | Response | Errors |
| --- | --- | --- | --- | --- | --- |
| GET | /api/health | anon | `?deep=1` | `{status, service, environment, uptimeSeconds, timestamp, database?}` | 503 `degraded` (database down) |
| POST | /api/auth/register | anon, rate limit | email (≤254, lowercased), password (10–128), name? (1–120) | 201 `{user}` (no session) | 403 registration_disabled, 409 email_taken, 400 |
| POST | /api/auth/login | anon, rate limit | email, password (1–128), portal? (admin\|investor\|onboarding\|company) | `{user, mfa?: verify\|enroll}` plus session cookie | 401 invalid_credentials, 403 portal_access_denied, 429 |
| POST | /api/auth/logout | anon (reads cookie) | — | `{ok}` | — |
| GET | /api/auth/me | session | — | `{user: {id, email, name, roles[], permissions[], createdAt}}` | 401 unauthorized / mfa_required |
| POST | /api/auth/mfa/enroll | session~, rate limit | — | `{secret, otpauthUri}` | 409 mfa_already_enrolled |
| POST | /api/auth/mfa/verify | session~, rate limit | code (6 digits) | `{user}`; session verified | 401 invalid_mfa_code |
| POST | /api/auth/mfa/step-up | session, rate limit | code | `{ok, validForSeconds: 300}` | 401 invalid_mfa_code |
| GET | /api/auth/mfa/status | session | — | `{enrolled, enrolledAt}` | — |
| POST | /api/auth/password/forgot | anon, rate limit | email, portal? | `{ok}` (always) | — |
| POST | /api/auth/password/reset | anon, rate limit | token (20–200), password (10–128) | `{ok}`; all sessions revoked | 400 invalid/expired |
| GET | /api/auth/invitations/:token | anon, rate limit | — | `{email, name, portal, existingAccount, expiresAt}` | 404 |
| POST | /api/auth/invitations/accept | anon, rate limit | token, name? (1–120), password (10–128) | `{user}` plus session cookie | 404, 401 invalid_credentials (existing account) |

The same eight MFA/password/invitation routes are also mounted under `/api/v1/auth/*`.

**Files and notifications** (`/api/v1`)

| Method | Path | Guard | Request | Response | Errors |
| --- | --- | --- | --- | --- | --- |
| POST | /uploads | session | multipart `file` ×1–10 | 201 `{files: [{id, name, size, mime, sha256}]}` | 400 type not accepted, 413 |
| GET | /files/:id/download | sig | exp, sig | File bytes (attachment, no-store) | 403 invalid_signature, 404 |
| GET | /notifications | session | — | `{items (50), unread}` | — |
| POST | /notifications/:id/read | session | — | `{ok}` | — |
| POST | /notifications/read-all | session | — | `{ok}` | — |

**Public onboarding** (`/api/v1/public`; every route rate-limited)

| Method | Path | Guard | Request | Response | Errors |
| --- | --- | --- | --- | --- | --- |
| POST | /applications | anon (20 per hour per IP) | email, applicantType? (≤64), name? (≤200), sendLink (default true) | 201 `{id, token}` | 400, 429 |
| GET | /applications/:id | draft (submitted allowed) | `?verified=1` | `{application: {id, ref, status, email, form, taxIdOnFile, owners, evidence[], requiredSlots, requestedSlots, caseStage}}` | 404 |
| PATCH | /applications/:id | draft (Draft only) | form: map of strings (≤4000 each); owners?: ≤20 × [name, id, pct] | `{ok, savedAt}` | 404, 409 already_submitted |
| POST | /applications/:id/evidence | draft (Draft, or case in ClientAction) | multipart `file` plus slot (doc1–doc8) | 201 `{slot, label, name, size, mime}` | 400, 409, 413 |
| POST | /applications/:id/submit | draft (Draft only) | consent: true, form? | `{ref, status: Submitted, screening: Queued}` | 400 incomplete_application `{fields[], evidence[]}` |

**KYC** (`/api/v1/kyc`; session + portal(admin))

| Method | Path | Guard | Request | Response | Errors |
| --- | --- | --- | --- | --- | --- |
| GET | /cases | perm(onboarding.view) | stage?, risk?, q? (≤120) | `{data: CaseSummary[], total}` | — |
| GET | /cases/legacy | perm(onboarding.view) | — | `{data}` (prototype shape) | — |
| GET | /cases/:id (uuid, KYC- or ONB- ref) | perm(onboarding.view) | — | `{case: CaseDetail}` | 404 |
| POST | /cases | perm(onboarding.manage) | applicantType (1–64), legalName (1–200), email, phone? (≤40), country? (≤80), expectedInvestment? (≥0) | 201 `{case}` | 400 |
| POST | /cases/:id/advance | perm(onboarding.manage) | toStage, reason? (≤2000), version? | `{case}` | 409 invalid_transition / version_conflict |
| POST | /cases/:id/request-evidence | perm(onboarding.manage) | slots[] (doc1–8), message (1–4000) | `{case}` | 409 invalid_transition |
| POST | /cases/:id/messages | perm(onboarding.manage) | message (1–4000), topic? (≤80) | `{ok}` | — |
| POST | /cases/:id/screening/refresh | perm(onboarding.manage) | — | 202 `{ok}` | 409 |
| POST | /cases/:id/evidence/:slot/review | perm(onboarding.manage) | status (Accepted\|Rejected), note? (≤1000) | `{case}` | 404 |
| GET | /cases/:id/evidence/:slot/download-url | perm(onboarding.view) | — | `{url, expiresAt}` | 404 |
| POST | /cases/:id/decision | perm(onboarding.manage) + compliance role + step-up | decision (approve\|reject\|enhanced_review), reason (5–4000), version? | `{case}` | 403 compliance_role_required, 401 step_up_required, 409 sod_violation / approval_blocked / invalid_transition / version_conflict |
| POST | /cases/:id/activate | perm(onboarding.manage) | — | `{clientId, clientRef, mandateRef, accountRef, case}` | 409 invalid_transition / activation_blocked |

**Clients, cash accounts, investor access** (`/api/v1`; session + portal(admin))

| Method | Path | Guard | Request | Response | Errors |
| --- | --- | --- | --- | --- | --- |
| GET | /clients | perm(clients.view) | q?, risk?, kyc? | `{data: Client[], total}` | — |
| POST | /clients | perm(clients.edit) | name (1–200), type (1–64), ccy (3, default USD), risk (Low\|Medium\|High), mandate?, owner?, email?, phone?, registration?, address? (≤255), notes? (≤4000), kyc? | 201 `{client}` | 400 |
| PATCH | /clients/:id | perm(clients.edit) | Same fields, all optional, plus version? | `{client}` | 404, 409 |
| GET | /clients/:id/360 | perm(clients.view) | — | `{client, mandates, cashAccounts, kycCases, documents, requests, portalUsers, pendingInvitations}` | 404 |
| GET | /clients/:id/mandates | perm(clients.view) | — | `{data}` | 404 |
| POST | /clients/:id/mandates | perm(clients.edit) | name (1–160), type (discretionary\|cis\|private_markets\|treasury\|advisory) | 201 `{mandate}` | — |
| GET | /cash-accounts | perm(cash.view\|clients.view) | — | `{data (masked), total}` | — |
| POST | /cash-accounts | perm(clients.edit) | clientId, provider (1–120), identifier (2–64), currency (3), portfolio?, type (default CLIENT_BANK), ownership (SEGREGATED\|OMNIBUS\|HYBRID) | 201 `{account}` (DRAFT) | 404 |
| POST | /cash-accounts/:id/{submit\|approve\|return\|suspend\|reactivate\|close} | Per 7.6a (checked in handler) | reason? (≤2000; required for return), version? | `{account}` | 403, 409 invalid_transition / sod_violation / version_conflict |
| POST | /cash-accounts/:id/reveal-identifier | perm(cash.approve) + step-up | — | `{identifier}` | 401, 403 |
| GET | /investor-users | perm(clients.view) | clientId? | `{data: members, invitations}` | — |
| POST | /investor-users | perm(clients.edit) | clientId, email, name?, role (admin\|investment\|finance\|auditor), scope (≤32) | 201 `{invitation}` | 404 |
| DELETE | /investor-users/:id (membership or invitation id) | perm(clients.edit) | — | `{ok}` | 404 |

**Investor services, staff** (`/api/v1`; session + portal(admin))

| Method | Path | Guard | Request | Response | Errors |
| --- | --- | --- | --- | --- | --- |
| GET | /capital-events | perm(cash.view\|clients.view) | clientId?, status? | `{data, total}` | — |
| POST | /capital-events | perm(clients.edit\|cash.journal.create) | clientId, investment (1–160), type (Capital call\|Distribution\|Contribution\|Withdrawal), amount (>0), currency (3), due (date), purpose? (≤2000), breakdown (≤20 × [label, amount], must sum to amount), bank? (≤255) | 201 `{capital}` | 400 |
| POST | /capital-events/allocate | perm(clients.edit\|cash.journal.create) | Same as create, minus clientId and breakdown | 201 `{refs[], investors}` | 400 no holders |
| POST | /capital-events/:id/approve | perm(cash.approve) + step-up | version? | `{capital}` | 403 sod_violation, 409 invalid_state |
| POST | /capital-events/:id/publish | perm(clients.edit\|cash.approve) | — | `{capital}` | 409 |
| POST | /capital-events/:id/settle | perm(cash.approve\|cash.journal.approve) + step-up | — | `{capital}` | 403 sod_violation, 409 |
| GET | /capital-events/:id/evidence/:evidenceId/download-url | perm(cash.view\|clients.view) | — | `{url, expiresIn}` | 404 |
| GET | /snapshots | perm(reports.view) | clientId? | `{data}` | — |
| GET | /snapshots/:id | perm(reports.view) | — | `{snapshot}` | 404 |
| POST | /snapshots | perm(reports.create) | clientId, valuationDate, reportingCurrency, fx, metrics, activity?, investments ≤200, holdings ≤2000, transactions ≤5000, performance, benchmark, allocation ≤50 | 201 `{snapshot: {id, status}}` | 400 |
| POST | /snapshots/:id/publish | perm(reports.create) + step-up | version? | `{ok}` | 403 sod_violation, 409 |
| GET | /service-requests | perm(clients.view) | clientId?, status? | `{data (with breached flag)}` | — |
| POST | /service-requests | perm(clients.edit) | clientId, type (1–64), priority, detail (1–4000), due? | 201 `{request}` | — |
| PATCH | /service-requests/:ref | perm(clients.edit) | status?, owner? (≤120), progress? (0–100), note? (≤4000), version? | `{request}` | 404, 409 |
| GET | /message-threads | perm(clients.view) | clientId? | `{data}` | — |
| POST | /message-threads | perm(clients.edit) | clientId, title (1–200), text (1–4000) | 201 `{thread}` | — |
| POST | /message-threads/:id/read | perm(clients.view) | — | `{ok}` | 404 |
| POST | /message-threads/:id/messages | perm(clients.edit) | text (1–4000) | `{thread}` | 404 |

**Documents** (`/api/v1/documents`; session + portal(admin))

| Method | Path | Guard | Request | Response | Errors |
| --- | --- | --- | --- | --- | --- |
| GET | / | perm(documents.view) | q?, status?, clientId? | `{data, total}` | — |
| GET | /:id | perm(documents.view) | — | `{document}` | 404 |
| POST | / | perm(documents.edit) | multipart `file` plus name (1–255), type (13 values), label?, classification (Public\|Client\|Internal\|Restricted), clientId?, relatedLabel?, documentDate?, requiresSignature, retentionYears (1–50) | 201 `{document}` (Draft) | 400, 413 |
| POST | /:id/versions | perm(documents.edit) | multipart `file` | `{document}` (back to Draft) | 409 |
| POST | /:id/submit | perm(documents.edit) | version? | `{document}` | 409 |
| POST | /:id/approve | perm(documents.edit) + step-up | version? | `{document}` | 403 sod_violation, 409 |
| POST | /:id/return | perm(documents.edit) | reason (3–1000) | `{document}` | 409 |
| POST | /:id/publish | perm(documents.edit) | clientIds? (≤500), signatureDueDate? | `{document}` | 400, 409 |
| POST | /:id/withdraw | perm(documents.edit) | clientId?, reason (3–1000) | `{document}` | — |
| GET | /:id/download-url | perm(documents.view) (Restricted: audit.view or maker) | version? | `{url, expiresIn}` | 403, 404 |

**Admin** (`/api/v1/admin`; session + portal(admin))

| Method | Path | Guard | Request | Response | Errors |
| --- | --- | --- | --- | --- | --- |
| GET | /access-context | session + portal(admin) | — | `{role, roles, permissions, roleLabels, rolePermissions}` | — |
| GET | /users | perm(admin.rbac) | — | `{data: staff users + pending invitations}` | — |
| POST | /users | perm(admin.rbac) + step-up | name (1–120), email, role (key) | 201 `{data}` (invitation sent) | 400, 409 already_member |
| PUT | /users/:id/roles | perm(admin.rbac) + step-up | roles: 1–10 keys | `{data}` | 404, 409 self_lockout / last_admin |
| PATCH | /users/:id | perm(admin.rbac) + step-up | isActive | `{data}` | 409 self_lockout |
| POST | /users/:id/mfa-reset | perm(admin.rbac) + step-up | reason (3–500) | `{data}` | 409 self_reset |
| GET | /roles | perm(admin.rbac) | — | `{data: [{key, label, locked, custom, users, permissions}]}` | — |
| GET | /permissions | perm(admin.rbac) | — | `{data: codes, protected: monetary codes}` | — |
| POST | /roles | perm(admin.rbac) + step-up | label (2–120), template (default blank) | 201 `{role}` | 400 |
| PUT | /roles/:key/permissions | perm(admin.rbac) + step-up | permissions ≤200 (pattern `a.b`) | `{role}` | 403 role_locked, 409 self_lockout |
| GET | /policy | session + portal(admin) | — | `{orderApproval, cashApproval, navApproval, bankApproval, sessionTimeout, mfa, policies}` | — |
| PUT | /policy | perm(admin.rbac) + step-up | orderApproval?, cashApproval? (independent\|threshold), navApproval?, bankApproval?, sessionTimeout? (5–240), mfa?, policies? {document_approval, client_publish_approval, kyc_dual_control} | Same shape as GET | — |
| GET | /sod-scan | perm(admin.rbac) | — | `{findings[], blocking, scannedAt}` | — |
| GET | /access-review.csv | perm(admin.rbac) | — | CSV | — |
| GET | /settings | session + portal(admin) | — | `{settings, updatedAt}` | — |
| PUT | /settings | perm(admin.settings) | settings: map of scalar values | `{settings, updatedAt}` | — |
| GET | /audit-events | perm(audit.view) | q?, actor?, action? (prefix), objectType?, objectId?, portal?, from?, to?, before? (cursor), limit (1–500, default 100) | `{data, nextBefore}` | — |
| GET | /audit-events.csv | perm(audit.view) | Same filters (≤10,000 rows) | CSV with hash column | — |
| GET | /audit-events/verify | perm(audit.view) | — | `{checked, brokenAt}` | — |

**Company portal** (`/api/v1/company`; session + co)

| Method | Path | Guard | Request | Response | Errors |
| --- | --- | --- | --- | --- | --- |
| GET | /workspace | co | — | `{company, periods, kpiDefs, covenants, cashRunway, volumeSeries, threads, history, activity, deadlines, library, currentPeriod, user}` | 403 no_company_access |
| GET | /periods/:period (YYYY-MM) | co | — | `{period}` | 404 |
| POST | /periods/:period/items/:key/files | co | multipart `files` ×≤10 (extension must be in the item's accept list) | 201 `{period}` | 400, 404, 409 |
| DELETE | /periods/:period/items/:key/files/:id | co | — | `{period}` | 404, 409 |
| GET | /periods/:period/files/:id/download-url | co | — | `{url, expiresIn, name}` | 404 |
| PUT | /periods/:period | co | kpis? (map to number or ''), notes? (≤10,000), version? | `{period}` | 409 |
| POST | /periods/:period/submit | co | Same as PUT | `{period}` | 400 still needed, 409 |
| POST | /questions/:ref/messages | co | text (1–5000) | `{thread}` | 404, 409 |
| POST | /questions/:ref/resolve | co | — | `{thread}` | 404 |
| GET | /library/:ref/download-url | co | — | `{url, expiresIn, name}` | 404 |

**Private markets review** (`/api/v1/private-markets`; session + portal(admin))

| Method | Path | Guard | Request | Response | Errors |
| --- | --- | --- | --- | --- | --- |
| GET | /companies | perm(portfolio.view) | — | `{data}` | — |
| GET | /reporting-packs | perm(portfolio.view) | status? (default submitted, or all) | `{data}` | — |
| GET | /companies/:ref | perm(portfolio.view) | — | Workspace plus periodDetails | 404 |
| POST | /companies/:ref/periods | perm(research.edit) | period (YYYY-MM), due (date) | 201 `{period}` | 409 duplicate |
| POST | /reporting-packs/:id/accept | perm(research.edit) | note? (≤5000) | `{period}` | 403 sod_violation, 409 |
| POST | /reporting-packs/:id/return | perm(research.edit) | note (required) | `{period}` | 400, 403, 409 |
| GET | /reporting-packs/:id/files/:fileId/download-url | perm(portfolio.view) | — | `{url, expiresIn, name}` | 404 |
| POST | /companies/:ref/questions | perm(research.edit) | title (1–200), text (1–5000), period?, role? | 201 `{thread}` | 404 |
| POST | /questions/:ref/messages | perm(research.edit) | text (1–5000) | `{thread}` | 409 |
| POST | /questions/:ref/resolve | perm(research.edit) | — | `{thread}` | 404 |
| PATCH | /companies/:ref/covenants/:key | perm(research.edit) | actual?, headroom? (≤40), evidence? (current\|expiring), note? (≤255) | `{covenant}` | 404 |
| POST | /companies/:ref/users | perm(research.edit) | name (1–120), email | 201 `{ok}` | 409 already_member |

**Investor portal** (`/api/v1/investor`; session + portal(investor) + membership; `?client=<ref>` selects among memberships)

| Method | Path | Guard | Request | Response | Errors |
| --- | --- | --- | --- | --- | --- |
| GET | /bootstrap | membership | — | Client, relationships, role, scope, permissions, canSign, snapshot data, capital, documents, requests, threads, portalUsers, bankInstruction (each section gated by permission) | 403 no_client_access |
| GET | /overview | inv(overview.view) | — | `{valuationDate, metrics, activity}` | 403 |
| GET | /investments | inv(investments.view) | — | `{data}` (scope-filtered) | 403 |
| GET | /performance | inv(performance.view) | — | `{sets, bench, allocation}` | 403 |
| GET | /holdings | inv(holdings.view) | — | `{data, transactions}` | 403 |
| GET | /capital-events | inv(capital.view) | — | `{data}` | 403 |
| GET | /documents | inv(documents.view) | — | `{data}` | 403 |
| GET | /requests | inv(requests.view) | — | `{data}` | 403 |
| GET | /threads | inv(messages.view) | — | `{data}` | 403 |
| GET | /users | membership | — | `{data}` | — |
| GET | /bank-instructions | inv(capital.view) or role admin | — | `{instruction}` | 403 |
| POST | /capital-events/:ref/funding-evidence | inv(capital.view), role admin or finance | multipart `file` plus confirm=true | `{capital}` | 400, 403, 404, 409 invalid_state |
| POST | /documents/:ref/read | inv(documents.view) | — | `{ok}` | 404 |
| GET | /documents/:ref/download-url | inv(documents.view) | — | `{url, expiresIn, name}` | 404 |
| POST | /documents/:ref/sign | step-up, role admin or finance | name (1–120), authority (1–160), consent: true | `{ok}` | 401, 403, 404, 409 |
| POST | /requests | inv(requests.view) | type (7 values), priority (Normal\|Time sensitive), detail (1–4000), title? (≤200), optional `file` | 201 `{request}` | 400 |
| POST | /profile-change-requests | inv(profile.view) | detail (1–4000), field? (≤80) | 201 `{request}` | — |
| POST | /requests/:ref/reply | inv(requests.view) | text (1–4000) | `{request}` | 404 |
| POST | /threads | inv(messages.view) | title (1–200), text? (≤4000) | 201 `{thread}` | — |
| POST | /threads/:id/messages | inv(messages.view) | text (1–4000) | `{thread}` | 404 |
| POST | /threads/:id/read | membership | — | `{ok}` | 404 |
| POST | /users/invite | inv(users.invite) | name (1–120), email, role (key or label), scope (all\|managed\|private\|documents) | 201 `{data}` | 409 already_member |
