# 5.E Custodian / Counterparty Portal (port 3104)

#### 5.E.0 Shell — header, hero, two-card layout (`/`, none)

| Attribute | Value |
| --- | --- |
| Purpose | Workspace where a custodian / counterparty submits trade executions and day-end packages for the manager's reconciliation. **[O]** |
| Access | None today: page is public; no proxy, no login route; portal id `custodian` absent from `PORTAL_IDS` (admin, investor, onboarding, company). **[O]** Target: authenticated counterparty users scoped to one counterparty and its accounts, MFA required. **[P]** |
| Prototype layer | V65 `custodian-portal.html` extracted to `portals/custodian-web/public/legacy/js/01-inline.js`, `public/legacy/css/01-inline.css`, `src/legacy/markup/01-body.html`. |
| Wiring status | Prototype (localStorage `matanho-v61-custodian-submissions`, in-memory fallback). Target: API (5.E.4). |
| Entry points | Direct URL (`custodian.nexus.matanho.com` per nginx; dev `http://localhost:3104/`). **[O]** |
| Exit points | None. |

##### Layout

1. Boot splash "matanho / LOADING WORKSPACE". **[O]**
2. Top bar: *matanho* with small "CUSTODIAN DATA PORTAL"; pill "Controlled counterparty workspace · Demo". **[O]**
3. Hero: eyebrow "TRADE CONFIRMATION · DAY-END BOOK · RECONCILIATION EVIDENCE"; H1 "Custodian / Counterparty Portal"; text "Enter the executed trade as soon as it is available, then submit the independent day-end book later. The asset manager receives both records in the same reconciliation staging area."; three static step tiles. **[O]**
4. Two-card grid (1.15 : 0.85): left "Submit counterparty data" with tabs *Trade execution* (5.E.1) and *Day-end package* (5.E.2); right "Submission status" (5.E.3). **[O]**
5. Toast (bottom-right). **[O]**

##### Elements

| # | Element | Type | Content / behaviour | Data source (current → target) | Label |
|---|---|---|---|---|---|
| 1 | Title | `<title>` | "Matanho Custodian Data Portal" | static | [O] |
| 2 | Step tile 1 | tile | "01 · EXECUTION" / "Record the trade after execution" | static | [O] |
| 3 | Step tile 2 | tile | "02 · DAY END" / "Submit cash, holdings and trade control totals" | static | [O] |
| 4 | Step tile 3 | tile | "03 · RECONCILE" / "Matanho matches against its internal book" | static | [O] |
| 5 | Left card head | text | "Submit counterparty data" / "Use the execution tab during the day. Use Day-end after the official books are final." | static | [O] |
| 6 | Tabs | segmented buttons | *Trade execution* (active by default), *Day-end package*; click toggles active tab and pane; no ARIA tab roles; selection not persisted | static | [O] |
| 7 | Toast | toast | Title + message, auto-hide 2.8 s | — | [O] |
| 8 | Signed-in identity (target) | header chip | Counterparty name, user name, sign-out | API `/api/auth/me` | [P] |

##### Tables

None.

##### Inputs & validation

None on the shell.

##### Actions

| Control | Enabled when | Permission | Effect | Wiring / API | Label |
|---|---|---|---|---|---|
| Tab *Trade execution* / *Day-end package* | always | none | Shows the pane | Prototype | [O] |

##### Modals & drawers

None.

##### States

- Empty / Loading / Error: boot splash only. **[O]**
- Responsive **[O]**: ≤ 800 px single column, step tiles stacked, form fields 1 column, header stacked, padding 14 px; ≤ 480 px metrics 1 column, hero padding 17 px, H1 22 px.

##### Business rules & calculations

None on the shell.

##### Edge cases

- Anyone with the URL can submit records. **[O]**

##### Gaps, defects & open questions

- **DEF-485** No authentication or authorisation: no `proxy.ts`, no `/login`, no `@matanho/portal-kit` dependency; page comment "Not gated by the auth proxy yet; custodian accounts are not part of the role catalogue."
- **DEF-486** `custodian` missing from the portal registry (`PORTAL_IDS`, `PORTALS`), from env (`CUSTODIAN_PORTAL_URL`) and therefore from the API's default CORS allow-list.
- FR-AUTH-018: Custodian portal access — `custodian` portal id, counterparty-scoped users invited by operations, MFA, `/login`, `/invite`, `/reset-password` — AC: an unauthenticated request to `/` redirects to `/login?next=/`; a user of counterparty A cannot see or submit for accounts of counterparty B.
- Q-165: Custodian user roles (single submitter, or submitter + approver for day-end packages)? — default: submitter and approver; day-end package requires approver ≠ submitter at the counterparty.

