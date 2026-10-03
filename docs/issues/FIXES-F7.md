# FIXES-F7: Investee portal (company-web, investee-portal/company API)

Branch: worktree of `feat/admin-recon-nav`. Verification: `tsc --noEmit` clean in `backend/api` and `portals/company-web`; company-web production build passes (`next build --webpack`; Turbopack cannot run inside a git worktree because `node_modules` is outside the worktree root, so webpack was used); runtime JS syntax-checked. No schema, seed or migration changes.

Common changes: error text no longer shows the raw `(status code)` pair and now names failing fields from the error envelope (`api.ts` `describe()`); validation failures from live actions are also shown at the top of the open modal/drawer (`inlineError` in the runtime, called from `InvesteePortal`).

Re-test prerequisites: sign in at the investee portal as `investee_101_contributor` / `investee_101_approver` (see docs/LOCAL-STACK.md).

## INO-001 fixed
Root cause: the shell rendered even when every API call returned 403 `no_company_access`. Change: the host detects that code and `InvesteePortal` replaces the shell with a "not linked to a portfolio company" panel (Sign out). Files: `InvesteePortal.tsx`, `host.ts`. Re-test: sign in as `custodian_approver_*` in another tab, open the investee root: panel shown, no sidebar/company name, no 14 failing calls shown as data. (Login-page "Continue" for such users lives in `(auth)`, owned by F3.)

## INO-002 fixed
Root cause: report modal used the demo period list, owner list and pre-filled demo financials. Change: in live mode periods come from `/reporting/requests` (open or returned only, labelled "Open · due 05 Sep 2026"), owners from `/team`, all values start blank or restore the saved draft; the host posts the selected request period (`periodKey`). Files: runtime JS, `host.ts`, `types.ts`. Re-test: Reporting Centre > Submit report: periods = real requests, owners = team members, inputs empty; Save draft for the open period succeeds.

## INO-003 fixed
Change: balance check runs before anything is posted; on Validate & submit the modal stays open with the message under the form and the toast (difference shown). Save draft still saves but its toast notes an unbalanced sheet. Totals are computed from the visible lines (they start at 0). Re-test: enter assets 100, liabilities+equity 90, Validate & submit: modal stays, inline error.

## INO-004 fixed
Draft workspace lists the real draft/returned reports (empty state otherwise); Templates lists the four real downloadable templates; Submission history and schedule show humanised status/type (no UUIDs or enums), schedule marks overdue periods. Re-test: Reporting Centre tabs.

## INO-005 fixed
Sidebar company/fund, avatar, role subtitle, footer health and period selector now come from live data (`profile.company.fundName`, `/health`); the demo period selector is hidden in live mode; shell defaults are neutral. Re-test: card shows company + "Matanho Growth Partners I"; footer "Connected to Matanho".

## INO-006 fixed
Root cause: API picks the oldest membership and the UI never sent `?company=`. Change: `/profile` returns `companies[]`; the company card opens a real switcher; the choice is kept per tab (sessionStorage) and sent as `?company=` on every call. Re-test: as investee_101_approver open the company card: PC-100 and PC-101 listed; switch to PC-101, team/term sheets are PC-101's.

## INO-007 fixed
Change: Cap Table shows a banner with the pending-transaction count; when the register has transactions (`locked` flag added to `/cap-table`) the dead "Add a holder" form is replaced by a link to Workspace tools > Cap table; the 409 text is friendly. Export register is a real client-side CSV download (not a defect). Re-test: Cap Table as contributor on PC-101: banner for CTX-0006, "Open cap-table transactions" button; Workspace tools lists and approves transactions.

## INO-008 fixed
New `POST /cap-table/transactions/:ref/withdraw` (maker only, `edit_draft`, status WITHDRAWN, audited); Workspace tools shows "Withdraw" on your own pending entries and Approve/Reject on others. Re-test: create a transaction as approver, click Withdraw: status "withdrawn".

## INO-009 fixed (residual needs-other-group)
KPI Centre now uses `/kpis` definitions (label, unit, latest value, budget, period) with a definition drawer and an Export history button; the export CSV adds one column per KPI definition and `/kpis/history` carries `metrics`. Residual (seed-uat.ts, F3): seeded ARR series is in millions while its budget is in dollars, and seeded period labels are wrong (Dec 2025 and Mar 2026 both "Jan - Mar 2026"). Re-test: KPI Centre cards show "Annual recurring revenue", units; Export history downloads numbers.

