# Fixes F3: personas, auth, sessions, shell, shared UI, roles, settings, validation errors

Verification: `tsc --noEmit` clean in `backend/api`, `packages/portal-kit`, `packages/shared`, `portals/admin-web`. `next build --webpack` passes for admin, company, custodian and onboarding (Turbopack cannot follow the junctioned `node_modules` of a worktree). `investor-web` fails to build on `src/components/lp-portal/screens/lp-performance-screen.tsx` ("stream did not contain valid UTF-8"): an existing encoding fault in an F8 file, not touched by F3. No schema change, no migration.

Re-test prerequisite for persona items: re-run `prisma/seed.ts` then `seed-uat.ts` (with `SEED_USERS_FILE=secrets/uat-users.json`) so the new roles, revocations and test personas exist. Test persona names are in `docs/LOCAL-STACK.md`; their passwords are in the git-ignored `secrets/uat-users.json`.

## ADA-001 order lifecycle untestable: FIXED
Root cause: one persona held `orders.approve` and also created every order; nobody held `orders.route`. Change: new test personas `test_portfolio_manager` (creates), `test_approver` (approves), `test_dealer` (routes and fills) in `seed-uat.ts`; shipped roles made SoD-clean (Investment Director no longer has `orders.create`, Dealer no longer has `orders.create`). Files: `prisma/seed-uat.ts`, `prisma/seed/role-catalog.json`, `prisma/seed-admin-shell.ts`, `docs/LOCAL-STACK.md`. Re-test: sign in as `test_portfolio_manager`, create and submit an order; as `test_approver` approve it (no SoD error); as `test_dealer` route and fill. Note: orders seeded before the change keep their original maker (F2 owns `seed-orders.ts`, which already prefers a portfolio manager as maker on a fresh database).

## ADA-002 local_admin view-only: NOT-A-DEFECT (documented)
System Administrator is deliberately view-only on money flows (it holds `admin.rbac`; the SoD catalogue forbids it holding orders/NAV/posting rights). `docs/LOCAL-STACK.md` now says so and points to the test personas. After ADB-020 it also lacks `admin.settings` (see that item); use `test_settings_admin` for Settings.

## ADA-003 step-up silently skipped: NOT-A-DEFECT (documented bypass)
`requireStepUp` passes when no factor is enrolled and `mfa_required` is off, by design. `docs/LOCAL-STACK.md` documents the bypass and how to exercise step-up (enrol an authenticator in Profile, or seed with `SEED_UAT_MFA_REQUIRED=1`).

## ADA-004 + LPC-001 shared session cookie across portals: FIXED
Root cause: cookies are not scoped by port, so all portals on `localhost` shared one `nexus_session`. Change: outside production, `createCors` (`backend/api/src/config/cors.ts`, runs before cookie-parser) maps the cookie to `nexus_session_<port>` for browser calls from a local portal origin (port taken from `Origin`/`Referer`), renaming on the way in (header) and out (`res.cookie`/`res.clearCookie`), so auth code is unchanged; production keeps the single plain cookie. `portal-kit/src/proxy.ts` reads its own port's cookie (from the Host header) and forwards it to `/api/auth/me` under the plain name. Files: `backend/api/src/config/cors.ts`, `packages/portal-kit/src/proxy.ts` (all five portals pick it up). Re-test: sign in as admin on :48221, then as an LP on :48222 in the same browser; reload :48221, still the admin; sign out of one, the other stays signed in. Existing browsers: sign in again once (old plain cookie is ignored). The `127.0.0.1` non-hydration part is a Next `allowedDevOrigins` setting in each portal's `next.config.ts` (not owned by F3); the doc now says to use `localhost` and a second browser profile for same-portal personas.

## ADA-005 slow hard navigation, two 401s: NOT-FIXED (cause is dev-mode compile, partly the cookie clash)
API calls measure 40-200 ms; the splash time is `next dev` compiling plus the auth bootstrap, absent in a production build. The session provider only renders pages after `/api/auth/me` succeeds, so the 401 console entries most likely came from the cross-portal cookie overwrite fixed under ADA-004; re-check after that fix. No code change.

