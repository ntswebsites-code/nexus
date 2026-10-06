# Handoff 17: M6 — Clients, vault, reports, and regulatory depth

Date 2026-10-05 · branch `feat/original-ui-wiring` · requirement IDs: ADMIN-5A09–13, ADMIN-5A22

## 1. Goal (one paragraph)

M6 closes legacy bridge gaps for investor portal user CRUD and pending change-request inbox on the clients page; vault PM evidence file upload; report schedule CRUD with run-now/run-due and LP distribution on completed runs; and regulatory filing package depth (evidence attach/remove, CSV export, waive, create-from-template). Bridges only; no markup/CSS or ops-native product UI changes.

## 2. Commands run and results

| Command | Result | Notes |
|---|---|---|
| `node tools/legacy-bridge.mjs --only admin` | **PASS** | Synced `admin-20`, `admin-40`, `admin-101`, `admin-102` |
| `node tools/legacy-bridge.mjs --only admin --check` | **PASS** | After sync |
| `npx vitest run --pool=vmThreads tests/frontend/legacy/w6-nav-accounting-regulatory-reports.test.ts tests/frontend/legacy/w7-clients-services-onboarding-vault.test.ts` | **PASS** | 9/9 including write round-trips |
| `test-reports.ts` / `test-regulatory.ts` | **Not run** | `DATABASE_URL` not set on this host |

## 3. Backend confirmation (read-only)

All required routes were already present; no backend changes in M6.

| Area | Routes | Status |
|---|---|---|
| Clients | `GET/POST/DELETE /api/v1/clients/investor-users` | **Sufficient** |
| Client ops | `GET/POST …/change-requests` approve/reject | **Sufficient** |
| Vault PM evidence | `POST /client-ops/vault/pm-evidence/:id/file` (multipart) | **Sufficient** |
| Reports schedules | `POST/PATCH /api/v1/reports/schedules`, `POST …/run-now`, `POST …/run-due`, `POST …/lp-delivery` (step-up) | **Sufficient** |
| Reports distribute | `POST /runs/:id/distribute` (`feature.report_distribution` + step-up) | **Sufficient** |
| Regulatory | `POST /filings`, `POST/DELETE …/evidence`, `GET …/export`, `POST …/waive`, `GET /templates` | **Sufficient** |

## 4. Frontend bridge changes

### `admin-20-clients.js`

- `openInvestorUsersModal`: list/invite/revoke portal users via `/api/v1/clients/investor-users`.
- `ensureClientsPageActions`: **Pending changes** header button → `mx.showChangeRequests()`.
- `mx.openInvestorUsersModal` exported for harness/tests.

### `admin-40-documents.js`

- `openPmEvidenceModal`: lists PM valuation evidence with **Upload file** / **Replace file** per row → `POST …/pm-evidence/:id/file`.
- `mx.openPmEvidenceModal` exported for harness/tests.

### `admin-102-reports.js`

- `openSchedulesModal` / `openCreateScheduleModal`: schedule list, create, pause/resume, run-now, run-due, LP delivery toggle.
- `distributeRun`: **Distribute** on completed `FACT_SHEET` / `NAV_PACK` runs (step-up).
- `#v33ReportSchedule` opens full schedules modal (replaces list-only stub).

### `admin-101-regulatory.js`

- `wrapRenderReg` + `patchRegPackage`: filing evidence panel on `#v33RegPackage` (attach, remove, export CSV, waive).
- `#v33NewObligation` → create filing from template modal (`GET /templates`, `POST /filings`).

## 5. Tests

- `w6-nav-accounting-regulatory-reports.test.ts`: static path checks; distribute POST; schedule create POST; regulatory filing create POST.
- `w7-clients-services-onboarding-vault.test.ts`: static path checks; change-request approve POST; PM evidence multipart POST.

## 6. Known limits / follow-ups

- Report schedule edit is create + pause/resume only (no inline name/recipients editor in legacy modal).
- Regulatory evidence panel fetches filing detail on selection (extra GET per obligation click).
- Investor portal invite modal uses bridge form; ops-native clients screen remains the full RBAC picker.

## 7. Acceptance checklist

- [x] Schedule create wired (`POST /reports/schedules`)
- [x] Regulatory evidence attach visible on filing package panel
- [x] PM evidence file upload wired
- [x] Investor portal users + pending changes on clients page
- [x] w6/w7 jsdom write round-trips + `legacy-bridge.mjs --check`
- [x] HANDOFF-17 with §11 M7 prompt

---

## §11 — Copy-paste prompt for M7 agent

```
Proceed to M7 on branch feat/original-ui-wiring. Bridges only; no commit/push unless I ask.

Read first:
1. docs/handoff/HANDOFF-17-M6-CLIENTS-VAULT-REPORTS-REG.md (this file)
2. IMPLEMENTATION_MILESTONES.md — M7
3. docs/ADMIN-REAL-PAGES.md — PM/financing/CA/data/models/recon gap rows

Repo: C:\Users\lysp\Downloads\matanho-nexus-v56-deployment
Branch: feat/original-ui-wiring

## Your scope: M7 — Admin page depth (PM, financing, CA, data, models + recon families)

Requirement IDs: ADMIN-5A03–04, 5A20–21, 5A23–24, ADMIN-5A17 (extended)

Goal: Close private-markets CRUD gaps; financing lifecycle; corporate-action elections/process; data exception resolve; model reviews tab; add recon families per GAP-006.

## Do

1. Static gate: `node tools/legacy-bridge.mjs --only admin --check` after bridge edits; targeted vitest for w8+ and recon tests.
2. Backend: Recon families/tolerances in `modules/recon/*` if missing (read-only confirm first).
3. Frontend (bridges only): `admin-83`, `admin-96`, `admin-97`, `admin-84`, `admin-85`, `admin-95` per ADMIN-REAL-PAGES.
4. Reference: ops-native PM/financing/CA/data/model screens; maker-checker via step-up + SoD toasts.
5. Tests: extend legacy jsdom suites with write round-trips per touched bridge.
6. Deliverable: `docs/handoff/HANDOFF-18-M7-PM-FINANCING-CA-DATA.md` with §11 prompt for M8.

## Do NOT

- Start M8+ or redo M2–M6 unless regressed
- Edit legacy markup/CSS or `/ops-native` product UI
- Deploy/push/merge unless owner asks
- Commit unless owner asks

## Acceptance criteria

- [ ] Financing draw creates facility state change in API
- [ ] CA process requires step-up where API does
- [ ] Recon break assign persists owner
- [ ] At least one jsdom write round-trip per touched bridge file
- [ ] `legacy-bridge.mjs --check` passes
- [ ] HANDOFF-18 written with §11 prompt for M8
```
