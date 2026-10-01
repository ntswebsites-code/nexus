# Corrections to other SRD sections (from the 5A-19-30 draft)

**6.2 RBAC administration**
- FR-RBAC-002: live user creation is an **invitation** (`POST /api/v1/admin/users {name, email, role}`, audited `staff_user.invited`). Invitations appear as *Invited* rows. There is no UI to revoke an invitation or disable a user, although `PATCH /api/v1/admin/users/{id} {isActive}` exists. Add FR-NEW(RBAC) for disable/enable and revoke.
- FR-RBAC-003: editing the system_admin bundle returns **403 `role_locked`**, not 409. The UI does not render a system_admin column at all.
- FR-RBAC-003: `cash.approve`, `admin.rbac` and `admin.settings` are not in the matrix UI.
- FR-RBAC-004: a custom role starts from a template copy or from `dashboard.view` (blank), not from zero permissions. The label must be 2–120 characters. System Administrator cannot be a template.
- FR-RBAC-005: of the policy values, only `cash_approval`, `session_idle_minutes` and `mfa_required` are enforced by the API, plus `document_approval` and `client_publish_approval`, which have no UI. `order_approval`, NAV approval and bank approval are stored but not enforced.
- FR-RBAC-006: the example AC is wrong. `cash.view` is not monetary. Use "granting `orders.create` (or `cash.approve`) to system_admin produces a finding". Update the rule references to the corrected 4.5 (BR-004/BR-005 contradicted; add the BR-NEW rules).
- FR-RBAC-007: the live CSV columns are Name, Email, Roles, Permissions, Active, MFA, Last sign-in. It includes inactive users and is audited as `access_review.exported`.
- FR-RBAC-008: preview is **not audited** and changes the client-side role context only. Mark it [O] UI / [P] audit.
- Add FR-RBAC-011: MFA reset by another administrator with a reason (implemented: `POST /api/v1/admin/users/{id}/mfa-reset`).
- Add FR-RBAC-012: step-up MFA on all RBAC mutations (implemented).

**6.11 Valuation, accounting, performance**
- FR-VAL-006: change the label to **[P]**. The *Run close pre-check* and *Close period* buttons both open a read-only second-level workspace; no close exists and nothing is blocked.

**6.12 Financing**
- FR-FIN-001: facilities are localStorage only (`matanho-v52-financing`). New facilities start in *Review* with drawn = 0. The "Drawn ≤ committed" rule is not validated (drawn is never edited). Label [O] UI / [P] rule.
- FR-FIN-002: the actual transitions are **Disputed → Due → Funded**, driven by buttons (*Resolve dispute*, *Mark funded*) with no reason, checker or cash expectation. The AC "Funding creates cash expectation/journal" is [P].
- FR-FIN-003: import only hashes and stages the file. It does **not** create or update calls. Mark the AC [P].

**6.16 Regulatory, data, models, copilot, settings, audit, notifications**
- FR-REG-001: enforced only by button disabling in memory (lost on reload). There is no attester identity. The visible obligations are REG-31–34.
- FR-DATA-001: the integration registry with test and health is on **Settings** (5.A.27), in localStorage `matanho-v55-integrations`. Tests always pass after 650 ms. The Data page has a separate in-memory connection form whose test wipes the entered values.
- FR-DATA-002: quality and lineage are static tables, with no dashboard linkage.
- FR-MOD-001: registry and wizard exist (localStorage). There is no approval, promotion or overdue flag. Registration sets *Independent validation*.
- FR-COP-001: keyword-matched canned answers with static source chips. **No entitlement filtering.**
- FR-SET-001: the live save is rejected by the API because of the nested `letterhead` payload (see DEFECT in 5.A.27). 13 settings have no consumer. Also, the default order type pre-fills the quick-order panel only, not the full ticket.
- FR-AUD-002: implemented in live mode:
  - filters Search, User, Action prefix, Object type, Object id, From, To;
  - hash-chain verify;
  - 14-column CSV (cap 10,000 rows), audited.
  - The hash manifest remains [P]. Change the label to [O] (filters/CSV) / [P] (manifest).
- FR-NOT-002 (global search): the drawer searches portfolios, clients, documents and orders (3 per type) in the prototype arrays. Results are not entitlement-filtered and their *Open →* buttons do nothing.

