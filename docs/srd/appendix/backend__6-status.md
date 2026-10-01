# 6-STATUS (from the backend draft)

Build status of every existing requirement ID. Format: `ID | Build | note`.

**6.1 AUTH**

FR-AUTH-001 | Built | Login sets the session cookie; the portal login form redirects to a same-site `next` path.
FR-AUTH-002 | Built | Unknown email, wrong password and disabled account all return 401 `invalid_credentials`; a dummy bcrypt compare equalises timing (not measured).
FR-AUTH-003 | Built | 403 `portal_access_denied` is returned before any session is created; company and onboarding logins skip the portal check because those portals have no roles.
FR-AUTH-004 | Built | bcrypt with cost 12 by default (configurable 10–15); password hashes are never selected into responses.
FR-AUTH-005 | Partial | Minimum 10 characters is enforced; there is no breached-password check.
FR-AUTH-006 | Built | Logout deletes the session row and clears the cookie.
FR-AUTH-007 | Built | `/me` returns the `AuthUser` fields only.
FR-AUTH-008 | Built | Login and register allow 20 per 15 min per IP in production; the identity endpoints allow 30 per 15 min.
FR-AUTH-009 | Partial | Redirect to `/login?next=` works but is opt-in per portal via `REQUIRE_AUTH_PORTALS`; custodian has no gate.
FR-AUTH-010 | Partial | TOTP enrol and verify are built, and a pending session can call only the MFA routes; MFA is not mandatory by default (`mfa_required=false`).
FR-AUTH-011 | Contradicted | Step-up exists (5-minute window) but returns 401, not 403; it is missing on cash-account approve, document publish, capital publish and KYC activate, and is skipped for users with no factor.
FR-AUTH-012 | Built | Idle timeout = the policy value (default 30 min) capped by the `SESSION_IDLE_MINUTES` ceiling; absolute timeout is `SESSION_TTL_HOURS` (default 12 h).
FR-AUTH-013 | Contradicted | Single-use token, reuse returns 400 and all sessions are revoked, but the TTL is 60 min (SRD: 30) and forgot returns 200 (SRD: 202).
FR-AUTH-014 | Built | Self-registration is off by default in production; `POST /auth/register` returns 403 `registration_disabled`.
FR-AUTH-015 | Contradicted | Invitations are single use and set the password, but are valid 7 days (SRD: 72 h) and do not set up MFA; acceptance creates a fully verified session.
FR-AUTH-016 | Not started | No account lockout.
FR-AUTH-017 | Not started | No session list or revoke endpoint.

**6.2 RBAC**

FR-RBAC-001 | Partial | Every route checks portal access plus a permission or scope; read-only `GET /admin/policy`, `GET /admin/settings`, `GET /admin/access-context` and `GET /investor/users` check portal membership only.
FR-RBAC-002 | Built | Users are created by invitation and roles are replaced via `PUT /admin/users/{id}/roles`; the change takes effect on the next request and is audited.
FR-RBAC-003 | Contradicted | The `system_admin` bundle is locked, but the API returns 403 `role_locked`, not 409.
FR-RBAC-004 | Built | Custom roles can be created blank or from a template; the key is a unique slug of the label.
FR-RBAC-005 | Partial | All toggles are stored; cash, document, publish, KYC dual control, session and MFA are enforced; NAV and bank approval are stored only; order approval has nothing to enforce yet.
FR-RBAC-006 | Built | The SoD scan flags relaxed order/cash/document approval, more than 2 system admins, monetary permissions on system_admin, admin.rbac combined with money movement, and privileged users without MFA.
FR-RBAC-007 | Built | CSV of admin users with roles, permissions, active flag, MFA and last sign-in; the export is audited.
FR-RBAC-008 | Partial | Preview exists only in the prototype UI; there is no API and it is not audited.

**6.3 ONB**

