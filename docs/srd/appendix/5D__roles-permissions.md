# ROLES & PERMISSIONS (from the 5D draft)

**NVCCZ (investee side)**
| Concept | Behaviour |
|---|---|
| Identity | One `users` row per company; role `applicant` (name "applicant", description "Applicant user role - can create and manage company profiles", permissions JSON: portfolio_company read/write, profile read/write, applications read/write, term_sheets read/write). Created at term-sheet creation if the applicant e-mail has no user; temporary password mailed (and logged: defect). |
| Applicant test | Two mechanisms: `isApplicant` (an `applications.applicantEmail` equals the user's e-mail) on profile/application/company/dashboard/term-sheet/drawdown routes; `requireApplicantRole()` (role `applicant`/code `APPLICANT`) on financial-reports and reporting routes. Letterhead routes use neither. |
| Company binding | `portfolio_companies.userId` unique (1 user ↔ 1 company); queries by `userId`. No team, no per-user permissions. |
| Staff access to investee data | Cap-table view: admin, fund manager, CIO, CFO, board chair/member/IC member, legal, corporate secretary, assigned analyst, company owner. Configure: admin, legal. Edit transactions: admin, fund manager, corporate secretary, legal. Approve/execute: admin, CIO, CFO. Term sheet create/update/finalise: admin, fund_manager, portfolio_mgr; investor signing: admin or "fund manager". Investee requisition approval: VC CFO or SYSADMIN; staff queue fund-scoped. Valuations/exit: admin, fund_manager, ceo, cfo. |
| Login | `portal:'investee'`; staff-portal login returns 403 for applicants. |

**Nexus (company side today)**
| Concept | Behaviour |
|---|---|
| Identity | `users` with no roles for the company portal; `company_users(company_id,user_id)` links; invitations carry `companyId` and `roleKeys: []`. Login form omits `portal`; investor-role accounts are turned away by the Next proxy only. |
| Context | `companyContext` = first `company_users` link by `createdAt` (multi-company users reach only one); no link → 403 `no_company_access`. |
| Guards | Session required (`requireAuth`, MFA-pending sessions refused); no permission codes; rows of other companies → 404. |
| Staff | Private Markets: VIEW = `portfolio.view`, REVIEW = `research.edit`; reviewer ≠ submitter always enforced; admin portal roles per `role-catalog.json` (no company or onboarding roles exist). |

**Mapping (proposed, no role-catalogue entries; access profiles stored on `company_users.profile` and evaluated by the API)**
| V8 access profile | Nexus capabilities (company scope) | NVCCZ equivalent |
|---|---|---|
| Workspace administrator | all pages; manage members, letterhead, company profile; approve; sign per authority | the single applicant user (all rights) |
| Executive approver | approve/submit reports, forecast versions, drawdown requests, consent requests; sign | applicant user |
| Report contributor | create/edit report drafts, upload evidence, vault upload | applicant user |
| KPI owner | submit period KPIs; read reports | applicant user |
| Finance editor | statements, forecast cells, request drafts | applicant user |
| Read only | view all company pages; no writes | not available |

| Capability | Admin | Exec approver | Contributor | KPI owner | Finance editor | Read only |
|---|:-:|:-:|:-:|:-:|:-:|:-:|
| View all pages | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Edit report drafts / upload evidence | ✓ | ✓ | ✓ | | ✓ | |
| Submit report pack | ✓ | ✓ | | | | |
| Submit period KPIs | ✓ | ✓ | | ✓ | ✓ | |
| Edit forecast cells | ✓ | ✓ | | | ✓ | |
| Submit forecast version | ✓ | ✓ | | | | |
| Create / edit request drafts | ✓ | ✓ | | | ✓ | |
| Submit request, answer drill-down | ✓ | ✓ | | | | |
| Request governance approval | ✓ | ✓ | | | | |
| Sign documents (if named signatory) | ✓ | ✓ | | | | |
| Upload to vault | ✓ | ✓ | ✓ | | ✓ | |
| Post messages | ✓ | ✓ | ✓ | ✓ | ✓ | |
| Manage team, letterhead, company profile | ✓ | | | | | |

**Gaps**
1. NVCCZ has one user per company and two inconsistent applicant checks; Nexus needs M:N membership with profiles and a single guard (company context + profile capability).
2. Nexus resolves only the first company for a user; V8 Company drawer implies a switcher.
3. No SoD inside the company (preparer ≠ approver) exists in either system; approval routes shown (CFO → CEO) are decorative.
4. Signing authority (matrix) is not modelled in either system.
5. Staff-side permissions needed in Nexus beyond `portfolio.view`/`research.edit` (candidate codes, to be decided with Q-04): `portfolio.terms.issue`, `portfolio.captable.edit`, `portfolio.captable.approve`, `portfolio.requests.review`, `portfolio.requests.approve`, `portfolio.governance.decide`, `portfolio.forecast.review`, `portfolio.vault.publish`.
6. Step-up MFA for signatures and approvals applies only to users with an enrolled factor while the MFA policy is off (Nexus H6).
7. Do not port: IDOR on letterhead, unguarded cap-table registry list/bootstrap, unfiltered company update, temporary passwords in logs.
