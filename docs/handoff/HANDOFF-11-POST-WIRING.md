# Handoff 11: Post-wiring documentation and cleanup closure
Date 2026-10-05 / agent run / branch `feat/original-ui-wiring` / commit `7cedc0a`

## 1. What this phase was (one paragraph)
W0–W9 original UI wiring was already complete on `feat/original-ui-wiring`. This phase closed **CLEANUP-AGENT-PROMPT §7** documentation gaps only: updated `docs/ADMIN-REAL-PAGES.md` with a per-page wiring report for all 28 prototype pages, updated `docs/TODO.md` with milestone M11 and package commit hashes, appended decisions D-39..D-40, and ran static verification (legacy-bridge check, admin-web build, tsc, jsdom tests). No deploy, no browser QA, no `/ops-native` deletion.

## 2. What I did (by page or area)
| Area | Deliverable |
| --- | --- |
| `docs/ADMIN-REAL-PAGES.md` | Full 28-page table: bridge files, wired controls, endpoints, tests, honest "Not available yet" gaps |
| `docs/TODO.md` | M11 milestone; section 9 W0–W9 all `[x]` with commits; merge/deploy checklist |
| `docs/DECISION-LOG.md` | D-39 (doc closure + ops-native retention), D-40 (vitest combined-run flake) |
| `docs/handoff/HANDOFF-11-POST-WIRING.md` | This file |
| `docs/handoff/LATEST.md` | Points here |
| `docs/handoff/PHASE-LOG.md` | W4–W9 commit hashes filled in |

Per-page wiring detail lives in `docs/ADMIN-REAL-PAGES.md` § "Legacy V56 UI wiring". Bridge inventory:

| Bridge | Pages |
| --- | --- |
| `admin-70-shell.js` | Topbar (shared) |
| `admin-71-command.js` | command |
| `admin-72-operations.js` | operations |
| `admin-80-portfolios.js` | portfolios |
| `admin-81-ibor.js` | ibor |
| `admin-82-portfolio-lab.js` | portfolio-lab |
| `admin-83-private-markets.js` | private-markets |
| `admin-84-data.js` | data |
| `admin-85-model-governance.js` | model-governance |
| `admin-86-copilot.js` | copilot |
| `admin-90-orders.js` | orders |
| `admin-91-research.js` | research |
| `admin-92-risk.js` | risk |
| `admin-93-performance.js` | performance |
| `admin-94-cash.js` | cash |
| `admin-95-recon.js` | reconciliations |
| `admin-96-financing.js` | financing |
| `admin-97-corporate-actions.js` | corporate-actions |
| `admin-98-nav.js` | valuation |
| `admin-100-accounting.js` | accounting |
| `admin-101-regulatory.js` | regulatory |
| `admin-102-reports.js` | reports |
| `admin-10-kyc.js` (extended) | onboarding |
| `admin-20-clients.js` (extended) | clients |
| `admin-30-investor-services.js` (extended) | investor-services |
| `admin-40-documents.js` (extended) | vault |
| `admin-60-access.js` + `admin-61-access-depth.js` | rbac, settings, audit (+ access union, role switcher) |

## 3. Files changed (list, grouped) and commits
- `docs/ADMIN-REAL-PAGES.md` — Legacy V56 UI wiring section expanded (28 pages + shared chrome + verification table)
- `docs/TODO.md` — M11, section 9 complete, merge checklist
- `docs/DECISION-LOG.md` — D-39..D-40
- `docs/handoff/HANDOFF-11-POST-WIRING.md` (new)
- `docs/handoff/LATEST.md`, `docs/handoff/PHASE-LOG.md`

Docs-only pass; not yet committed unless owner asks.

## 4. How I verified it (commands run and results)
| Command | Result |
| --- | --- |
| `node tools/legacy-bridge.mjs --only admin --check` | pass — up to date |
| `npm run build -w @matanho/admin-web` | pass (Next 16.3.7, Turbopack, ~2 min) |
| `npx tsc --noEmit -p portals/admin-web` | pass |
| `npx vitest run --pool=forks --maxWorkers=1 tests/frontend/legacy/` | 8 files / 20 tests pass in one run; w0 (5) + w6 (2) worker spawn timeout — **all 27 tests pass when run per file** |

Test files: `w0-entry` (5), `w1-command-ops` (2), `w2-portfolios-ibor`, `w3-orders`, `w4-research-risk-performance`, `w5-cash-recon-financing`, `w6-nav-accounting-regulatory-reports` (2), `w7-clients-services-onboarding-vault`, `w8-private-markets-data-models`, `w9-copilot-rbac-audit-qa`.

## 5. Not browser-verified
Aggregate checklist from W1–W9 (still applies until UAT deploy + owner browser QA):

