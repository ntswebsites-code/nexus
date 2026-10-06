# Handoff 22: M11 — Onboarding AI readiness panel

Date 2026-10-05 · branch `feat/original-ui-wiring` · requirement IDs: ONB-006, GAP-A09 (LLM triage)

## 1. Goal (one paragraph)

M11 adds the SRD 5.C.0 application readiness panel to the onboarding wizard. Scoring and risk preview are server-driven (`computeReadinessScore` + `applicationReadiness`); optional AI-assisted pre-screen uses the fake LLM triage adapter. Submit returns readiness score/risk band from the API. The panel sits in a third column beside the wizard steps.

## 2. Commands run and results

| Command | Result | Notes |
|---|---|---|
| `npx vitest run --pool=vmThreads --project onboarding-web` | **PASS** | 77/77 |
| `npm run typecheck -w @matanho/onboarding-web` | **PASS** | |

## 3. Backend changes

### `modules/kyc/readiness.ts` (new)

- `computeReadinessScore()` — V65 weights (fields 42%, evidence 34%, owners 12%, signatories 7%, triage 5%)
- `applicationReadiness()` — checks list + risk preview band
- `buildTriageInput()` / `runDraftTriage()` — fake LLM adapter; stores `formData.draftTriage` with `inputSha256` dedup

### `modules/kyc/public.routes.ts`

- `GET /applications/:id/readiness` → `{ readiness }`
- `POST /applications/:id/triage` → advisory triage
- Submit response extended: `{ ref, status, screening, readiness: { score, riskBand } }`

## 4. Frontend changes

| File | Change |
|---|---|
| `components/ReadinessPanel.tsx` | Score bar, checks, Run AI pre-screen button |
| `components/Wizard.tsx` | Panel in `wizard-grid`; refresh on boot/evidence; submit readiness on success page |
| `lib/api.ts` | `readiness()`, `triage()`; `navigateTo` / `setNavigateHandler` test hook |
| `app/(app)/globals.css` | `.wizard-grid`, `.readiness`, `.score`, `.check-list` styles |

## 5. Tests

- `readiness-panel.test.tsx` — render, triage POST + refresh, error handling
- `readiness-score.test.ts` — V65 formula weights (inline, no backend env import)
- `wizard.test.tsx` — readiness mocks, panel visible, submit readiness on success
- Test infra: `stubLocation` via `history.replaceState`; redirect tests use `setNavigateHandler`

## 6. Known limits / follow-ups

- Live LLM vendor out of scope (fake adapter only)
- Triage is advisory; Compliance retains final decision
- Public readiness endpoint requires draft token (same as other draft routes)

## 7. Acceptance checklist

- [x] Submitting wizard shows readiness score from API, not client-only formula
- [x] Public API covered by Vitest (readiness + triage mocks; formula unit test)
- [x] Component test (`readiness-panel.test.tsx`)
- [x] HANDOFF-22 with §11 M12 prompt

---

## §11 — Copy-paste prompt for M12 agent

```
Proceed to M12 on branch feat/original-ui-wiring. Custodian feed integration and admin recon consume; no commit/push unless I ask.

Read first:
1. docs/handoff/HANDOFF-22-M11-ONBOARDING-AI.md (this file)
2. IMPLEMENTATION_MILESTONES.md — M12
3. backend/api/src/integrations/custodian-feed/ (file-drop, parsers)
4. backend/api/src/integrations/bank-statement/
5. backend/api/src/modules/cash/cash.engine.ts + cash.routes.ts
6. portals/custodian-web/src/app/(portal)/statements/page.tsx
7. tests/frontend/custodian-web/statements.test.tsx

Repo: C:\Users\lysp\Downloads\matanho-nexus-v56-deployment
Branch: feat/original-ui-wiring

## Your scope: M12 — Custodian feed integration and admin recon consume

Requirement IDs: CUS-006, CUS-011, GAP-A05

Goal: Statement upload parses CAMT/MT940 via adapter; day-end packages flow into admin recon without manual re-key.

## Do

1. Backend: Wire `BankStatementAdapter` / `CustodianFeedAdapter` fakes; add CAMT053 to custodian validate/upload path via `cash.engine.parseStatement` where appropriate.
2. Bridge custodian ingest → `cashStatementImport` when account/ledger mapping exists (admin cash recon consumable).
3. Frontend: Custodian statements page shows parse results/errors (including CAMT).
4. Validation: extend `scripts/test-integrations.ts` and/or custodian Vitest.
5. Deliverable: `docs/handoff/HANDOFF-23-M12-CUSTODIAN-FEEDS.md` with §11 prompt for M13.

## Do NOT

- Start M13+ or redo M2–M11 unless regressed
- Wire live SWIFT / live custodian-feed vendor
- Deploy/push/merge unless owner asks
- Commit unless owner asks

## Acceptance criteria

- [ ] Upload sample CAMT creates `cashStatementImport` row consumable by admin cash recon
- [ ] Custodian statements UI shows parse results/errors
- [ ] Integration or custodian Vitest green
- [ ] HANDOFF-23 written with §11 prompt for M13
```
