# HANDOFF-39 — M13 slice 16: Final sweep closure

**Branch:** `feat/original-ui-wiring`  
**Date:** 2026-10-06  
**Prior:** HANDOFF-38 (slice 15)

## 1. Goal

Close remaining M13 open items from `ADMIN-REAL-PAGES.md` gap column and cross-check against `ORIGINAL-UI-WIRING-PLAN` / `IMPLEMENTATION_MILESTONES.md`: no hardcoded demo KPIs when `mx.live && mx.strict(page)`.

## 2. Rule

Wire only where routes exist. Hide or neutralize prototype panels when live. No commit/push unless owner asks (D-07).

## 3. Changes

| File | Change |
|---|---|
| `admin-30-investor-services.js` | `pmExposureTotals` fills unfunded KPI; `openPortalAccessOverview` (`GET /clients/investor-users`); live Portal users button |
| `admin-61-access-depth.js` | Settings demo hide + hydrate; RBAC ops-style tabs; staff **Disable** via `USER_DISABLE` |
| `32-page-settings.html` | Prototype status/grid marked `mx-demo-only` |
| `w7` / `w9` tests | New assertions |
| `docs/ADMIN-REAL-PAGES.md` | Rows 7, 9, 10, 26, 27 gaps cleared |

## 4. Honest remaining limitations (not hardcoded UI)

| Area | Note |
|---|---|
| Performance TE/IR | API does not expose fields yet; stat line stays `—` |
| IBOR | Column groups saved but columns not hidden in grid |
| Operations | XLSX export not wired (CSV is) |
| Recon connector | 503 when custodian adapter not configured |
| Accounting | Multi-basis book config has no API |
| Model governance | v37 wizard simplified UX |
| Copilot | Multi-table answer rendering unverified in browser |
| Audit | Facet counts at very large chain sizes unverified |
| Settings | `platformSettingsV8` workspace prefs only in prototype mode |

## 5. Acceptance checklist

- [x] All 28 sidebar pages: KPI strips clear on hydrate when live+strict
- [x] Demo panels hidden or replaced with API data across sweep targets
- [x] Portal users: clients modal + investor-services overview
- [x] RBAC: tabs + staff disable request
- [x] Settings: prototype grid hidden; admin-core drawers when live
- [x] **Full M13 sweep complete** (hardcoded-number rule)

---

## §11 — Copy-paste prompt for post-M13 work

```
M13 admin legacy sweep complete (HANDOFF-39). Branch feat/original-ui-wiring. No commit/push unless I ask.

Remaining items are API/UX limitations in ADMIN-REAL-PAGES.md §4 of HANDOFF-39 — not hardcoded KPI violations.

Next: owner sign-off on /ops-native removal, LP/onboarding portal sweeps, or deploy (D-07).
```
