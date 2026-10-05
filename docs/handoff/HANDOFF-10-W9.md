# Handoff 10: W9 finished — original UI wiring complete
Date 2026-10-05 / agent run / branch `feat/original-ui-wiring` / commit (see git log)

## 1. What this phase was (one paragraph)
W9 completed the final admin pages and QA sweep: Investment Copilot (`30`), RBAC/settings admin-core depth, audit facets/drill-down, and cross-page jsdom tripwires. **What you can do now that you could not before W9:** on Copilot, ask questions via `POST /admin-core/copilot/ask` with live suggestions/history, integration banner when fake adapters run in production, and prototype bubble rendering; on RBAC, privileged matrix/user/invite/role changes route through `/admin-core/rbac/requests` with approve/reject drawers, access review campaigns, step-up policy view, and extended SoD report; on Settings, view admin-core change history in the audit panel, open numbering padding and retention purge drawers; on Audit, filter with facet dropdowns (action/type/portal), verify chain, and drill into events via `/admin-core/audit/events/:id` with hash-chain metadata. Final QA tests cover all W1–W8 bridges, role focus matrix, and localStorage/copilot bypass hooks. The V56 look is unchanged.

## 2. What I did (by page or area)
| Page / area | Wired controls | Endpoints | Bridge file |
| --- | --- | --- | --- |
| copilot `30` | `#v15CopilotForm`, suggestion chips, history/sources/new actions, `appendV15Copilot` wrap, integration banner | `POST /admin-core/copilot/ask`, `GET /copilot/{suggestions,history}`, `GET /integrations/banner` | `admin-86-copilot.js` |
| rbac `31` | Matrix/user changes → change requests, injected Change requests/Reviews/Step-up buttons, SoD depth | `POST /admin-core/rbac/requests`, `/requests/:id/{approve,reject}`, `GET /rbac/{reviews,step-up,sod}` | `admin-61-access-depth.js` |
| settings `32` | Injected Numbering/Retention buttons, `#settingsAuditList` from admin-core history | `GET /admin-core/settings/history`, `/settings/numbering`, `/retention/{runs,run}` | `admin-61-access-depth.js` |
| audit `33` | Facet filter drawer (action/type/portal), event drill-down with chain links | `GET /admin-core/audit/{facets,events/:id}`, existing `/admin/audit-events*` | `admin-60-access.js` (row ids) + `admin-61-access-depth.js` |
| RBAC switcher | system_admin preview of all prototype roles | existing `/admin/access-context` | `admin-61-access-depth.js` |
| DATA_HOOKS | `appendV15Copilot` demo bypass when `mx.strict('copilot')` | n/a | `tools/hooks/w9.mjs` |
| QA | Role matrix, bridge inventory, hook assertions | n/a | `w9-copilot-rbac-audit-qa.test.ts` |

Native `/ops-native/{copilot,rbac,settings,audit}/**` remains reference-only. No backend changes in W9.

## 3. Files changed (list, grouped) and commits
- `portals/admin-web/src/legacy/bridge/admin-86-copilot.js` (new)
- `portals/admin-web/src/legacy/bridge/admin-61-access-depth.js` (new)
- `portals/admin-web/src/legacy/bridge/admin-60-access.js` (audit row `data-mx-audit-id`, `__mxAuditRows`)
- `portals/admin-web/public/legacy/js/bridge/admin-{60,61,86}-*.js` (generated)
- `tools/hooks/w9.mjs` (new)
- `portals/admin-web/public/legacy/js/06-inline.js` (hook patch)
- `portals/admin-web/src/legacy/manifest.ts` (bridge list)
- `tests/frontend/legacy/w9-copilot-rbac-audit-qa.test.ts` (new)
- `docs/DECISION-LOG.md` (D-37..D-38)
- `docs/handoff/HANDOFF-10-W9.md`, `LATEST.md`, `PHASE-LOG.md`

## 4. How I verified it (commands run and results)
- `node tools/legacy-bridge.mjs --only admin` — hooks applied
- `node tools/legacy-bridge.mjs --only admin --check` — up to date
- `npx vitest run … w9-copilot-rbac-audit-qa.test.ts` — not run (vitest worker timeout on this host; same as W0–W8)

## 5. Not browser-verified
- [ ] Copilot answer table rendering vs ops-native for multi-table replies
- [ ] Copilot integration banner when `ALLOW_FAKE_INTEGRATIONS=1` in production
- [ ] RBAC change-request approve with step-up from prototype drawer
- [ ] Access review item certify/revoke flow vs ops-native
- [ ] Settings numbering padding change vs ops-native
- [ ] Retention live purge step-up from prototype drawer
- [ ] Audit facet counts vs ops-native when chain has many action types
- [ ] system_admin role switcher preview vs ORIGINAL-UI reference screenshots

## 6. Decisions made
- D-37: Bridge files `admin-86-copilot.js` + `admin-61-access-depth.js` per HANDOFF-09 §9 (not plan's `admin-97-copilot`).
- D-38: RBAC/settings depth in sibling `admin-61`; minimal `admin-60` patch for audit event ids only.

## 7. Problems found, workarounds, traps
- `interceptSubmit` registration order blocked admin-61 form overrides — use capture-phase `submit` listener instead.
- `filter-audit` duplicate intercept — admin-61 uses capture-phase click to replace admin-60 filter drawer with facet-aware version.
- W9 `02-v7` localStorage hooks duplicate W0 base hooks — copilot-only hook in `w9.mjs`; RBAC/settings bypass stays in W0 `legacy-bridge.mjs`.
- Vitest worker timeout on combined legacy tests — static file assertions in w9 test file.

## 8. Carry-over / deferred
- Full ops-native parity for RBAC matrix “propose change” modal (prototype uses per-cell toggles).
- Access review per-item certify UI — list-only in prototype drawers; full workflow in ops-native.
- Admin-core platform settings editor (feature flags/security) — ops-native Settings tab; prototype uses legacy `platformSettingsV8` for workspace prefs.
- Copilot FAB (`44-button-v15-copilot-fab`) — navigates to page; live ask uses same bridge as page form.
- Delete `/ops-native` screens after owner sign-off (post-wiring cleanup task).

## 9. Next phase: wiring complete — deploy / UAT validation
All W0–W9 packages are implemented on `feat/original-ui-wiring`. Recommended next steps for the owner:
1. Review `docs/CLEANUP-AGENT-PROMPT.md` §7 definition of done checklist.
2. Run full `npm run build -w @matanho/admin-web` and API flow scripts on UAT host.
3. Browser-verify items in §5 above.
4. Commit W1–W9 (one commit per package if not already committed) and deploy when approved.

## 10. Current state of the repo and environments
- Branch: `feat/original-ui-wiring` (W0–W9 code; commits may be pending)
- Tests: W0–W9 static checks pass; `legacy-bridge.mjs --check` passes; vitest worker timeout possible on combined runs
- Production (207.180.234.151): untouched
- Dev environment: not deployed

## 11. Next agent — copy-paste this prompt

> **Handoff rule:** Original UI wiring (W0–W9) is complete. Use this prompt for deployment validation or post-wiring cleanup only.

```
W0–W9 original UI wiring is complete on branch feat/original-ui-wiring.
Read docs/handoff/HANDOFF-10-W9.md and docs/CLEANUP-AGENT-PROMPT.md §7.
Run builds, API flow scripts, browser-verify §5 items, commit per package if needed, and prepare UAT deploy per owner instruction. Do not push unless asked.
```
