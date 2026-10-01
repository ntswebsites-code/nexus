# ROLES & PERMISSIONS (from the 5B draft)

##### A. Role gating that exists in the Nexus LP UI today [O]

`lpRole` comes from the LP session (`GET /lp-portal/session` → `lpRole`: `VIEWER`, `SIGNATORY`, `MANAGER`; demo value `MANAGER`). The UI labels are: Organisation screen "Investor Admin" (MANAGER), "Signatory" (SIGNATORY), "Viewer" (VIEWER); the backend messages say "LP Manager access required" and "Authorised Signatory access required". The portal-kit gate only checks that the Nexus user holds some role whose `portal` is `investor`; it does not read the LP role.

| Screen and control | UI gate in code | Server gate in the reference backend | Consequence |
| --- | --- | --- | --- |
| Shell: all navigation items | none | `lp.portal.access` for every role | every role sees every page |
| Dashboard: all tiles, actions, documents panel | none | `lp.dashboard.view`, `lp.activity.view`, `lp.documents.*` | none |
| Performance: *Download Report* | none | `lp.performance.download_report` (all roles) | none |
| Account Activity: filters, export, detail | none | `lp.activity.view`, `lp.activity.export` (all roles) | none |
| Capital Activity: *Acknowledge*, *Upload payment confirmation* | `canWrite = lpRole !== "VIEWER"`; the controls are disabled for VIEWER and, because `lpRole` is `null` until the session loads, enabled while it loads | SIGNATORY or MANAGER | a VIEWER cannot start the action; a user who clicks during the session load receives 403 |
| Capital Activity: notice download, distribution download | none | `lp.capital_calls.download_notice`, `lp.distributions.download` (all roles) | none |
| Subscriptions & Redemptions: estimates | none | `lp.dealing.estimate` (all roles) | none |
| Subscriptions & Redemptions: *Review subscription*, *Review redemption* submit | none | `lp.dealing.subscribe` or `lp.dealing.redeem` (SIGNATORY or MANAGER) | a VIEWER sees enabled buttons and receives 403 "Authorised Signatory access required" |
| Documents: list, preview, download | none | `lp.documents.view`, `lp.documents.download` (all roles) | none |
| Notices: *Acknowledge* | none | SIGNATORY or MANAGER (`lp.notices.acknowledge`) | a VIEWER sees an enabled button and receives 403 |
| Requests: *New request* form submit, reply | none | SIGNATORY or MANAGER (`lp.requests.create`, `lp.messages.reply`) | a VIEWER receives 403 |
| Requests: *Add participant* (request to add a colleague) | disabled for VIEWER, title "Viewers cannot request participant changes" | creation requires SIGNATORY | partial gate |
| Messages: send reply | none | SIGNATORY or MANAGER | a VIEWER receives 403 |
| Organisation: *Invite User*, row actions menu (edit, revoke), bank-instruction *Request Change* | `canManage = lpRole === "MANAGER"`; a banner explains the restriction | colleagues: MANAGER only; bank-change submit: SIGNATORY or MANAGER (the UI is stricter) | SIGNATORY cannot submit a bank change although the server allows it |
| Settings: notification and display switches, MFA links | none | `lp.settings.view` (all roles edit their own preferences) | none |

##### B. Role labels and meaning

| LP role | UI label | Rights (reference backend) | Typical person |
| --- | --- | --- | --- |
| VIEWER | Viewer | read everything in scope; estimates; downloads; mark threads read; edit own settings | analyst, auditor, finance reader |
| SIGNATORY | Signatory (authorised signatory) | Viewer rights plus acknowledge calls and notices, upload payment confirmations, submit subscriptions and redemptions, create requests, reply to requests and threads, submit bank-instruction changes | authorised signatory of the investor |
| MANAGER | Investor Admin (administrator) | Signatory rights plus list, invite, change and revoke colleagues (not other managers, never grant MANAGER) | institutional investor administrator |

##### C. Where the LP model and the Nexus model differ (gaps)

