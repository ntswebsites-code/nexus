# Fixes F6 (clients, services, vault, reports, regulatory, data, esign, onboarding review)

Verification: `tsc --noEmit` in `backend/api` and `portals/admin-web`, `npm run build -w @matanho/admin-web`. No schema change, no migration. Seed changes are idempotent.

## ADB-013 Client 360 contradicts the client list
Status: fixed (two sub-items need another group, below).
- Root cause: the list shows denormalised fields (`accountsCount`, `mandateLabel`) loaded from the demo JSON that have no backing rows, while the 360 reads real rows. The tab label counted commitments only. The drawer was keyed on the previously selected client.
- Changed: 360 route returns accounts and mandate from real rows; seed reconciles `accountsCount` to real cash-account rows and creates an Active mandate row from `mandateLabel` when a client has none; tab label now "Portfolios (n) & commitments (m)"; empty KYC text explains a Current status set directly on the client; after "New client" the drawer selects the new client.
- Files: `modules/clients-onboarding/co.clients.routes.ts`, `prisma/seed-clients-onboarding.ts`, `ops/clients/page.tsx`.
- Re-test: re-run the UAT seed, open Clients, Horizon Pension Fund: list Accounts equals the Cash accounts tab count, Mandate matches the Mandates tab; create a client and the drawer shows it.
- Needs other group (unassigned `backend/api/src/modules/clients/clients.routes.ts`, line with `legalEntity: 'Matanho Managed Funds'`): new cash accounts get a hard-coded account holder; should default to the client name. Also `clientView` should count rows only. The two numbering schemes for vault documents (LP-DOC and DOC) come from the shared UAT seed JSON (F3), not fixable in F6 files.

## ADB-015 Investor Services SLA
Status: fixed.
- Root cause: "Waiting on you" requests kept their running clock and counted as breached; investor-portal types (Account / Statement, Tax / Reporting, Capital Activity) had no policy row so the fallback applied.
- Changed: SLA state is "Waiting on client" (clock paused, not a breach) for those requests, new filter option; `SLA_TYPE_ALIASES` maps the portal types to the matching policy rows; policy rows added for Capital Activity; explanatory text on the SLA policy tab.
- Files: `co.services.routes.ts`, `co.service.ts`, `seed-clients-onboarding.ts`, `investor-services/page.tsx`.
- Re-test: Investor Services, a request set to "Waiting on you" shows SLA "waiting on client" and is not counted in SLA breached. Seed ages of 2-3 months still make other open cases breached; that is seed data, not logic.

## ADB-016 Document vault
Status: fixed (a, b, c, d, e).
- (a) Upload name field now prefilled from the chosen file and editable. (b) Version size shows exact bytes under 1 KB ("22 B"). (c) Approve is disabled with the maker-checker reason for the person who submitted (detail now returns `makerId`). (d) The "(demo)" suffix is removed from the seeded texts, and existing rows are cleaned up idempotently by the seed. (e) Approved valuation marks without a file show "Evidence file missing: attach it".
- Files: `co.vault.routes.ts`, `vault/page.tsx`, `seed-clients-onboarding.ts`.
- Re-test: upload a 22-byte file: version size "22 B"; submit it and open it as the same user: Approve is disabled with the reason.

## ADB-017 Reports scheduling
Status: fixed (date format), not-a-defect ("Run now" leaving Next run unchanged).
- Next run is a calendar-day schedule shown in the same "dd Mon yyyy" style as other dates (UTC date, no shift). "Run now" intentionally does not move the next scheduled slot (documented in the route); Last run does update. Tooltip added on the cell.
- Files: `reports/page.tsx`.

## ADB-018 Regulatory stale red hint
Status: fixed for the stale hint; native confirm needs F3.
- Root cause: the red text is the ActionButton's own error from an earlier failed click and it persisted after the cause was fixed. The button is now keyed on the filing's payload/evidence state (remounts, clearing the message), is disabled while figures or evidence are missing, and a muted line states what is missing.
- Native `window.confirm` belongs to the shared ActionButton (ADA-014, F3).
- Files: `regulatory/page.tsx`.
- Re-test: open REG-00002 as DRAFT: Send for review is disabled with "First populate the figures and attach at least one piece of evidence"; after both, it is enabled and no red text remains.

## ADB-019 Data Fabric
Status: fixed (never-run, raw JSON); not-a-defect/other group for data gaps.
- Rules never run: `seed-reports.ts` now runs every active rule that has no run once at seed time (idempotent: only rules with zero runs).
- Raw JSON in CHECK column: replaced by plain-language text (`describeParams`).
- Missing ISIN on 12 securities and stale prices/positions (26 Aug) are market-data seed content (F4: securities, prices) and not changed here.
- Files: `seed-reports.ts`, `data/page.tsx`.
- Re-test: after reseeding, Overview shows Never run 0; Rules table shows e.g. "must be equal to total_credit" instead of JSON.

## ADB-025 Staff e-sign signers
Status: fixed in the console; nav access needs F3.
- Finding: the signed-in signing endpoints (`/esign/me/...`) and the "My signatures" inbox already exist, but the request drawer offered no signing action and nothing pointed a signer to it.
- Changed: the drawer shows a Sign button on the row of the signed-in user when it is their turn (opens "My signatures"); the all-requests view shows a banner "N documents are waiting for your own signature" with a button.
- Needs other group (F3): `ops/shell/nav.ts` hides E-signatures for users without `esign.view` (analyst); the nav entry should also be visible to anyone (perms include a signer check). The page itself already renders the inbox for such users. Signing needs step-up (MFA), which staff accounts lack (ADB-020, F3).
- Files: `ops/esign.tsx`.
- Re-test: as client_services (a signer on a pending request) open E-signatures: banner appears; open the request, click Sign on your row, sign in the inbox.

## INO-025 Admin onboarding case shows Clear / Low risk with zero checks
Status: fixed for the admin display; screening source needs F9.
- Root cause: risk preview scores only recorded checks, so none run reads as Low; the screening summary says "Clear" from the automated advisory pre-screen.
- Changed: workup returns `riskPreview.provisional/checksRun/checksTotal`; with zero checks the case screening text reads "... (automated pre-screen only: 8 provider checks not run)"; the UI shows a "Provisional" warning above the risk rating.
- Needs other group (F9): the "No advisory exceptions. Risk rated Low" timeline wording and the missing bank-holder-mismatch exception are produced in `modules/kyc/screening.ts` and `public.routes.ts`.
- Files: `co.onboarding.routes.ts`, `onboarding/page.tsx`.
- Re-test: submit an application, open its case in Onboarding: warning "Provisional: 0 of 8 provider checks"; screening line states checks not run.
