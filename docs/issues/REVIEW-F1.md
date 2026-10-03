# Review F1 (branch worktree-agent-ad33a66928fe78c10, commit 8eec378)

Scope check: all 17 files are in the F1 ownership list (`modules/ops` is covered by the `ops` module). No migrations, no secrets. Build of admin-web not run by the agent (no node_modules in worktree): must be run after merge.

| Issue | Verdict | Notes |
|---|---|---|
| ADA-015 (critical) | OK | `cash/page.tsx` (5 hooks) and `ops/CashJournalForm.tsx:48` now call `apiRequest('GET', ...)` so `data` survives. Root cause is the `api.get` helper stripping `data` (F3 owns `ops/api*`), so the fix is per call site; any other page that reads `.data` after `api.get` still has the same trap (not audited). Verify nothing else in the cash page still uses `api.get` for list payloads (`grep "api.get" cash/page.tsx`). Re-test by opening each tab. |
| ADA-017 | REWORK | `seed-cash.ts` `poster = first other active user ordered by createdAt`: no portal or permission filter, so the poster can be a portal (LP/investee) user or a user without `cash.journal.post`. Pick an admin-portal user holding the posting permission (or use F3's new test personas). It also rewrites `postedBy` on existing journals via `updateMany` (audit rows keep the old actor); acceptable for seed data but should be limited to OPENING-BALANCE as it is. The fills-do-not-move-cash half is correctly handed to F2 (F2 did not address it either: see Cross-group). |
| ADA-021 | OK with note | API now emits `amountPaid` / `totalCommitted` in addition to old names (`capital.routes.ts`, `funds.routes.ts`). Dual fields is an API-shape patch rather than aligning the client type, acceptable and low risk. |
| ADA-022 | OK with note | Names via batch lookup in `capital.service.ts` and `notices.routes.ts` (no N+1). `allocationMethod` is inferred from equal call/commitment ratios (`capital.service.ts` ~L120): a heuristic, it can label an explicit allocation that happens to be proportional as PRO_RATA, and rounds at 4 dp. Prefer storing the method on the call. |
| ADA-023 | OK (partial) | Notice/document label uses `c.ref`. Existing `CC-AGFI-0xx` refs untouched: they live only in the existing database (the agent states no seed creates them), so a data fix/migration is still needed in environments that have them. |
| ADA-026 | OK (partial) | Overdue marker and status switch after Open period done in `reporting/page.tsx`. `isOverdue` compares `row.due` string to today's date (UTC date string) which is fine only if `due` is a YYYY-MM-DD string; verify the type. Period label inconsistency handed to F5 (F5 did not touch it). |
| ADA-027 | OK (partial) | Labelling only: `executionsReceived` added to day-ends (one `count` per day-end: N queries, fine for list size). The 0.00 holdings MV on the seeded package is left for F9 (`seed-custodian`). |
| ADA-030 | OK | Layout fixes in `recon/common.tsx` and `BreakDetail.tsx`; Operations tile uses `bySeverity` (present in `wiring/control.service.ts:34`). The Today page "Open breaks ... high" tile (F2 file `command/page.tsx`) still uses `high` that folds critical; minor inconsistency. |
| ADA-031 | REWORK (minor) | `seed-corporate-actions.ts`: (a) formatting defect `for (const e of EVENTS) {    const sec = ...` on one line. (b) The new CONFIRMED CMCL.VX dividend with a past record date is only useful if CMCL.VX holdings existed at the record date; nothing seeds that, so "Calculate entitlements" may yield zero entitlements; check or seed a holding. (c) The marker moved to a trailing "Sample event." suffix: matching by `endsWith` could match user-entered descriptions ending with that text; low risk. (d) The legacy tidy mutates dates of existing ANNOUNCED/CONFIRMED events on every environment where seeds run, including production-like DBs if the seed is ever run there; guard with the demo/UAT flag. Idempotency itself is OK (marker removed after tidy). `seed-recon-ops.ts` weekday roll is fine. |

## Cross-group conflicts
- ADA-017 fills part: F2 (orders/accounting) did not touch fills-to-cash posting; nobody owns it now. Flag to supervisor.
- ADA-026 period label: assigned to F5 by F1, F5 did not address it. Orphaned.
- ADA-027 holdings MV seed: depends on F9.
- The seed poster choice depends on F3's new personas (`seed-uat.ts`); coordinate so `seed-cash` picks a proper persona.
- File overlap: none between F1 and F2/F5 branches.