## ADA-010 + ADB-014 + LPC-015 + LPC-006 field-level validation errors: FIXED (shared layer); other parts NEEDS-OTHER-GROUP
Root cause: `validateBody`/`validateQuery` forwarded raw zod text and the error envelope never surfaced `details`. Change: `middleware/validate.ts` turns zod defaults into readable phrases with the field name ("Reason is required", "Rationale must be at least 5 characters", "Quantity must be a number"), keeping schema-authored messages as written; `middleware/errorHandler.ts` adds a `fieldErrors` map (`error.fieldErrors` and top level) and appends the first three reasons to the message ("Validation failed. Rationale must be at least 5 characters"), which also covers the many hand-thrown `HttpError.badRequest('Validation failed', [{path,message}])` calls; so every admin form that shows `message` (`describeError`, `useAction`, `FormModal`) and the portal-kit auth forms show the reason. `ApiErrorBody` in `packages/shared/src/auth.ts` gained the optional fields. Files: `middleware/validate.ts`, `middleware/errorHandler.ts`, `packages/shared/src/auth.ts`. Re-test: NAV create with accruals "abc", Resolve exception with rationale "ok", custodian amend without a reason: the red banner now names the field and rule. Needs other group: LPC-006 (LP endpoints accept bad `period`, `asOfDate`, `status`, `currency`, `lpRole`) is route-level validation inside `modules/lp-portal` (F8); LP forms in F8/F5 that render their own per-field errors (ADB-010) can read `fieldErrors`.

## ADA-014 native window.confirm in ActionButton: FIXED
`ui.tsx` `ActionButton` now opens an in-app `ConfirmDialog` (new shared export, built on `Modal`) instead of `window.confirm`. Files: `portals/admin-web/src/ops/ui.tsx`. Re-test: NAV maker review / release shows a modal with Cancel and the action button; confirming sends the request. Other `window.confirm` callers (security page, `recon/RunTab.tsx`, `recon/SourcesTab.tsx`) were outside the issue and are unchanged (recon files belong to F1; they can use `ConfirmDialog`).

## ADA-024 seeded records owned by the only persona able to progress them: FIXED
Term sheets: `seed-uat.ts` now authors seeded term sheets as `test_portfolio_manager` (fallback analyst) and reassigns untouched Draft ones still owned by the director. Custodian day-end `DAY-DEMO1`: submitted by a custodian user in `seed-recon.ts` (F1 file); instead of editing it, `test_custodian_approver` (same counterparty CP-001, approver role) is added so the other custodian user's submission can be approved. Orders: see ADA-001. Re-test: as `test_portfolio_manager` submit TS-103-01, as `test_compliance` approve; custodian portal as `test_custodian_approver` approve DAY-DEMO1 (or as the other custodian persona, whichever did not submit it).

## ADA-025 stack traces and absolute paths in responses: FIXED (api errorHandler); NEEDS-OTHER-GROUP for two module handlers
`errorHandler` no longer returns `details.stack` for any status; unhandled errors are logged server-side only. Re-test: `GET /api/v1/ops/dealing` returns `{error:{code:"not_implemented",message:...}}` with no `details.stack`. Remaining leaks in `modules/lp-portal/lp.http.ts` (line ~110, F8) and `modules/investee-portal/investee.http.ts` (line ~31, F7) add `stack` in non-production; those groups should drop it.

## ADA-028 sidebar not permission-filtered: NOT-A-DEFECT (already addressed)
`Shell.tsx` already dims and disables links the role lacks (`aria-disabled`, tooltip "Your role does not include this area") and honours the role-focus lens. The wrong permission named on Accounting ("valuation.view") is in `app/(ops)/ops/accounting/page.tsx` (F2). The slow "Loading orders..." state is the dev-compile note under ADA-005.

## ADA-029 dead "Back to the investment workspace" link; "Welcome, UAT": PARTLY FIXED
Removed the dead sidebar footer link (`/` only redirected to `/ops`). The "Welcome, UAT" greeting is in `app/(ops)/ops/page.tsx`, which no group owns; it should use the full name. NEEDS-OTHER-GROUP (unowned file).

## ADB-012 gated actions silently absent: FIXED (shared mechanism); call sites NEEDS-OTHER-GROUP
`ActionButton` takes `requires` (permission code or list). Without it the button stays visible, disabled, with a title and note "Needs <permission>". Files: `ops/ui.tsx`. The financing, portfolio-lab, onboarding and clients drawers are F5/F6 files; they must pass `requires=` (or render a disabled button) at each hidden action. Also note ADB-020 means System Administrator will still lack these by design.

## ADB-020 shipped roles violate the SoD catalogue: FIXED
Computed every shipped admin role against `SOD_RULES`: 21 role-level conflicts across 7 roles, now 0. Removed: Investment Director `orders.create`, `accounting.post`, `financing.manage`, `portfolio.manage`, `research.edit`, `reports.create`; Portfolio Manager `research.ic.decide`; Dealer `orders.create`; Compliance `financing.manage`, `reports.create`, `reports.submit`, `risk.manage`; Operations `cash.journal.approve`, `cash.close`; Fund Accountant `cash.journal.create`, `accounting.close`, `valuation.release`; System Administrator `admin.settings` (new role Platform Settings Administrator carries it, persona `test_settings_admin`). `prisma/seed.ts` only adds permissions, so the catalogue lists them under `retiredPermissions` and `seed-admin-shell.ts` revokes them from existing databases (idempotent). "Last sign-in" now shows date and time (`modules/admin/admin.routes.ts`). The "27 pairs" text was already computed from the rule list. "All staff have no MFA" is policy/enrolment, not seed data (documented under ADA-003). Re-test: RBAC > Segregation of duties shows no role conflicts; Security page lists the same rule count as the text.

