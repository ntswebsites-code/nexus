# 10.3-RECONCILE (from the backend draft)

| Proposed table (current 10.3) | Status | How it differs |
| --- | --- | --- |
| user_mfa_factors | Built-as | TOTP only |
| invitations | Built-differently | `role_keys` instead of `role_ids`; adds name, revoked_at, invited_by_id |
| password_resets | Built-as | — |
| policies | Built-differently | Different key set (see 10.2); nav/bank approval live in `settings` |
| settings | Built-differently | PK(owner_id, key); no scope/user_id columns |
| saved_views | Not started | — |
| notifications | Built-as | — |
| notification_preferences | Built-as | Unused |
| audit_events | Built-as | — |
| outbox_events | Built-differently | Adds attempts, last_error |
| jobs | Not started | — |
| integrations | Not started | — |
| clients | Built-differently | No logo_document_id; adds display, portal and archive columns |
| client_users | Built-differently | investor_role key instead of role id; own id |
| mandates | Built-differently | Adds ref; no ips_document_id |
| onboarding_applications | Built-differently | purpose instead of objective; tax_status instead of fatca_crs_status; adds form_data and draft-token columns |
| beneficial_owners | Built-as | — |
| kyc_cases | Built-differently | Adds ref, prepared_by_id, EDD timestamp, funds_approved, owner_name, version |
| kyc_evidence | Built-differently | Slots doc1–doc8; file_id instead of document_id; adds application_id, label |
| screening_results | Built-as | — |
| kyc_case_events | Built-as | — |
| portfolios | Not started | — |
| securities | Not started | — |
| prices | Not started | — |
| fx_rates | Not started | — |
| benchmarks / benchmark_levels | Not started | — |
| positions | Not started | — |
| transactions | Not started | Snapshot transactions are a stand-in |
| construction_scenarios | Not started | — |
| private_investments | Not started | — |
| private_cashflows | Not started | — |
| portfolio_companies | Built-differently | Full company profile; no private_investment_id |
| research_issuers | Not started | — |
| research_models | Not started | — |
| research_notes | Not started | — |
| investment_cases | Not started | — |
| risk_limits | Not started | — |
| risk_breaches | Not started | — |
| risk_scenarios / runs | Not started | — |
| risk_cases | Not started | — |
| models / model_versions / model_validations | Not started | — |
| orders | Not started | — |
| order_fills | Not started | — |
| order_imports | Not started | — |
| brokers | Not started | — |
| broker_instructions | Not started | — |
| cash_accounts | Built-differently | No portfolio_id or effective_date; calendar, tolerance and GL in meta JSON; balances are display strings |
| cash_journals | Not started | — |
| cash_journal_lines | Not started | — |
| cash_reservations | Not started | — |
| cash_expectations | Not started | — |
| statement_imports | Not started | — |
| statement_lines | Not started | — |
| cash_period_closes | Not started | — |
| ops_tasks | Not started | — |
| recon_sources | Not started | — |
| recon_runs | Not started | — |
| recon_breaks | Not started | — |
| counterpart_imports | Not started | — |
| recon_signoffs | Not started | — |
| corporate_actions | Not started | — |
| ca_entitlements / ca_elections | Not started | — |
| nav_runs | Not started | — |
| nav_exceptions | Not started | — |
| accounting_periods | Not started | — |
| gl_mappings | Not started | — |
| performance_periods | Not started | — |
| attribution_results | Not started | — |
| financing_facilities | Not started | — |
| margin_calls | Not started | — |
| regulatory_obligations / filings | Not started | — |
| documents | Built-differently | Adds ref, client/company ids, dates, signature flag, retention_years, maker/checker; owner_name instead of owner_id |
| document_versions | Built-differently | file_id → `files` (storage key, size, mime, scan status live there) |
| retention_policies | Not started | — |
| reports | Not started | — |
| report_templates / report_schedules | Not started | — |
| publications | Built-differently | No audience_scope; adds withdrawn_at |
| capital_events | Built-differently | investment_name text; bank_text instead of bank_instruction_id; Draft/Approved states; maker/checker; breakdown |
| funding_evidence | Built-differently | file_id; matched_at/by instead of matched_journal_id |
| bank_instructions | Built-differently | verified_at instead of verified_by; adds account_name |
| signature_requests / signatures | Built-differently | Split into two tables |
| service_requests | Built-as | Plus owner_name, progress, file_id, version |
| service_request_events | Built-as | — |
| message_threads / messages | Built-differently | Owner name/role; from_client; read state in message_reads |
| company_users | Built-as | — |
| reporting_periods | Built-differently | Adds label, KPI values, notes, review fields |
| reporting_items | Built-differently | Keys accounts/kpis/debt/board/compliance; adds title/detail/required/accept |
| reporting_submissions | Built-differently | file_id, name, size |
| reporting_questions | Built-differently | Thread model plus reporting_question_messages; no question/answer columns |
| covenants | Built-differently | Threshold/actual/limit/headroom/evidence/note; no evidence_due/status |

Built tables that are not in 10.3 (add them to 10.2): sequences, files, document_reads, message_reads, reporting_question_messages, company_kpis, investor_snapshots, snapshot_investments, snapshot_holdings, snapshot_transactions, snapshot_performance_points, snapshot_allocation.
