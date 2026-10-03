# Review F8 (branch worktree-wf_2828facf-e30-8, commit 35053a8)

Scope check: 13 files, all inside `portals/investor-web/**` or `backend/api/src/modules/lp-portal/**`. No schema, seed, shared-package, migration or secret changes. Agent ran tsc and a webpack build of investor-web, and fixed an invalid-UTF-8 byte in `lp-performance-screen.tsx` that was breaking the build (good catch, in scope).

| Issue | Verdict | Notes |
|---|---|---|
| LPC-002 | OK | Real root cause: `findRequest` in `services/requests.ts:200` spread `fundScopeWhere(ctx)` (an `OR`) over the reference `OR`. Now combined under `AND`. |
| LPC-022 (critical) | OK | Same fix; unknown reference returns 404. Verify the list endpoint and reply/attachment endpoints all go through `findRequest` (a reply for REQ-1082 should now land on REQ-1082); the agent states they do, spot check `replyRequest`. |
| LPC-003 | OK with note | `services/capital.ts` rejects zero outstanding, <=0 and over-outstanding amounts with field error. Note: `new D(body.amountClaimed)` on a non-numeric string throws a Decimal error (500) before the new checks: validate the format first. The UI dialog validates with a regex, the API should too. |
| LPC-004 | REWORK (orphaned) | Declared needs-other-group, but F6's FIXES file does not address it either: `modules/esign/esign.service.ts` `signRequest` still accepts any typed name of 2+ characters. Nobody owns it now. FIX-GROUPS allowed F8 to change `esign` verification if essential; assign explicitly to F6 (API check) and F3 (portal-kit `EsignInbox` hint). |
| LPC-007 | OK | `assertFund(ctx, fundId)` in dashboard; overview rejects non open-ended funds; hook only passes an open-ended selected fund. |
| LPC-008 | REWORK (stopgap) | `services/documents.ts` `dropOutOfScopeLabelled` hides fund-less documents whose free-text `relatedLabel` equals the name of a fund outside the caller's scope. This is a symptom filter based on string matching a display label (case-insensitive name equality), runs an extra `fund.findMany` on every list/summary call, and still leaks documents whose label differs slightly. Root cause is fund-less documents with a fund name in a label: fix the data/link (seed owner) or scope documents by a real `fundId`/`clientId`. The distribution category fix (`docCategory`) is fine. |
| LPC-009 | OK (not-a-defect) with note | Explanation (opening balances, open-ended fund excluded) is plausible and documented, but the issue was a visible contradiction for the LP; labelling was improved under LPC-024. Dashboard `asOfDate` vs performance session date left unchanged. |
| LPC-010 | OK with notes | `services/organisation.ts` pending-invitation PATCH (audited, scoped to the caller's client, unexpired and unrevoked invitations only) and `listColleagues` restricted to own row for non-managers. Check that non-manager UIs that call `listColleagues` for pickers (e.g. e-sign signer choice, colleague dropdowns) still work. `lp_b_signatory` membership in client A left as a seed issue for F3 (F3 did not address it). |
| LPC-023 | OK | Distribution type shown as reported; Paid Calls total computed from the visible Paid rows (can disagree if the table is filtered or paginated; computed on `calls` state). |
| LPC-024 | OK with note | Remaining value, labels, YTD "Not available", "-" for empty amounts, actions limited to AWAITING_FUNDS. Legacy "Signature required" actions remain (needs F6/seed). |
| LPC-025 | OK | Dead link removed, sidebar group renders after funds load. |
| LPC-026 | OK | Dialog with amount and notes; idempotency key now includes amount and file name; on success `attemptKeys.current = {}` clears every pending key, not only this call's (minor). |

## Not done / orphaned (belongs to nobody now)
- `modules/lp-portal/lp.http.ts:110` still returns `details.stack` outside production (F3 left this to F8 under ADA-025; F8's FIXES-F8.md does not mention it). Remove.
- LPC-006 route-level validation (bad `period`, `asOfDate`, `status`, `currency`, `lpRole` accepted) was assigned by F3's file to F8, but it is not in FIX-GROUPS for F8 and is not addressed. Decide the owner.
- LPC-015 (LP validation envelope) depends on F3's shared envelope change; F3's top-level fields are meant to be compatible with the LP client; confirm after merge.

## Cross-group conflicts
- None at file level. Behavioural: F3's `errorHandler` rewrites the error envelope; the LP client `lpPortalApi` error handling should be re-tested against the new top-level `success:false`/`fieldErrors` shape (F8 did not touch the client error parsing).
- F8 reads `LPC-004` fix from F6/F3: see above.
