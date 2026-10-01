# SECTION 4 (from the 5A-19-30 draft)

#### 4.1 Admin portal roles (corrected)

Sources:
- Prototype: `roleLabels` / `rolePermissions`.
- Runtime (live): `GET /api/v1/admin/access-context`, which returns `roleLabels`, `rolePermissions`, the caller's `roles` and the primary `role` (System Administrator if held, else the first role).
- Seed: `backend/api/prisma/seed/role-catalog.json`.

| Key | Label | Matrix column header | Purpose | Seed | Locked | Label |
| --- | --- | --- | --- | --- | --- | --- |
| `investment_director` | Investment Director | "Inv. Director" | Final investment authority; approves orders and cash-account changes. | Yes | No | [O] |
| `portfolio_manager` | Portfolio Manager | "Portfolio Manager" | Owns portfolios; creates orders and scenarios; reserves cash. | Yes | No | [O] |
| `dealer` | Dealer / Trader | "Dealer / Trader" | Creates orders and routes approved orders to brokers. | Yes | No | [O] |
| `analyst` | Investment Analyst | "Inv. Analyst" | Research, models, reports. No order, client, cash or operations access. | Yes | No | [O] |
| `compliance` | Compliance Officer | "Compliance Officer" | KYC decisions (`onboarding.manage`), risk cases, client master, cash approval. | Yes | No | [O] |
| `operations` | Operations | "Operations" | Cash journals, imports, reservations, period close, reconciliations. | Yes | No | [O] |
| `fund_accountant` | Fund Accountant | "Fund Acct." | NAV, accounting, journals, statement imports, cash close. | Yes | No | [O] |
| `client_services` | Client Services | "Client Svc." | Client master, onboarding cases (`onboarding.manage`), investor servicing. No risk, financing, operations or valuation access. | Yes | No | [O] |
| `auditor` | Auditor | "Auditor" | Read-only evidence access. **No `dashboard.view`**: cannot open the Command Centre or Copilot; lands on the first permitted page. | Yes | No | [O] |
| `system_admin` | System Administrator | *(no column; protected)* | Users, roles, policy, settings, audit. No monetary permissions. The bundle cannot be edited (server returns 403 `role_locked`); re-seeding forces it back to the catalogue. | Yes | **Yes** | [O] |
| *custom* | user-defined label | label | Created in the role builder from a template or blank (`dashboard.view` only). Key = slug of the label, de-duplicated. `custom = true`. | No | No | [O] |

Notes:
- Live users can hold several admin roles; effective permissions are the union of all held roles. In live mode the prototype role switcher lists only the user's own roles, plus "Preview · {label}" when previewing. [O]
- The prototype stores role changes in `localStorage['matanho-rbac-v8']`. This is ignored in live mode. [O]
- Re-seeding adds only catalogue permissions not applied before. Permissions an administrator removed stay removed, except on locked roles. [O]

#### 4.2 Admin permission matrix — as seeded and at runtime

Legend: ✓ = granted. **UI** = toggleable in the RBAC matrix (M) or not shown (—). "Seed" and "Runtime" differences are flagged in the last column.

| Permission | UI | Dir | PM | Dealer | Analyst | Compl. | Ops | FundAcc | ClientSvc | Auditor | SysAdmin | Seed vs runtime |
|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|---|
| `dashboard.view` | M | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | | ✓ | same |
| `portfolio.view` | M | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | same |
| `orders.view` | M | ✓ | ✓ | ✓ | | ✓ | ✓ | ✓ | | ✓ | ✓ | same |
| `orders.create` | M | ✓ | ✓ | ✓ | | | | | | | | same |
| `orders.approve` | M | ✓ | | | | | | | | | | same |
| `orders.route` | M | | | ✓ | | | | | | | | same |
| `research.view` | M | ✓ | ✓ | ✓ | ✓ | | | | | | ✓ | same |
| `research.edit` | M | ✓ | ✓ | | ✓ | | | | | | ✓ | same |
| `risk.view` | M | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | | ✓ | ✓ | same |
| `risk.manage` | M | | | | | ✓ | | | | | ✓ | same |
| `clients.view` | M | ✓ | ✓ | | | ✓ | ✓ | | ✓ | ✓ | ✓ | same |
| `clients.edit` | M | | | | | ✓ | | | ✓ | | ✓ | same |
| `onboarding.view` | M | ✓ | ✓ | | | ✓ | ✓ | | ✓ | ✓ | ✓ | same |
| `onboarding.manage` | M | ✓ | | | | ✓ | | | ✓ | | | **Seed: present.** Prototype base bundles lack it and inject it at load; prototype *Reset defaults* removes it until reload (DEFECT) |
| `reports.view` | M | ✓ | ✓ | | ✓ | ✓ | | ✓ | ✓ | ✓ | ✓ | same |
| `reports.create` | M | ✓ | ✓ | | ✓ | ✓ | | ✓ | ✓ | | ✓ | same |
| `documents.view` | M | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | same |
| `documents.edit` | M | ✓ | ✓ | | ✓ | ✓ | ✓ | ✓ | ✓ | | ✓ | same |
| `operations.view` | M | ✓ | ✓ | ✓ | | ✓ | ✓ | ✓ | | ✓ | ✓ | same |
| `valuation.view` | M | ✓ | ✓ | | | ✓ | ✓ | ✓ | | ✓ | ✓ | same |
| `audit.view` | M | ✓ | | | | ✓ | ✓ | ✓ | | ✓ | ✓ | same |
| `cash.view` | M | ✓ | ✓ | ✓ | | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | same |
| `cash.approve` | **—** | ✓ | | | | ✓ | | | | | | same; **not shown in the matrix UI** (cannot be granted or revoked in the UI); the server treats it as monetary |
| `cash.journal.create` | M | | | | | | ✓ | ✓ | | | | same |
| `cash.journal.approve` | M | | | | | | ✓ | ✓ | | | | same |
| `cash.reservation` | M | | ✓ | ✓ | | | ✓ | | | | | same |
| `cash.import` | M | | | | | | ✓ | ✓ | | | | same |
| `cash.close` | M | | | | | | ✓ | ✓ | | | | same |
| `admin.rbac` | **—** | | | | | | | | | | ✓ | same; not in the matrix UI (locked role) |
| `admin.settings` | **—** | | | | | | | | | | ✓ | same; not in the matrix UI |