## ADB-021 settings copy and raw values: FIXED
Footer "Settings marked recorded" only shows when some setting is unenforced; enum values render humanised ("In app email"); lede says the authenticator code is needed once one is enrolled. File: `app/(ops)/ops/settings/page.tsx`.

## ADB-026 mobile sidebar: FIXED
Sidebar is an off-canvas drawer below 980 px with a hamburger button in the top bar and a scrim; closes on navigation. Files: `ops/Shell.tsx`, `app/(ops)/ops.css` (shared stylesheet, no owner listed; only the shell block was touched). Re-test at 375x812: content first, menu opens from the button.

## ADB-027 password change form: FIXED
Mismatch is already caught client-side (button disabled with hint); the weak-password reason now arrives via ADA-010. The device column shows "Chrome on Windows" style labels instead of the raw user agent (`profile/page.tsx`). Stale script sessions are real sessions and can be revoked from the list.

## ADB-028 shell details: FIXED (a, c); NOT-A-DEFECT / NOT-FIXED (rest)
(a) Notification dropdown no longer scrolls horizontally and wraps long text (`ops.css`). (c) Record page hides internal fields: id, ref, version, foreign-key uuids and `*Count` counters (`modules/search/registry.ts`), removing the "ACCOUNTS COUNT 5" conflict. (b) works as reported. (d) Next dev overlay and (e) 10 s reload are dev-mode behaviour; no change.

## INO-026 forgot-password entry and reset page: FIXED
All five portals render the shared `LoginForm`/`ResetPasswordForm`, and the form already had a "Forgot password?" step calling `/api/auth/password/forgot`. Fixed the dead ends: the reset page (missing token, form, bad token) now links to "Request a new reset link" (`/login?forgot=1`, which opens the request step directly) and "Back to sign in". Files: `packages/portal-kit/src/LoginForm.tsx`, `ResetPasswordForm.tsx`. Re-test on any portal: `/reset-password` with no or a bad token shows both links; the first opens the email form.

## LPC-005 e-sign error envelope: FIXED
E-sign routes use the shared `validateBody`; with the changes above their errors now carry readable messages and `fieldErrors`, and every error body also carries top-level `success:false`, `code`, `message`, `fieldErrors`, a superset of the LP envelope, so the LP client (which accepts both) gets one shape. No change to `modules/esign`.

## Needs other group (summary)
F8: LPC-006 route validation, `lp.http.ts` stack. F7: `investee.http.ts` stack. F2: Accounting page wrong permission name. F1: recon `window.confirm`, `DAY-DEMO1` seed owner. F5/F6: adopt `ActionButton requires` / per-field errors in their forms. Unowned: `/ops` overview greeting. F8 (or whoever owns it): `investor-web/.../lp-performance-screen.tsx` invalid UTF-8 breaks `next build`.

# Rework round

