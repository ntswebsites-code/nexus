# Frontend tests: Admin console part B

Project: `admin-web` (Vitest + jsdom + Testing Library + user-event, network mocked with `mockApi`, no browser).
Folder: `tests/frontend/admin/b/` (25 files, 477 tests). The folder is picked up through one line added to `vitest.config.mts` (the `admin-web` project also includes `tests/frontend/admin/**`).

Run: `npx vitest run --project admin-web tests/frontend/admin/b --reporter=dot` (about 3.5 minutes on this machine; one file: add its name).
Shared test kit: `_kit.tsx` (`mountPage(ui, { perms, routes, user })` = SessionProvider + `/api/auth/me` with the given permission codes + shell stubs) and `_params.ts` (route params for `[id]` pages).

Responses use the real shapes read from the backend routes: `{data}` envelopes where the route sends one, bare bodies where it does not (ledger, events, periods, notifications, shell, client-ops), `{error:{code,message,details,fieldErrors}}` for errors.

## Flows covered

- **src/ops/api.ts client** (`api-client.test.tsx`): JSON/FormData requests, Idempotency-Key, credentials, `{data}` unwrap, error envelope mapping, field-level reasons appended to "Validation failed" (3 max, no duplicates), non-JSON errors, network errors, `describeError` wording per code, step-up retry with the same key (no loop, cancel, no handler), `apiUpload`, `apiDownload`.
- **Shared UI** (`ui-components.test.tsx`): ActionButton (in-app confirm instead of `window.confirm`, disabled-with-reason `requires`, double-click protection, key reuse on retry and rotation after success, stale error cleared, dismiss), ConfirmDialog/Modal, FormModal (success, API failure, retry key), `useResource`/`Loaded`/`ErrorState` (loading, 501, 403, 404, generic), formatters, money (no float drift).
- **Shell** (`shell.test.tsx`): session provider states (ok, no admin role, server error, signed out), sidebar permission filtering and role-focus lens, mobile hamburger toggle (aria-expanded, scrim, closes on navigation), production simulated-adapter banner, command palette (Ctrl+K, `/`, permitted pages only, record search debounce and 2-character minimum, errors, keyboard), notification bell (unread count, mark read then navigate, external links never followed, mark all read, empty/error), user menu role focus, breadcrumbs, TOTP step-up modal end to end.
- **IBOR** (`ibor.test.tsx`): overview tiles, ledger filters/paging, Refresh and Reconcile (disabled with reason, picks a portfolio, posts with key, reloads), events tab, position detail (tabs, links, 404).
- **Performance** (`performance.test.tsx`): returns table, stale-data banner, controls with evidence text, attribution/contributions, prepare period, benchmark composition editor (100% rule), period detail (maker cannot lock, pending controls block, stale draft, correction).
- **Portfolio construction** (`portfolio-lab.test.tsx`): models (PMD refs, check tag, disabled actions with permission, maker-checker activate, create/edit with version, retire), what-if (tiles, trade-check banner, validation errors), proposals (save, stale/breached block, orders.create gate, discard).
- **Private markets** (`private-markets.test.tsx`): overview/J-curve/FX gaps, By client look-through, funds and commitments, cashflow notice rules, marks (evidence, SoD, approve gating, reject/return reasons, upload guard).
- **Research and IC** (`research.test.tsx`): case list/filters, per-field validation modal (client rules and server `details` mapping), case lifecycle with author/reviewer separation, IC decisions (vote, ratify SoD, propose HOLD), meetings.
- **Financing** (`financing.test.tsx`): summary tiles, facilities (disabled controls for every gated action, approve SoD, draw posting), margin calls (acknowledge/dispute/met/waive, issuer cannot waive), pools, rules.
- **Clients** (`clients.test.tsx`): list/filters, 360 tab counts, new-client drawer selection, hold release as change request, pending approvals (maker sees Withdraw only), mandate activation confirm, cash account submit/approve.
- **Investor services** (`investor-services.test.tsx`), **Onboarding and KYC** (`onboarding.test.tsx`), **Vault** (`vault.test.tsx`), **Reports** (`reports.test.tsx`), **Regulatory** (`regulatory.test.tsx`), **Data fabric incl. schedules/queue/lineage** (`data.test.tsx`, `suite-helpers-automation.test.tsx`), **Model governance** (`model-governance.test.tsx`), **E-signatures incl. staff signing, wizard, verify, flows menu** (`esign.test.tsx`, `esign-wizard.test.tsx`).
- **RBAC** (`rbac.test.tsx`): role matrix, role/permission change requests, staff access (invite, change roles, disable), change requests (own vs others, approve confirm, reject), access reviews, SoD report, step-up policy.
- **Settings, profile, notifications** (`settings-profile-notifications.test.tsx`), **Security, record, audit, copilot** (`security-audit-copilot-record.test.tsx`), **Integrations** (`integrations.test.tsx`), **Securities and market data** (`securities-market-data.test.tsx`).