Notes:
- The seed catalogue equals the prototype bundles plus `onboarding.manage` for Director, Compliance and Client Services. Q-03 is resolved in the seed. [O]
- Hard-coded role checks bypass the codes. Example: cash match confirmation requires the role `operations` or `fund_accountant` itself, not a permission. [O]
- Page gates: see the permission column in each 5.A header. The detail page (5.A.29) inherits the parent page's gate. [O]
- Protected monetary codes differ by layer:
  - server `MONETARY` = orders.create, orders.approve, orders.route, cash.approve, cash.journal.create, cash.journal.approve, cash.close;
  - prototype SoD list = the same **without** `cash.approve`. [O]

#### 4.5 Segregation-of-duties rules (corrected)

| ID | Rule | Enforcement today | Label |
| --- | --- | --- | --- |
| BR-001 | A user may not approve an item they created. | Live API: cash-account checker (when `cash_approval` is on), capital events (`cash_approval`), documents (`document_approval`), investor publications (`client_publish_approval`). Prototype: order approval blocks the **maker's role** (not the user) while order approval = independent. No enforcement for journals, NAV, elections, reconciliation sign-off or reports. | [O] partial |
| BR-002 | `system_admin` must never hold a monetary permission. | Server SoD scan flags any of MONETARY (includes `cash.approve`). The server also forbids editing the locked system_admin bundle (403 `role_locked`). The UI hides the system_admin column. | [O] |
| BR-003 | Order approval and routing are held by different people. | Seed bundles only (orders.approve = Director; orders.route = Dealer). Not checked by the SoD scan. | [O] seed only |
| BR-004 | ~~At least two active users must hold `admin.rbac`~~ — **contradicted.** | The server enforces **at least one** active System Administrator (409 `last_admin` "At least one active System Administrator must remain"). The SoD scan flags **more than two** System Administrators ("Privileged account count"). Assigning or removing System Administrator requires a browser confirm. | [O] |
| BR-005 | ~~Relaxing any policy toggle is flagged by the SoD scan~~ — **contradicted.** | Only relaxed order approval and cash approval (block) and relaxed document approval (warn, server only) are flagged. NAV approval, bank-detail approval, the MFA toggle and the session timeout are **never** flagged. | [O] |
| BR-006 | Bank instruction changes require dual approval and out-of-band verification. | Policy value `bankApproval` (dual / independent) is stored in setting `access_policy_extra` but **not enforced** by any API. | [O] copy |
| BR-NEW | No user may hold `admin.rbac` together with any monetary permission through combined roles. | Server SoD scan finding "Access control combined with money movement" (block, action "Split roles"). Not prevented at assignment time. | [O] |
| BR-NEW | Users holding `admin.rbac` or `cash.approve` must have a verified MFA factor. | Server SoD scan finding "Privileged user without MFA" (warn, action "Enforce MFA"). | [O] |
| BR-NEW | An administrator cannot remove their own access-control permission, whether through their own role assignment or through the bundle of a role they hold. | 409 `self_lockout`: "You cannot remove your own access-control permission" / "You cannot remove access control from a role you hold". | [O] |
| BR-NEW | An administrator cannot reset their own second factor or disable their own account. | 409: "Ask another administrator to reset your own second factor" / "You cannot disable your own account". | [O] |
| BR-NEW | Every RBAC, policy, user and role mutation requires MFA step-up within the last 5 minutes. | Server returns 401 `step_up_required` → the UI prompts for a code. A user without a factor passes unless `mfa_required` is on, in which case the server returns 401 `mfa_enrolment_required`. | [O] |
| BR-NEW | Document approval relaxed must be surfaced. | Server SoD scan finding "Document approval relaxed" (warn). | [O] |
| BR-NEW | Every RBAC, policy and settings change and every audit or access-review export writes an audit event (`role.created`, `role.permissions_changed`, `staff_user.invited`, `staff_user.roles_changed`, `staff_user.mfa_reset`, `staff_user.enabled/disabled`, `policy.updated`, `settings.updated`, `access_review.exported`, `audit.exported`). | Server. | [O] |

Local (prototype) SoD scan rules:
1. order approval ≠ independent;
2. cash approval ≠ independent;
3. more than 2 System Administrators;
4. system_admin holds orders.create / orders.approve / orders.route / cash.journal.create / cash.journal.approve / cash.close.

In live mode the server list replaces the local list. The KPI counts every non-ok server finding, including warnings. [O]

Policy defaults:
- Server: order_approval = true, cash_approval = true, document_approval = true, client_publish_approval = true, **mfa_required = false**, kyc_dual_control = true, session_idle_minutes = 30 (capped by server configuration).
- Prototype UI defaults: MFA checked (true), NAV = independent, bank = dual.

Q-88: Should `mfa_required` default to true for the admin portal, matching the prototype UI? — default: true in production.

---