FR-ONB-001 | Partial | The API persists every wizard field (tax ID encrypted); the running onboarding UI does not call it.
FR-ONB-002 | Partial | The API supports auto-save and a 30-day `?resume=` link that marks the email verified; the running UI does not use it.
FR-ONB-003 | Partial | Files are encrypted at rest and checked against a type allow-list; no malware scan.
FR-ONB-004 | Built | Individuals need doc1–doc3, other types doc1–doc4; missing items return 400 `incomplete_application` with the list.
FR-ONB-005 | Built | `consent` must be literally `true`.
FR-ONB-006 | Built | Submission creates the ONB- reference and the KYC case in one transaction.
FR-ONB-007 | Partial | Pre-screen is queued via the outbox and run by a stub provider; the case starts at Screening and moves to ComplianceReview automatically.
FR-ONB-008 | Built | Assisted onboarding via `POST /kyc/cases` with channel Assisted.
FR-ONB-009 | Built | Manual transitions come from an allow-list; anything else returns 409 `invalid_transition`.
FR-ONB-010 | Partial | High risk without EDD returns 409 `activation_blocked`; the source-of-funds gate is ineffective because approval sets `fundsApproved` automatically.
FR-ONB-011 | Built | Sends an emailed 14-day upload link; case stage and SLA become Client action.
FR-ONB-012 | Built | Decider must hold the compliance role, supply a rationale of at least 5 characters, differ from the preparer (policy `kyc_dual_control`) and pass step-up.
FR-ONB-013 | Built | Activation creates CL- (KYC Current), a mandate shell, a DRAFT cash account and an investor-admin invitation.
FR-ONB-014 | Partial | Per-stage SLA due dates are stored; no breach detection, no Escalated state, no notification.
FR-ONB-015 | Built | Theme preference stays in the browser (prototype behaviour).

**6.4 CLI**

FR-CLI-001 | Partial | Create/PATCH with `clients.edit`, version check and audited before/after; no logo, no archive endpoint, no history view.
FR-CLI-002 | Built | Filters by name/ref/owner (`q`), risk and KYC status.
FR-CLI-003 | Partial | Client 360 has mandates, cash accounts, KYC cases, documents, requests and portal users; no portfolios.
FR-CLI-004 | Partial | Full lifecycle with checker ≠ maker; no zero-balance check on close; no PATCH to complete a DRAFT account.
FR-CLI-005 | Built | Identifiers are encrypted and masked; the full value is revealed only to `cash.approve` holders with step-up, and the reveal is audited.
FR-CLI-006 | Partial | `nextReviewDate` is set at activation; no scheduler moves clients to Review due.
FR-CLI-007 | Not started | No client report generation.

**6.5–6.12**

FR-PORT-001 | Not started | No portfolio registry.
FR-PORT-002 | Not started | No Portfolio 360.
FR-PORT-003 | Not started | No IBOR.
FR-PORT-004 | Not started | No settlement ladder.
FR-PORT-005 | Not started | No construction scenarios.
FR-PORT-006 | Not started | No optimiser jobs.
FR-PORT-007 | Not started | No scenario-to-order promotion.
FR-PORT-008 | Not started | Private-markets metrics are imported into investor snapshots, not computed.
FR-OMS-001 | Not started | No orders module.
FR-OMS-002 | Not started | No orders module.
FR-OMS-003 | Not started | No orders module.
FR-OMS-004 | Not started | No orders module.
FR-OMS-005 | Not started | No orders module.
FR-OMS-006 | Not started | No orders module.
FR-OMS-007 | Not started | No orders module.
FR-OMS-008 | Not started | No orders module.
FR-OMS-009 | Not started | No orders module.
FR-OMS-010 | Not started | No orders module.
FR-OMS-011 | Not started | No orders module.
FR-OMS-012 | Not started | No orders module.
FR-RES-001 | Not started | No research module.
FR-RES-002 | Not started | No research module.
FR-RES-003 | Not started | No research module.
FR-RES-004 | Not started | No research module.
FR-RES-005 | Not started | No research module.
FR-RSK-001 | Not started | No risk module.
FR-RSK-002 | Not started | No risk module.
FR-RSK-003 | Not started | No risk module.
FR-RSK-004 | Not started | No risk module.
FR-RSK-005 | Not started | No risk module.
FR-CASH-001 | Not started | Cash-account balances are display strings in account metadata; nothing is derived.
FR-CASH-002 | Not started | No journals.
FR-CASH-003 | Not started | No journals.
FR-CASH-004 | Not started | No journals.
FR-CASH-005 | Not started | No reservations.
FR-CASH-006 | Not started | No expectations.
FR-CASH-007 | Not started | No statement import.
FR-CASH-008 | Not started | No period close.
FR-OPS-001 | Not started | No operations module.
FR-OPS-002 | Not started | No reconciliation module.
FR-OPS-003 | Not started | No reconciliation module.
FR-OPS-004 | Not started | No reconciliation module.
FR-OPS-005 | Not started | No reconciliation module.
FR-OPS-006 | Not started | No corporate-actions module.
FR-VAL-001 | Not started | No NAV module.
FR-VAL-002 | Not started | No NAV module.
FR-VAL-003 | Not started | No NAV module.
FR-VAL-004 | Not started | No NAV module.
FR-VAL-005 | Not started | No NAV module.
FR-VAL-006 | Not started | No accounting module.
FR-VAL-007 | Not started | No performance module.
FR-FIN-001 | Not started | No financing module.
FR-FIN-002 | Not started | No financing module.
FR-FIN-003 | Not started | No financing module.