## INO-010 fixed (residual needs-other-group)
Backend `forecastSchema` rejects negative revenue; host rejects before sending. Residual: Jul-Sep actual revenue shows "-" because seeded accepted periods carry no `totalRevenue` (seed-uat.ts, F3); scenario headline cards are fixed 1.15x/0.8x multiples by design. Re-test: enter -100, Save forecast: error naming the month.

## INO-011 fixed
Send for signature and public sign now say what is missing (no document / no signer / name / consent box); field-level details from the error envelope are shown (signer e-mail, amount, etc.); negative request amount and past decision dates are rejected with named fields. Simulated upload zones are demo-only controls and remain (documented, not live features).

## INO-012 fixed
`publicSign` in `investee-portal/workspace/sharing.ts` rejects a typed name that differs from the invited signer (case, spacing, accents ignored) with a field error; the page prints the expected name. Re-test: open the e-mailed link, type "Wrong Name": error, request stays PENDING.

## INO-013 fixed
Workspace tables show "Loading..." until the data arrives (no "Nothing recorded yet" flash); approval text now says a code is requested only if two-factor sign-in is not set up. Re-test: Workspace tools > Cap table.

## INO-014 fixed
Share links (and the e-mail) now point to a portal landing page `/sign/share/<token>` (document, recipient, expiry, watermark notice, Download button) instead of the raw API file URL; the fresh link has Copy and Open buttons. The list cannot show old links again because only a token fingerprint is stored (by design). Re-test: create a link, copy, open it in a private window.

## INO-015 fixed
In live mode the request drawer shows only the record: fabricated "Request pack", "Fund owner", "Decision target" and the mock drill-down form are removed. Re-test: Requests > REQ-2055.

## INO-016 fixed
Root cause: a failed/slow flags call started the runtime in demo mode. Now flags are retried (3 attempts), and on failure a Retry panel is shown; the demo company is never used on failure. A failed dashboard call shows the page-level error with Retry (existing). Re-test: block `/platform/flags` in devtools and reload: error panel, no Zambezi Pay figures.

## INO-017 fixed
Added an in-portal two-factor enrolment path: "Set up two-factor authentication" on Settings (Security card), Signatures ("Who can sign"), the profile drawer and Workspace tools > Access and MFA; it opens the existing enrolment dialog and refreshes the status. Security card values are now live (`/settings`). Signing itself re-prompts if needed. Re-test: Settings > Set up two-factor, add the key to an authenticator, confirm a code, then sign TS-1001 as the PC-101 approver. Note: PC-100 has no term sheet, so Signatures is empty there (data).

## INO-018 fixed
Signatures page now includes workspace signature requests (SIG-xxxx) in the lists and counts; the static "Authority matrix" is replaced by the live members with signing authority. Re-test: Signatures after completing a workspace request.

## INO-019 fixed
Root cause: letterhead city was a hard-coded empty field and the letterhead was always sent. Now letterhead is pre-filled from `/letterhead`, all parts are validated before any write (e-mail, http(s) website, letterhead street/city/country), and only changed parts are saved. Backend rejects non-http(s) websites. Security card is live. Re-test: change Description, Save: one success toast; website `javascript:alert(1)`: error.

## INO-020 fixed
`/team` now lists pending invitations (status "invited", "Invitation pending", excluded from MFA/active stats); invite toast names the e-mail; last active falls back to last sign-in. Re-test: invite an address, Team table shows the pending row.

## INO-021 fixed (partial)
Vault upload now checks the bytes: executables (MZ/ELF/shebang) are rejected whatever the name, and PDF/PNG/JPEG/Office/text must match their type (`assertFileContentMatches`); the table shows document refs not UUIDs. Not done: download/preview/delete actions (no API for them; would be a new feature). Re-test: upload a file starting "MZ" named fake.pdf: 400.

## INO-027 fixed
The bell opens the caller's real notifications from `/api/v1/notifications` (empty state when none). Sidebar count badges are computed from live data already (not static) when the page is live.

## INO-028 fixed
Governance "Request approval" defaults to today + 14 days with `min=today`, empty or past dates give a named inline error, backend also rejects past dates; the reporting calendar marks overdue periods ("open - overdue"). Re-test: Governance > Request approval, submit empty.

## INO-030 not-a-defect / needs-other-group
Slow "Checking session..." is Next dev compilation on first hit (not present in a production build). Redirect of unknown unauthenticated routes to /login is `proxy.ts`/`(auth)` behaviour (F3). API gating results in the entry were correct.

## Summary
Fixed 23 (INO-001..008, 009, 010, 011..021, 027, 028), not-a-defect 1 (INO-030), needs-other-group residuals: seed-uat.ts KPI units/period labels/totalRevenue (F3), login-page Continue link (F3), proxy redirect (F3).