---

#### 5.E.1 Trade execution (`/` tab `execution`, none)

| Attribute | Value |
| --- | --- |
| Purpose | Record an executed trade as soon as it is available for matching against the manager's order book. **[O]** |
| Access | None today. Target: counterparty submitter for the selected account. **[P]** |
| Prototype layer | V65 `custodian-portal.html` → `01-inline.js` |
| Wiring status | Prototype (`executions[]` in `matanho-v61-custodian-submissions`). Target: `POST /api/v1/custodian/executions` [P]. |
| Entry points | Default tab; tab *Trade execution*. |
| Exit points | Tab *Day-end package*. |

##### Layout

1. Form `#tradeForm`, 2-column grid (execution note full width).
2. Actions right-aligned: *Clear*, *Submit execution*.
3. Note (blue left border): "The portal creates an immutable submission record in this prototype. Production access would be authenticated, permissioned and signed by the custodian user."

##### Elements

None beyond inputs and the note.

##### Tables

None.

##### Inputs & validation

Native HTML validation is active (form has no `novalidate`); JS guard runs after it. **[O]**

| Field | Control | Required | Options / default / placeholder | Validation today (code) | Target validation | Error message |
|---|---|---|---|---|---|---|
| *Trade reference* (`ref`) | text | **Yes** | default "TRD-260904-201" | `required`; JS non-empty after trim | unique per counterparty [P] | browser required message; toast "Incomplete trade" / "Complete all required execution fields."; target "Trade reference already submitted" [P] |
| *Execution time* (`execTime`) | datetime-local | **Yes** | now (local) at load and after submit | `required` | not in future; stored ISO-8601 UTC [P] | browser required message |
| *Account / portfolio* (`account`) | text | **Yes** | default "BGF-001" | `required`; JS non-empty | select from accounts the counterparty services [P] | browser / "Incomplete trade" toast |
| *Security / ticker* (`ticker`) | text (upper-cased on save) | **Yes** | default "DLTA.ZW" | `required`; JS non-empty | resolves to security master (ticker or ISIN) [P] | browser / toast; target "Unknown security" [P] |
| *Side* (`side`) | select | Yes | *BUY* (default), *SELL* | — | — | — |
| *Quantity* (`qty`) | number, min 1, step 1 | **Yes** | default 10000 | `required`, min 1, integer (native); JS `qty` truthy | > 0, lot size [P] | browser range/step message; toast |
| *Execution price* (`price`) | number, step 0.0001 | **Yes** | default 0.184 | `required`, ≤ 4 dp (native); JS `price` truthy (0 rejected) | > 0, instrument tick [P] | browser step message; toast |
| *Currency* (`currency`) | select | Yes | *USD* (default), *ZWG* | — | add ZAR [P] | — |
| *Settlement date* (`settlement`) | date | **Yes** | today + 2 calendar days (UTC date) | `required` | ≥ trade date, business-day calendar (ZSE/VFEX) [P] | browser required message |
| *Executing broker* (`broker`) | text | **Yes** | default "IH Securities" | `required` | select from broker master [P] | browser required message |
| *Execution note* (`tradeNote`) | textarea, full width | No | placeholder "Optional market, allocation or settlement note" | none | ≤ 2000 [P] | — |

##### Actions

| Control | Enabled when | Permission | Effect (state change, toast text, navigation) | Wiring / API | Label |
|---|---|---|---|---|---|
| *Clear* (`type=reset`) | always | none | Native reset to markup defaults; *Execution time* and *Settlement date* become empty (defaults are not re-applied) | Prototype | [O] |
| *Submit execution* (primary) | always | none | Record `{id:'EXEC-'+epoch ms, ref, executionTime, account, ticker (upper), side, qty, price, currency, settlement, broker, note, created: "dd Mon yyyy, HH:mm" en-GB, status:'Submitted'}` appended to `executions[]`; status panel refreshed; toast "Execution submitted" / "`<ref>` is available to Matanho Reconciliations."; form reset and date defaults re-applied | Prototype → `POST /api/v1/custodian/executions` → 201 `{id, ref, status:'Received'}` [P] | [O] |

##### Modals & drawers

None.

##### States

- Empty: defaults above. **[O]**
- Error: native bubbles; toast "Incomplete trade". **[O]**
- Disabled: none. **[O]** Target: submit disabled while request runs. **[P]**
- Conditional: none.

