# 10.2 (from the backend draft)

### 10.2 Built tables **[O]**

Conventions as built:
- Primary keys are `CHAR(36)` UUID v4. `audit_events` and `outbox_events` use BIGINT autoincrement.
- Human `ref` columns are unique.
- Money is `DECIMAL(20,4)` plus a `CHAR(3)` currency; percentages are `DECIMAL(9,4)`.
- Timestamps are `DATETIME(3)`.
- **Statuses are VARCHAR with no DB enum or check**; the vocabularies below are enforced in services.
- Foreign keys cascade on delete. Many logical references (file ids, maker/checker ids, `client_id` on documents and invitations) have no FK.

**Identity**

| Table | Key fields | Relations | Unique / indexes | Status vocabulary |
| --- | --- | --- | --- | --- |
| `users` | id, email VARCHAR(254), password_hash, name, is_active, last_login_at | roles, sessions, factors, resets, notifications, client/company links | UQ email | is_active true/false |
| `sessions` | id, user_id, token_hash CHAR(64) (SHA-256), expires_at, last_used_at, user_agent, ip_address, mfa_pending, mfa_verified_at | → users | UQ token_hash; idx user_id; idx expires_at | — |
| `roles` | id, portal, key, label, locked, custom | permissions, users | UQ(portal, key) | portal: admin \| investor |
| `role_permissions` | role_id, permission VARCHAR(80) | → roles | PK(role_id, permission) | — |
| `user_roles` | user_id, role_id, assigned_at | → users, → roles | PK(user_id, role_id); idx role_id | — |
| `user_mfa_factors` | id, user_id, type (totp), secret_enc (encrypted), verified_at | → users | idx user_id | unverified / verified |
| `invitations` | id, email, name, portal, role_keys JSON, client_id?, company_id?, scope, token_hash, expires_at, accepted_at, revoked_at, invited_by_id | (logical) client, company | UQ token_hash; idx email | pending / accepted / revoked / expired (derived) |
| `password_resets` | id, user_id, token_hash, expires_at, used_at | → users | UQ token_hash | pending / used / expired |

**Platform**

| Table | Key fields | Relations | Unique / indexes | Status vocabulary / notes |
| --- | --- | --- | --- | --- |
| `policies` | key PK, value JSON, updated_by | — | PK key | Keys: order_approval, cash_approval, document_approval, client_publish_approval, mfa_required, kyc_dual_control, session_idle_minutes |
| `settings` | owner_id, key, value JSON | — | PK(owner_id, key) | Platform keys: workspace, access_policy_extra (nav/bank approval), role_catalog_applied |
| `notifications` | id, user_id, type, title, body, link, read_at | → users | idx(user_id, read_at) | read / unread |
| `notification_preferences` | user_id, channel, type, enabled | — | PK(user_id, channel, type) | Unused |
| `audit_events` | id BIGINT, occurred_at DATETIME(3), actor_id, actor_role, portal, action, object_type, object_id, before JSON, after JSON, reason, ip, request_id, prev_hash, hash | — | idx(object_type, object_id); idx(actor_id, occurred_at); idx(occurred_at) | Append-only by convention (no DB enforcement) |
| `outbox_events` | id BIGINT, type, payload JSON, created_at, published_at, attempts, last_error | — | idx(published_at, id) | pending / published / failed after 8 attempts |
| `sequences` | name PK, value INT | — | PK name | Reference counters |
| `files` | id, storage_key, name, mime, size, sha256, scan_status, uploaded_by_id, application_id | Referenced by versions, evidence, submissions (no FK) | UQ storage_key; idx application_id | scan_status always "clean" |

**Documents**

| Table | Key fields | Relations | Unique / indexes | Status vocabulary |
| --- | --- | --- | --- | --- |
| `documents` | id, ref, name, type, label, classification, status, owner_name, related_type/id/label, client_id, company_id, year, document_date, requires_signature, retention_years, maker_id, checker_id, approved_at, audit cols, version | versions, publications, reads, signature requests | UQ ref; idx client_id; idx company_id; idx(related_type, related_id) | status: Draft, In review, Approved, Published (Superseded reserved). classification: Public, Client, Internal, Restricted |
| `document_versions` | id, document_id, version, file_id, sha256, uploaded_by_id | → documents | UQ(document_id, version) | — |
| `publications` | id, document_id, client_id, published_at, published_by_id, withdrawn_at | → documents | UQ(document_id, client_id); idx client_id | active / withdrawn |
| `document_reads` | document_id, user_id, read_at | → documents | PK(document_id, user_id) | — |
| `signature_requests` | id, document_id, client_id, status, requested_by_id, due_date | → documents | idx(client_id, status) | Pending, Signed, Cancelled |
| `signatures` | id, request_id, signer_user_id, signer_name, authority, consent_at, mfa_at, doc_sha256, ip, signed_at | → signature_requests | — | — |

