# Review F7 (branch worktree-wf_2828facf-e30-7, commit d199589)

Scope check: 19 files, all inside `portals/company-web/**` (not `proxy.ts` or `(auth)`) and `backend/api/src/modules/investee-portal/**`. No schema, seed, migration or secret changes. `tsc` and a webpack production build of company-web were run. 23 issues claimed fixed in a 906-line diff, much of it in `lib/investee/host.ts`, `InvesteePortal.tsx`, `WorkspaceTools.tsx` and the vendored `matanho-investee-portal-runtime.js`; the frontend was reviewed at the summary level (diff stat plus FIXES claims), the backend was reviewed line by line. Front-end root causes should be confirmed in the browser.

| Issue | Verdict | Notes |
|---|---|---|
| INO-001 | OK | Detects `no_company_access` and shows a panel instead of the shell. |
| INO-002 | OK (unverified UI) | Periods from `/reporting/requests`, owners from `/team`, blank inputs; no hard-coded demo values by the description. |
| INO-003 | OK (unverified UI) | Balance check before posting; inline error. |
| INO-004 / 005 | OK (unverified UI) | Live data replaces demo content. |
| INO-006 | OK | `/profile` returns `companies[]` (`investee.routes.ts`), switcher sends `?company=`. Confirm the server validates the `company` query against the caller's memberships (the resolver pre-exists; not changed in this diff) so switching cannot reach another company. |
| INO-007 | OK | `capTableView` adds `locked` (any non-OPENING tx exists); dead form replaced. |
| INO-008 | REWORK (minor) | New `POST /cap-table/transactions/:ref/withdraw` (`workspace.routes.ts`) is a state-changing endpoint without the `idempotent(...)` middleware used by its sibling `/decide` route and other mutations; a double click or retry returns 409 `invalid_state` on the second call instead of replaying the first response. Add `idempotent('investee.cap_tx.withdraw')`. Maker-only check and conditional `updateMany` claim in `workspace/cap.ts` `withdrawCapTransaction` are correct, audited, and company-scoped. |
| INO-009 | OK with note | KPI export adds one column per KPI definition. The CSV cell helper does not neutralise leading `=`, `+`, `-`, `@` in labels (pre-existing; labels come from DB definitions). Seed residuals (ARR units, period labels, totalRevenue) correctly deferred to seed owner; note FIX-GROUPS gives `seed-investee*.ts` to F7, so the residual belongs to F7, not F3 (the issue was misrouted; F7 should fix `seed-investee*.ts` if the data lives there, otherwise `seed-uat.ts` F3). |
| INO-010 | OK | `forecastSchema` rejects negative revenue; client-side check too. |
| INO-011 | OK (unverified UI) | Named missing fields. |
| INO-012 | OK with note | `workspace/sharing.ts` `publicSign`: typed name must match `signer.name` (accent/case/space-insensitive) with a field error. If `signer.name` can be null/empty or only the e-mail local-part (invite without a name), valid signers could be blocked: confirm `signer.name` is always set (non-null column?) or fall back to e-mail. Same defect class as LPC-004 in the staff e-sign module remains open (see REVIEW-F8). |
| INO-013 | OK | Loading state only. |
| INO-014 | OK | Share link lands on a portal page `(tools)/sign/share/[token]` (public, excluded by the `sign/` matcher in `proxy.ts`). The e-mailed link also changed; the raw file URL kept as `fileUrl`. |
| INO-015 | OK (unverified UI) | Fabricated drill-down removed. |
| INO-016 | OK | Flags retried 3 times, then an error panel rather than demo data. Confirm no other code path still falls back to `DEMO_COMPANY` (grep `Zambezi` in `lib/investee`). |
| INO-017 | OK with note | In-portal MFA enrolment entry points added. Needs end-to-end test (enrol and sign TS-1001) since F3's `requireStepUp` bypass semantics apply: in a stack with no factor enrolled and `mfa_required` off, signing never prompts. |
| INO-018 | OK (unverified UI) | Workspace signature requests in Signatures page. |
| INO-019 | OK | `investee.contract.ts` website refine (`http(s)://` only) rejects `javascript:`. Backend-enforced. Letterhead validation prior to write. |
| INO-020 | REWORK (minor) | `investee.routes.ts` `/team` appends pending invitations with `id: p.id` (invitation id) in the same list as members (user ids) and `accessProfile: 'read_only'` regardless of the invited profile. Any UI action keyed on `id` (change profile, remove, resend) will hit a user endpoint with an invitation id and 404; the invited profile/role should be shown from the invitation's `roleKeys`/grant. Verify the UI disables actions for `status === 'invited'`. |
| INO-021 | OK (partial) | `assertFileContentMatches` (magic bytes for PDF/PNG/JPEG/Office/text and executable refusal) is applied only in `uploadVaultFile`; other upload paths in this module (report attachments, signature documents, cap-table/KYC files) do not call it: apply it centrally or confirm they are covered. Download/preview/delete not built (acknowledged: new feature). |
| INO-027 / 028 | OK | Real notifications; due date default and server-side past-date rejection (`records.ts` `consentSchema`); the refine compares to the UTC date, so a user in a timezone ahead of UTC picking "today" late in the evening local time can see "in the past" briefly: acceptable. |
| INO-030 | OK (not-a-defect) | Dev compile time; redirect behaviour is F3's. |

## Cross-group conflicts
- `portals/company-web/src/proxy.ts` untouched (F3). The INO-001 "Continue" link in login is F3's `(auth)`; F3 did not address it.
- F3's `middleware/errorHandler.ts` rewrite of the error message (`Validation failed. <reasons>`) overlaps F7's own `api.ts` `describe()` that builds field-named text from the envelope: after merge the field names could be shown twice. Re-test one error in company-web.
- `investee-portal/investee.http.ts` still adds `details.stack` outside production (F3 left this to F7 under ADA-025; not addressed in FIXES-F7). Remove it.
- INO-009 seed residual routed to F3 by F7, but FIX-GROUPS assigns `seed-investee*.ts` to F7: decide who fixes.
- No same-file edits with other branches.