## Issue ids with regression tests

ADB-001, 002, 003, 004, 005, 006, 007, 008, 009, 010, 011, 012 (financing, portfolio-lab, private marks, onboarding risk scoring, clients cash account, shared ActionButton), 013, 014 (api client and form modal), 015, 016 (a prefill, b size text, c maker-checker, e missing evidence; d is seed text), 017, 018 (page and ActionButton), 019, 020 (SoD report), 021, 022, 023 (PMD- vs MDL-, numbering label), 024 (undo with reason, supersession refusal, step-up retry), 025, 026, 027, 028(c), ADA-008 (stale banner), ADA-010, ADA-014 (security page, ActionButton, no `window.confirm`), ADA-019 (guarded simulate route, rejected exceptions), ADA-028, ADA-029 (dead link), INO-025 (provisional rating). Test names carry the id.

## Results

477 passed, 0 failed (final full run of the folder). `tsc --noEmit` in `portals/admin-web` is clean after the product edits below.

Failures found and what was done:

| Failure | Cause | Fix |
|---|---|---|
| Onboarding risk scoring table: no Edit control for a user without `onboarding.approve` (ADB-012 not fully fixed) | F6 pass never applied the disabled-with-reason pattern to this table | Product fix: `portals/admin-web/src/app/(ops)/ops/onboarding/page.tsx` renders Edit disabled with "Needs the onboarding.approve permission" plus a line of text |
| Clients: cash account in Pending approval had no Approve control at all (ADB-012) | Page only had Submit for a Draft | Product fix: `portals/admin-web/src/app/(ops)/ops/clients/page.tsx` adds `ActionButton` Approve with `requires="cash.approve"`, confirm, idempotency key (server enforces maker-checker) |
| E-signatures: a signer without `esign.view` still requested every signature request (refused by the API, wasted call) | `useResource` ran regardless of the permission | Product fix: `portals/admin-web/src/ops/esign.tsx` skips that request when `esign.view` is missing |
| Several first-run failures | Test mistakes only (duplicate text matches, wrong expected text, native validation, jsdom limits) | Test corrected; no product code involved, no assertion weakened |

Behaviour notes (not defects): document lifecycle and e-sign wizard POSTs send no Idempotency-Key (their APIs do not require one); `en-GB` date formatting prints "Sept" in newer Node/ICU, so date assertions accept `Sep(t)`.

Still open, outside this area: the `/ops/clients` drawer actions (hold, owner, review date) and "New client" are hidden, not disabled, for users without `clients.edit`. ADB-012 only named the cash account Approve for clients, so this was left as is.

## Cannot be verified without a browser

- Visual layout, colours, spacing, truncation and table overflow (including ADB-028(a) notification dropdown no longer scrolling sideways and wrapping long text).
- Mobile drawer at 375 px (ADB-026): the toggle state logic is tested; slide animation, scrim stacking, 980 px breakpoint and tap targets are CSS.
- Focus order, focus trap in dialogs, autofocus on the confirm button, Escape handling across nested modals, scroll position after navigation or modal open.
- Real file input behaviour: jsdom `FormData(form)` cannot read files chosen through user-event, so the multipart body of the vault upload and e-sign wizard is verified through the helpers (`upload`, `uploadPdf`) and the name prefill is verified, not the end-to-end submit of the file from a form. Native browser form validation messages (required, pattern, email, min/max) are only partly emulated.
- `window.open` downloads and signed-link tabs, blob downloads and CSV save dialogs (spied, not observed), print-ready HTML reports, PDF rendering and the signature/field placement canvas.
- Charts and SVG drawing quality (return chart, J-curve): presence only, not shape.
- Redirect to `/login` on a 401 (`window.location.assign` is not observable in jsdom; only "protected content never renders" is asserted).
- Real cookies across portals and the per-port session cookie (ADA-004), session timeout, MFA clock drift, authenticator apps.
- Browser differences (date/datetime-local pickers, `Intl` output, Safari/Firefox quirks), keyboard shortcut conflicts with browser shortcuts (Ctrl+K), password managers.
- Real latency, concurrency and double-click timing against a real server; real Next.js routing, middleware and server rendering (`next/*` is mocked).