**Parties**

| Table | Key fields | Relations | Unique / indexes | Status vocabulary |
| --- | --- | --- | --- | --- |
| `clients` | id, ref (CL-#####), name, type, base_currency, risk_rating, kyc_status, mandate_label, owner_name, email, phone, registration_ref, address, notes, value_label, accounts_count, next_review_date, portal_enabled, archived_at, audit cols, version | client_users, mandates, cash accounts, capital events, requests, threads, snapshots, bank instructions | UQ ref | kyc_status: Pending, Current, Review due, Enhanced review. risk: Low, Medium, High |
| `client_users` | id, client_id, user_id, investor_role, account_scope | → clients, → users | UQ(client_id, user_id) | role: admin, investment, finance, auditor. scope: all, managed, private, documents |
| `mandates` | id, ref (MND-####), client_id, name, type, status, version | → clients | UQ ref | type: discretionary, cis, private_markets, treasury, advisory. status: Shell (Active, Closed reserved) |
| `cash_accounts` | id, ref (CCA-####), client_id, mandate_id?, legal_entity, ownership, money_class, type, provider, identifier_enc, masked, currency, meta JSON (display balances, GL, calendar), status, maker_id, checker_id, submitted_at, approved_at, version | → clients | UQ ref; idx client_id | DRAFT, PENDING_APPROVAL, ACTIVE, SUSPENDED, CLOSING, CLOSED. ownership: SEGREGATED, OMNIBUS, HYBRID |

**Onboarding and KYC**

| Table | Key fields | Relations | Unique / indexes | Status vocabulary |
| --- | --- | --- | --- | --- |
| `onboarding_applications` | id, ref (ONB-######, set at submit), channel, applicant_type, legal_name, email, email_verified_at, all 5.C fields (tax_id_enc encrypted), expected_investment DECIMAL, form_data JSON, consent_at, status, submitted_at, draft_token_hash, draft_token_expires_at, client_id | owners, kyc_case (1:1) | UQ ref; UQ draft_token_hash; idx email | Draft, Submitted. channel: Investor portal, Assisted |
| `beneficial_owners` | id, application_id?, client_id?, full_name, id_number_enc, ownership_pct DECIMAL(7,4), is_controller, pep | → applications | — | — |
| `kyc_cases` | id, ref (KYC-####), application_id, client_id, stage, risk, sla_state, sla_due_at, owner_id, owner_name, prepared_by_id, decision, decision_reason, decided_by_id, decided_at, enhanced_review_done_at, funds_approved, version | → applications (1:1); evidence, screening, events | UQ ref; UQ application_id; idx stage | stage: see 7.1b. risk: Pending, Low, Medium, High. decision: approve, reject, enhanced_review |
| `kyc_evidence` | id, case_id?, application_id, slot (doc1–doc8), label, file_id, status, reviewer_id, reviewed_at | → kyc_cases | UQ(application_id, slot) | Missing, Received, Accepted, Rejected |
| `screening_results` | id, case_id, provider, type, outcome, score, raw_ref, received_at | → kyc_cases | — | type: sanctions, pep, adverse_media, document. outcome: Clear, Review, Match |
| `kyc_case_events` | id, case_id, at, title, detail, actor_id | → kyc_cases | idx(case_id, at) | — |

**Investor services**

| Table | Key fields | Relations | Unique / indexes | Status vocabulary |
| --- | --- | --- | --- | --- |
| `capital_events` | id, ref (CAP-####), client_id, investment_name, type, amount DECIMAL, currency, due_date, status, purpose, breakdown JSON, bank_text, evidence_name, maker_id, checker_id, approved_at, published_at, version | → clients; funding evidence | UQ ref; idx(client_id, status) | type: Capital call, Distribution, Contribution, Withdrawal. status: Draft, Approved, Expected, Due, Processing, Funded, Paid |
| `funding_evidence` | id, capital_event_id, file_id, confirmed_by_id, confirmed_at, matched_at, matched_by_id | → capital_events | — | confirmed / matched |
| `bank_instructions` | id, client_id, version, bank, account_name, identifier_enc, masked, verified_at, status | → clients | — | Active, Superseded (seed only; no write API) |
| `service_requests` | id, ref (REQ-####), client_id, type, priority, title, detail, status, owner_name, owner_id, progress, sla_due_at, file_id, opened_by_id, version | → clients; events | UQ ref; idx(client_id, status) | Open, In progress, Waiting on you, Closed. priority: Normal, Time sensitive |
| `service_request_events` | id, request_id, at, title, detail, actor_id | → service_requests | — | — |
| `message_threads` | id, client_id, title, owner_name, owner_role | → clients; messages, reads | idx client_id | — |
| `messages` | id, thread_id, author_id, author_name, from_client, body | → threads | idx(thread_id, created_at) | — |
| `message_reads` | thread_id, user_id, read_at | → threads | PK(thread_id, user_id) | — |

**Published investor snapshots** (IBOR/PBOR stand-in)

| Table | Key fields | Relations | Unique / indexes | Status vocabulary |
| --- | --- | --- | --- | --- |
| `investor_snapshots` | id, client_id, valuation_date DATE, status, reporting_currency, fx JSON, metrics JSON, activity JSON, maker_id, checker_id, published_at, version | → clients; child tables | idx(client_id, status) | Draft, Published, Superseded |
| `snapshot_investments` | snapshot_id, key, name, kind, value, return/benchmark pct, currency, status, commitment, called, unfunded, distributions, irr, tvpi, dpi, sort | → snapshot | — | — |
| `snapshot_holdings` | snapshot_id, key, security, account, asset, quantity, price, value, weight_pct, ytd_pct, sort | → snapshot | — | — |
| `snapshot_transactions` | snapshot_id, key, trade_date, type, account, description, quantity, amount, status, sort | → snapshot | — | — |
| `snapshot_performance_points` | snapshot_id, range, idx, portfolio_pct, benchmark_pct | → snapshot | idx(snapshot_id, range) | range: 1M, 3M, YTD, 1Y, 3Y |
| `snapshot_allocation` | snapshot_id, label, pct, sort | → snapshot | — | — |

**Company reporting**

| Table | Key fields | Relations | Unique / indexes | Status vocabulary |
| --- | --- | --- | --- | --- |
| `portfolio_companies` | id, ref (PC-…), name, legal_name, ticker, sector, country, founded, employees, website, address, relationship JSON, contacts JSON, cash_runway JSON, volume_series JSON, version | users, periods, kpis, covenants, questions | UQ ref | — (seed only; no create API) |
| `company_users` | company_id, user_id | → companies, → users | PK(company_id, user_id) | — |
| `company_kpis` | id, company_id, key, label, unit, invert, prev, budget, series JSON, sort | → companies | UQ(company_id, key) | — |
| `reporting_periods` | id, company_id, period (YYYY-MM), label, due_date, status, kpi_values JSON, notes, submitted_at/by, reviewed_at/by, reviewer_name, review_note, version | → companies; items | UQ(company_id, period) | open, submitted, accepted, returned |
| `reporting_items` | id, period_id, key, title, detail, required, accept, status, expires_at, sort | → periods; submissions | UQ(period_id, key) | key: accounts, kpis, debt, board, compliance. status: Due, Complete (Expiring reserved) |
| `reporting_submissions` | id, item_id, file_id, name, size, status, uploaded_by_id | → items | — | Draft, Submitted, Accepted, Returned |
| `reporting_questions` | id, ref (Q-####), company_id, period_id?, title, from_name, from_role, status | → companies; messages | UQ ref; idx(company_id, status) | open, resolved |
| `reporting_question_messages` | id, question_id, author_id, author_name, from_company, body | → questions | — | — |
| `covenants` | id, company_id, key, name, threshold, actual, limit, unit, headroom, evidence, note, sort | → companies | UQ(company_id, key) | evidence: current, expiring |

Migrations: `init` creates 5 identity tables. `phase1_core` adds MFA columns to sessions, locked/custom to roles, 50 new tables and 40 cascading FKs. There are no triggers or grants.