**6.13 DOC**

FR-DOC-001 | Partial | Vault has metadata, classification, versions n+1 with sha256 and a `retentionYears` field; retention is not enforced.
FR-DOC-002 | Built | Signed URLs expire in 5 min and are issued after an entitlement check; the capital-evidence and company-own-file URLs are not audited.
FR-DOC-003 | Partial | Uploaded documents go Draft → In review → Approved → Published; no templates or report authoring.
FR-DOC-004 | Not started | No scheduled reports.
FR-DOC-005 | Built | The investor API returns only Published documents with an active publication for the caller's client.
FR-DOC-006 | Partial | Captures signer, authority, consent time, IP, document sha256 and MFA time with step-up; the MFA time can be null for users with no factor; no verify endpoint.

**6.14 INV**

FR-INV-001 | Partial | Scoped by client membership (other clients return 404); account scope filters investments, holdings and transactions but not documents, capital, requests or threads; UI not wired.
FR-INV-002 | Partial | FX map and valuation date come from the imported snapshot, not an approved rate source; no `currency` parameter; UI not wired.
FR-INV-003 | Partial | API sets Processing and notifies `cash.approve` holders (no ops task); investor UI not wired.
FR-INV-004 | Partial | API has create, reply, timeline and SLA; staff can set any status; no templates or complaint SLA; UI not wired.
FR-INV-005 | Partial | API threads with per-user unread counts; investor message posts are not audited; UI not wired.
FR-INV-006 | Partial | API invite with role and scope (`users.invite`); scope enforcement is incomplete; UI not wired.
FR-INV-007 | Not started | The `notification_preferences` table exists but has no API.
FR-INV-008 | Partial | Profile change creates a service request; no dual approval and no bank-instruction change flow.
FR-INV-009 | Not started | No export endpoints.
FR-INV-010 | Not started | The assistant exists only in the prototype.

**6.15 CMP**

FR-CMP-001 | Partial | Scoped by company membership (other companies return 404), but only the user's first company is reachable and every period is visible.
FR-CMP-002 | Partial | Due and Complete are derived from uploads; Expiring and expiry dates are never set.
FR-CMP-003 | Built | Per-item uploads and a saved draft (KPIs, notes) that survives reload.
FR-CMP-004 | Built | Submit is blocked with 400 when a required item has no file.
FR-CMP-005 | Built | Staff review queue, accept or return (note required), question threads, reviewer ≠ submitter.
FR-CMP-006 | Partial | Covenant records and a staff update; evidence currency is set manually, not derived.
FR-CMP-007 | Built | Library documents can be downloaded (entitlement-checked and audited).

**6.16 PLAT**