Verification: `tsc --noEmit` clean in `packages/shared`, `packages/portal-kit`, `portals/admin-web`, `portals/company-web` (the last three checked with a temporary `paths` tsconfig because inside a worktree `@matanho/*` resolves to the main checkout's older sources); `backend/api` tsc clean except pre-existing `prisma/seed-research-privates.ts` (F5: `nextRef` not imported). `next build --webpack` passes for admin-web (Turbopack fails only because of the worktree layout). company-web webpack build type-checks against the main checkout's stale portal-kit, so only the paths-based tsc is authoritative there. No schema change.

## Role seeding made additive (ADB-020 rollout risk): FIXED
`prisma/seed.ts` no longer trims locked roles (`deleteMany notIn` removed; locked roles are topped up only). `seed-admin-shell.ts` `retireCataloguePermissions` is now explicit: runs only with `SEED_APPLY_ROLE_RETIREMENTS=1`, logs every role and permission it removes, and skips `admin.settings` unless an active user holds `admin:settings_admin`. Default seeding never revokes anything, so System Administrator keeps `admin.settings` on live databases. The SoD-clean catalogue (`role-catalog.json`, with `retiredPermissions` and the `settings_admin` role) was restored: the merge had reverted it. Re-test: seed twice on an existing DB, `role_permissions` unchanged; with the flag and a settings_admin user, System Administrator loses `admin.settings`.

## Validation envelope (ADA-010/ADB-014/LPC-015/LPC-006 shared layer): REWORKED
`validate.ts`: removed the catch-all `Invalid*` rewrite; only zod's exact default sentences are rephrased, so "Invalid IBAN checksum" stays as written. `errorHandler.ts`: `message` is stable ("Validation failed") again; reasons live in `fieldErrors` (several per field are joined with "; ", none dropped). Clients render them: `describeApiError` (`packages/shared/src/auth.ts`) used by the shared `ApiError` and `EsignSigner`; `OpsError` in `ops/api.ts` appends the reasons, so every admin form still shows the field text. 5xx `HttpError`s are now logged (warn). Re-test: POST a NAV with accruals "abc": body message "Validation failed", `fieldErrors.accruals` set, banner shows both.

## ADA-014 confirm: security page converted
`security/page.tsx` uses `ConfirmDialog` for removing a permission code and for the retention purge (no `window.confirm` left in F3 files; `recon/RunTab.tsx` and `recon/SourcesTab.tsx` are F1's).

## ADB-018 stale error in ActionButton: FIXED
`ActionButton` clears its error when `disabled`, the missing-permission state, label, title or confirm text change, and shows a dismiss button. Re-test: regulatory pack action fails for a missing prerequisite, fix it, the red text disappears.

## ADA-029 "Welcome, UAT": FIXED
`app/(ops)/ops/page.tsx` greets with the full name.

## ADB-004 breadcrumbs: FIXED
`Breadcrumbs.tsx` `segmentLabel`: "position" -> "Position", "new-order" -> "New order"; ids with digits unchanged.

## ADB-023 refs.ts label: FIXED
`FORMATS.modelPortfolio` prefix is `PMD-` (Model Governance keeps `MDL-`). Settings > numbering shows it.

## ADA-019 old market-data route: FIXED
`admin-core/integrations.routes.ts` `/market-data/sync|simulate` now delegates to `refreshMarketData` (sanity bounds, exceptions, run record, undo) instead of writing VENDOR prices directly. Re-test: POST `/api/v1/admin-core/integrations/market-data/sync` returns a run summary; a wild quote becomes an exception.

## ADB-025 esign nav: FIXED
`ops/shell/nav.ts` shows E-signatures to every signed-in staff user (the page already renders the signer inbox and gates the rest). Staff signing still needs an enrolled authenticator when `mfa_required` is on.

## LPC-004 typed-name hint: FIXED (UI); API check is F6
`EsignSigner.tsx` (`EsignInbox` and public signer) shows "Type your registered name exactly: <name>", flags a mismatch and keeps Sign disabled until it matches (case, accents, spacing ignored).

## INO-001 login Continue link: FIXED
`LoginForm`/`LoginPage` take `turnAwayPortals`; the company login passes `['investor','custodian']`, so such accounts see "no access" with a sign-in-as-other option, and the company proxy turns custodian users away to `/access-denied` like investors.

## INO-009/010 seed KPIs, periods, revenue: FIXED
`tools/uat/seed-data/uat-seed.json`: ARR series and prev in dollars (budget was already dollars), period labels "Jul – Sep 2025", "Oct – Dec 2025", "Jan – Mar 2026". `seed-uat.ts`: accepted periods now carry per-quarter KPI values and `totalRevenue` (ARR/4), and existing databases get labels repaired and missing revenue added without touching workflow state.

## LPC-007 stray LP membership: FIXED
`seed-uat.ts` `seedMemberships` removes memberships a persona holds in a UAT client other than its own (seed-demo enrols unlinked investor users in the demo client).

## Not done / not a defect
- INO-030 unauthenticated unknown route redirects to `/login?next=`: not-a-defect, intended gated behaviour of the proxy.
- Vault document numbering `LP-DOC-` vs `DOC-`: not fixed; `LP-DOC` refs are keyed by the seed dataset and by other seeded rows, renaming risks existing databases.
- DAY-DEMO1 file/hash: F1 (`seed-recon.ts`); F3 side (second approver `test_custodian_approver`) already exists.
- Cookie namespacing: browsers send `Referer` on navigations, so download links keep working; no-referrer requests fall back to the plain cookie. `scripts/test-*.ts` resend the whole cookie pair with their Origin, so they work; only `test-lp-remainder.ts` expects the plain name for its manually supplied cookie.
- `nav_stale_days` label/description (F2 review): the value is a NAV policy key, not surfaced in the Settings screen; nothing to relabel there.
- `lp.http.ts` / `investee.http.ts` stack leaks: F8 and F7 files.