**7 User workflows & state diagrams**
- Add 7.x Regulatory filing: In preparation → Validated → Attested → Filed (receipt). Selecting another obligation resets the state [O]. Regulator acknowledgement is [P].
- Add 7.x Margin call (prototype): Disputed → Due → Funded [O]. Target: Due → Disputed → Resolved → Funded, with a checker [P].
- Add 7.x Model lifecycle: Draft (wizard) → Independent validation [O] → Validation due / Production [P] transitions.
- Add 7.x Integration: not_connected → configured → testing → healthy; disconnect → not_connected [O].
- 7.9: add a financing BR-NEW (utilisation = Σdrawn ÷ Σcommitted; margin requiring action = Σ calls not Funded; weighted cost = Σ(cost × drawn) ÷ Σdrawn).

**10.3 Proposed tables**
- `policies`: the actual keys are `order_approval`, `cash_approval`, `document_approval`, `client_publish_approval`, `mfa_required`, `kyc_dual_control`, `session_idle_minutes`. NAV and bank approval are stored in `settings` (owner `platform`, key `access_policy_extra`). Remove `nav_approval`, `dual_bank_approval` and `session_timeout_min` from the proposal, or state the mapping.
- `settings`: in use as (owner_id, key, value JSON). Keys `workspace` (platform settings), `access_policy_extra`, `role_catalog_applied`.
- `roles` already exists with `locked` and `custom` columns (move it to 10.2).
- `audit_events` is implemented with `id BIGINT`, `occurred_at`, `actor_id`, `actor_role`, `portal`, `action`, `object_type`, `object_id`, `before`, `after`, `reason`, `ip`, `request_id`, `hash` (move to 10.2). `user_mfa_factors` and `invitations` also exist.
- `integrations`: statuses as implemented `not_connected / configured / testing / healthy`. Add `group`, `code`, `schedule`, `username`, `last_test`.
- `margin_calls`: states Disputed / Due / Funded; IDs `MC-88xx`. `financing_facilities`: states Current / Review.
- `corporate_actions`: types Voluntary / Choice / Mandatory.
- `regulatory_filings`: add `receipt_ref` (e.g. REG-RCPT-28491).

**11.3 Endpoints — `/api/v1/admin/*` as implemented and used by the bridge** (move to 11.2 [O]):

