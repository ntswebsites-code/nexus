# FE test run: Custodian and Onboarding portals

Projects `custodian-web` and `onboarding-web`, jsdom, network mocked with real response shapes (read from `backend/api/src/modules/custodian/*` and `modules/kyc/public*.ts`). No browser.

Run: `npx vitest run --project custodian-web --reporter=dot` and `npx vitest run --project onboarding-web --reporter=dot` (or `npm run test:frontend:custodian` / `:onboarding`).

Result (final): custodian-web 7 files, 109 tests, all pass. onboarding-web 4 files, 71 tests, all pass.

## Flows covered

Custodian (`tests/frontend/custodian-web/`)
- Shell: user/counterparty/role header, nav, unread badge, /me failure with Sign out.
- Dashboard: KPI tiles and deep links, exceptions, drafts (singular/plural), awaiting approval, rejection note, latest statement, empty states, no Submit link without permission.
- Executions: list with real fields, filters (query params, deep links `?status=`, `?new=1`), loading/empty/error, new execution (empty form, currencies, Idempotency-Key reuse on retry, double submit, API errors), amend (pre-fill, patch of changed fields only, no-change guard, API errors, Escape), cancel, history modal, HTML/formula text rendered as text, read-only users.
- Bulk upload: template download, dry run then upload multipart (declared totals trimmed), per-row errors, control-total Agrees/Differs table, duplicates, 422 on real upload, resetting on new file, recent uploads, permission note. CSV parsing and formula-injection rules live in the API (the UI sends the file); the UI side of them (row errors, field names, messages) is covered.
- Day-end: list, role-based Submit/Approve/Supersede, maker-checker (own package: disabled Approve with reason), submit/approve actions and error messages (control_total_mismatch, segregation_of_duties), 401 redirect, new package multipart, duplicate-draft warning, package_exists, double submit, control totals fill (incl. nil day-end), supersede, controls and history modal.
- Statements and holdings: files, holdings (account filter, per-file modal), templates, validate/upload flow, rejected statements, 1 MB limit, duplicates, adapter error.
- Users and roles, notifications, status history.

Onboarding (`tests/frontend/onboarding-web/`)
- Start (types from /meta, fallback types, email validation, create draft body and session storage, rate limit), resume by `?resume=` link (secret removed from URL), expired draft, load failure, already submitted redirect, hydration of every section.
- All six steps: field-level validation, banner, focus, entity versus individual (directors required only for entities, entity-only fields hidden), ownership totals, people emails, KYC amounts, tax/bank formats, holder-name advisory, evidence required-by-type, review declaration.
- Document upload: request shape and token header, received state with scan result, size limit, malware reject, disguised executable, picker accept list, busy state, replace.
- Autosave (debounced PATCH), Save draft success/failure, 409 redirect, review summary, submit payload, double submit, incomplete_application, server value errors, done screen with reference and tracker link.
- Resume panel and `/resume?link=` (explicit click, used/expired link), tracker (steps, updates newest first, draft state, 30 s refresh, expired link), more-info request (documents, reply trimmed, double click, errors, escaping).
- Pure logic: `holderMatches`, `isEntity`, field definitions, defaults, `fmtSize`, session storage, API client error mapping.

## Issue ids with regression tests

| Issue | Test(s) |
|---|---|
| LPC-011 | day-end: "control-total mismatch (409) on Submit shows the server message"; bulk: "control totals ... Differs" (server rule itself is backend) |
| LPC-013 | bulk: formula-injection row errors; executions: "spreadsheet-formula text refused by the API" |
| LPC-014 | executions: ISO date-time with Z is sent |
| LPC-015 | executions (new/amend): API field messages shown verbatim, retry reuses the Idempotency-Key |
| LPC-016 | day-end: duplicate-draft warning shown as a warning notice |
| LPC-017 (blocker) | executions: quantities 500/100/40000/10000/500.5 pre-filled unchanged (it.each); price-only amend patches only price; quantity change sent with zeros |
| LPC-018 | executions: empty form, USD/ZWG/ZAR, no min on quantity, fractional quantity displayed in full |
| LPC-019 | day-end: 401 `unauthorized` redirects to `/login?next=` with query; other 401 codes (mfa) and the login page do not redirect |
| LPC-020 | day-end: save creates a Draft only, Submit is separate |
| LPC-021 | wording.test.tsx: no prototype/Demo wording or pre-filled demo values on any page |
| LPC-012 | not a frontend item (seed data, F1) |
| INO-022 | wizard: upload all nine documents in one session, Continue reaches Review |
| INO-023 | wizard: program disguised as PDF rejected message; unsupported type and picker accept list |
| INO-024 | wizard: negative/non-numeric amounts, SWIFT, account number, holder mismatch is warning only |
| INO-029 | wizard: "On file. Leave blank to keep it."; HTML escaped; resume lands on step 1 (known gap, documented by a test) |

