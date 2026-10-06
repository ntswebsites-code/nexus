# Handoff 23: M12 — Custodian feed integration and admin recon consume

Date 2026-10-05 · branch `feat/original-ui-wiring` · requirement IDs: CUS-006, CUS-011, GAP-A05

## 1. Goal (one paragraph)

M12 wires CAMT.053 statement upload in the custodian portal through `cash.engine.parseStatement`, stages a `cashStatementImport` row when a bank ledger mapping exists, and surfaces parse/validation results in the custodian statements UI. Admin cash recon can consume staged imports without manual re-key.

## 2. Commands run and results

| Command | Result | Notes |
|---|---|---|
| `npx vitest run --pool=vmThreads --project custodian-web` | **PASS** | 115/115 |
| `npx tsx backend/api/scripts/test-integrations.ts` | **PASS** | CAMT detect + parse check |

## 3. Backend changes

### `modules/cash/cash.stage-import.ts` (new)

- `resolveBankLedgerForAccount(counterpartyId, accountRef)` — recon map → portfolio → first active BANK ledger
- `stageStatementImport()` — parse, foot, duplicate checks, create `cashStatementImport` + lines

### `modules/custodian/custodian.cash-bridge.ts` (new)

- `isCamtStatement()`, `checkCamtStatement()`, `ingestCamtStatement()`
- Stages cash import, records `custodianFeedFile`, `recordCounterpartImport` (STATEMENT feed)

### `modules/custodian/custodian.native.ts` (modified)

- `statementSchema` extended with `CAMT053`
- Upload/check branch on CAMT → cash bridge vs normal position ingest
- Post-upload audit/notify split: CAMT notifies `cash.journal.approve`; position feeds keep day-end flow

### `scripts/test-integrations.ts`

- Pure check: `isCamtStatement` + `parseStatement` on fake CAMT XML

## 4. Frontend changes

| File | Change |
|---|---|
| `portals/custodian-web/.../statements/page.tsx` | CAMT053 format, `.xml` accept, cash-import column, success message for `cashImportRef` |
| `portals/custodian-web/src/lib/api.ts` | `setAssignHandler` / `resetAssignHandler` for 401 redirect tests |

## 5. Tests

- `tests/frontend/custodian-web/camt-bridge.test.ts` — pure CAMT detect + parse (no prisma)
- `tests/frontend/custodian-web/statements.test.tsx` — CAMT053 in formats list; validation table columns
- `tests/frontend/custodian-web/day-end.test.tsx` — 401 tests use assign handler

## 6. Known limits / follow-ups

- MT940 bank-statement path via custodian not implemented (CAMT only)
- `POST /cash/statement-imports` not refactored to call `stageStatementImport()` (duplicate logic OK for now)
- E2E throwaway-DB assert on `cashStatementImport` row optional (`E2E_CONFIRM=throwaway-db`)
- Live SWIFT / live custodian-feed vendor out of scope

## 7. Acceptance checklist

- [x] Upload sample CAMT creates `cashStatementImport` row when ledger mapped (bridge + stage-import)
- [x] Custodian statements UI shows parse results/errors including CAMT
- [x] Integration script + custodian Vitest green
- [x] HANDOFF-23 with §11 M13 prompt

---

## §11 — Copy-paste prompt for M13 agent

```
Proceed to M13 on branch feat/original-ui-wiring. Admin legacy sweep — close gaps in ADMIN-REAL-PAGES; no commit/push unless I ask.

Read first:
1. docs/handoff/HANDOFF-23-M12-CUSTODIAN-FEEDS.md (this file)
2. IMPLEMENTATION_MILESTONES.md — M13
3. docs/ADMIN-REAL-PAGES.md — per-page gap column (L926+)
4. portals/admin-web/src/legacy/bridge/ + tools/hooks/w*.mjs
5. docs/handoff/HANDOFF-24-M13-ADMIN-SWEEP.md (command chart slice may already be done)

Repo: C:\Users\lysp\Downloads\matanho-nexus-v56-deployment
Branch: feat/original-ui-wiring

## Your scope: M13 — Admin legacy remaining gaps and chart live data

Requirement IDs: ADMIN-5A01, ADMIN-5A02–04, 5A14, 5A18–19, 5A25–26 remainder

Goal: Zero "Not available yet" entries in ADMIN-REAL-PAGES that have backend routes; honest empty states elsewhere.

## Do

1. Continue sweep from ADMIN-REAL-PAGES gap column (command gio scope chips + mini-liquidity may remain).
2. Wire remaining demo chart tabs / static KPIs via mx.strict(page) + tools/hooks/w*.mjs + bridge stash pattern.
3. Update ADMIN-REAL-PAGES gap column as items close.
4. Validation: `node tools/legacy-bridge.mjs --only admin --check`; run `w0`–`w9` legacy tests (one file at a time on Windows).
5. Deliverable: `docs/handoff/HANDOFF-25-M13-COMPLETE.md` (or incremental HANDOFF-24+) with §11 only if another milestone follows.

## Do NOT

- Redo M2–M12 unless regressed
- Delete `/ops-native` (owner sign-off)
- Deploy/push/merge unless owner asks
- Commit unless owner asks

## Acceptance criteria

- [ ] ADMIN-REAL-PAGES shows "—" or explicit "no API" for every closed gap
- [ ] Legacy bridge check green; w0–w9 tests pass per file
- [ ] Handoff written
```
