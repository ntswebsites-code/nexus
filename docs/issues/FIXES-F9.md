# FIXES-F9 (custodian and onboarding portals)

Verification: `tsc --noEmit` clean in backend/api, portals/custodian-web, portals/onboarding-web. `npm run build` could not run inside the git worktree (Turbopack rejects the node_modules link outside the root); the lead should run `npm run build -w @matanho/custodian-web` and `-w @matanho/onboarding-web` after merge. No schema or migration changes.

## LPC-011 fixed
Root cause: `totalsMismatch` only checked quantity and notional. Change: it now also fails on trade count (executions received vs declared). Files: custodian.service.ts. Re-test: create a day-end with tradeCount 5 and no executions, Submit: 409 `control_total_mismatch`.

## LPC-012 needs-other-group (F1, F3)
DAY-DEMO1 is created in `backend/api/prisma/seed-recon.ts` (F1) without file/hash, prepared by the approver persona; a second approver persona is F3's seed-uat work. Not edited.

## LPC-013 fixed
Root cause: free text stored verbatim. Change: `safeText` on tradeRef, broker, note rejects leading `= + @ TAB CR`, a `-` not followed by a digit, and HTML tags (single, bulk and amend). Files: custodian.schemas.ts. Re-test: bulk CSV with tradeRef `=CMD()1`: row error "Text may not start with =...".

## LPC-014 fixed
Change: `executionAt` must be ISO 8601 date-time with Z or offset (the UI already sends a full ISO string); `02/10/2026 09:30` and date-only are rejected. Thousands separator "1,000" now gives one error. Files: custodian.schemas.ts.

## LPC-015 fixed
Change: required messages on reason (amend/cancel) and key execution fields ("Give a reason for the amendment"). Re-test: PATCH without reason. `declaredCount: abc` keeps zod's generic text (custodian.ops.ts bulk fields not changed; minor leftover).

## LPC-016 fixed
Change: `POST /custodian/day-end` returns `warnings: ["Draft CDE-x already exists for this account, date and currency"]` when another Draft exists; creation still allowed. Files: custodian.routes.ts. UI does not yet display the warnings field (leftover).

## LPC-017 not-a-defect
Legacy `custodian-live.js` is gone; native executions page Amend pre-fills `row.quantity` unchanged and sends only changed fields. Re-test: Amend quantity 500 shows 500; change price only; only price is patched.

## LPC-018 not-a-defect
Native form starts empty (`blank()`), currencies USD/ZWG/ZAR, quantity input has no min=1. No "Demo" text.

## LPC-019 fixed
Legacy slow load is gone with the native shell. Added: any 401 from the custodian/platform API redirects to `/login?next=...` instead of a stale shell. Files: custodian-web/src/lib/api.ts. Re-test: sign out in another tab, press Approve: redirected to login.

## LPC-020 not-a-defect
Native day-end is create Draft, then a separate Submit button (no hidden two-step); the form closes after save. List shows all packages (take 200).

## LPC-021 not-a-defect
No "prototype"/"Demo" wording remains in custodian-web/src (grep).

## INO-022 not-a-defect
Native Wizard evidence step uses server state (`evidence` rows); the legacy `dataset.doc` handler is gone.

## INO-023 fixed
Change: `assertContentMatches` before storing: executables (MZ, ELF, shebang, Mach-O) always refused; pdf/png/jpg/docx/xlsx/zip must carry their signature. Files: kyc/public.routes.ts. Re-test: upload bytes "MZ.." as evil.pdf: 400.

## INO-024 fixed
Change: Wizard blocks negative/non-numeric amounts, SWIFT not 8/11 chars, invalid account number; server re-checks the same on submit when a form is sent. Holder mismatch stays a warning. The native wizard has no blocking `alert()` (inline errors). Files: Wizard.tsx, kyc/public.routes.ts.

## INO-029 mostly not-a-defect
"Saved locally/prototype" copy is gone; tax id and account show "On file. Leave blank to keep it." Resume returning to step 1: not fixed (low value). HTML in name: React escapes; admin rendering is F6.