## Product bugs found and fixed (F9 files)

1. Quantities rounded to whole numbers in the UI (a quantity of 0.5 showed as 1, 1234.5678 as 1,235) on Executions, Dashboard exceptions, Holdings, and day-end/bulk totals. API allows 8 decimals (LPC-018). Added `fmtQty` (string based, keeps every decimal, groups thousands). Files: `portals/custodian-web/src/lib/api.ts`, `app/(portal)/executions/page.tsx`, `page.tsx` (dashboard), `statements/page.tsx`, `day-end/page.tsx`, `executions/upload/page.tsx`.
2. Race in `useLoad`: a slower older response could overwrite a newer one (deep link `/executions?status=Exception` fetches unfiltered first, then filtered; the unfiltered list could win while the Status select says Exception). Only the latest request now updates state. File: `custodian-web/src/lib/api.ts`.
3. Permission-gated controls were hidden silently. Added read-only notices on Executions, Day-end and Statements, and a disabled Approve with the reason ("You prepared this package; a different approver must approve it.") on the user's own submitted package. Files: executions, day-end, statements pages.
4. Onboarding: a bank holder name that differs from the legal name BLOCKED Continue on the Tax and bank step, contradicting INO-024/INO-029 ("stays a warning"). It is now an advisory note under the field and never blocks. Files: `portals/onboarding-web/src/components/Wizard.tsx`, `ui.tsx` (new `warning` prop), `app/(app)/globals.css`.

Typecheck: `tsc --noEmit` clean in portals/custodian-web and portals/onboarding-web.

## Test-side notes

- jsdom reports `valueMissing` for a `required` file input even after `user.upload`; `attachFile` (custodian `_support.tsx`) drops the flag after attaching (each test asserts `toBeRequired()` first).
- `Sept` versus `Sep` differs between ICU versions for en-GB; tests use October dates.

## Observations not changed

- Executions page fetches the list twice on mount (`ready` flips after mount). Harmless now that stale responses are ignored.
- `toIso()` (new/amend execution) interprets the datetime-local value in the browser's time zone while the hint says "Harare time"; correct for users in Harare, shifted for others.
- Public onboarding API calls (submit, reply) carry no Idempotency-Key; double-submit is prevented by the disabled button and the server's `already_submitted` / reply de-duplication.
- Onboarding step 2 has no duplicate-owner check and the wizard always reopens on step 1 (INO-029 leftover).
- `(sign)` e-sign pages and `(auth)` pages are out of scope (portal-kit / other groups).

## Cannot be verified without a browser

- Layout, responsive table overflow, modal focus trap and scroll lock, sticky shell/sidebar, CSS visibility of `hidden` file inputs.
- Real file-picker behaviour (accept filtering by the OS dialog, drag and drop), real constraint-validation bubbles for `required` file inputs and `type=date max`.
- `window.scrollTo` smooth scrolling and focus after step change on real pages; timing of the 1 s autosave under slow networks.
- Actual navigation after `location.assign/replace` (login redirect, `/status`), cookies/session sharing between portals (LPC-019 end to end), `next build`.
- Blob download of templates (tested up to the anchor click and Blob content), date/time rendering in the Harare time zone on a non-UTC machine.
- Visual Idempotency/duplicate behaviour against the real API (covered backend-side).