FR-REG-001 | Not started | No regulatory module.
FR-DATA-001 | Not started | No integration registry.
FR-DATA-002 | Not started | No data-quality or lineage.
FR-MOD-001 | Not started | No model registry.
FR-COP-001 | Not started | The copilot exists only in the prototype.
FR-SET-001 | Partial | Workspace settings are persisted as a JSON blob but not applied server-side.
FR-AUD-001 | Partial | Hash-chained audit rows are written in the same transaction; some state changes are not audited, append-only is not enforced in the DB, and actor role, portal, IP and request id are outside the hash.
FR-AUD-002 | Partial | Search, CSV (10k rows, per-row hash) and a chain-verify endpoint exist; no signed hash manifest.
FR-NOT-001 | Partial | In-app and email notifications via the outbox for KYC, capital, publication, request, message and reporting events; no preferences.
FR-NOT-002 | Not started | No global search.

**Business rules**

BR-001 | Partial | Maker ≠ checker is enforced for KYC decisions, cash accounts, capital approve and settle, snapshot publish, document approve and reporting-pack review; the other listed objects do not exist yet.
BR-002 | Built | `system_admin` has no monetary permission, its bundle is locked and the SoD scan flags violations.
BR-003 | Not started | No orders exist; the seeded roles already keep `orders.approve` and `orders.route` apart.
BR-004 | Contradicted | The code requires at least one active system_admin and flags more than two; it does not require at least two `admin.rbac` holders or a confirmation flag.
BR-005 | Partial | All toggles are configurable; the SoD scan flags relaxed order, cash and document approval only.
BR-006 | Not started | No bank-instruction change API; `bankApproval` is stored but not enforced.
BR-010 | Not started | No cash ledger.
BR-011 | Not started | No journals.
BR-012 | Not started | No NAV.
BR-013 | Not started | No price coverage.
BR-014 | Not started | No stress engine.
BR-015 | Not started | Private-markets figures are imported, not computed.
BR-016 | Not started | No performance engine.
BR-017 | Not started | No orders.
BR-018 | Partial | The snapshot carries an FX map, but it is not linked to an approved rate source.
BR-019 | Built | For existing approvals, permissions are resolved per request and maker ≠ checker is enforced.
BR-020 | Built | Required evidence per type is enforced; PEP "Yes" rates the case High risk, which blocks approval until EDD is complete.

**Section 8 NFRs**

