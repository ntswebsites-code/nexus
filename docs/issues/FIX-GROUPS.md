# Fix groups for the browser-QA issues

Issue sources (full steps, expected, actual, evidence): `docs/issues/ISSUES-admin-a.md` (ADA-*), `ISSUES-admin-b.md` (ADB-*), `ISSUES-lp-custodian.md` (LPC-*), `ISSUES-investee-onboarding.md` (INO-*).
Severity mapping: blocker = critical, polish = minor.

## Rules for every fix agent

1. Work in your own git worktree; first run `git reset --hard feat/admin-recon-nav`. Commit there with a message ending `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`. NEVER push. Never commit secrets; never print credentials.
2. Read the full entry of each of YOUR issues (and the entries just before/after it for context), reproduce the cause in the code, **fix the root cause, not the symptom**, do not change unrelated code, do not refactor, do not rename. If an issue turns out not to be a defect (already fixed by the native rewrites, or intended by the SRD), say so with evidence instead of changing code.
3. Only edit the files you own (list below). If a fix needs a file owned by another group, do NOT edit it; record it under "Needs other group" in your report instead.
4. For every issue write into `docs/issues/FIXES-<group>.md`: issue id, root cause, what changed, files, how to re-test in the browser (exact steps and expected result), and status (fixed / not-a-defect / needs-other-group / not-fixed + reason). Append as you go.
5. Verify: `npx prisma validate` + `npx prisma generate` if you touched the schema (dummy `DATABASE_URL`/`SHADOW_DATABASE_URL`), `npx tsc --noEmit` in `backend/api` and every workspace you touched, and `npm run build -w @matanho/<portal>` for every portal you touched (a past merge broke `next.config.ts` and tsc did not notice). New migrations only if essential; use prefix `20261120<group number>` e.g. `202611201`; generate SQL stdout-only and grep for `Update available|pris.ly|npm i`. Check VARCHAR widths for composite keys.
6. New or changed seed data must keep `seed-uat.ts` and `seed-demo.ts` idempotent.
7. Keep your final reply under 100 words: counts fixed / not-a-defect / needs-other-group, files, branch name.

8. **NO BROWSER ACTIVITY OF ANY KIND** (owner instruction, overrides everything above and earlier briefs): do not open pages, click, navigate, screenshot, or read the browser console/network. Verify with non-browser means only: unit/integration/API tests, direct endpoint calls, builds, type checks, lint. If something can only be confirmed in a browser, list it in your FIXES file under "Not browser-verified".

## Groups and file ownership (disjoint; only the owner edits these)

### F1 Fund ops, cash, capital calls, notices, reconciliation display
Issues: ADA-015 (critical, cash tabs crash: client reads `r.data.length` after the api helper stripped `data`), ADA-017, ADA-021, ADA-022, ADA-023, ADA-026, ADA-027, ADA-030, ADA-031.
Owns: `backend/api/src/modules/{cash,ops,recon,opsctl,corporate-actions}`, `backend/api/prisma/seed-{cash,corporate-actions,recon,recon-ops,opsctl}.ts`, `portals/admin-web/src/app/(ops)/ops/{cash,capital-calls,distributions,funds,notices,bank-instructions,reporting,custodian,reconciliation,operations,corporate-actions,dealing,term-sheets,investee-requests}/**`, `portals/admin-web/src/ops/{cash,CashJournalForm,recon*,opsinsights,commandpanels,SourcesTab,BreakExtras}*`.

### F2 Orders, NAV, accounting, risk, Today dashboard, portfolios
Issues: ADA-006, ADA-007, ADA-009, ADA-011 (NAV maker-review 500 after commit: find the DB connection/transaction error), ADA-012, ADA-013 (make NAV stale-price age calculation consistent with the Securities page; do not edit securities code), ADA-016, ADA-018, ADA-020. Also field-level validation wording for NAV/orders only through the existing error envelope.
Owns: `backend/api/src/modules/{nav,orders,risk,accounting,wiring}`, `backend/api/prisma/seed-{nav,orders,risk,accounting,wiring}.ts`, `portals/admin-web/src/app/(ops)/ops/{nav,orders,risk,accounting,command,portfolios}/**`, `portals/admin-web/src/ops/{orders,nav,risk,accounting,JournalForm}*`.

