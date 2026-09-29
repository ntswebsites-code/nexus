# Domain entities implied by the prototype (NOT yet modelled)

The four portals are still a browser-side prototype: business data lives in
JavaScript arrays and `localStorage`. Per the project rules the database schema
is **not** invented up-front - only authentication / authorisation is modelled
in `backend/api/prisma/schema.prisma` today.

This file records what the UI implies, so the next migrations are driven by
real workflows instead of guesses. Nothing here is implemented.

## Already modelled (Prisma)

| Table | Purpose |
| --- | --- |
| `users` | Accounts shared by every portal (email, bcrypt hash, name). |
| `sessions` | Server-side sessions. Only the SHA-256 of the opaque cookie token is stored. |
| `roles` | Roles discovered in the prototype (`portal` + `key`). 14 rows, see below. |
| `role_permissions` | Permission codes per role, taken from the prototype. |
| `user_roles` | Which roles a user holds. |

### Roles taken from the prototype (`prisma/seed/role-catalog.json`)

* **admin portal (`index.html`, `rolePermissions` / `roleLabels`)** - 10 roles:
  `investment_director`, `portfolio_manager`, `dealer`, `analyst`, `compliance`,
  `operations`, `fund_accountant`, `client_services`, `auditor`, `system_admin`.
* **investor portal (`client-portal.html`, `data-entitlement`)** - 4 roles:
  `admin`, `investment`, `finance`, `auditor`.
* **onboarding / company portals** - no roles exist in the prototype, so none were invented.
  Any valid account can sign in there.

## Entities the UI implies (candidate tables)

Source = where the prototype keeps the data today.

| Candidate entity | Prototype source | Notes |
| --- | --- | --- |
| Client / relationship | `clients` array, `matanho-client-profiles-v10` | id `CL-#####`, type, owner, base currency, mandate, KYC state, risk. |
| Onboarding application | `matanho-onboarding-v10`, `public-onboarding` form | Multi-step (applicant, ownership, evidence, review) with uploaded documents. |
| Client cash account | `cashAccounts`, `matanho-cash-accounts-v43` | Maker/checker lifecycle, starts as `DRAFT`. |
| Order / instruction | `matanho-v37-orders`, `matanho-v53-submitted-orders`, `*-order-draft` | Draft -> validated -> awaiting approval. |
| Reconciliation case | `matanho-recon-v12`, `recon44` | Internal vs counterpart records, break workflow. |
| Counterpart import | `matanho-v53-counterpart-imports` | Uploaded broker / custodian / bank files. |
| Financing position | `matanho-v52-financing` | |
| NAV / valuation run | `navState` (in memory) | Maker/checker release. |
| Portfolio company reporting pack | `company-portal.html` | Accounts, board, compliance items and submit. |
| Audit event | Audit page (static data) | Should be written by the API for every state change once workflows exist. |

UI-only preferences (`matanhoFocus`, `matanho-v39-orders-metrics`, theme) are
deliberately left in the browser.

## Guidance for the next migrations

1. Specify one workflow at a time (e.g. onboarding submission) with the business owner.
2. Add its tables with `npm run db:migrate -- --name <change>`.
3. Expose it under `/api/...` behind `requireAuth` + `requirePermission(<code>)`
   using the permission codes that already exist in `role_permissions`.
4. Replace that slice of the prototype's `localStorage` code, keeping the markup and CSS untouched.
