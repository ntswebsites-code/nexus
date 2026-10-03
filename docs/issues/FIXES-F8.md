# FIXES-F8 (LP portal)

Branch: worktree branch of `feat/admin-recon-nav` (committed, not pushed).
Verification: `npx tsc --noEmit` in `backend/api` and `portals/investor-web`, `npm run build -w @matanho/investor-web` (see end of file).

## LPC-002 - POST /requests returns the wrong request
- Root cause: `findRequest` in `modules/lp-portal/services/requests.ts` spread `fundScopeWhere(ctx)` (which is `{ OR: [...] }`) after the reference `OR`, replacing it. The create response (`getRequest(id)`) therefore returned any in-scope request.
- Change: `findRequest` combines clientId, the reference/id OR and the fund-scope OR under `AND`.
- Files: `backend/api/src/modules/lp-portal/services/requests.ts`.
- Re-test: as lp_a_signatory POST /lp-portal/requests with a new subject; the 201 body is the new request (new REQ ref, status SUBMITTED, your subject). In the UI, New request opens the new record.
- Status: fixed.

## LPC-022 (critical) - request detail and reply always use REQ-2017
- Root cause: same as LPC-002.
- Change: same one-line fix; unknown references now 404 and out-of-scope fund requests are no longer reachable by reference.
- Re-test: GET /requests/REQ-1082 returns REQ-1082; /requests/REQ-9999 and /requests/garbage return 404; reply on REQ-1082 appears in REQ-1082 only (REQ-2017 unchanged).
- Status: fixed.

## LPC-003 - payment confirmation accepts any amount / already PAID call
- Root cause: `uploadPaymentConfirmation` (`services/capital.ts`) used the claimed amount without bounds.
- Change: reject when nothing is outstanding, amount <= 0, or amount > outstanding, with field error `amountClaimed` (400 LP_VALIDATION).
- Re-test: upload to CC-013 with amountClaimed=99999999 -> 400 "Amount exceeds the outstanding balance"; to CC-012 (PAID) -> 400 "already fully paid"; 150000 on CC-013 -> 201.
- Status: fixed.

## LPC-004 - e-sign typed name need not match signer
- Root cause: `signRequest` in `modules/esign/esign.service.ts` only checks the typed name is 2+ characters; it never compares with `signer.name`. The sign endpoint is `/esign/me/requests/:id/sign` (module owned by F6) and the inbox/signing UI is `EsignInbox` in `packages/portal-kit` (owned by F3). There is no `modules/esign/public.*` file and nothing on the lp-portal side performs signing.
- Needed (other group): in `signRequest`, when `payload.mode === 'TYPED'`, compare normalised (case, whitespace, accents) `typed` with `signer.name` and throw `HttpError.badRequest('The typed name must match your registered name (<name>)')`; optionally show the registered name as placeholder in `EsignInbox`.
- Status: needs-other-group (F6 for the API check, F3 for the portal-kit hint).

## LPC-007 - out-of-scope fund handling
- Root cause: `getDashboard` silently ignored an out-of-scope `fundId`; `dealing/overview` did not reject closed-end funds.
- Change: dashboard calls `assertFund` (404 "Fund not found"); dealing overview returns a validation error for non open-ended funds. The LP hook `useLpDealingOverview` now only falls back to the selected fund when it is open-ended, so the UI does not call overview for a private fund.
- Files: `services/dashboard.ts`, `services/dealing.ts`, `portals/investor-web/src/lib/lp-portal/hooks.ts`.
- Re-test: GET /dashboard?fundId=<other fund> as lp_a_signatory -> 404; GET /dealing/overview?fundId=<Growth Fund I> -> 400 "Dealing is not available for private capital funds"; Subscriptions/Redemptions page for a manager with a closed-end fund selected still loads the open-ended fund.
- Status: fixed.

## LPC-008 - documents outside fund scope, distribution notice category
- Root cause: fund-less documents carry a free-text `relatedLabel` naming other funds ("Balanced Growth", "Private Credit Fund I") and were listed for everyone; distribution notices of generic type `capital` fell into `CALL_NOTICE`.
- Change: documents list and summary drop fund-less documents whose label equals the name of a fund outside the caller's scope; a `capital`-type document whose name starts with "Distribution" (or related type DISTRIBUTION*) is categorised `DISTRIBUTIONS`.
- Files: `services/documents.ts`.
- Re-test: Document Centre as lp_a_signatory shows no "Balanced Growth"/"Private Credit Fund I" rows; "Distribution Notice - DIST-2610-01" category is Distributions.
- Status: fixed (root data issue, labelled documents seeded without a fundId, belongs to the seed owner; the filter hides them for out-of-scope LPs).