##### Business rules & calculations

- Matching (manager side) **[V61]**: exact trade reference preferred; else ticker + side + quantity; quantity must match exactly; execution-price tolerance ±0.01 (absolute); routine matches leave the exception queue; missing counterpart records and genuine differences create exceptions.
- BR-193: A submitted execution is immutable; corrections are new versions that supersede the earlier one with a reason, both retained.

##### Edge cases

- After submit the reference resets to "TRD-260904-201", so duplicates are easy; no uniqueness check. **[O]**
- *Clear* empties both date fields; next submit is blocked until re-entered. **[O]**
- Settlement default ignores weekends/holidays and uses the UTC date. **[O]**
- Fractional quantities and prices with > 4 decimals are rejected by the browser. **[O]**
- No submitter identity is stored on the record. **[O]**

##### Gaps, defects & open questions

- **DEF-487** No API endpoint or model for executions; the "immutable" record is editable browser storage.
- FR-REC-012: Counterparty execution submission API with server validation (unique reference per counterparty, account scope, security master, positive qty/price, settlement ≥ trade date) and audit — AC: duplicate reference → 409; out-of-scope account → 403; each accepted record appears in admin Reconciliations as a counterpart Trades record within 5 s.
- Q-166: Minimum execution fields (ISIN, venue ZSE/VFEX, gross/net consideration, fees, ClOrdID/ExecID)? — default: add ISIN, venue, gross consideration, fees and optional ClOrdID/ExecID.

---

#### 5.E.2 Day-end package (`/` tab `dayend`, none)

| Attribute | Value |
| --- | --- |
| Purpose | Submit the official day-end cash, holdings and trade-count control totals with the official file fingerprint. **[O]** |
| Access | None today. Target: counterparty submitter (+ approver, Q-NEW 5.E.0). **[P]** |
| Prototype layer | V65 `custodian-portal.html` → `01-inline.js` |
| Wiring status | Prototype (`dayEnd[]` in `matanho-v61-custodian-submissions`; file content not stored). Target: `POST /api/v1/custodian/day-end` multipart [P]. |
| Entry points | Tab *Day-end package*. |
| Exit points | Tab *Trade execution*. |

##### Layout

1. Form `#dayForm`, 2-column grid; file drop zone and control note full width.
2. Actions right-aligned: *Clear*, *Submit day-end package*.

##### Elements

| # | Element | Type | Content / behaviour | Data source (current → target) | Label |
|---|---|---|---|---|---|
| 1 | File drop zone | dashed box (label) | "Select holdings / cash / settlement file" (replaced by chosen file name) / small "Filename and SHA-256 fingerprint are recorded when supported"; click opens file picker (no drag-and-drop handler) | Prototype | [O] |

##### Tables

None.

##### Inputs & validation

| Field | Control | Required | Options / default / placeholder | Validation today (code) | Target validation | Error message |
|---|---|---|---|---|---|---|
| *Statement date* (`statementDate`) | date | **Yes** | today (UTC date) | `required`; JS non-empty | ≤ today; one active package per (account, date, currency) [P] | browser; toast "Incomplete package" / "Statement date and account are required." |
| *Account* (`dayAccount`) | text | **Yes** | default "BGF-001" | `required`; JS non-empty | counterparty-scoped account select [P] | as above |
| *Closing cash* (`cash`) | number, step 0.01 | **Yes** | default 6320000 | `required`, ≤ 2 dp; negatives allowed | decimal(20,2); negative allowed only with overdraft flag [P] | browser step message |
| *Currency* (`dayCurrency`) | select | Yes | *USD* (default), *ZWG* | — | add ZAR [P] | — |
| *Holdings market value* (`holdings`) | number, step 0.01 | **Yes** | default 21839000 | `required`, ≤ 2 dp; negatives allowed | ≥ 0 [P]; per-security holdings from file [P] | browser step message |
| *Trades in day-end book* (`trades`) | number, min 0, step 1 | **Yes** | default 3 | `required`, integer ≥ 0 | equals executions received for (account, date) or raises a control exception [P] (BR-NEW) | browser range message |
| *Official day-end file* (`dayFile`) | file (single) | No | accept `.csv,.xlsx,.xls,.xml,.json,.pdf,.txt` | none; no size limit | required [P]; ≤ 25 MB; malware scan; server SHA-256 | target "Attach the official day-end file" [P] |
| *Control note* (`dayNote`) | textarea, full width | No | default "Official day-end balances approved for reconciliation." | none | ≤ 2000 [P] | — |

##### Actions