| Method | Path | Permission | Request / notes |
| --- | --- | --- | --- |
| GET | `/api/v1/admin/access-context` | any admin-portal user | returns `{role, roles, permissions, roleLabels, rolePermissions}` |
| GET | `/api/v1/admin/users` | `admin.rbac` | staff rows `{id, name, email, role, roles, access, last, mfa}` + invitations (`id "invite:…"`, access *Invited*) |
| POST | `/api/v1/admin/users` | `admin.rbac` + step-up | `{name(1–120), email, role}` → invitation; 409 `already_member`; audited `staff_user.invited` |
| PUT | `/api/v1/admin/users/{id}/roles` | `admin.rbac` + step-up | `{roles:[roleKey…]}` (1–10). **No `confirm` flag and no `roleIds`**. 409 `self_lockout`, 409 `last_admin`; audited `staff_user.roles_changed` |
| PATCH | `/api/v1/admin/users/{id}` | `admin.rbac` + step-up | `{isActive}`; revokes sessions on disable; 409 when disabling yourself; **no UI** |
| POST | `/api/v1/admin/users/{id}/mfa-reset` | `admin.rbac` + step-up | `{reason(3–500)}`; 409 `self_reset`; audited `staff_user.mfa_reset` |
| GET | `/api/v1/admin/roles` | `admin.rbac` | `{key, label, locked, custom, users, permissions}`; not called by the UI |
| POST | `/api/v1/admin/roles` | `admin.rbac` + step-up | `{label(2–120), template}` (default `blank`); 400 for a system_admin template; audited `role.created` |
| PUT | `/api/v1/admin/roles/{key}/permissions` | `admin.rbac` + step-up | `{permissions:[code…]}` (regex `^[a-z_]+(\.[a-z_]+)+$`, ≤200) — replaces the old `PATCH /roles/{id}`; 403 `role_locked`; 409 `self_lockout`; audited with added/removed |
| GET | `/api/v1/admin/permissions` | `admin.rbac` | `{data:[codes], protected: MONETARY}`; not called by the UI |
| GET | `/api/v1/admin/policy` | any admin-portal user | `{orderApproval, cashApproval, navApproval, bankApproval, sessionTimeout, mfa, policies}` |
| PUT | `/api/v1/admin/policy` | `admin.rbac` + step-up | `{orderApproval?, cashApproval?, navApproval?, bankApproval?, sessionTimeout?(5–240), mfa?, policies?{document_approval, client_publish_approval, kyc_dual_control}}`; audited `policy.updated` |
| GET | `/api/v1/admin/sod-scan` | `admin.rbac` | `{findings:[{severity: block\|warn\|ok, title, detail, action}], blocking, scannedAt}` |
| GET | `/api/v1/admin/access-review.csv` | `admin.rbac` | CSV `matanho-access-review-YYYY-MM-DD.csv`; audited |
| GET | `/api/v1/admin/settings` | any admin-portal user | `{settings, updatedAt}` (key `workspace`) |
| PUT | `/api/v1/admin/settings` | `admin.settings` | `{settings: Record<string ≤64, string ≤200 \| number \| boolean \| null>}`. Nested objects are rejected, so the current UI payload with `letterhead` always fails (DEFECT). Audited `settings.updated` |
| GET | `/api/v1/admin/audit-events` | `audit.view` | query `q, actor, action (prefix), objectType, objectId, portal, from, to, before (cursor), limit (1–500, default 100)`; `{data, nextBefore}` — replaces `/api/v1/audit-events` |
| GET | `/api/v1/admin/audit-events.csv` | `audit.view` | same filters; ≤10,000 rows; 14 columns; audited `audit.exported` |
| GET | `/api/v1/admin/audit-events/verify` | `audit.view` | `{checked, brokenAt?}` |
| POST | `/api/auth/mfa/step-up` | session | `{code}`; sets the 5-minute step-up window |

- Keep `/api/v1/accounting/*`, `/financing/*`, `/corporate-actions`, `/regulatory/*`, `/integrations` (note: owned by Settings), `/data-quality`, `/lineage`, `/models`, `/copilot/*` as **[P]**. None is called today.

**13.3 Open questions**
- Q-03: resolved. `onboarding.manage` is in the seed for Director, Compliance and Client Services. Remaining issue: the prototype reset drops it (DEFECT).
- Q-04: add `financing.manage`, `corporate_actions.elect`, `regulatory.submit`, `models.approve`, `accounting.close` as used by the FR-NEW items in 5.A.19–5.A.24.
- Q-06: reference the visible obligations REG-31 Quarterly investment return, REG-32 AML transaction summary, REG-33 Capital adequacy return, REG-34 Offshore exposure return. The 13F/N-PORT/EMIR list is unreachable prototype data.
- Q-07: the copilot is currently keyword-matched with canned answers, not rule-based retrieval.
- Add the Q-NEW items raised in 5.A.20, 5.A.22, 5.A.23, 5.A.26 and Section 4 (`mfa_required` default).

**13.4 Known prototype defects** — add:
- Live Settings save and reset always rejected (nested `letterhead` vs the scalar-only settings schema).
- Data page: successful *Test connection* wipes the form; *Save* stores placeholder values; Environment and Schedule are never captured.
- RBAC prototype *Reset defaults* drops `onboarding.manage` for Director, Compliance and Client Services.
- RBAC *Access policy* KPI tile is static "Enforced".
- Model Governance *Clone as new version* → *Continue* throws a TypeError (missing `datasetVersion` / `assumptions`); clone versions use floating-point arithmetic.
- The v52 row-click layer hides single-button row actions (*Preview* in RBAC users, *Inspect →* in Corporate Actions) and makes whole rows clickable.
- Accounting *Close period* does not close anything (it opens the pre-check workspace); the checklist binder is dead.
- Corporate Actions *Import notice* / *+ New event* open the CA-26091 election drawer; the *All / Election / Income / Reorg* filter does not filter and shows "Chart period updated".
- Regulatory *Submit filing* stays enabled after filing; the v16 regulatory hub is never injected.
- Financing collateral total hard-coded 4.18; funding-plan rows static; funding-point click does nothing.
- Unknown second-level type falls back to the work queue; unknown ID shows the first record.
- Toasts render unescaped HTML.
- Copilot answers are not entitlement-filtered.
- Replace the existing bullet "Admin regulatory renderer targets a non-existent container (`#v15RegRows`)" with the fuller statement: V15 regulatory, model, financing and data-product screens are all unreachable.