- [ ] Visual match to `docs/reference/ORIGINAL-UI-today-system-administrator.png` and role-specific sidebar focus sets
- [ ] Today KPI/chart tabs with live series when signed in
- [ ] Operations maker-checker / creator-cannot-complete toasts
- [ ] Global search navigation to hash pages
- [ ] Portfolio create with evidence upload; IBOR refresh polling sequence
- [ ] Orders step-up on approve/route; broker instruction preview
- [ ] Research valuation; risk scenario numbers; performance period lock step-up
- [ ] Cash statement import commit with checker; recon break resolve flow
- [ ] Financing draw/repay; corporate action elections/process step-up
- [ ] NAV release step-up; regulatory filing evidence; report editor params
- [ ] Client 360 change-request approve SoD; vault hold release step-up
- [ ] Private markets mark approve step-up; data exception resolve
- [ ] Copilot multi-table answers; integration banner with `ALLOW_FAKE_INTEGRATIONS=1`
- [ ] RBAC change-request approve with step-up; access review certify/revoke
- [ ] Settings numbering padding and retention purge drawers
- [ ] Audit facet counts vs ops-native; system_admin role switcher preview

## 6. Decisions made
- D-39: Document honest per-page gaps in `ADMIN-REAL-PAGES.md`; retain `/ops-native` until owner sign-off.
- D-40: Vitest combined legacy run may flake on Windows; per-file runs are the acceptance path (27/27 pass).

## 7. Problems found, workarounds, traps
- Combined vitest legacy suite: after ~8 worker spawns, w0/w6 may fail to start (timeout). Run each `w*.test.ts` individually on this host.
- UAT live stack unchanged — still pre-wiring image; staged release `uat-rc11-original-ui` on server.
- Untracked files in working tree (investee-native, offline scripts) are unrelated to wiring — do not commit without owner review.

## 8. Carry-over / deferred (owner-decision flags)

| Item | Owner decision needed |
| --- | --- |
| **Deploy `uat-rc11-original-ui` to UAT** | Owner must approve deploy command (see HANDOFF-10-W9 §10) |
| **Browser-verify §5 checklist** | Owner or delegated QA after deploy |
| **Merge `feat/original-ui-wiring` → `dev`** | After deploy + browser QA sign-off |
| **Delete `/ops-native` routes and `src/ops/**`** | Explicit owner sign-off — reference screens still useful for parity checks |
| **Platform settings editor in prototype Settings** | **Closed (D-41):** Platform settings drawer on Settings page; workspace prefs stay in prototype panels |
| **RBAC matrix "propose change" modal parity** | **Closed (D-41):** Propose role change drawer with batch permission checkboxes; per-cell toggles kept |
| **Access review per-item certify UI** | **Closed (D-41):** Review detail drawer with certify/revoke per staff row and complete review |
| **Onboarding/custodian portal originals** | Owner decision (D-42): restore HTML vs keep React vs UAT rc1 — not implemented here |
| **Push to remote** | Owner instruction required (D-07) |

## 9. Next phase: merge / deploy / UAT validation (owner-driven)
Recommended order:
1. Owner reviews `docs/ADMIN-REAL-PAGES.md` gap column and §8 flags above.
2. Deploy `uat-rc11-original-ui` when approved (`HANDOFF-10-W9` §10).
3. Browser-verify §5 items with owner credentials.
4. Merge branch to `dev`; optionally delete `/ops-native` after sign-off.
5. Commit this doc pass if desired (docs-only).

## 10. Current state of the repo and environments
- Branch: `feat/original-ui-wiring` @ `7cedc0a`
- Commits: W0 `eeafba4`, W1 `00a5c2c`, W2 `1ab13f5`, W3 `ecbfe21`, W4 `573bbf2`, W5 `58a5d9b`, W6 `c4f723d`, W7 `dc527af`, W8 `bd53a41`, W9 `3486460`, validation fix `7cedc0a`
- Static checks: pass (see §4)
- UAT (207.180.234.151): **live stack unchanged** (pre-wiring). Staged: `/root/nexus-releases/uat-rc11-original-ui.tar.gz`
- Post-wiring docs: updated locally, uncommitted

## 11. Next agent — copy-paste this prompt

> **Handoff rule:** Original UI wiring and post-wiring docs are complete. Use this prompt only when the owner asks for deploy, browser QA, merge, or ops-native cleanup.

```
Original UI wiring (W0–W9) and post-wiring docs are complete on feat/original-ui-wiring @ 7cedc0a.
Read docs/handoff/HANDOFF-11-POST-WIRING.md (especially §8–§9) and docs/CLEANUP-AGENT-PROMPT.md §7.
Do ONLY what the owner explicitly requests: UAT deploy, browser-verify §5, merge to dev, delete /ops-native, or push.
Do not deploy, browser-test, push, or delete /ops-native unless the owner says so in the same message.
```