## LPC-009 - KPIs do not reconcile with lists
- Cause: KPIs add pre-platform opening balances (`openingCalled`, `openingPaidIn`, `openingDistributions` in commitment metrics, see `services/positions.ts`) to platform allocations, and private-capital KPIs deliberately exclude the open-ended fund (reported in `openEndedSummary`). Dashboard asOfDate is the live holdings date, performance uses the session default.
- Status: not-a-defect for the KPI-vs-list difference (documented design); the dashboard card label now says what is covered (see LPC-024). The asOf date difference is not changed.

## LPC-010 - pending invitations not editable; colleague directory exposure
- Root cause: `updateColleague` only looked in `clientUser`; `colleagueRows` returned everyone to every role.
- Change: PATCH on a pending invitation id updates its role key, invite grant and pending-scope setting (audited as `lp_colleague.invitation_updated`); GET /colleagues returns only the caller's own row for non-managers.
- Files: `services/organisation.ts`.
- Re-test: manager invites, PATCH `/colleagues/<invitation id>` with role/fundIds -> 200 and the list shows the new role; as lp_a_viewer GET /colleagues -> only own entry.
- Not changed: lp_b_signatory being a member of client A is seed data (`seed-uat.ts`, F3).
- Status: fixed (seed membership: needs-other-group F3).

## LPC-023 - capital activity page types and totals
- Root cause: `mapDistributionType` re-bucketed API types into two labels; "Paid Calls" showed the YTD payments figure next to an all-time count.
- Change: type shown as the API reports it; Paid Calls amount is the sum of paid on calls listed as Paid. "Total Distributions" includes pre-platform opening distributions by design (see LPC-009). The bell count vs dashboard action count differs because the bell excludes some action types; not changed.
- Files: `lib/lp-portal/mappers.ts`, `components/lp-portal/screens/lp-capital-activity-screen.tsx`.
- Re-test: DIST-008 shows Exit Proceeds, DIST-007 Dividend; Paid Calls equals the sum of the paid calls in the table (1,150,000 for the sample).
- Status: fixed (total distributions and bell count: not-a-defect / not changed).

## LPC-024 - dashboard contradictory figures
- Change: "Remaining Value" in Capital Position is the current NAV (it used NAV minus distributions); Commitment card helper says "Private capital funds - N investments in view" instead of "2 Commitments"; YTD return shows "Not available" when null; Recent Capital Activity rows without an amount show "-" instead of $0.00; dashboard Actions Required lists dealing requests only when they need investor action (AWAITING_FUNDS), so "Redemption submitted" is no longer an action.
- Not changed: "Signature required" actions come from legacy `SignatureRequest` rows (past due dates) that have no entry in the native e-sign inbox; fixing needs the esign/seed owners (F6/F3).
- Files: `components/lp-portal/screens/lp-portal-dashboard-screen.tsx`, `services/dashboard.ts`.
- Re-test: dashboard as lp_a_manager; check the items above.
- Status: fixed except the legacy signature actions (needs-other-group F6).

## LPC-025 - "2 Commitments" link, sidebar flash
- Change: removed the link to the non-existent `/lp-portal/investments` from the dashboard card and pointed Performance "View All Funds" at `/lp-portal/performance`; the "My Investments" sidebar group renders only once the fund list has loaded.
- Files: dashboard screen, `lp-performance-screen.tsx`, `components/layout/lp-portal-sidebar.tsx`.
- Re-test: the card is not clickable; reload any page, sidebar does not show My Investments until funds load.
- Status: fixed (a dedicated holdings page was not built; out of scope for a defect fix).

## LPC-026 - payment confirmation UI has no amount or note
- Change: picking a file now opens a dialog with amount (prefilled with outstanding), optional notes and validation; submits `amountClaimed` and `notes`; server errors are shown in the dialog.
- Files: `lp-capital-activity-screen.tsx`.
- Re-test: Capital Calls > Submit Payment Confirmation, choose a PDF; dialog appears; amount above outstanding is rejected; valid amount uploads and the toast confirms.
- Status: fixed (the 403 wording on invalid sessions belongs to the session/auth work, F3).

## Extra
- `lp-performance-screen.tsx` contained an invalid UTF-8 byte (0x85, CP1252 ellipsis) that fails the investor-web build; replaced with a valid ellipsis.

## Verification
- `npx tsc --noEmit` clean in `backend/api` and `portals/investor-web`. No schema, seed or shared-package changes.
- `next build --webpack` for investor-web passes. Default Turbopack build could not run in the worktree only because node_modules there is a junction to the main checkout; re-run `npm run build -w @matanho/investor-web` after merge.
