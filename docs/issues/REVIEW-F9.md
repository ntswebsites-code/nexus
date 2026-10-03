# Review F9 (branch worktree-wf_2828facf-e30-9, commit 92a5af3)

Scope check: 7 files, all inside `portals/custodian-web/**`, `portals/onboarding-web/**` (not `proxy.ts`/`(auth)`), `modules/custodian`, `modules/kyc`. No schema, migration, seed or secret changes. tsc clean; builds not run in the worktree (to be run after merge).

| Issue | Verdict | Notes |
|---|---|---|
| LPC-011 | OK | `custodian.service.ts` `totalsMismatch` now includes trade-count mismatch, enforced at submit (`custodian.routes.ts:319`). The issue also wanted approval to be blocked: approve is protected only because submit now blocks (a package already Received before the change, or one created by the seed with a mismatch, can still be approved). Behaviour change vs the old comment "count mismatch alone is reported, not blocking": make sure the seeded DAY-DEMO1 (declared 2 trades, executions on file differ per F1's ADA-027 finding) can still be submitted for the UAT flow, otherwise the UAT flow breaks. |
| LPC-012 | REWORK (orphaned) | Declared needs-other-group (F1 `seed-recon.ts`, F3). F1 did not touch `seed-recon.ts` and F3 added only a second approver persona. DAY-DEMO1 without file/hash and prepared by the approver persona remains. `seed-custodian.ts` is F9's own file in FIX-GROUPS: F9 should fix what it can there. |
| LPC-013 | OK with note | `custodian.schemas.ts` `safeText` rejects formula prefixes (`= + @ TAB CR`, `-` not followed by a digit) and HTML tags for tradeRef, broker, note (single, bulk, amend). Notes: it rejects legitimate text starting with `+` or `-` (a note such as "- late" is refused); validation on input only: values already stored (and exported) are not sanitised, so export code should still escape. |
| LPC-014 | OK | Strict ISO 8601 with offset for `executionAt`. The same schema is used by bulk CSV upload; CSV with other date formats now fails with a clear message (intended). Amend dialog builds the value with `toIso` (verify it emits `Z`/offset). |
| LPC-015 | OK (partial) | Required messages added. Bulk `declaredCount: abc` generic text left (custodian.ops.ts). Depends on F3's shared `validate.ts` rewording for the rest; `{ error: '...' }` zod v4 option used consistently. |
| LPC-016 | REWORK (minor) | API returns `warnings` on create, but the custodian UI does not display it (acknowledged), so the user still gets no early warning: the issue's expected behaviour is not visible to anyone. Render `warnings` in the day-end form. |
| LPC-017 (critical) | OK (not-a-defect) with doubt | Verified in code: `executions/page.tsx` `Amend` initialises `quantity: row.quantity` and only sends changed fields; the legacy `custodian-live.js` with `replace(/\.?0+$/, '')` is gone (grep finds no such replace). Because this was a blocker, confirm in the browser (amend an execution of quantity 500, change only price, saved quantity must remain 500) before closing. |
| LPC-018 | OK (not-a-defect) | Claims native form starts empty, ZAR offered, no `min=1`; code was not inspected in full: confirm in the browser. |
| LPC-019 | OK with note | `lib/api.ts` `guarded()` redirects to `/login?next=<pathname>` on any 401 from the custodian and platform clients; drops the query string, and a 401 caused by a wrong MFA/step-up code on a platform call would also log the user out. Restrict to `session_expired`-style codes if the API distinguishes them. |
| LPC-020 / 021 | OK (not-a-defect) | Plausible after the native rewrite; verify no "Demo" text remains (grep claimed). |
| INO-022 | OK (not-a-defect) | Evidence step uses server state. |
| INO-023 | OK with note | `kyc/public.routes.ts` `assertContentMatches` (magic bytes, executable refusal) on evidence upload. Third independent copy of the same magic-byte check (F7 `investee-workspace.ts`, F9, F7-like logic elsewhere): consolidate into one shared helper (F3 `lib`) after merge. Applies to `.docx/.xlsx/.zip` only by PK header; `.doc/.xls/.txt/.csv` unchecked. |
| INO-024 | OK | Client and server checks (amounts, SWIFT 8/11, account format) on submit only (`formChecked`), autosave unaffected. The IBAN/account regex is permissive (`[A-Za-z0-9 -]{4,40}` with a digit). |
| INO-029 | OK (mostly not-a-defect) | "Resume returns to step 1" left unfixed (acknowledged). |

## Not done / orphaned
- INO-025 root cause in `modules/kyc/screening.ts` / `public.routes.ts` (timeline says "No advisory exceptions. Risk rated Low", missing bank-holder-mismatch exception): F6 pushed it to F9, but INO-025 is not in F9's list and not addressed. Assign.
- LPC-012 seed owner (see above).

## Cross-group conflicts
- `modules/kyc/public.routes.ts` is F9-only in this wave; F6 relies on it for INO-025.
- Magic-byte validators in F7 and F9 duplicate each other (different error shapes: F7 uses a field-path details array, F9 uses an object `{ reason }` details, which F3's `errorHandler` `fieldDetails()` will not render as `fieldErrors`). After merge, F9's `HttpError.badRequest(msg, { reason: ... })` produces no field mapping, which is fine for a file upload but inconsistent.
- F3's cookie namespacing and 401 handling: F9's `guarded()` redirect interacts with F3's per-port cookie (a session for another portal does not leak any more, so more 401s are expected when testing two portals; the redirect is the right outcome).