| Control | Enabled when | Permission | Effect (state change, toast text, navigation) | Wiring / API | Label |
|---|---|---|---|---|---|
| Choose file | always | none | Drop-zone label shows the file name | Prototype | [O] |
| *Clear* (`type=reset`) | always | none | Native reset; *Statement date* becomes empty; drop-zone label is **not** reset | Prototype | [O] |
| *Submit day-end package* (primary) | always | none | Computes SHA-256 of the whole file in the browser (`crypto.subtle`; empty string when no file or no secure context); record `{id:'DAY-'+epoch ms, date, account, cash, currency, holdings, trades, file: name or '', size, sha256, note, created, status:'Submitted'}` appended to `dayEnd[]`; toast "Day-end package submitted" / "`<account>` is ready for reconciliation."; form reset, drop-zone label reset, defaults re-applied | Prototype → `POST /api/v1/custodian/day-end` (multipart: fields + file) → 201 `{id, sha256, status:'Received'}` [P] | [O] |

##### Modals & drawers

None.

##### States

- Empty: defaults above; label "Select holdings / cash / settlement file". **[O]**
- Loading: none (hashing large files blocks without feedback). **[O]**
- Error: native bubbles; toast "Incomplete package". **[O]**
- Conditional: drop-zone label shows file name when chosen. **[O]**

##### Business rules & calculations

- SHA-256 hex of the file bytes, computed client-side only when `crypto.subtle` exists (HTTPS or localhost). **[O]**
- Control totals = closing cash, holdings market value, trade count, file fingerprint. **[O]**
- BR-194: Day-end trade count must equal the number of executions received for the same account and statement date; a difference opens a Trades control exception.
- BR-195: A day-end package, once submitted, can only be superseded by a newer package for the same (account, date, currency) with a reason; the earlier one is retained.

##### Edge cases

- File content is never stored or transmitted; only name, size, hash. **[O]**
- On plain-HTTP deployments the hash is silently empty. **[O]**
- Statement date default is the UTC date (between 00:00 and 02:00 Harare time it shows yesterday). **[O]**
- Multiple packages for the same account and date are accepted without warning. **[O]**
- The trade count is not compared with executions submitted. **[O]**

##### Gaps, defects & open questions

- **DEF-488** No API, model or object storage for day-end packages; hash computed only in the browser.
- FR-REC-013: Day-end package submission API — store the original file encrypted, compute SHA-256 server-side, validate control totals, register the package as a counterpart source import — AC: returned hash equals `sha256sum` of the uploaded file; package appears in admin Reconciliations source health for that account and date.
- Q-167: Day-end file formats to parse (MT535/MT536, CSV template)? — default: CSV template + PDF evidence; MT535/536 later.

---

#### 5.E.3 Submission status (`/` right card, none)

| Attribute | Value |
| --- | --- |
| Purpose | Show counts and the most recent submissions from this browser. **[O]** |
| Access | None today. Target: submissions of the user's counterparty only. **[P]** |
| Prototype layer | V65 `custodian-portal.html` → `01-inline.js` |
| Wiring status | Prototype (reads `matanho-v61-custodian-submissions`; re-renders on the `storage` event from other tabs). Target: `GET /api/v1/custodian/submissions` [P]. |
| Entry points | Always visible. |
| Exit points | None. |

##### Layout

1. Card head "Submission status" / "Records entered here become available to the manager's Reconciliations workspace."
2. Two metric tiles.
3. Activity list (max 8 items).

##### Elements

| # | Element | Type | Content / behaviour | Data source (current → target) | Label |
|---|---|---|---|---|---|
| 1 | *Executions* | KPI tile | count of all stored executions | Prototype → API | [O] |
| 2 | *Day-end packs* | KPI tile | count of all stored day-end packages | Prototype → API | [O] |

##### Tables

**Activity list** (card list, not a grid)

| Column | Format | Sortable | Notes |
| --- | --- | --- | --- |
| Title | "Execution · `<ref>`" or "Day-end · `<account>`" | No | bold |
| Status pill | "Submitted" (green) | No | always "Submitted" |
| Sub-line | execution "`<side> <qty with thousands separators> <ticker> @ <price>`"; day-end "Cash `<ccy> <cash with separators>` · `<n>` trades" | No | — |
| Created | "dd Mon yyyy, HH:mm" | No | — |

- Ordering: `created` string compared descending; top 8 shown. No filters, search, row click, row actions or pagination. **[O]**
- Target statuses: Received, Matched, Exception, Queried, Superseded with colours green/green/amber/blue/grey. **[P]**

