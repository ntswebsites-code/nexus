# Handoff 01: W0 finished -> next: W1
Date 2026-10-05 / agent run / branch `feat/original-ui-wiring` / commit `eeafba4`

## 1. What this phase was (one paragraph)
W0 restored the original V56 admin UI as the product entry point, demoted the mistaken native React console to an unlisted `/ops-native` reference route, extended the shared `mx-core` bridge client, and added jsdom test infrastructure so later packages can wire pages without a browser.

## 2. What I did (by page or area)
| Area | Wired | Endpoints | Bridge file |
| --- | --- | --- | --- |
| Entry / routing | `/` serves legacy workspace; `/classic` alias; `/ops/*` → `/ops-native/*` | n/a | `next.config.ts`, `(legacy)/page.tsx` |
| Sidebar | 28 items restored from `0adef6f`; no Operations Console link | n/a | `03-sidebar.html` |
| Retired redirects | Removed hash→`/ops` hijack | n/a | deleted `admin-01-retired.js` |
| mx-core | envelope unwrap, idempotency, If-Match, step-up modal, hydrate/gate/strict/list/table | n/a | `packages/legacy-runtime/bridge/mx-core.js` |
| Hook loader | `tools/hooks/*.mjs` merged at install time | n/a | `tools/legacy-bridge.mjs` |
| Permissions | 15 prototype view codes verified in catalogue | n/a | `tools/check-prototype-permissions.mjs` |
| Tests | jsdom harness + W0 tripwires | n/a | `tests/frontend/legacy/_harness.ts`, `w0-entry.test.ts` |

## 3. Files changed (list, grouped) and commits
- Commit `eeafba4`: W0 package (124 files): runtime, entry, sidebar, ops-native move, tests, decision log D-17..D-19.

## 4. How I verified it (commands run and results)
- `npm run build -w @matanho/admin-web` — pass (after clearing stale `.next`)
- `node tools/legacy-bridge.mjs --only admin --check` — up to date
- `npx vitest run --project admin-web tests/frontend/legacy/w0-entry.test.ts` — 5/5 pass
- `git diff 0adef6f -- portals/admin-web/src/legacy/markup portals/admin-web/public/legacy/css` — empty (sidebar matches original)

## 5. Not browser-verified
- [ ] Visual match to `docs/reference/ORIGINAL-UI-today-system-administrator.png`
- [ ] Signed-in landing at `/` with full sidebar and role focus behaviour
- [ ] `/ops-native` redirect from old bookmarks

## 6. Decisions made
See `docs/DECISION-LOG.md` D-17 (serve at `/`), D-18 (`/ops-native`), D-19 (hook loader).

## 7. Problems found, workarounds, traps
- Stale `.next` referenced deleted `(ops)` routes — delete `.next` before build after route renames.
- `admin-01-retired.js` copy lingered in `public/legacy/js/bridge/` until manually deleted; re-run `legacy-bridge.mjs` after removing source files.
- PowerShell does not support `&&` or bash HEREDOC commits.

## 8. Carry-over
None. W1 started in HANDOFF-02.

## 9. Next phase: W1
Scope: command (Today), operations, topbar/shell. Files: `admin-70-shell.js`, `admin-71-command.js`, `admin-72-operations.js`, `tools/hooks/w1.mjs`. Depends on W0.

First steps: read `src/ops/commandpanels.tsx`, `operations.tsx`, `shell/*`; implement bridges; add `tests/frontend/legacy/w1-*.test.ts`; run `legacy-bridge.mjs`.

## 10. Current state
Branch `feat/original-ui-wiring` @ `eeafba4`. Production untouched. Dev deploy: not done.