### F3 Personas, auth, sessions, shell, shared UI, roles, settings, validation errors
Issues: ADA-001, ADA-002, ADA-003, ADA-004 and LPC-001 (portals share one `nexus_session` cookie on localhost: namespace the cookie per portal outside production or otherwise fix so two portals/personas do not overwrite each other, update every portal's proxy through packages/portal-kit only), ADA-005, ADA-010 + ADB-014 + LPC-015 + LPC-006 (make validation errors across the platform return field-level details in the shared error envelope and show them in the shared form components; owner of `middleware/validate.ts`), ADA-014 (replace `window.confirm` in the shared ActionButton with an in-app confirm dialog), ADA-024 (seed: records must not be owned by the only persona able to progress them; add personas), ADA-025 (501/stack trace leaks: never return stack traces or absolute paths), ADA-028, ADA-029, ADB-012 (show disabled controls with a reason instead of silently hiding), ADB-020 (shipped roles must satisfy the SoD catalogue), ADB-021, ADB-026 (mobile sidebar toggle), ADB-027, ADB-028, INO-026 (forgot-password link + working reset page in all five portals via portal-kit), LPC-005 (consistent error envelope for e-sign endpoints). **Test accounts (owner instruction):** create dedicated test-only personas in the UAT seed with the right roles to approve/route/fill orders, release NAV, post accounting, run cash approvals, process corporate actions, approve term sheets, custodian day-end approve; passwords only in the git-ignored secrets file; document persona names (no passwords) in `docs/LOCAL-STACK.md`.
Owns: `backend/api/src/{middleware,lib,config}/**`, `backend/api/src/modules/{identity,admin,admin-core,search,notifications}`, `backend/api/prisma/{seed-uat.ts,seed-admin-core.ts,seed-admin-shell.ts,seed/role-catalog.json}`, `packages/portal-kit/**`, `packages/shared/**`, `portals/admin-web/src/ops/{Shell,api,session,StepUp,ui,shell,admin-core}*` and `portals/admin-web/src/app/(ops)/ops/{rbac,settings,security,profile,audit,copilot,notifications,record}/**`, every portal's `src/proxy.ts` and `src/app/(auth)/**`, `docs/LOCAL-STACK.md`.

### F4 Market data, securities, integrations
Issues: ADA-008, ADA-019 (prices dated today with -94% moves), ADB-022, ADB-024 (feeds accept absurd prices: add sanity bounds, exception records and an undo/rollback for a simulated run), plus stale-price warnings on valuations (ADA-008).
Owns: `backend/api/src/integrations/**`, `backend/api/src/modules/portfolio/**`, `backend/api/prisma/seed-{market-data,portfolio}.ts`, `portals/admin-web/src/app/(ops)/ops/{securities,integrations}/**`, `portals/admin-web/src/ops/market-data.tsx`.

### F5 IBOR, performance, portfolio lab, private markets, research, financing
Issues: ADB-001..ADB-011 (ADB-010 research form: show per-field errors locally in the research form component), ADB-023 (model id clash MDL-1001/1002 between Portfolio Construction and Model Governance: change the Portfolio Construction reference prefix and migrate seeded refs idempotently).
Owns: `backend/api/src/modules/{ibor,performance,portfolio-lab,private-markets,research,financing}`, `backend/api/prisma/seed-{ibor-performance,research-privates}.ts`, `portals/admin-web/src/app/(ops)/ops/{ibor,performance,portfolio-lab,private-markets,research,financing}/**`, `portals/admin-web/src/ops/{rp}*`.

### F6 Clients, services, vault, reports, regulatory, data, models, staff e-sign, admin onboarding review
Issues: ADB-013, ADB-015, ADB-016, ADB-017, ADB-018, ADB-019, ADB-025 (staff e-sign signers need a Sign action in the admin console), INO-025 (admin onboarding case shows Clear/Low risk with zero checks).
Owns: `backend/api/src/modules/{clients-onboarding,reports,regulatory,data-fabric,model-governance,esign,opsctl-none}`, `backend/api/prisma/seed-{clients-onboarding,reports,esign}.ts`, `portals/admin-web/src/app/(ops)/ops/{clients,investor-services,vault,onboarding,reports,regulatory,data,models,esign,investee-review}/**`, `portals/admin-web/src/ops/{suite,esign}*`.

### F7 Investee portal
Issues: INO-001..INO-021, INO-027, INO-028, INO-030 (not INO-026). INO-017 (term sheets cannot be signed: MFA setup needed; add the in-portal path to enrol MFA inside company-web), INO-007/008 (cap table transactions and maker withdraw), INO-016 (no hard-coded demo fallbacks).
Owns: `portals/company-web/**` (except `src/proxy.ts` and `src/app/(auth)/**`), `backend/api/src/modules/{investee-portal,company}/**`, `backend/api/prisma/seed-investee*.ts`.

### F8 LP portal
Issues: LPC-002, LPC-003, LPC-004 (e-sign typed name must match the signer; applies to the shared sign endpoint: coordinate by only changing `lp-portal` side and `modules/esign/public.*` verification if essential — F6 does not touch that file), LPC-007, LPC-008, LPC-009, LPC-010, LPC-022 (critical, request detail/reply always REQ-2017), LPC-023, LPC-024, LPC-025, LPC-026. LPC-001 is F3.
Owns: `portals/investor-web/**` (except `src/proxy.ts`, `src/app/(auth)/**`), `backend/api/src/modules/lp-portal/**`.

### F9 Custodian and onboarding portals
Issues: LPC-011..LPC-021 (LPC-017 critical: amend dialog strips trailing zeros so quantity silently becomes 5), INO-022, INO-023, INO-024, INO-029 (and verify whether the native rewrites already fixed any; mark not-a-defect with evidence).
Owns: `portals/custodian-web/**`, `portals/onboarding-web/**` (except `src/proxy.ts`, `src/app/(auth)/**`), `backend/api/src/modules/{custodian,kyc}/**`, `backend/api/prisma/seed-{onboarding,custodian}.ts`.