**Appendix A — Traceability**
- Accounting (5.A.19): API resources `/accounting/*` [P]; current Prototype.
- Financing (5.A.20): entities `financing_facilities`, `margin_calls`, plus `margin_statement_imports` (hash, rows).
- Data Fabric (5.A.23): drop `/integrations` (moved to Settings); keep `/data-quality`, `/lineage`.
- Settings (5.A.27): requirements FR-SET-001, FR-DATA-001; API `/admin/settings`, `/integrations`; entities `settings`, `integrations`.
- RBAC (5.A.26): add `/admin/access-context`, `/admin/users/{id}/mfa-reset`, `/admin/roles/{key}/permissions`, `/admin/access-review.csv`; entities add `invitations`, `user_mfa_factors`, `settings(access_policy_extra)`.
- Audit (5.A.28): API `/admin/audit-events`, `/admin/audit-events.csv`, `/admin/audit-events/verify`.
- Add row: Record detail page (5.A.29) | FR-NEW(PLAT) addressable second level | parent page resources | parent entities.
- Add row: Shared overlays (5.A.30) | FR-DOC-001/003/005, FR-OMS (routing) | `/documents/*`, `/reports/*`, `/orders/{id}/route` | documents, document_versions, reports, broker_instructions.
- The "Role → page coverage" note: add that the Auditor lacks `dashboard.view` (no Command Centre or Copilot) and that `cash.approve`, `admin.rbac` and `admin.settings` are not editable in the UI.

**Appendix B — Status vocabularies**
- Margin call: order as implemented **Disputed, Due, Funded** (transition Disputed → Due → Funded).
- Add Financing facility: Current, Review.
- Add Corporate action (control state): Election required, Review, Projected. Types: Voluntary, Choice, Mandatory.
- Add Regulatory filing: In preparation, Validated, Attested, Filed. Obligation chip: Draft, Review, Ready.
- Add Model: Draft, Independent validation, Validation due, Production.
- Integration: replace with `not_connected, configured, testing, healthy` [O] (keep `degraded, failed` as [P]).
- Add Data connection: Live, Sandbox. Data product: Certified. DQ impact: NAV / reporting, Filing.
- Add Staff user access: Active, Privileged, Read only, Invited, Disabled.
- Add SoD finding severity: block, warn, ok.
- Add Document lifecycle (live): Draft, In review, Approved, Published (+ withdrawn).

**Appendix C — Prototype persistence to replace**
- `matanho-rbac-v8`: note it is **ignored in live mode** (replaced by `roles`, `role_permissions`, `user_roles`, `policies` and `settings.access_policy_extra`).
- `matanho-settings-v8`: ignored in live mode, **but live persistence currently fails** (nested `letterhead`). Replace with `settings.workspace` plus a letterhead record with a logo asset.
- `matanho-v37-models`: the correct key. **Remove `matanho-models-v37`** (does not exist). Also note `matanho-model-register.csv` is an export file name, not a store.
- `matanho-v52-financing`: add that it contains `imports` (staged statement metadata with SHA-256) → `margin_statement_imports`.
- `matanho-v55-integrations`: add that secrets are never stored (target `integrations.secret_ref`).
- Add in-memory (lost on reload): Data page connections list; regulatory workflow flags; model wizard draft; settings configuration-audit list; Copilot conversation; report editor drafts; corporate-action elections → target `integrations`, `regulatory_filings`, `model_versions`, `audit_events`, `copilot conversations`, `reports`, `ca_elections`.
- Add UI-only (unwired) values: the Digital KYC policy card (auto pre-screen, 35 threshold, 1,000,000 EDD threshold) → `settings` (KYC policy) consumed by the KYC engine.