1. LP roles form a ladder with fund scope per colleague; Nexus roles are functional sets (`admin`, `investment`, `finance`, `auditor`) with a four-value account scope that filters only investments and holdings. Documents, capital events, requests and threads are not filtered by scope in Nexus.
2. Nexus has no SIGNATORY rung. "May sign or confirm funding" is derived from role `admin` or `finance` (`SIGNING_ROLES`).
3. `lpRole` must be derived or stored per membership; the reference resolves it from the database on every request (never from the token), so a role change applies immediately.
4. The LP session needs `lpRole`; the Nexus session returns `roles[]` and `permissions[]` only.
5. Per-colleague data (MFA enabled, last active, status, fund ids) does not exist on `client_users`.
6. LP uses the first active membership only; Nexus allows `?client=<ref>` (Q-23). The LP shell has no client switcher.
7. MFA: LP policy `requireMfaForLp` forces nothing at sign-in by itself; Nexus `mfa_required` forces enrolment at sign-in for the admin and investor portals and offers a 5-minute step-up.
8. Staff impersonation (`?clientId=`) exists only in the reference; Nexus staff use the admin portal.
9. Staff gates: the reference uses role names (admin, fund_manager, cfo); Nexus uses permission codes.

##### D. Recommended mapping and decisions for Nexus

| Nexus role today | Maps to LP role | New permission codes needed |
| --- | --- | --- |
| admin (Investor Admin) | MANAGER | `capital.acknowledge`, `dealing.view`, `dealing.estimate`, `dealing.submit`, `notices.view`, `notices.acknowledge`, `requests.create`, `messages.reply`, `settings.view`, `users.manage` (update and revoke) |
| finance (Finance / Treasury) | SIGNATORY | same minus `users.manage` |
| investment (Investment Viewer) | VIEWER | `dealing.view`, `dealing.estimate`, `notices.view`, `settings.view` |
| auditor | VIEWER (narrower: no capital, requests, messages) | `notices.view`, `settings.view` |

- Q-154: Replace the four Nexus investor roles by VIEWER, SIGNATORY and MANAGER (migration of `user_roles` and `client_users.investor_role`), or keep the four roles and derive `lpRole` by the table above? — default: derive for the first release (no data migration), then converge on the three roles.
- Q-155: Is `fundIds` stored on `client_users` (JSON) or in a join table `client_user_funds`? — default: join table with a unique (membership, fund) key so that fund deletion and audits are relational.
- FR-LP-106: every LP route declares one permission code and one minimum role; the matrix in section E of the reference contract is the acceptance test — AC: for every route, a VIEWER session receives 403 on SIGNATORY routes and a SIGNATORY session receives 403 on MANAGER routes, with the same error body as other permission failures.
- FR-LP-107: the LP UI disables or hides every control whose server gate the current role fails, including *Acknowledge* (notices), submit buttons (dealing), reply and new request (requests, messages), and *Request Change* (bank instructions) for roles below SIGNATORY — AC: with a VIEWER session no write request is ever sent.
- FR-LP-108: while the LP session is loading, write controls are disabled (`lpRole` null is treated as no rights) — AC: no write control is enabled before `lpRole` is known.

##### E. Reference contract extract (roles, permission codes, matrix)

**E.1 LP roles and how they are derived**


