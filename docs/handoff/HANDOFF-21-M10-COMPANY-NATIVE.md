# Handoff 21: M10 — Company-web native pages and workspace depth

Date 2026-10-05 · branch `feat/original-ui-wiring` · requirement IDs: CO-016, CO-005–011, CO-015, FR-CMP-020–028, GAP-016

## 1. Goal (one paragraph)

M10 wires the four native investee screens (requests, forecasts, governance, data-room) into the Next.js app via `PortalSwitch`, extends the investee API client with workspace-depth methods, and registers backend vault depth routes. Workspace tables (GAP-016) were already migrated in prior work; this milestone connects the frontend to live API paths and completes investee vault download/preview/versions/withdraw.

## 2. Commands run and results

| Command | Result | Notes |
|---|---|---|
| `npx vitest run --pool=vmThreads tests/frontend/company-web/native-screens.test.tsx` | **PASS** | 38/38 |
| `npm run typecheck -w @matanho/company-web` | **PASS** | Native + PortalSwitch included after tsconfig exclusion removal |
| `npx tsx backend/api/scripts/test-investee-workspace.ts` | **Not run** | Requires `E2E_CONFIRM=throwaway-db` + API |
| `npx tsx backend/api/scripts/test-investee-vault.ts` | **Not run** | Requires `E2E_CONFIRM=local` + API |

## 3. Backend changes

### GAP-016 (confirmed read-only)

Cap table, forecast, governance, requisitions persist in Prisma workspace tables (`investee_workspace`, `investee_cap_tx`, `investee_forecast_*`, etc.); legacy `Setting` JSON migrated once in `workspace/store.ts`.

### New: `workspace/vault.ts`

- `GET /vault/:id/versions` — version history with fingerprints
- `GET /vault/:id/download-url` — signed URL; `?inline=1` for PDF/image preview
- `POST /vault/:id/versions` — new version upload
- `POST /vault/:id/withdraw` — withdraw with reason (legal-hold / published-pack refusals)
- `vaultDocuments` excludes withdrawn/disposed; includes current `version`

### `files.routes.ts`

- `?inline=1` on signed downloads serves previewable types inline with `X-Content-Type-Options: nosniff`

## 4. Frontend changes

### Layout

- `(portal)/layout.tsx` — `PortalSwitch` replaces direct `InvesteePortal`; children render native screens when flags live

### Native routes

| Route | Page component |
|---|---|
| `/requests` | `RequestsScreen` |
| `/forecasts` | `ForecastsScreen` |
| `/governance` | `GovernanceScreen` |
| `/data-room` | `DataRoomScreen` |

Runtime-only routes (`/reports`, `/kpis`, …) still fall back to V8 via `PortalSwitch`.

### `lib/investee/api.ts` + `types.ts`

Native methods: `getRequestsWithTranche`, `submitDraftRequest`, `resubmitRequest`, `getForecastWorking`, `saveForecastCells`, `submitForecastVersion`, `getForecastVersion`, `getGovernanceFull`, `getVaultDownloadUrl`, `getVaultVersions`, `addVaultVersion`, `withdrawVaultDocument`.

### `tsconfig.json`

Removed M10 WIP exclusions for `native/**`, `PortalSwitch.tsx`, `native-pages.ts`.

## 5. Flags / env

`INVESTEE_LIVE_ACTIONS=all` (or per-key: `requests.list`, `forecast`, `governance`, `vault`, …) enables native screens via `GET /api/v1/platform/flags` → `investee.liveActions`. Production example: `deploy/.env.production.example`.

## 6. Known limits / follow-ups

- Cap-table native page not in scope — stays on V8 + `/workspace` tools
- Full E2E workspace/vault scripts need throwaway DB or `E2E_CONFIRM=local`
- V8 runtime removal remains phased per milestones

## 7. Acceptance checklist

- [x] `PortalSwitch` active in portal layout
- [x] `/forecasts` (and 3 other native routes) render native screen when flag on
- [x] Cap-table transactions persist in DB (GAP-016 tables; verified read-only)
- [x] Investee vault depth routes registered
- [x] Vitest `native-screens.test.tsx` green
- [x] HANDOFF-21 with §11 M11 prompt

---

## §11 — Copy-paste prompt for M11 agent

```
Proceed to M11 on branch feat/original-ui-wiring. Onboarding AI readiness panel; no commit/push unless I ask.

Read first:
1. docs/handoff/HANDOFF-21-M10-COMPANY-NATIVE.md (this file)
2. IMPLEMENTATION_MILESTONES.md — M11
3. portals/onboarding-web/src/ (Wizard.tsx)
4. backend/api/src/integrations/llm/
5. portals/admin-web/src/legacy/bridge/admin-10-kyc.js (staff triage pattern)

Repo: C:\Users\lysp\Downloads\matanho-nexus-v56-deployment
Branch: feat/original-ui-wiring

## Your scope: M11 — Onboarding AI readiness panel

Requirement IDs: ONB-006, GAP-A09 (LLM triage)

Goal: SRD 5.C.0 readiness/triage panel appears in wizard with server-driven scoring (fake LLM adapter acceptable).

## Do

1. Backend: Public or draft-scoped triage endpoint (or extend `/public/applications/:id`); wire `integrations/llm` fake adapter.
2. Frontend: Panel component in `Wizard.tsx` calling API.
3. Validation: onboarding flow test; component test.
4. Deliverable: `docs/handoff/HANDOFF-22-M11-ONBOARDING-AI.md` with §11 prompt for M12.

## Do NOT

- Start M12+ or redo M2–M10 unless regressed
- Wire live LLM vendor
- Deploy/push/merge unless owner asks
- Commit unless owner asks

## Acceptance criteria

- [ ] Submitting wizard shows readiness score from API, not client-only formula
- [ ] Public API test passes
- [ ] HANDOFF-22 written with §11 prompt for M12
```
