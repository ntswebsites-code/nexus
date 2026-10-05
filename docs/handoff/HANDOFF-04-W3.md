# Handoff 04: W3 finished -> next: W4
Date 2026-10-05 / agent run / branch `feat/original-ui-wiring` / commit (see git log)

## 1. What this phase was (one paragraph)
W3 connected the Orders & Execution page (`10`) to the live OMS API. **What you can do now that you could not before W3:** open Orders and see real blotter rows and KPI tiles (working, awaiting approval, filled, slippage) from `GET /orders`, search/filter with server-side `q`/status, export CSV via `/orders/export`, submit new orders from the v33 security workstation composer (`POST /orders` + validate + submit), approve/route/record fills from Order 360 and the approvals tab (maker-checker with step-up), preview and send broker instructions from modal `43` (`broker-instruction/preview` + `route`), and refresh the workspace from the API. Browser `localStorage` order lists are bypassed when live. The V56 look is unchanged.

## 2. What I did (by page or area)
| Page / area | Wired controls | Endpoints | Bridge file |
| --- | --- | --- | --- |
| orders `10` | KPI strip, blotter tabs (workstation/blotter/approvals/post-trade), `#v33BlotterSearch`, `#v33SubmitOrder`, `#v33ApproveOrder`, Order 360 approve/route/fill, `#brokerModal` preview + send, `export-orders`, `refresh-order-book`, legacy `#orderSearch` / `#orderStatusFilter` | `GET /orders`, `/orders/export`, `POST /orders`, `/orders/precheck` (via validate path), `/:id/{validate,submit,approve,route,fills}`, `/:id/broker-instruction/preview`; catalogs `GET /portfolios`, `/securities`, `/brokers` | `admin-90-orders.js` |
| DATA_HOOKS | `orders` + v33 blotter arrays; localStorage draft/submitted stores disabled when live | n/a | `tools/hooks/w3.mjs` |

Native `/ops-native/orders/**` remains reference-only. No backend changes in W3.

## 3. Files changed (list, grouped) and commits
- `portals/admin-web/src/legacy/bridge/admin-90-orders.js` (new)
- `portals/admin-web/public/legacy/js/bridge/admin-90-orders.js` (generated)
- `tools/hooks/w3.mjs` (new)
- `portals/admin-web/public/legacy/js/01-inline.js`, `v33-rebuild.js`, `v37/v44/v53/v56-enhancements.js` (hook patches)
- `portals/admin-web/src/legacy/manifest.ts` (bridge list)
- `tests/frontend/legacy/w3-orders.test.ts` (new)
- `docs/DECISION-LOG.md` (D-25..D-26)
- `docs/handoff/HANDOFF-04-W3.md`, `LATEST.md`, `PHASE-LOG.md`

## 4. How I verified it (commands run and results)
- `node tools/legacy-bridge.mjs --only admin` — hooks applied
- `node tools/legacy-bridge.mjs --only admin --check` — up to date
- `node -e "…"` static W3 assertions — pass
- `npx tsc --noEmit` — pass `portals/admin-web`, `packages/legacy-runtime`
- `npm run build -w @matanho/admin-web` — pass (after clearing stale `.next` lock)

## 5. Not browser-verified
- [ ] KPI numbers vs API when signed in
- [ ] v33 composer portfolio name → portfolio id mapping with real master data
- [ ] Step-up modal on approve/route
- [ ] Broker instruction email preview vs sent payload
- [ ] Fill modal quantity/price vs partial fill state
- [ ] v44/v56 ticket overlays when opened instead of v33 composer
- [ ] Post-trade tab content vs `GET /orders/:id/post-trade`
- [ ] FIX feeds / contract notes panels (no prototype controls wired)

## 6. Decisions made
- D-25: Bridge file `admin-90-orders.js` (handoff §9) rather than plan's `admin-83-orders.js`.
- D-26: Shared mutable arrays `__mxData._orders` / `_v33Orders` so both 01-inline and v33-rebuild blotters hydrate from one API fetch; v33 composer maps portfolio/broker names to ids via catalog lookup.

## 7. Problems found, workarounds, traps
- `mx.get` unwrap drops `summary` on list responses — use `getEnvelope()` like W2.
- v33 `orders` lives inside an IIFE; hook uses `window.__mxData._v33Orders` reference for in-place `mx.replace`.
- v44/v56 submit buttons intercepted in capture phase when live; full v44 ticket field mapping deferred (composer path preferred).
- Next.js build lock: remove `.next` if "Another next build process is already running".

## 8. Carry-over / deferred
- Reject/cancel/settle from prototype drawer (no dedicated buttons in fragment; available in ops-native detail).
- Order import (`#v33OrderImport`) — honest toast only; use ops-native imports route.
- STOP_LIMIT and price-override fields not in prototype composer; API supports them via ops-native new order.
- Post-trade KPI tiles (settlement ready, control state) remain static markup until post-trade API mapped to chips.
- `GET /orders/:id/post-trade`, trading-feeds FIX/contract-notes not wired (no matching prototype controls).

## 9. Next phase: W4 — research, risk, performance
**Scope:** pages `11`, `12`, `13`. **Owns:** `admin-91-research.js`, `admin-92-risk.js`, `admin-93-performance.js`, `tools/hooks/w4.mjs`. **Depends:** W0, W2.

First 5 steps:
1. Read ops-native research/risk/performance pages for API shapes.
2. Inventory prototype pages `11-page-research.html`, `12-page-risk.html`, `13-page-performance.html` + enhancement scripts.
3. Add DATA_HOOKS for demo arrays (`research`, risk limits, performance series).
4. Wire list/hydration and primary write actions per CLEANUP-AGENT-PROMPT §5 W4.
5. Add `tests/frontend/legacy/w4-research-risk-performance.test.ts` and run `legacy-bridge.mjs --check`.

## 10. Current state of the repo and environments
- Branch: `feat/original-ui-wiring` @ `ecbfe21` (W3 code; parent W2 `1ab13f5`)
- Tests: W0–W2 static checks pass; W3 static checks pass; vitest worker timeout possible on combined runs (same as W1/W2)
- Production (207.180.234.151): untouched
- Dev environment: not deployed
- Untracked files from other workstreams remain — not part of W3