| Item | Finding |
|---|---|
| Role values | `VIEWER`, `SIGNATORY`, `MANAGER` (column `lp_user_relations.lp_role` VARCHAR(16), default `VIEWER`). Aliases normalised on read: `LP_VIEWER` to VIEWER; `LP_MANAGER`, `ADMIN` to MANAGER; any other string to VIEWER. Writers do not always normalise (GP `POST /admin/memberships` and colleague invite store the raw string) |
| Labels in the Nexus LP UI | Organisation screen maps `MANAGER` to "Investor Admin", `SIGNATORY` to "Signatory", `VIEWER` to "Viewer"; backend messages say "LP Manager access required" and "Authorised Signatory access required". (The labels "authorised signatory" and "administrator" appear only in backend text and one UI help sentence; the badge labels are the three above) |
| Where `lpRole` comes from | **Not in the JWT.** JWT claims are `userId, roleId, roleName, email, firstName, lastName, department, roleCode, tokenVersion, aud (portal), exp 7d`. On every request `requireLpPortalAccess` calls `LpPortalAccessService.resolveAccess(userId)`: (1) first ACTIVE `lp_user_relations` row for the user, ordered by createdAt asc: gives `clientId`, `lpRole`, `membershipId`, `fundScope`; (2) else the legacy `clients.user_id` link when the client is ACTIVE: VIEWER, no fund scope; (3) else, for GP staff only, `?clientId=<id>` impersonation; (4) else 401 "No active LP portal access". `getSession` returns `lpRole` (`"VIEWER"` if null) |
| Multiple organisations | A user can have several membership rows (unique on user+client) but only the FIRST active one is ever used; there is no organisation switcher |
| Fund scope per colleague | `lp_user_relations.fund_ids` (JSON array of fund ids; null or empty array = all funds). `fundAllowed(ctx, fundId)` is true when no scope, else when the id is in the array. Applied by: session funds, dashboard, capital calls, distributions, ledger (per row), dealing (`assertFundAccess` gives 403 `LP_FORBIDDEN` "Not entitled to this fund"), performance, documents, notices, requests, threads. Not applied by: ledger entry detail (#21), vault list `fundId` filter, request replies, bank-account list rows of fundId null, `unreadCounts.messages` |
| Client scoping | Every query filters by `ctx.clientId`; rows of other clients return 404 (not 403). `assertClientActive` requires `clients.status = ACTIVE` (404 "LP profile not found", 403 "LP profile is not active") |
| Who may invite or change roles | LP MANAGER only (Gate M): may grant VIEWER or SIGNATORY, never MANAGER, filters granted `fundIds` to its own scope, cannot revoke a MANAGER. GP staff (`requireGpAdmin`) may grant any role (incl. MANAGER) and revoke any membership |
| Staff impersonation | Roles `admin`, `fund_manager`, `cfo`, `FUND_MGR`, `CFO` (roleCode or role name; `isGpStaff`) must pass `?clientId=` on every LP route (400 "GP staff must pass ?clientId= for LP portal impersonation" otherwise). Context: `isStaff:true`, `lpRole:null`, permissions = the full MANAGER set; all role gates pass. A staff user who also owns an active membership gets that membership instead (relation is resolved first) |
| Login gate | `POST /api/auth/login` with `portal:"lp"` requires `resolveLpAccess`: active membership, or active legacy client, or LP role code (`LIMITED_PARTNER`, `LP_VIEWER`, `LP_INSTITUTIONAL_MANAGER`), or GP staff. Staff portal refuses LP users. Invited colleagues are created with roleCode `LIMITED_PARTNER` and `mustChangePassword = true` |
| Revocation | Revoking a membership sets `isActive=false`, `revokedAt`, and increments `users.tokenVersion` (`authenticate` rejects tokens whose `tokenVersion` claim differs). Role or fund-scope edits need no token change because they are read per request |
| MFA (`requireMfaForLp`) | One global row `lp_portal_mfa_policy` id `default` (`requireMfaForLp` default false, `issuerName` default "Arcus LP Portal"), edited by SysAdmin via `PUT /admin/mfa-policy`. At login (portal lp) the user is challenged (`mfaRequired`, `mfaPendingToken` TTL 5 min, then `/auth/mfa/verify` with a TOTP or one of 8 backup codes, window +-1) **only when the policy is on AND the user already has an enabled TOTP**; a user without TOTP is never forced to enrol at login. Enrolment (`/auth/mfa/enroll`, `/auth/mfa/confirm-enrollment`) is voluntary. The only action that enforces enrolment is `POST /bank-instructions/changes` (403 `LP_MFA_REQUIRED`). There is no step-up (re-verification window) on any LP action; `lp.settings.manage_mfa` exists in the SIGNATORY set but no route uses it. `GET /settings` and `/settings/mfa` expose `requireMfaForLp, issuerName, enabled, enabledAt` |

**E.2 LP permission codes**


Defined in `middleware/lpPortalFoundation.ts` (`ROLE_PERMS`). Authorisation = permission code AND the route's role middleware (both are present on every route and agree, except where noted).

| Role | Permission codes |
|---|---|
| VIEWER (25) | `lp.portal.access`, `lp.portal.switch_fund`, `lp.portal.view_notifications`, `lp.dashboard.view`, `lp.investments.view`, `lp.commitment.view`, `lp.capital_account.view`, `lp.holdings.view`, `lp.capital_calls.view`, `lp.capital_calls.download_notice`, `lp.distributions.view`, `lp.distributions.download`, `lp.dealing.view`, `lp.dealing.estimate`, `lp.performance.view`, `lp.performance.download_report`, `lp.activity.view`, `lp.activity.export`, `lp.documents.view`, `lp.documents.download`, `lp.notices.view`, `lp.requests.view`, `lp.messages.view`, `lp.organisation.view`, `lp.settings.view` |
| SIGNATORY (VIEWER + 8) | `lp.capital_calls.acknowledge`, `lp.capital_calls.upload_payment_confirmation`, `lp.dealing.subscribe`, `lp.dealing.redeem`, `lp.notices.acknowledge`, `lp.requests.create`, `lp.messages.reply`, `lp.settings.manage_mfa` |
| MANAGER (SIGNATORY + 1) | `lp.organisation.manage_colleagues` |
| Staff impersonation | all MANAGER codes |

Codes defined but used by no route: `lp.portal.switch_fund`, `lp.investments.view`, `lp.commitment.view`, `lp.capital_account.view`, `lp.holdings.view`, `lp.settings.manage_mfa`. `lp.organisation.view` is (mis)used as the permission of the bank-instruction POST. Failure body for a missing code: 403 `LP_FORBIDDEN` "Missing permission <code>"; for a failed role gate: 403 `LP_FORBIDDEN` "Authorised Signatory access required" or "LP Manager access required".

Staff-side authorisation (not permission codes): `requireGpAdmin` (admin, fund_manager, cfo, FUND_MGR, CFO) on `/admin/requests*`, `/admin/notices`, `/admin/memberships*`, `/admin/documents`; `requireSysAdmin` (role "admin" only) on `/admin/mfa-policy`; shared secret or loopback on the cron route. Failure bodies are plain `{success:false,message}` ("GP Ops access required", "SysAdmin access required"). No staff action here has maker-checker, step-up or idempotency.

**E.3 Role by endpoint matrix**


Legend: Y = allowed; N = 403; S = staff impersonation allowed (needs `?clientId=`). Permission code in the last column.

| Endpoint group (UI methods) | VIEWER | SIGNATORY | MANAGER | Staff | Permission / gate |
|---|---|---|---|---|---|
| getSession, getRealtime, getJob | Y | Y | Y | S | `lp.portal.access` |
| getNotifications | Y | Y | Y | S | `lp.portal.view_notifications` |
| getDashboard, getDashboardActions | Y | Y | Y | S | `lp.dashboard.view` |
| getDashboardRecentActivity, getAccountActivity, getLedger, getLedgerEntry | Y | Y | Y | S | `lp.activity.view` |
| exportAccountActivity | Y | Y | Y | S | `lp.activity.export` |
| getCapitalCalls, getCapitalCall, getCapitalCallSummary, getCapitalCallDocuments | Y | Y | Y | S | `lp.capital_calls.view` |
| downloadCapitalCallNotice | Y | Y | Y | S | `lp.capital_calls.download_notice` |
| acknowledgeCapitalCall | N | Y | Y | S | `lp.capital_calls.acknowledge` + Gate S + Idem |
| uploadPaymentConfirmation | N | Y | Y | S | `lp.capital_calls.upload_payment_confirmation` + Gate S + Idem |
| getDistributions, getDistribution | Y | Y | Y | S | `lp.distributions.view` |
| downloadDistribution, downloadDistributionStatement | Y | Y | Y | S | `lp.distributions.download` |
| getDealingBankAccounts, getDealingOverview, getDealingRules, getDealingRequests, exportDealingRequests | Y | Y | Y | S | `lp.dealing.view` |
| estimateSubscription, estimateRedemption | Y | Y | Y | S | `lp.dealing.estimate` (creates a snapshot row) |
| submitSubscription | N | Y | Y | S | `lp.dealing.subscribe` + Gate S + Idem |
| submitRedemption | N | Y | Y | S | `lp.dealing.redeem` + Gate S + Idem |
| getPerformance, getPerformanceHistory, getPerformanceByFund, getPerformanceBenchmarks | Y | Y | Y | S | `lp.performance.view` |
| requestPerformanceReport, downloadPerformanceReport | Y | Y | Y | S | `lp.performance.download_report` (requestPerformanceReport also Idem) |
| getDocuments, getDocumentsSummary, getDocument, previewDocument, getVault, verifyVaultDocument, getReports | Y | Y | Y | S | `lp.documents.view` (getReports uses this code) |
| downloadDocument, downloadVaultDocument, downloadReport | Y | Y | Y | S | `lp.documents.download` |
| getNotices, getNotice | Y | Y | Y | S | `lp.notices.view` (getNotice marks the notice opened) |
| acknowledgeNotice | N | Y | Y | S | `lp.notices.acknowledge` + Gate S + Idem |
| getRequests, getRequest, attachment download (B1) | Y | Y | Y | S | `lp.requests.view` |
| createRequest, uploadRequestAttachment | N | Y | Y | S | `lp.requests.create` + Gate S (createRequest also Idem) |
| replyToRequest, replyToMessageThread | N | Y | Y | S | `lp.messages.reply` + Gate S |
| getMessages, getMessageThread, markMessageThreadRead | Y | Y | Y | S | `lp.messages.view` |
| getOrganisation | Y (colleagues list empty) | Y (empty) | Y (full) | S | `lp.organisation.view` |
| getBankInstructionChanges | Y | Y | Y | S | `lp.organisation.view` |
| submitBankInstructionChange | N | Y | Y | S | Gate S + `lp.organisation.view`; needs enabled MFA when policy is on; Idem |
| getColleagues, inviteColleague (Idem), updateColleague, revokeColleague | N | N | Y | S | `lp.organisation.manage_colleagues` + Gate M |
| getSettings, getMfaSettings, updateNotificationSettings, updateDisplaySettings | Y | Y | Y | S | `lp.settings.view` |
| `/admin/requests*`, `/admin/notices`, `/admin/memberships*`, `/admin/documents` | N | N | N | GP staff (`requireGpAdmin`), no `?clientId` | role-code check |
| `/admin/mfa-policy` | N | N | N | role "admin" only | `requireSysAdmin` |
| cron snapshot refresh | N | N | N | scheduler secret or loopback | `requireCronCaller` |

UI-side gating found in the Nexus LP UI: Capital & Activity screen `canWrite = lpRole !== "VIEWER"`; Organisation screen `canManage = lpRole === "MANAGER"`; Requests screen disables a control for VIEWER (title "Viewers cannot request participant changes"). This matches the backend gates (SIGNATORY+ for writes, MANAGER for colleagues). The UI invite dialog always sends `role:"VIEWER"` and `fundIds` = all the user's funds.

**E.4 Mapping to the Nexus investor roles and gaps**


Nexus investor model (from `role-catalog.json`, `backend-audit.md` 1.7/1.13, SRD 3.3): four portal roles in `user_roles`, each a set of permission codes; per-client membership `client_users` (`investorRole`, `accountScope` in all, managed, private, documents); `investorContext` picks the first membership or `?client=<ref>`; signing/funding evidence is allowed only for role admin or finance (the `canSign` flag); step-up MFA (SU, 5 minutes) exists for approvals, signing and bank-detail reveal; sessions are a cookie (`nexus_session`) with an origin guard.

| Nexus role (label) | Nexus permission codes | Closest LP role | Why |
|---|---|---|---|
| admin ("Investor Admin") | overview.view, investments.view, performance.view, capital.view, holdings.view, documents.view, requests.view, messages.view, profile.view, users.invite | MANAGER | only role with `users.invite`; superset of every read permission; can sign |
| finance ("Finance / Treasury") | overview.view, investments.view, capital.view, holdings.view, documents.view, requests.view, messages.view, profile.view | SIGNATORY | holds `capital.view` and may sign or submit funding evidence (the closest to acknowledge/upload confirmation), but lacks `performance.view` |
| investment ("Investment Viewer") | overview.view, investments.view, performance.view, holdings.view, documents.view, messages.view, profile.view | VIEWER | read only; no capital or requests |
| auditor | overview.view, investments.view, performance.view, holdings.view, documents.view, profile.view | VIEWER (narrower) | read only; no capital, requests or messages |

Proposed permission mapping (LP code to Nexus code) and what is missing:

| LP permission | Nearest Nexus code today | Gap |
|---|---|---|
| lp.portal.access | `PA(investor)` (some role in portal investor) + resolved client membership | none |
| lp.dashboard.view | overview.view | none |
| lp.activity.view, lp.activity.export | holdings.view (transactions) and capital.view | LP activity mixes calls, distributions, payments and dealing; needs one rule (suggest capital.view for call/distribution rows) |
| lp.capital_calls.view, download_notice; lp.distributions.view, download | capital.view | Nexus auditor and investment lack it, so they cannot see capital data that an LP VIEWER can |
| lp.capital_calls.acknowledge, lp.capital_calls.upload_payment_confirmation | capital.view + role admin or finance (funding-evidence rule) | acknowledge has no Nexus counterpart (no acknowledged state on capital events); needs a new `capital.acknowledge` |
| lp.dealing.* (view, estimate, subscribe, redeem) | none | no investor dealing module (no holdings positions API for units, NAV per unit, dealing rules, estimates, bank accounts); needs new codes `dealing.view`, `dealing.estimate`, `dealing.submit` |
| lp.performance.view, lp.performance.download_report | performance.view | no report-job concept; documents.view for the file |
| lp.documents.view, lp.documents.download | documents.view | Nexus documents are published per client; no per-document `permissions` list or access audit view |
| lp.notices.view, lp.notices.acknowledge | none | no notice entity with receipts (Nexus has notifications and document read marks); needs `notices.view`, `notices.acknowledge` |
| lp.requests.view, lp.requests.create | requests.view (also used for create and reply) | Nexus has no separate create right; LP VIEWER cannot create, so `requests.create` is needed; attachments are not linkable in Nexus (uploaded ids "are not consumed by any other endpoint") |
| lp.messages.view, lp.messages.reply | messages.view (also used for thread create and reply) | needs a reply right split from view to keep VIEWER read-only |
| lp.organisation.view | profile.view | LP organisation screen shows colleagues with fund scope, MFA state and last-active; Nexus `GET /users` has no such fields |
| lp.organisation.manage_colleagues | users.invite | Nexus can only invite (and staff delete); no investor-side update-role, update-scope or revoke endpoint |
| lp.settings.view, lp.settings.manage_mfa | none (profile.view at best) | no per-user notification or display preference store; MFA via `/api/auth/mfa/*` (different flow) |

Gaps in the Nexus model relative to the LP model:
1. **Per-colleague fund scope.** LP: `fundIds` array per membership (null = all funds), applied on nearly every query. Nexus: `accountScope` is one of four categories (all, managed, private, documents) applied only to investments and holdings, and "documents, capital events, requests and threads are not filtered by scope". No fund-id list exists on `client_users`.
2. **SIGNATORY as its own rung.** LP is a ladder (VIEWER < SIGNATORY < MANAGER, each a superset, with distinct write gates). Nexus roles are functional (finance, investment, auditor) and "may sign" is derived from admin or finance. No role is "read plus acknowledge and submit but cannot manage users".
3. **`lpRole` in the session.** Needs to be derived (admin to MANAGER, finance to SIGNATORY, investment/auditor to VIEWER) and returned by `getSession`; LP resolves it per request from the DB (not from the token), Nexus resolves permissions via the cookie session plus `investorContext`.
4. **Staff impersonation** (`?clientId=` for GP staff with full MANAGER permissions) has no Nexus counterpart (staff use the admin portal); decide whether to keep it (security-sensitive, no audit in the LP code).
5. **Colleague lifecycle.** LP MANAGER invites VIEWER/SIGNATORY only (never another MANAGER), edits role and fund scope, and revokes (not a MANAGER); revocation kills tokens. Nexus: `users.invite` may invite any of the four roles including admin; `DELETE /investor-users` is staff-only and "sessions are not revoked". Missing: investor-side PATCH and revoke, `status` ACTIVE/INVITED/SUSPENDED, `mfaEnabled`, `lastActiveAt` per colleague.
6. **Multi-organisation.** LP uses only the first membership (no switcher). Nexus supports `?client=<ref>`; keep the Nexus behaviour and add a switcher only if required.
7. **MFA policy.** LP: one global `requireMfaForLp` flag; challenge at login only for already-enrolled users; enrolment mandatory only for bank-instruction changes; no step-up. Nexus: `mfa_required` policy forces enrolment at login for admin and investor portals, plus 5-minute step-up (`SU`) on sign, approve and reveal. Map `requireMfaForLp` to the Nexus policy and bank-instruction changes to a step-up route; LP is weaker, so Nexus behaviour is a superset.
8. **Idempotency.** LP requires an `Idempotency-Key` on 9 write routes (list in NOTES); Nexus "Idempotency: Not implemented", so the store and middleware must be added.
9. **Staff-side authorisation style.** LP admin routes use role-code checks; Nexus uses permission codes (clients.view/edit, reports.create, cash.approve, admin.settings, documents.edit). Map: admin/memberships to clients.edit (existing `/investor-users`), admin/requests to clients.view and clients.edit (existing `/service-requests`), admin/documents to documents.edit plus publish approval (Nexus has maker-checker and a publish step; LP publishes immediately), admin/notices to a new code, admin/mfa-policy to admin.settings.
10. **Error and envelope.** Nexus errors are `{error:{code,message,details}}` with codes such as `permission_denied`, `no_client_access`; LP expects `error.code` values `LP_*`, `fieldErrors` and `retryable`. A translation or an extension of the Nexus error shape is needed (see NOTES).
11. **Reference data with no Nexus owner.** LP reads fund portal context (operating model, share class, valuation status), dealing rules, holdings positions (units, NAV per unit), bank accounts, compliance status, benchmark series, message threads from tables that, in NVCCZ, are filled only by seed scripts (`scripts/seed-lp-portal-srd-demo.ts`); no staff API creates them (not found in `src`). Nexus has published snapshots (investments, holdings, transactions, metrics) but none of these entities.