NFR-PERF-001 | Not started | No load testing or latency measurement.
NFR-PERF-002 | Partial | Lists are hard-capped at 200–500 rows with no pagination; portal paint not measured.
NFR-PERF-003 | Partial | Screening and email run asynchronously via the outbox; no jobs table or status API.
NFR-PERF-004 | Partial | Audit CSV builds up to 10k rows in memory; no streaming.
NFR-AV-001 | Not started | No availability monitoring.
NFR-AV-002 | Not started | No backups or point-in-time recovery in the deployment.
NFR-AV-003 | Contradicted | One instance per service; the worker is neither idempotent nor safe to run as more than one instance.
NFR-AV-004 | Not started | No stale-data banners (no integrations yet).
NFR-SEC-001 | Built | certbot TLS with HTTP→HTTPS redirect; HSTS from the API in production; session cookie httpOnly, SameSite=Lax, Secure in production.
NFR-SEC-002 | Built | Origin allow-list on state-changing `/api` requests plus a credentialed CORS allow-list.
NFR-SEC-003 | Partial | Files, tax IDs, ID numbers, account identifiers and TOTP secrets are encrypted; DB and backup encryption not addressed; no HMAC search columns.
NFR-SEC-004 | Partial | Secrets live in a `chmod 600` env file and a users file on the host; no secret manager.
NFR-SEC-005 | Partial | zod validates bodies and most queries (some staff list filters are unvalidated); Prisma parameterised queries.
NFR-SEC-006 | Partial | Type allow-list (includes `octet-stream`), 25 MB limit, encrypted outside the web root, signed URLs; no malware scan.
NFR-SEC-007 | Partial | Seeded role catalogue follows SoD; SoD scan and access-review CSV exist; no scheduled review process.
NFR-SEC-008 | Partial | MFA is optional by default and step-up applies only to enrolled users.
NFR-SEC-009 | Partial | Auth limit (20 per 15 min) is built; no general per-user limit or upload limit.
NFR-SEC-010 | Partial | helmet headers on the API only; portals and nginx set no CSP or permissions policy.
NFR-SEC-011 | Not started | No CI, dependency scanning or pen test.
NFR-CMP-001 | Partial | Audit rows have no delete path; retention not configured and append-only not DB-enforced.
NFR-CMP-002 | Not started | No KYC retention or data-subject tooling.
NFR-CMP-003 | Contradicted | Built labels are Public / Client / Internal / Restricted, not the SRD set; enforced only for publishing and Restricted downloads.
NFR-CMP-004 | Not started | Data residency not addressed.
NFR-CMP-005 | Partial | Maker and checker ids are stored and audit is searchable per object; no per-transaction evidence export.
NFR-UX-001 | Contradicted | Investor and onboarding now render newer prototype pages (V59/V65), not V56.
NFR-UX-002 | Not started | No accessibility testing.
NFR-UX-003 | Partial | Responsiveness is inherited from the prototypes; not verified.
NFR-UX-004 | Not started | No browser test matrix.
NFR-UX-005 | Built | English only; API display dates formatted in Africa/Harare.
NFR-OPS-001 | Not started | Plain console output; no structured per-request logs.
NFR-OPS-002 | Not started | No metrics or tracing.
NFR-OPS-003 | Not started | No alerting.
NFR-OPS-004 | Partial | `/api/health` and `?deep=1` exist (503 `degraded`), but the deep check covers the database only (not queue or storage).
NFR-OPS-005 | Partial | Migrations run in a pre-start container; `docker compose up` is not a rolling deploy.
NFR-MNT-001 | Built | TypeScript strict; shared zod auth schemas and typed client in `packages/shared` (domain schemas are defined inline in the API).
NFR-MNT-002 | Not started | No unit or contract tests; two scripted journeys only.
NFR-MNT-003 | Partial | Admin slices replaced their `localStorage`; the investor and onboarding bridges are disabled.

**New requirements for behaviour already built but not in the SRD [O]**