##### Inputs & validation

None.

##### Actions

None (no row actions). Target: row click opens submission detail with manager status and query thread. **[P]**

##### Modals & drawers

None.

##### States

- Empty: "No submissions yet" / "Enter the first execution or day-end package." **[O]**
- Loading / Error: none. **[O]**
- Storage unavailable: in-memory fallback; counts reset on reload without message. **[O]**

##### Business rules & calculations

- Counts are all-time totals for this browser, not per day or account. **[O]**

##### Edge cases

- Sorting compares display strings, so order is wrong across days/months (e.g. "10 Aug" after "09 Sept"). **[O]**
- Records from another browser or device are never shown. **[O]**

##### Gaps, defects & open questions

- **DEF-489** `created` stored as a locale display string with no time zone; ordering broken. FR-REC-014: store ISO-8601 UTC and display Africa/Harare — AC: newest first across month boundaries.
- FR-REC-015: Status round-trip — manager match result and queries visible to the counterparty — AC: a break raised on an execution shows "Exception" with the query text in the custodian portal.

---

#### 5.E.4 Hand-off to admin reconciliation (process, not a page)

| Attribute | Value |
| --- | --- |
| Purpose | Deliver custodian submissions to the manager's reconciliation staging area (5.A.17). |
| Access | Custodian writes; admin users with `operations.view` read. |
| Prototype layer | Writer: V65 `custodian-portal.html`. Reader: none in the repository. |
| Wiring status | Prototype (same-origin localStorage only). Target: API. |
| Entry points | Custodian *Submit execution* / *Submit day-end package*. |
| Exit points | Admin Reconciliations source records and breaks. |

##### Layout

None.

##### Elements

None.

##### Tables

None.

##### Inputs & validation

None.

##### Actions

| Control | Enabled when | Permission | Effect | Wiring / API | Label |
|---|---|---|---|---|---|
| Hand-off (today) | submit succeeds | none | Writes `matanho-v61-custodian-submissions` in the custodian origin's localStorage | Prototype | [O] |
| Hand-off (target) step 1 | custodian submits | counterparty scope | `POST /api/v1/custodian/executions` or `POST /api/v1/custodian/day-end` → stored, audited (`custodian.execution.submitted`, `custodian.dayend.submitted`), outbox event | API [P] | [P] |
| step 2 | outbox event | system | Worker registers a `counterpart_imports` batch for source "Custodian portal · `<counterparty>`" and updates `recon_sources.last_received_at` | API [P] | [P] |
| step 3 | *Run matching* or schedule | `operations.view` | `POST /api/v1/recon/runs` matches internal vs counterpart records (reference → ticker/side/qty; qty exact; price ±0.01 [V61]); creates `recon_breaks` for differences and missing records | API [P] | [P] |
| step 4 | break updates | `operations.view` | Status visible to custodian via `GET /api/v1/custodian/submissions` (5.E.3 target) | API [P] | [P] |

##### Modals & drawers

None.

##### States

- Current: the admin portal is still extracted from V56 `index.html`; no admin code reads `matanho-v61-custodian-submissions`, and the V61 reconciliation workspace (three counterpart routes, matching, sign-off) is not present in the repository. **[O]**

##### Business rules & calculations

- The localStorage hand-off **cannot work** in any deployment of this repository: localStorage is per origin, and the custodian portal (`:3104` / `custodian.nexus.matanho.com`) and the admin portal (`:3100` / `nexus.matanho.com`) are different origins. Even on one origin, no admin reader exists. **[O]**
- Matching rules and sign-off **[V61]**: see 5.E.1; material exceptions block daily sign-off; resolution needs maker rationale + evidence reference; sign-off needs an independent checker (BR-001).

##### Edge cases

- The custodian toast "`<ref>` is available to Matanho Reconciliations." is untrue in every current deployment. **[O]**

##### Gaps, defects & open questions

- **DEF-490** Cross-origin localStorage hand-off; the custodian success toasts claim a delivery that never happens.
- **DEF-491** Admin reconciliation screen is V56; the V61 staging area described in `V61_CHANGES.md` is absent.
- FR-REC-016: Custodian submissions reach admin Reconciliations through the API (steps 1–4 above) — AC: an execution submitted in the custodian portal is visible as a counterpart record in admin Reconciliations within 5 s and is matched on the next run.
- FR-REC-017: Manual file import and broker/counterparty API connector routes [V61] share the same `counterpart_imports` pipeline — AC: each import creates a batch with source, account, filename, record count, import time and SHA-256.

---
