# FE test run: investee portal (company-web) and portal-kit

Run: `npx vitest run --project company-web --project portal-kit --reporter=dot`
Result: 14 files, 238 tests, all pass (the previous agent's partial work was kept and continued).

## Flows covered (tests/frontend/company-web, tests/frontend/portal-kit)
- company-web: portal shell and navigation, overview (no demo fallback), reporting centre (submit/save draft, period list, failed submit keeps the modal, double-submit, submit existing draft), requests, cap table (register, transactions, maker-checker, withdraw), forecasts, KPIs (units, periods, export), governance, workspace tools (signature requests, share links, cap table register, board packs), public /sign/<token> and share pages, settings save, team invitations, vault upload, messages, company switcher, term-sheet signing and declining (incl. MFA step-up), InvesteeApiError messages.
- portal-kit: session hook, AccessDenied, login/forgot/reset password, MFA prompts, accept-invite form, proxy gate logic.

## Issue ids with regression tests
INO-001 to INO-021, INO-026, INO-027, INO-028 (named in describe/it titles). INO-030 is not-a-defect (dev compile time). INO-017 term-sheet signing is now covered end to end (draw signature, consent, multipart body, step-up replay, server refusal).

## Product bugs found and fixed
- INO-019 (regression): Settings letterhead fields were pre-filled from the company record, so legal name, registration, e-mail, phone and website always looked "changed": the letterhead was rewritten on every save and its legal name overwritten with the short company name. Fixed in `portals/company-web/src/components/investee-portal-v8-mock/matanho-investee-portal-runtime.js` (a saved letterhead is the source of its own fields).
- Reporting centre: with live requests and no open period selected, saving fell back to a calendar index and posted a report for a period nobody asked for. Fixed in `portals/company-web/src/lib/investee/host.ts` (`saveReport` requires an open request).
- INO-008: double-clicking Withdraw (or Approve/Reject) sent the request twice. Fixed in `portals/company-web/src/components/WorkspaceTools.tsx` (in-flight guard per transaction).

## Test-side corrections
- Term-sheet signing tests did not draw on the signature pad, which the product correctly requires; added a pointer-event drawing helper.
- "Sign refreshes the term sheet" counted GET /term-sheets/:id including the page-load call; now asserts the count increases.
- The mfa-invite timeout seen on the first run was machine load; passes on rerun.

## Cannot be verified without a browser
- Real canvas drawing and the PNG produced by the signature pad (canvas is stubbed).
- Layout, overlay stacking, mobile drawer, sticky headers, responsive tables.
- File download and object-URL behaviour (CSV/XLSX export, templates), real file picker.
- Cookie handling, the Next proxy redirect on a real server, session expiry timers.
- Authenticator-app TOTP enrolment end to end and QR rendering.