- FR-AUTH-019: Step-up confirmation endpoint re-verifies a TOTP code and marks the session step-up valid for 5 minutes; `GET /auth/mfa/status` reports enrolment. — AC: approval call after a code more than 5 minutes old returns `step_up_required`; after `POST /auth/mfa/step-up` with a valid code the same call succeeds.
- FR-AUTH-020: Invitation preview shows email, portal, expiry and whether an account already exists; an existing account accepts with its current password. — AC: expired, revoked or used token returns 404; wrong password for an existing account returns 401.
- FR-RBAC-013: Administrator lost-device MFA reset removes the user's factors and sessions, with a reason, step-up and audit; self-reset is refused. — AC: after reset the user's next login returns `mfa='enroll'` (when MFA is required); self-reset returns 409.
- FR-RBAC-014: Enable/disable user; disabling revokes all sessions; self-disable is refused. — AC: disabled user's next request returns 401.
- FR-RBAC-015: Guards against self-lockout (removing your own `admin.rbac`) and against removing the last active System Administrator. — AC: 409 `self_lockout` / 409 `last_admin`.
- FR-RBAC-016: Access context endpoint returns the caller's admin roles, permissions and role labels/bundles, used to drive UI visibility. — AC: matches the caller's `/me` permissions.
- FR-ONB-041: An onboarding draft is owned by a draft token (header `X-Draft-Token`, SHA-256 stored, 30-day expiry), delivered to the creating browser and in an emailed resume link. Staff evidence requests re-issue a 14-day token. — AC: missing or wrong token returns 404; a submitted draft cannot be edited (409 `already_submitted`) except evidence upload while the case is in Client action.
- FR-ONB-042: Per-slot evidence review (Accepted / Rejected with note); rejected evidence counts as missing for approval. — AC: approval blocked while a required slot is Rejected.
- FR-ONB-043: Staff can message the applicant by email from the case, recorded on the case timeline. — AC: timeline event, audit event and queued email.
- FR-ONB-044: Screening re-run on undecided cases. — AC: on Approved, Rejected, Activation or Active returns 409.
- FR-ONB-045: A case in Client action returns automatically to Compliance review when every requested slot has a file, and reviewers are notified. — AC: last requested upload changes the stage.
- FR-ONB-046: Activation completes automatically (Activation → Active) once the client has an ACTIVE cash account and at least one accepted investor user. — AC: whichever of the two events happens second moves the case to Active.
- FR-ONB-047: Approval blockers are computed server-side and returned with the case: missing evidence, screening running, waiting on applicant, EDD open, High risk without EDD, potential sanctions match. — AC: approve with any blocker returns 409 `approval_blocked` with the list.
- FR-CLI-022: Staff management of investor portal access per client: list members and pending invitations, invite with role and scope, remove a member or revoke an invitation. — AC: removed member loses the investor role when they have no other client.
- FR-INV-019: Investor portfolio data is served from a **published investor snapshot** (valuation-dated import of investments, holdings, transactions, performance, allocation, FX, metrics). A different user (policy `client_publish_approval`) publishes it with step-up; publishing supersedes the previous snapshot. — AC: investors see only the latest Published snapshot; the importer publishing their own snapshot gets 403 `sod_violation`.
- FR-INV-020: Fund-level capital event allocation creates one Draft notice per investor holding the vehicle, pro-rata to unfunded commitment (calls) or commitment (other types). — AC: allocations sum exactly to the fund amount.
- FR-INV-021: Capital notice lifecycle: staff create → independent approve (step-up) → publish (email to investors) → settle/match (step-up; matcher ≠ evidence submitter). — AC: see 7.3.
- FR-INV-022: A single investor bootstrap endpoint returns all entitled portal data in one call, with sections empty where the role lacks the permission. — AC: an auditor role receives no capital or requests data.
- FR-INV-023: Document read receipts and unread flags per investor user. — AC: after download or mark-read the document is no longer unread.
- FR-DOC-024: Documents can be returned (with reason) from In review or Approved, and withdrawn per client or globally (cancelling pending signature requests). A new version resets the document to Draft and withdraws its publications. — AC: investor loses access immediately after withdrawal or after a new version.
- FR-DOC-025: All binaries are stored AES-256-GCM encrypted with a SHA-256 of the plaintext, and downloaded only through HMAC-signed URLs (5 min) issued after an entitlement check. — AC: a tampered or expired signature returns 403 `invalid_signature`.
- FR-CMP-047: Staff open a reporting period (YYYY-MM, due date) from the 5-item template, invite company users, update covenants and download submitted files (audited). — AC: duplicate period returns 409 `duplicate`.
- FR-CMP-048: Company users can remove non-accepted files while a pack is open or returned, and resolve question threads. — AC: removing an Accepted file returns 409.
- FR-AUD-005: Audit chain verification endpoint recomputes the hash chain and returns rows checked and the first broken id. — AC: altering any hashed field of a row makes `brokenAt` equal that row's id.
- FR-AUD-006: Audit and access-review exports are themselves audited, and CSV cells are escaped against formula injection. — AC: the export creates an `audit.exported` / `access_review.exported` event.
- FR-PLAT-004: Transactional outbox. Side effects (email, notifications, screening) are enqueued in the business transaction and delivered by a worker with retry (exponential back-off, max 8 attempts, last error kept). — AC: a rolled-back transaction sends nothing; a failed handler is retried.
- FR-PLAT-005: Human references are allocated atomically per kind from a sequence table (CL-, MND-, CCA-, ONB-, KYC-, DOC-, REQ-, CAP-, Q-). — AC: concurrent creates never duplicate a reference.
- FR-NOT-003: Mark all notifications read. — AC: unread count becomes 0.
- NFR-OPS-006: Every response carries an `X-Request-Id` (a caller value is accepted when it matches `[\w.-]{8,64}`), and the id is stored on audit events. — AC: an audit row links to the response header value.
- NFR-SEC-012: Optimistic concurrency: `If-Match` (or `version` in the body) is compared to the row version on transitions, and a mismatch returns 409 `version_conflict`. — AC: a stale version returns 409.
