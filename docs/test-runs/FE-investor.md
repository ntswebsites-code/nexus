# FE test run: LP portal (investor-web)

Command: `npx vitest run --project investor-web tests/frontend/investor-web --reporter=dot`

## Flows covered (tests/frontend/investor-web/)
- dashboard (KPIs, actions, activity, open-ended panel, error/Try Again, realtime refresh) - dashboard.test.tsx
- capital calls, payment confirmation (amount, note, overpayment, already PAID, Idempotency-Key), distributions, activity - capital-activity, account-activity
- subscriptions/redemptions dealing (estimate, submit, expired estimate, validation) - dealing
- documents, notices, performance and statement download - documents, notices, performance
- service requests: create, detail, reply - requests
- settings and notification preferences - settings
- organisation: colleagues, invitations (create/edit/revoke), viewer restrictions - organisation, organisation-viewer
- e-sign inbox and signing (consent, typed name, step-up, decline, completed read-only) - esign-signing
- sidebar, smoke - sidebar, smoke
- lib: api client and error envelopes, format and mappers, realtime SSE client with polling fallback (mock EventSource) - lib-*.test.ts

## Issue regression tests
LPC-002, 003, 004, 007, 008, 010, 022, 023, 024, 025, 026 (named in their tests); LPC-005, 006, 009 in issue-regressions.test.tsx. LPC-001 is F3 (not this area).

## Results
220 tests, 18 files: all pass (217 pre-existing + 3 added). No product bugs found; no product files changed.

## Cannot be verified without a browser
- Chart rendering (recharts has 0 size in jsdom; only data/labels asserted)
- Real PDF/statement download and inline PDF viewing, drawn signature canvas
- Real EventSource network behaviour and reconnect timing
- Layout, responsive sidebar, CSS visibility, focus rings, sidebar flash timing (LPC-025)
- Cookie/session behaviour across portals (LPC-001)
