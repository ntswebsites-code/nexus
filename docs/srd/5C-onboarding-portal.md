# 5.C Public Onboarding Portal (port 3102)

<!-- Drop-in text. Replaces the whole body of `### 5.C Public Onboarding Portal (port 3102)` and adds a new `### 5.E Custodian / Counterparty Portal (port 3104)` after 5.D. Headings below start at ####. -->

**5.C Public Onboarding Portal (port 3102)** — body replacing the current 5.C text.

The onboarding portal is a single public route (`/`) rendering the V65 "Institutional Investor Application" prototype (`legacy-static/v65/public-onboarding.html`; the code identifies itself as V57: draft key `…-draft-v57`, triage model "ATS v57"). It is a six-step wizard with a right-hand AI readiness / triage panel. **[O]** Today the page is 100 % `Prototype`: it makes no API call; the legacy data bridge for this portal is disabled. The shared API already implements a public applications API (`/api/v1/public/applications/*`, described in 5.C.7 and 11.3) that is written for the older V56 form and is not called by the V65 UI. Every "target" below refers to that API after the changes listed in each page's gaps.

---

#### 5.C.0 Shell — header, hero, step rail, action bar, AI readiness / triage panel (`/`, public)

| Attribute | Value |
| --- | --- |
| Purpose | Frame every wizard step: brand header, hero with draft/evidence/decision state, step rail, form head with progress, action bar, and the always-visible "AI ATS" readiness and triage panel. **[O]** |
| Access | Anonymous; no role, no session. Next.js proxy `createPortalProxy('onboarding', {requirePortalRole:false})` is a no-op unless `onboarding` is listed in `REQUIRE_AUTH_PORTALS` (empty by default). **[O]** Target: still anonymous; the draft belongs to whoever holds its draft token (`X-Draft-Token`) obtained at draft creation or from the emailed resume link. **[O API]/[P UI]** |
| Prototype layer | V65 `public-onboarding.html` extracted to `portals/onboarding-web/public/legacy/js/01-inline.js`, `public/legacy/css/01-inline.css`, `src/legacy/markup/01-body.html`; manifest lists only these files. Bridge `src/legacy/bridge/onboarding-bridge.js` exists but is not installed. `src/legacy/extras/v57-rail-nav.js` exists but is not loaded. **[O]** |
| Wiring status | Prototype (localStorage `matanho-public-onboarding-draft-v57` and `matanho-onboarding-v10`; files in memory). Target: API `/api/v1/public/applications/*`. |
| Entry points | Direct URL (`onboarding.nexus.matanho.com` per nginx; dev `http://localhost:3102/`). **[O]** Resume link `/?resume=<id>.<token>` from the draft email — honoured only by the disabled bridge, ignored by the V65 UI. **[O API]/[DEFECT UI]** Target: admin "Applicant experience" link (Q-25). **[P]** |
| Exit points | None — no links leave the page. Auth routes `/login`, `/invite`, `/reset-password` exist on this portal but are not linked from the UI. **[O]** |

##### Layout

1. Boot splash (full screen) *matanho* + spinner + "LOADING WORKSPACE" until the prototype script finishes (fail-safe reveal after 27 s). **[O]**
2. Top bar: brand mark + *matanho* (left); pills "Encrypted submission workflow" (with dot) and "Institutional investor onboarding" (right). No theme toggle. **[O]**
3. Hero: eyebrow "INVESTOR / LP APPLICATION"; H1 "One application. One verified investor record."; paragraph ("Complete your institutional profile, beneficial ownership, tax and banking details, KYC/AML declarations and supporting evidence. Document OCR and AI-assisted triage reduce re-keying; an authorised compliance professional remains responsible for final acceptance."); three state tiles (Draft, Evidence, Decision). **[O]**
4. Three-column app grid (220 px | fluid | 310 px): left step rail; centre form card; right AI ATS side panel. Rail and side panel are sticky (top 14 px). **[O]**
5. Form card: form head (eyebrow, title, help, progress label + bar) → active step pane (5.C.1–5.C.6) → action bar; success panel (5.C.7) replaces the form after submit. **[O]**
6. Right side panel: head, readiness score block, check list (7 rows), two action buttons, production-control note. **[O]**
7. Three modals: Document preview, OCR extraction (5.C.5), AI-assisted triage details (this page). **[O]**

##### Elements

| # | Element | Type | Content / behaviour | Data source (current → target) | Label |
|---|---|---|---|---|---|
| 1 | Page title | `<title>` | "Matanho \| Institutional Investor Application"; meta description "Institutional investor and LP application with document OCR, KYC/AML declarations, AI-assisted triage and human compliance review." | static | [O] |
| 2 | Theme | html attribute | `data-theme="light"` fixed; no toggle | static | [O] |
| 3 | Hero tile *Draft* | tile | Label "Draft"; value `#draftStatus` "Saved locally" → "Saved just now" after any save; small "Resume on this device" | Prototype (localStorage) → API `PATCH /public/applications/{id}` `savedAt`; small text → "Resume link sent to <email>" [P] | [O] |
| 4 | Hero tile *Evidence* | tile | "Evidence" / `#heroEvidence` "`n` uploaded" (all slots incl. optional) / small "OCR available" | Prototype (in-memory files) → API `GET /public/applications/{id}` `evidence[]` | [O] |
| 5 | Hero tile *Decision* | tile | "Decision" / "Human controlled" / "AI cannot approve" | static | [O] |
| 6 | Step rail | button list (6) | Each button: number, title, subtitle, ✓ mark; classes `active` (current), `done` (index < current). Steps: 1 *Investor* "Profile & relationship"; 2 *Ownership* "UBOs & signatories"; 3 *KYC / AML* "Funds & declarations"; 4 *Tax & bank* "Tax + funding account"; 5 *Evidence* "Documents + OCR"; 6 *Review* "AI triage + submit". `aria-label="Application steps"`, no `aria-current`. | static | [O] |
| 7 | Rail footer | text | "Application state" / `#railState` "Draft saved" → "Saved just now" on save; reset to "Draft saved" on every step change | Prototype | [O] |
| 8 | Form head eyebrow | text | "STEP `n` OF 6" | computed | [O] |
| 9 | Form head title / help | text | Step 1 "Investor profile" / "Tell us exactly who the investor is and what relationship is being requested."; step 2 "Ownership and authority" / "Identify the people who ultimately own, control and are authorised to act for the investor."; step 3 "KYC / AML declarations" / "Capture the economic purpose, source of funds, source of wealth and risk declarations used in due diligence."; step 4 "Tax and bank verification" / "Record FATCA / CRS classification and the verified bank account used for funding."; step 5 "Supporting evidence" / "Upload original documents, preview them in place and use OCR to reduce re-keying."; step 6 "Review and submit" / "Review the application pack, run AI-assisted triage and make the authorised declaration." | static | [O] |
| 10 | Progress | label + bar | "`NN`% complete"; `round((step+1)/6*100)` → 17, 33, 50, 67, 83, 100 | computed | [O] |
| 11 | Side panel head | text | Eyebrow "AI ATS · ASSISTED TRIAGE & SCREENING"; H3 "Application readiness"; "Continuously checks completeness, OCR consistency and risk declarations. External watchlist screening remains provider-controlled." | static | [O] |
| 12 | Readiness score | KPI + bar | "Readiness score" / `#readinessScore` `NN%` (markup placeholder 22 % replaced at boot; ≈ 10 % with defaults) and gradient bar width = score | Prototype (client formula, see Business rules) → [P] server-computed completeness from `GET /public/applications/{id}` | [O] |
| 13 | Risk badge | chip | "Risk pending" until triage run; then "`Low\|Medium\|High` review risk" | Prototype (client triage) → [P] never shown to applicant (Q-NEW below) | [O] |
| 14 | Check list | 7 rows | Icon ✓ (good, green) / ! (warn, amber) / • (neutral, grey); name; detail; right-hand status. Rows in 'Tables' below. | Prototype | [O] |
| 15 | Production-control note | callout | "**Production control.** Real sanctions, PEP and adverse-media results require approved external screening providers, audit references and server-side evidence retention. This client-side prototype does not fabricate external matches." | static | [O] |

##### Tables

**Side-panel check list**

| Column | Format | Sortable | Notes |
| --- | --- | --- | --- |
| Icon | ✓ / ! / • | No | good / warn / neutral |
| Check name + detail | text | No | see rows below |
| Status | short text | No | right-aligned italic |

Rows (fixed order) **[O]**:

| Check | good when | Detail (good / warn / neutral) | Status |
| --- | --- | --- | --- |
| Core application | legalName, registrationRef and sourceFundsNarrative all non-empty | "Profile captured" (if legalName) / "Legal profile incomplete" | "Ready" if registrationRef else "Incomplete" |
| Beneficial ownership | ≥ 1 owner with a name | "`n` person(s) captured" / "Owner / controller required" | "Captured" / "Required" |
| Required evidence | 0 of 9 required documents missing | "Required evidence uploaded" / "`n` required document(s) outstanding" | "`x`/9" |
| OCR extraction | ≥ 1 document with OCR Complete (else neutral) | "`n` document(s) extracted" / "Run OCR after upload" | "Active" / "Optional" |
| Bank holder consistency | holder matches legal name (rule in Business rules); warn on mismatch; neutral if either empty | "Holder broadly aligns to legal name" / "Possible name mismatch — human review required" / "Waiting for bank details" | "Pass" / "Review" / "Pending" |
| Sanctions / PEP / adverse media | `externalProvider==='connected'` (never true today → always warn) | "Approved provider result attached" / "External screening provider result not yet attached" | "Provider" / "Pending" |
| Human compliance decision | never (always neutral) | "Required before account activation" | "Mandatory" |

- No filters, search, row click, row actions or pagination. **[O]**

##### Inputs & validation

None on the shell (fields are per step). Global validation engine used by all steps **[O]**:

- `validatePane(index, report)`: for each `[required]` element of the pane, `checkValidity()`; first failure → `reportValidity()` (browser-native bubble) when `report` is true. Only `required` controls are checked; `min`, `max`, `step`, `type=url`, `type=email` on non-required fields are not enforced. The form has `novalidate`.
- Pane 2 (Ownership) extra rule, pane 5 (Evidence) extra rule — see 5.C.2 and 5.C.5.

##### Actions

| Control | Enabled when | Permission | Effect (state change, toast text, navigation) | Wiring / API | Label |
|---|---|---|---|---|---|
| Rail step button | always | public | `target ≤ current` → go to step. `target > current` → only if the **current** step validates silently (`validatePane(step,false)`); invalid → click does nothing, no message. Intermediate steps are not validated. Re-renders, smooth-scrolls to form card. | Prototype | [O] |
| *Back* (ghost) | disabled on step 1 | public | step − 1; no validation; no explicit save | Prototype | [O] |
| *Save draft* | always | public | Writes draft to localStorage; `#draftStatus` and `#railState` = "Saved just now"; button text "Saved ✓" for 800 ms. Storage failure is silent. | Prototype → API `PATCH /api/v1/public/applications/{id}` (create with `POST /api/v1/public/applications` first when no draft exists) | [O] / [P] |
| *Continue* (accent) | hidden on step 6 | public | `validatePane(step,true)`; pass → save draft silently → step + 1 → re-render | Prototype → API `PATCH …/{id}` | [O] |
| *Submit application* (accent, `type=submit`) | visible only on step 6 | public | See 5.C.6 | Prototype → API `POST …/{id}/submit` | [O] |
| Autosave | any `input`/`change` on the 49 tracked fields, repeater inputs, file selection, OCR completion, OCR *Apply*, triage run, row removal | public | Debounced 120 ms → `saveDraft(false)` + readiness refresh | Prototype → API `PATCH …/{id}` debounced ≥ 1 s [P] | [O] |
| *Run AI-assisted pre-screen* (primary) | always | public | Runs deterministic triage; stores result in memory; refreshes badge/checks; saves draft; opens AI modal | Prototype (client JS) → [P] server-side advisory pre-screen only after submit (FR-ONB-007) | [O] |
| *View triage details* | always | public | Opens AI modal; runs triage first if never run | Prototype | [O] |

##### Modals & drawers

**Modal — AI-assisted triage details** (`#aiModal`, `role="dialog"`, closes on ×, backdrop click, Escape) **[O]**

- Header card "AI-assisted triage result" with risk chip "`<risk>` review risk" (green when Low); tiles: *Readiness* `NN%` "Form + evidence completeness"; *Model* "ATS v57 · deterministic prototype triage" "Advisory triage only"; *External screening* "Provider result required" "No fabricated sanctions / PEP / media result".
- Section "Exceptions and review prompts" — "Every item below should be resolved against original evidence and approved provider data." One card per flag: code with `_` → space, message, "Severity: `<high|medium>` · human review required". Empty: "No rule-based exceptions identified" / "This is not a sanctions/PEP/adverse-media clearance. Approved external screening is still required."
- Card "Screening plan": *Identity / legal existence* "Ready"/"Incomplete" (registrationRef present); *UBO screening population* "`n` person(s)"; *Required provider checks* "Sanctions · PEP · adverse media".
- Inputs: none. Actions: × close only.

##### States

- Empty: one blank owner row and one blank signatory row; defaults (Zimbabwe ×4, USD, 250000, 500000, "Growth Fund I"); readiness ≈ 10 %; "Risk pending"; "0 uploaded"; step 1. **[O]**
- Loading: boot splash only; saves are synchronous (no busy state). **[O]** Target: "Saving…" indicator while `PATCH` is in flight; "Saved hh:mm" on success. **[P]**
- Error: localStorage failure is swallowed (no message); success screen still appears. **[O]** Target: toast "Draft not saved — check your connection" and retry. **[P]**
- Disabled / read-only: *Back* on step 1; after submit the form is hidden. **[O]**
- Conditional: *Continue* hidden and *Submit application* shown on step 6; side panel hidden after submit. **[O]**
- Responsive **[O]**: ≤ 1120 px → rail + form (side panel moves under the form, not sticky), 3-column field grids → 2; ≤ 820 px → single column, rail becomes a 3-column grid of centred numbers (subtitles, ✓ and footer hidden), all field grids 1 column, repeater rows 2 columns, OCR modal single column; ≤ 520 px → first header pill hidden, hero tiles stacked, rail 2 columns, action bar stacked full width (Back / Save in a 2-column row, Continue/Submit full width), repeater rows 1 column, success tiles stacked.

##### Business rules & calculations

- Readiness score **[O]**: `round((fieldComplete×0.42 + uploadedRequired/9×0.34 + hasNamedOwner×0.12 + hasNamedSignatory×0.07 + triageRun×0.05)×100)`, clamped 0–100; `fieldComplete` = share of 13 non-empty fields: legalName, registrationRef, jurisdiction, registeredAddress, primaryEmail, primaryContact, sourceFundsNarrative, expectedActivity, taxResidence, bankName, bankHolder, bankCountry, bankAccount.
- Name normalisation **[O]**: lower-case, non-alphanumerics → space, collapse spaces, trim.
- Bank-holder match **[O]**: `norm(legalName)==norm(bankHolder)` OR `norm(bankHolder)` contains the first word of `norm(legalName)`.
- Triage flags **[O]** (any change of data does not re-run triage):

| Code | Severity | Condition |
| --- | --- | --- |
| `PEP_REVIEW` | high | PEP ≠ `no` (Yes or Unsure) |
| `SANCTIONS_DECLARATION` | high | sanctions ≠ `no` |
| `ADVERSE_MEDIA` | medium | adverse media ≠ `no` |
| `JURISDICTION_EDD` | medium | enhanced-risk jurisdiction ≠ `no` |
| `OWNERSHIP_TOTAL` | medium | Σ owner % > 100.01 |
| `VALUE_EDD` | medium | expected initial investment ≥ 1,000,000 |
| `BANK_NAME_MISMATCH` | medium | bank-holder match false (both filled) |
| `OCR_NAME_MISMATCH` | medium | per document: OCR legal-name candidate ≠ entered legal name (normalised) |
| `OCR_REG_MISMATCH` | medium | per document: OCR registration candidate ≠ entered reference (normalised) |
| `MISSING_EVIDENCE` | medium | ≥ 1 of 9 required documents missing |

- Triage risk **[O]**: any high → High; ≥ 2 medium → High; 1 medium → Medium; else Low. Result `{runAt, risk, flags, externalProvider:'not_connected', readiness, model:'ATS v57 · deterministic prototype triage', humanReviewRequired:true}`.
- BR-190: The applicant-side triage is advisory and must never set or display a case decision; the authoritative pre-screen runs server-side after submit (FR-ONB-007) and its result is not shown to the applicant.

##### Edge cases

- Rail forward jump from step 1 to step 6 validates only step 1. **[O]**
- `#railState` "Saved just now" is overwritten by "Draft saved" on every step change. **[O]**
- After submit the rail and form head stay visible and clickable; clicks re-render behind the hidden form. **[O]**
- Private browsing / storage blocked: nothing persists; no message. **[O]**
- The page always reopens at step 1 after reload. **[O]**

##### Gaps, defects & open questions

- **DEF-458** Legacy data bridge disabled for onboarding (`tools/legacy-bridge.mjs` `DISABLED = {investor, onboarding, custodian}`); the retained `onboarding-bridge.js` targets the V56 DOM (`#form`, `#submit`, `#ref`, `#save`, `#next`, `#owners`, file inputs `doc1…doc8`, global `window.collect`, draft key `…-v19`) and cannot work against V65 (`#applicationForm`, `#submitBtn`, `#successRef`, `#saveBtn`, `#nextBtn`, `#ownerList`, `data-doc-input`, IIFE-private `collect`, key `…-v57`).
- FR-ONB-027: Rewrite the onboarding bridge (or native React form) for the V65 DOM so that draft create/save/resume, evidence upload and submit call `/api/v1/public/applications/*` — AC: with the API running, a draft typed in one browser is restored field-for-field (including files) from the emailed resume link in another browser.
- **DEF-459** `src/legacy/extras/v57-rail-nav.js` is dead code — not published (no `extraScripts` in the extractor config), not in the manifest, and written for the V56 DOM (`#rail`, globals `step`/`validCurrent`); V65 already has a clickable rail. Delete it.
- **DEF-460** Rail forward navigation fails silently when the current step is invalid. FR-ONB-028: Forward rail click validates every intervening step and reports the first error — AC: clicking step 6 from step 1 with an empty legal name focuses *Legal name* with its message.
- **DEF-461** Theme toggle removed in V65; FR-ONB-015 has no UI. Q-159: Keep a theme toggle on the public onboarding portal? — default: no (retire FR-ONB-015).
- Q-160: Should the applicant see the advisory risk badge ("High review risk")? — default: no; show only completeness.

---

#### 5.C.1 Investor profile (`/` pane 0 "Investor", public)

| Attribute | Value |
| --- | --- |
| Purpose | Capture who the investor is and what relationship is requested. **[O]** |
| Access | Anonymous (draft owner). **[O]** |
| Prototype layer | V65 `public-onboarding.html` → `01-inline.js` / `01-body.html` |
| Wiring status | Prototype (localStorage draft `matanho-public-onboarding-draft-v57`). Target: `POST /api/v1/public/applications` on first valid *Primary contact email*, then `PATCH /api/v1/public/applications/{id}`. |
| Entry points | Default step on load; rail *Investor*; *Edit* on review card "Investor and relationship"; submit validation failure on this pane. |
| Exit points | *Continue* → 5.C.2; rail (forward if valid). |

##### Layout

1. Sub-section "Investor identity" — "Use legal / registry details, not abbreviated trading names." (3-column field grid; registered address full width).
2. Sub-section "Investment relationship" — "Used for account setup and suitability / mandate routing." (3-column grid).
3. Action bar (5.C.0).

##### Elements

None beyond the inputs below.

##### Tables

None.

##### Inputs & validation

| Field | Control | Required | Options / default / placeholder | Validation today (code) | Target validation | Error message |
|---|---|---|---|---|---|---|
| *Investor type* (`investorType`) | select | Yes (always has value) | *Institutional investor* (default), *Pension / provident fund*, *Corporate treasury*, *Investment company / family office*, *Trust / foundation*, *Fund / collective investment vehicle*, *Individual / HNW* | none effective | one of list; drives required evidence and field labels [P] | — |
| *Legal name* (`legalName`, autocomplete organization) | text | **Yes** | — | `required` | 2–200 chars [P] | browser "Please fill out this field." |
| *Registration / identity number* (`registrationRef`) | text | **Yes** | — | `required` | ≤ 80 chars [P] | browser required message |
| *Jurisdiction of incorporation / residence* (`jurisdiction`) | text | **Yes** | default "Zimbabwe" | `required` | ISO-3166 country select [P] | browser required message |
| *Date incorporated / date of birth* (`incorporationDate`) | date | No | — | none | not in future; required for Individual (DOB) [P] | — |
| *Regulatory status* (`regulatedStatus`) | select | No | *Not a regulated financial institution* (default), *Regulated financial institution*, *Pension / retirement arrangement*, *Government / public institution*, *Other regulated entity* | none | — | — |
| *Regulator / supervisory body* "if applicable" (`regulator`) | text | No | — | none | required when status ≠ "Not a regulated…" [P] | "Enter the regulator" [P] |
| *Licence / registration reference* "if applicable" (`licenceRef`) | text | No | — | none | as regulator [P] | "Enter the licence reference" [P] |
| *Website* "optional" (`website`) | url | No | placeholder "https://" | none (type not enforced because not required) | valid https URL if present [P] | "Enter a valid web address" [P] |
| *Registered address* (`registeredAddress`) | textarea, 2 rows, full width | **Yes** | — | `required` | ≤ 500 chars [P] | browser required message |
| *Relationship requested* (`relationship`) | select | No | *Discretionary managed account* (default), *Fund / LP subscription*, *Segregated mandate*, *Advisory relationship*, *Cash / liquidity mandate* | none | — | — |
| *Fund / mandate* (`mandate`) | text | No | default "Growth Fund I" | none | select from open funds/mandates when relationship = Fund / LP subscription [P] | — |
| *Expected commitment / initial investment* (`initialInvestment`) | number, min 0, step 1000 | No | default 250000 (no currency label) | none (min/step not enforced) | ≥ 0 and ≥ minimum per relationship/classification (Q-10) [P] | "Amount is below the minimum of <x>" [P] |
| *Base currency* (`baseCurrency`) | select | No | *USD* (default), *ZWG*, *ZAR*, *GBP*, *EUR* | none | — | — |
| *Investor classification* (`investorClassification`) | select | No | *Institutional / professional investor* (default), *Qualified / sophisticated investor*, *Retail / individual investor*, *To be confirmed by Compliance* | none | — | — |
| *Primary contact email* (`primaryEmail`, autocomplete email) | email | **Yes** | — | `required` + browser email syntax | `emailSchema` (trim, lower-case, valid, ≤ 254) — API already enforces on draft create | browser "Please include an '@'…"; API "Enter a valid email address" |
| *Primary contact name* (`primaryContact`) | text | **Yes** | — | `required` | ≤ 160 [P] | browser required message |
| *Telephone* (`telephone`, autocomplete tel) | text | No | — | none | E.164 [P] | "Enter the number in international format" [P] |
| *Relationship purpose* (`purpose`) | select | No | *Long-term capital growth* (default), *Income / preservation*, *Liquidity management*, *Pension / liability matching*, *Strategic allocation*, *Other* | none | *Other* reveals free text [P] | — |

##### Actions

Shell actions only (5.C.0). Target wiring: first valid email creates the draft (`POST /api/v1/public/applications {email, applicantType, name}` → `{id, token}`; server emails "Continue your Matanho application" with the resume link, valid 30 days). **[O API]/[P UI]**

##### Modals & drawers

None.

##### States

- Empty: defaults above. **[O]**
- Loading / Error: none today; target toast on draft-create failure incl. 429 "Too many applications from this network, try again later". **[O API]/[P UI]**
- Disabled / read-only: none.
- Conditional: none today (same fields for every investor type). **[O]** Target: *Individual / HNW* relabels to personal fields (full name, ID/passport number, country of residence, date of birth required) and hides regulatory fields; *Trust / foundation* shows trustee fields. **[P]**

##### Business rules & calculations

- Expected investment is shown on review formatted as USD regardless of base currency. **[O]**
- No minimum investment rule. **[O]** (Q-10)

##### Edge cases

- Browser email syntax accepts `a@b` (no dot); API `emailSchema` rejects it later. **[O]**
- Default "Growth Fund I" is submitted even for non-fund relationships. **[O]**

##### Gaps, defects & open questions

- **DEF-462** Fields collected on this step but dropped from the submitted record: incorporationDate, regulatedStatus, regulator, licenceRef, website, registeredAddress, baseCurrency, investorClassification, primaryContact (the record keeps only type, name, registrationRef, email, telephone, jurisdiction as `country`, initialInvestment, relationship, mandate, purpose).
- **DEF-463** API `FIELD_MAP` uses V56 keys (`type`, `name`, `reg`, `phone`, `country`, `amount`, …); V65 keys `investorType`, `legalName`, `registrationRef`, `telephone`, `jurisdiction`, `initialInvestment`, `primaryEmail` map to no column, so submit would fail the server check "Legal name / Email / Country missing".
- FR-ONB-029: Persist every step-1 field server-side in typed columns (legal name, registration ref, jurisdiction, incorporation date, regulatory status, regulator, licence ref, website, registered address, relationship, mandate, expected investment, base currency, classification, primary contact name/email/phone, purpose) — AC: resume restores all 19 values; admin case shows all 19.
- **DEF-464** SRD FR-ONB-001 fields (risk profile, liquidity requirement, investment objective) no longer exist in the UI; columns `risk_profile`, `liquidity_need` have no source. Q-161: Is suitability (risk profile, liquidity) captured at onboarding or later in mandate setup? — default: later, in mandate setup.
- Q-10 still open (minimum investment).

---

#### 5.C.2 Ownership and authority (`/` pane 1 "Ownership", public)

| Attribute | Value |
| --- | --- |
| Purpose | Identify beneficial owners/controllers and authorised signatories, and describe ownership structure and authority to invest. **[O]** |
| Access | Anonymous (draft owner). |
| Prototype layer | V65 `public-onboarding.html` |
| Wiring status | Prototype (draft `owners[]`, `signatories[]`). Target: `PATCH /api/v1/public/applications/{id}` with `owners` (and a new `signatories` array [P]). |
| Entry points | *Continue* from 5.C.1; rail *Ownership*; submit validation failure here. (No review *Edit* button targets this step.) |
| Exit points | *Continue* → 5.C.3; *Back* → 5.C.1; rail. |

##### Layout

1. Section "Beneficial owners and controllers" — "Capture natural persons who ultimately own or control the investor, or the governing persons where no ownership applies." with button *+ Add owner / controller*; owner repeater.
2. Sub-section "Authorised signatories" — "People permitted to execute instructions or legal documents for this relationship." with *+ Add signatory*; signatory repeater.
3. Sub-section with two textareas (ownership structure, authority to invest).

##### Elements

None beyond the repeaters and inputs.

##### Tables

**Owner repeater (one row per person)**

| Column | Format | Sortable | Notes |
| --- | --- | --- | --- |
| *Full legal name* | text, required | No | — |
| *Nationality* | text | No | default "Zimbabwe" |
| *ID / passport* | text | No | — |
| *Ownership %* | number 0–100 step 0.01 | No | not enforced |
| × | button `aria-label="Remove owner"` | — | removes row only when > 1 row |

**Signatory repeater**

| Column | Format | Sortable | Notes |
| --- | --- | --- | --- |
| *Full name* | text, required | No | — |
| *Role / capacity* | text | No | — |
| *Email* | email | No | format not enforced |
| × | button `aria-label="Remove signatory"` | — | removes row only when > 1 row |

- No filters, search, sorting or pagination; one blank row of each is always present at load. **[O]**

##### Inputs & validation

| Field | Control | Required | Options / default / placeholder | Validation today (code) | Target validation | Error message |
|---|---|---|---|---|---|---|
| Owner *Full legal name* (each row) | text | **Yes** (every row) | — | `required` | ≤ 160 chars | browser required message |
| Owner *Nationality* | text | No | "Zimbabwe" | none | country select [P] | — |
| Owner *ID / passport* | text | No | — | none | required for natural persons ≥ 25 % [P]; stored encrypted (API encrypts owner ID today) | "Enter the ID or passport number" [P] |
| Owner *Ownership %* | number | No | — | none | 0–100; Σ ≤ 100; every holder ≥ 25 % listed or a controller named [P] (BR-NEW) | "Ownership totals must not exceed 100 %" [P] |
| At least one owner | rule | **Yes** | — | `owners.some(o=>o.name)` | same | alert "Add at least one beneficial owner, controller, trustee or governing person." |
| Signatory *Full name* (each row) | text | **Yes** (every row) | — | `required` | ≤ 160 | browser required message |
| Signatory *Role / capacity* | text | No | — | none | required [P] | "Enter the signatory's role" [P] |
| Signatory *Email* | email | No | — | none | valid email if present [P] | "Enter a valid email address" |
| *Ownership structure description* (`ownershipNarrative`) | textarea | No | placeholder "Describe parent entities, trustees, beneficiaries, controllers and any nominee arrangements." | none | required for non-individuals [P] | — |
| *Authority to invest* (`authorityNarrative`) | textarea | No | placeholder "Board / trustee / investment committee authority and any signing rules." | none | required for non-individuals [P] | — |

##### Actions

| Control | Enabled when | Permission | Effect (state change, toast text, navigation) | Wiring / API | Label |
|---|---|---|---|---|---|
| *+ Add owner / controller* | always | public | Appends blank owner row (nationality "Zimbabwe") | Prototype → `PATCH …/{id}` `owners` | [O] |
| Owner × | always | public | If > 1 row, removes it; then saves draft and refreshes readiness; with 1 row nothing happens (no message) | Prototype | [O] |
| *+ Add signatory* | always | public | Appends blank signatory row | Prototype → [P] `signatories` | [O] |
| Signatory × | always | public | Same as owner × | Prototype | [O] |

##### Modals & drawers

None.

##### States

- Empty: one blank owner row, one blank signatory row. **[O]**
- Error: required-name bubble on the first empty row; ownership alert. **[O]**
- Conditional: none. **[O]** Target: owner row gains *PEP* (yes/no) and *Controller* flags and date of birth [P].

##### Business rules & calculations

- Owner % over 100.01 raises triage flag `OWNERSHIP_TOTAL` (advisory only). **[O]**
- Server (today): owners fully replaced on each PATCH; % clamped 0–100; `isController = pct ≥ 25`; owner ID encrypted. **[O API]**
- BR-191: Every natural person holding ≥ 25 % (directly or indirectly) and at least one controller must be listed; Σ ownership ≤ 100 %.

##### Edge cases

- An extra blank row blocks *Continue* (every row's name is required). **[O]**
- Owner % may be negative or > 100 without error. **[O]**

##### Gaps, defects & open questions

- **DEF-465** API `owners` shape is `[name, id, pct]` arrays (max 3 strings, max 20 rows); V65 owners are objects with a 4th field *Nationality*, which the API cannot store.
- FR-ONB-030: Store signatories (name, role, email) and owner nationality server-side — AC: resume restores all rows; admin case lists signatories.
- **DEF-466** ownershipNarrative and authorityNarrative are dropped from the submitted record.

---

#### 5.C.3 KYC / AML declarations (`/` pane 2 "KYC / AML", public)

| Attribute | Value |
| --- | --- |
| Purpose | Capture risk declarations, source of funds / wealth and expected activity for due diligence. **[O]** |
| Access | Anonymous (draft owner). |
| Prototype layer | V65 `public-onboarding.html` |
| Wiring status | Prototype. Target: `PATCH /api/v1/public/applications/{id}`. |
| Entry points | *Continue* from 5.C.2; rail *KYC / AML*; review card "KYC / AML profile" *Edit*; submit validation failure here. |
| Exit points | *Continue* → 5.C.4; *Back* → 5.C.2; rail. |

##### Layout

1. Section "KYC / AML declarations" — "These declarations support screening and determine whether enhanced due diligence is required." 2×2 declaration grid.
2. Sub-section 3-column field grid (funds, wealth, volume, frequency, jurisdictions, currencies) + two full-width textareas.

##### Elements

Declaration cards: bold title, small help text, select (right). **[O]**

##### Tables

None.

##### Inputs & validation

| Field | Control | Required | Options / default / placeholder | Validation today (code) | Target validation | Error message |
|---|---|---|---|---|---|---|
| *Politically exposed person (PEP)* (`pep`) — "Applicant, owner, controller or close associate." | select | No | *No* `no` (default), *Yes / possible* `yes`, *Unsure* `unknown` | none | Yes/Unsure reveals details (name, role, country, dates) [P] | — |
| *Sanctions exposure* (`sanctions`) — "Known current or historic sanctions designation / restriction." | select | No | *No known exposure* `no` (default), *Yes / possible* `yes`, *Unsure* `unknown` | none | Yes/Unsure reveals details [P] | — |
| *Adverse media / legal matters* (`adverseMedia`) — "Material fraud, corruption, financial-crime or regulatory concerns." | select | No | *No known concern* `no` (default), *Yes / disclose* `yes`, *Unsure* `unknown` | none | Yes reveals disclosure text [P] | — |
| *Enhanced-risk jurisdictions* (`highRiskJurisdiction`) — "Material business, ownership or funds nexus requiring EDD under manager policy." | select | No | *No* `no` (default), *Yes / possible* `yes`, *Unsure* `unknown` | none | Yes reveals country list [P] | — |
| *Primary source of funds* (`sourceFunds`) | select | No | *Operating revenue / treasury funds* (default), *Investment proceeds*, *Pension contributions / member assets*, *Sale of business / asset*, *Employment / professional income*, *Inheritance / family wealth*, *Capital call / investor contributions*, *Other* | none | *Other* requires text [P] | — |
| *Primary source of wealth / capital* (`sourceWealth`) | select | No | *Business / operating activity* (default), *Investments / accumulated savings*, *Pension / institutional assets*, *Property / asset ownership*, *Inheritance / family capital*, *Other* | none | *Other* requires text [P] | — |
| *Expected annual transaction volume · USD eq.* (`annualVolume`) | number, min 0, step 1000 | No | default 500000 | none | ≥ 0 [P] | — |
| *Expected transaction frequency* (`transactionFrequency`) | select | No | *Monthly or less* (default), *2–5 per month*, *Weekly*, *Daily / treasury activity* | none | — | — |
| *Primary funding jurisdictions* (`fundingJurisdictions`) | text | No | default "Zimbabwe" | none | multi-select countries [P] | — |
| *Primary investment / payment currencies* (`expectedCurrencies`) | text | No | default "USD" | none | multi-select ISO 4217 [P] | — |
| *Source of funds explanation* (`sourceFundsNarrative`) | textarea, full width | **Yes** | placeholder "Explain where the money for this investment comes from and the economic activity that generated it." | `required` | ≥ 20 chars [P] | browser required message |
| *Expected account activity* (`expectedActivity`) | textarea, full width | **Yes** | placeholder "Describe expected subscriptions, withdrawals, transfers, counterparties and any cross-border activity." | `required` | ≥ 20 chars [P] | browser required message |

##### Actions

Shell actions only.

##### Modals & drawers

None.

##### States

- Empty: all declarations "No"; defaults above. **[O]**
- Conditional: none today (Yes/Unsure reveal nothing). **[O]**

##### Business rules & calculations

- Any declaration ≠ `no` (including *Unsure*) raises a triage flag: PEP and sanctions high; adverse media and jurisdiction medium. **[O]**
- Review card "Declarations" = "Review required" if PEP, sanctions or adverse media ≠ `no` (enhanced-risk jurisdiction is not counted there), else "No self-declared flags". **[O]**
- Server screening stub treats PEP as positive only when the stored value starts with "yes"; `unknown` is not flagged. **[O API]**
- BR-192: PEP = Yes or Unsure, or sanctions ≠ No, routes the case to EnhancedReview before any approval.

##### Edge cases

- *Unsure* is treated as a positive flag client-side but negative by the server stub. **[O]**

##### Gaps, defects & open questions

- **DEF-467** sourceFundsNarrative (required on screen), annualVolume, transactionFrequency, expectedCurrencies are dropped from the submitted record; fundingJurisdictions is kept only as the review sub-label.
- **DEF-468** API has columns for `pep` only; sanctions, adverse media, enhanced-risk jurisdiction declarations have no server fields.
- FR-ONB-031: Persist all four declarations (with follow-up details) and all funds/activity fields server-side — AC: admin case shows each declaration value and narrative.
- **DEF-469** No risk-profiling questionnaire or scoring exists in V65 (V56 risk-profile select removed).

---

#### 5.C.4 Tax and bank verification (`/` pane 3 "Tax & bank", public)

| Attribute | Value |
| --- | --- |
| Purpose | Record FATCA/CRS classification and the verified funding bank account. **[O]** |
| Access | Anonymous (draft owner). |
| Prototype layer | V65 `public-onboarding.html` |
| Wiring status | Prototype (tax ID and bank account stored in plain text in localStorage). Target: `PATCH /api/v1/public/applications/{id}` (tax ID encrypted server-side today; bank account encryption [P]). |
| Entry points | *Continue* from 5.C.3; rail *Tax & bank*; review card "Tax, bank and evidence" *Edit*; submit validation failure. |
| Exit points | *Continue* → 5.C.5; *Back* → 5.C.3; rail. |

##### Layout

1. Section "Tax and bank verification" — "Required for tax classification, payment controls and verified subscription / redemption instructions." (3-column grid, 6 tax fields).
2. Sub-section "Verified funding account" — "Subscriptions and redemptions should use an account held in the investor's name unless Compliance approves an exception." (3-column grid, 6 bank fields).

##### Elements

None beyond inputs.

##### Tables

None.

##### Inputs & validation

| Field | Control | Required | Options / default / placeholder | Validation today (code) | Target validation | Error message |
|---|---|---|---|---|---|---|
| *Primary tax residence* (`taxResidence`) | text | **Yes** | default "Zimbabwe" | `required` | country select [P] | browser required message |
| *Tax identification number* (`taxId`) | text | No | — | none | required unless explained [P]; stored encrypted | — |
| *FATCA classification* (`fatca`) | select | No | *Non-US entity / individual* (default), *Participating FFI*, *Active NFFE*, *Passive NFFE*, *US person / US entity*, *To be confirmed* | none | — | — |
| *GIIN* "if applicable" (`giin`) | text | No | — | none | required and 19-char GIIN format when FATCA = Participating FFI [P] | "Enter a valid GIIN" [P] |
| *CRS classification* (`crs`) | select | No | *Financial institution* (default), *Active non-financial entity*, *Passive non-financial entity*, *Individual*, *To be confirmed* | none | default by investor type [P] | — |
| *US indicia present?* (`usIndicia`) | select | No | *No* `no` (default), *Yes / possible* `yes` | none | Yes requires W-9 evidence [P] | — |
| *Bank / financial institution* (`bankName`) | text | **Yes** | — | `required` | — | browser required message |
| *Account holder* (`bankHolder`) | text | **Yes** | — | `required` | must match legal name or exception reason [P] | browser required message |
| *Bank jurisdiction* (`bankCountry`) | text | **Yes** | default "Zimbabwe" | `required` | country select [P] | browser required message |
| *Account / IBAN reference* (`bankAccount`) | text | **Yes** | — | `required` | IBAN checksum when IBAN country [P]; stored encrypted [P] | browser required message |
| *SWIFT / BIC* "if applicable" (`swift`) | text | No | — | none | 8 or 11 chars `[A-Z0-9]` [P] | "Enter a valid SWIFT/BIC" [P] |
| *Account currency* (`bankCurrency`) | select | No | *USD* (default), *ZWG*, *ZAR*, *GBP*, *EUR* | none | — | — |

##### Actions

Shell actions only.

##### Modals & drawers

None.

##### States

- Empty: defaults above. **[O]**
- Conditional: none today. **[O]**

##### Business rules & calculations

- Bank-holder consistency (5.C.0) drives check "Bank holder consistency" and flag `BANK_NAME_MISMATCH`. **[O]**

##### Edge cases

- CRS defaults to *Financial institution* even for *Individual / HNW*. **[O]**

##### Gaps, defects & open questions

- **DEF-470** Tax ID and bank account number are stored in plain text in browser localStorage (draft).
- **DEF-471** taxId, giin, usIndicia are dropped from the submitted record (fatca, crs, bank block are kept).
- **DEF-472** API has no bank-account fields; FATCA and CRS are two fields in the UI but one `tax_status` column in the API.
- FR-ONB-032: Persist tax (residence, TIN encrypted, FATCA, GIIN, CRS, US indicia) and funding-account fields (bank, holder, jurisdiction, account encrypted, SWIFT, currency) server-side; the funding account becomes a DRAFT bank instruction on activation — AC: activation creates a bank instruction requiring maker/checker approval (BR-001).

---

#### 5.C.5 Supporting evidence (`/` pane 4 "Evidence", public)

| Attribute | Value |
| --- | --- |
| Purpose | Upload original evidence per slot, preview it and extract field candidates with OCR. **[O]** |
| Access | Anonymous (draft owner). |
| Prototype layer | V65 `public-onboarding.html`; OCR libraries loaded at runtime from `cdn.jsdelivr.net` (Tesseract.js 5) and `cdnjs.cloudflare.com` (pdf.js 3.11.174). |
| Wiring status | Prototype (files held in memory as blob URLs; only metadata in the draft; nothing uploaded). Target: `POST /api/v1/public/applications/{id}/evidence` (multipart `slot`, `file`) per selection. |
| Entry points | *Continue* from 5.C.4; rail *Evidence*; submit validation failure here. |
| Exit points | *Continue* → 5.C.6 (blocked while required evidence missing); *Back* → 5.C.4; rail (not blocked by missing evidence). |

##### Layout

1. Section "Supporting evidence" — "Upload the original evidence. OCR reads images/PDFs to reduce re-keying; the original file remains the evidence of record." with button *Run OCR on uploaded files*.
2. Document grid: 11 slot cards (table below).
3. Sub-section: *Additional evidence / explanation* and *Compliance contact* textareas.

##### Elements

Slot card anatomy **[O]**: title (+ " *" when required), help text, status chip (`Not uploaded` grey → file name green → `OCR complete` green), *Choose file* (label wrapping hidden file input), *Preview* (text button), *Extract with OCR* (text button), OCR progress bar (hidden until OCR runs), meta line ("`<size>` KB · OCR not yet run" or "OCR `<conf>`% · `<n>` field candidate(s)"; hidden with no file).

##### Tables

**Evidence slots** (one card each; accepted types for every slot: `application/pdf, image/png, image/jpeg, image/webp`; one file per slot; no size limit in UI) **[O]**

| # | Slot key (UI) | Title | Help text | Required today (all investor types) | Current API slot | Target required set [P] |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | `legal` | *Legal existence / identity* | "Certificate of incorporation, trust deed, fund constitution or government ID." | Yes | `doc1` Identity / legal existence | all types |
| 2 | `registry` | *Registry / constitutional extract* | "Current registry extract, governing document or equivalent legal profile." | Yes | none | entities, trusts, funds |
| 3 | `ownership` | *Ownership / control evidence* | "Share register, ownership chart, trustee / beneficiary schedule or controller record." | Yes | `doc4` Ownership structure | entities, trusts, funds |
| 4 | `identity` | *Owners / signatories ID* | "Passport / national identity evidence for required natural persons." | Yes | none | all types |
| 5 | `address` | *Address evidence* | "Registered-office or residential address evidence, as applicable." | Yes | `doc2` Address evidence | all types |
| 6 | `bank` | *Bank verification* | "Recent bank statement, bank letter or controlled account confirmation." | Yes | `doc5` Bank verification | all types |
| 7 | `funds` | *Source-of-funds evidence* | "Bank-origin evidence, audited record, transaction evidence or equivalent support." | Yes | `doc3` Source of funds | all types |
| 8 | `tax` | *Tax / FATCA / CRS* | "Tax residence, W-8/W-9 or self-certification evidence where applicable." | Yes | `doc6` Tax / FATCA / CRS | all types |
| 9 | `authority` | *Authority to invest* | "Board, trustee, IC or authorised-signatory resolution / mandate." | Yes | `doc7` Authority to invest | entities, trusts, funds |
| 10 | `subscription` | *Subscription / investment mandate* | "Subscription agreement, IPS or investment mandate, if available." | No | `doc8` Investment mandate | optional |
| 11 | `additional` | *Additional supporting evidence* | "Any other document relevant to KYC, AML, tax or account opening." | No | none | optional |

- No filters, sorting or pagination. Grid collapses to 1 column ≤ 820 px. **[O]**

##### Inputs & validation

| Field | Control | Required | Options / default / placeholder | Validation today (code) | Target validation | Error message |
|---|---|---|---|---|---|---|
| Slot file (× 11) | file (single) | slots 1–9 **Yes** | accept pdf/png/jpeg/webp | none beyond `accept`; no size limit | MIME allow-list pdf/png/jpeg/webp; size ≤ agreed limit (Q-NEW below); malware scan; SHA-256 recorded | API: 400 "File type <mime> is not accepted"; 413 "File is larger than the upload limit"; "Unknown evidence slot"; "Attach a file" |
| Required-evidence rule | rule | **Yes** | 9 required slots | `missing.length && report` → blocks *Continue* | per investor type (table above) | alert "Supporting evidence still missing: `<first 4 titles>`…" (ellipsis when > 4) |
| *Additional evidence / explanation* "optional" (`evidenceNote`) | textarea | No | placeholder "Use this field to explain unusual ownership, funding, tax or document circumstances." | none | ≤ 4000 | — |
| *Compliance contact* "optional" (`complianceContact`) | textarea | No | placeholder "Name, role, email and telephone of the person we may contact about KYC / AML questions." | none | structured name/role/email/phone [P] | — |

##### Actions

| Control | Enabled when | Permission | Effect (state change, toast text, navigation) | Wiring / API | Label |
|---|---|---|---|---|---|
| *Choose file* | always | public | Replaces any earlier file for the slot (old blob URL revoked), resets OCR state to "Not run", refreshes card and hero count, saves draft metadata, refreshes readiness | Prototype → `POST /api/v1/public/applications/{id}/evidence` `{slot, file}` → 201 `{slot,label,name,size,mime}`; card shows "`name` · `size` KB · uploaded securely" [P] | [O] |
| *Preview* | slot has a file | public | Opens Document preview modal | Prototype (blob URL) → [P] signed download of the stored original | [O] |
| *Extract with OCR* | slot has a file | public | Runs OCR on that file (progress "Loading OCR engine…" → "OCR `nn`% · `file`"); on success sets status "OCR complete", saves, opens OCR modal; on failure meta "OCR could not run in this browser. The original document is still attached. `<error>`" | Prototype (client Tesseract) → [P] server-side OCR job | [O] |
| *Run OCR on uploaded files* | always | public | Runs OCR sequentially on every uploaded file not yet complete, without opening modals; none → alert "Upload at least one document that still needs OCR."; done → alert "`n` document(s) processed. Open any document to review its OCR candidates." | Prototype | [O] |

##### Modals & drawers

**Modal — Document preview** (`#previewModal`; ×, backdrop, Escape) **[O]**: title "`<slot title>` · `<file name>`"; PDF → embedded frame; other types → image with alt "Preview of `<file name>`". Inputs: none. Actions: × close.

**Modal — OCR extraction** (`#ocrModal`) **[O]**: title "OCR extraction · `<file name>`". Left: eyebrow "EXTRACTED TEXT · CONFIDENCE `nn`%" and the full text (or "No readable text extracted."). Right: "FIELD CANDIDATES" — one card per candidate: key, value, "Candidate only · verify against the original document", button *Apply to application*. Empty: "No structured candidates detected" / "The full OCR text remains available for human review."

| Control | Enabled when | Permission | Effect | Wiring / API | Label |
|---|---|---|---|---|---|
| *Apply to application* | candidate exists | public | Writes the value into the matching form field (`registrationRef`, `taxId`, `bankAccount`, `swift`, `legalName`, `registeredAddress`), saves draft, refreshes readiness, button text "Applied ✓" | Prototype | [O] |
| × | always | public | Close | — | [O] |

##### States

- Empty: all 11 cards "Not uploaded", *Preview*/*Extract with OCR* disabled, meta hidden. **[O]**
- Loading: per-card OCR bar and percentage. **[O]** Target: upload progress per card. **[P]**
- Error: OCR failure text in card; files silently lost on reload. **[O]**
- Disabled: *Preview*, *Extract with OCR* until a file is chosen. **[O]**
- Conditional: status chip text by state; "*" on required titles. **[O]**

##### Business rules & calculations

- OCR processes page 1 of PDFs only, rendered at scale 1.6, language `eng`. **[O]**
- Candidate patterns **[O]**: registration (`registration|company|reg.|certificate` + optional no./number, value ≥ 5 chars `[A-Z0-9/-.]`); tax ID (`tax|tin|taxpayer` + optional id/number); bank account (`account|a/c` + optional number); SWIFT (`swift|bic` + 8–11 alnum); legal name (line starting "legal name:", "name:", "account holder:", "entity:"; value > 3 chars); registered address (the two lines after a line "Address" or "Registered address").
- OCR name / registration candidates that differ from entered values raise `OCR_NAME_MISMATCH` / `OCR_REG_MISMATCH` (5.C.0). **[O]**
- Server (today): evidence upsert per slot replaces the earlier file; stored AES-256-GCM encrypted with SHA-256; `scanStatus` recorded as "clean" without scanning. **[O API]**

##### Edge cases

- Reload loses all files, OCR text and candidates; the evidence step then blocks *Continue* again. **[O]**
- Rail click forward skips the evidence check (`report=false`). **[O]**
- OCR requires internet access to public CDNs from the applicant's browser. **[O]**

##### Gaps, defects & open questions

- **DEF-473** Required documents differ between layers: UI requires **9** for every investor type; API `requiredSlots()` requires **3** (`doc1–doc3`) when applicant type is exactly "Individual" and **4** (`doc1–doc4`) otherwise; current SRD 5.C [P] says Individual 1–3, 5, 6 / entities 1–7. The V65 type string "Individual / HNW" never equals "Individual", so the API would apply the entity rule to individuals.
- **DEF-474** Slot catalogue mismatch — UI keys `legal, registry, ownership, identity, address, bank, funds, tax, authority, subscription, additional` (11) vs API `doc1…doc8` (8); the API rejects unknown slots with 400 "Unknown evidence slot".
- **DEF-475** Upload limit mismatch — UI none; API `MAX_UPLOAD_MB` default 25 MB (nginx `client_max_body_size 25m`); current SRD says 10 MB.
- **DEF-476** Malware scan not implemented — API stores `scanStatus: 'clean'` unconditionally (FR-ONB-003 unmet).
- **DEF-477** OCR engine and PDF renderer are fetched from third-party CDNs in the applicant's browser.
- **DEF-478** evidenceNote and complianceContact are dropped from the submitted record.
- FR-ONB-033: Single evidence-slot catalogue (key, label, help, accepted types, required-by-investor-type) served by the API and used by UI and submit check — AC: UI stars, readiness count, review count and server `incomplete_application` list agree for every investor type.
- FR-ONB-034: Server-side OCR with candidate suggestions, never auto-applied — AC: candidates shown only after upload succeeds; applying writes via `PATCH`.
- Q-162: Upload size limit per evidence file? — default: 25 MB (matches API and nginx).
- Q-163: Which evidence set is mandatory per investor type (7 types)? — default: the "Target required set" column above.

---

#### 5.C.6 Review and submit — summary, electronic declaration, consent (`/` pane 5 "Review", public)

| Attribute | Value |
| --- | --- |
| Purpose | Let the applicant review the pack, run triage, sign electronically, consent and submit. **[O]** |
| Access | Anonymous (draft owner). |
| Prototype layer | V65 `public-onboarding.html` |
| Wiring status | Prototype (record appended to localStorage `matanho-onboarding-v10`; draft key removed). Target: `POST /api/v1/public/applications/{id}/submit` `{consent:true, form, owners}` → `{ref, status:"Submitted", screening:"Queued"}`. |
| Entry points | *Continue* from 5.C.5; rail *Review*. |
| Exit points | Review-card *Edit* → 5.C.1 / 5.C.3 / 5.C.4; *Back* → 5.C.5; rail; submit success → 5.C.7; submit validation failure → first invalid step. |

##### Layout

1. Section "Review and submit" — "Check the application pack. AI ATS is advisory; external sanctions/PEP/adverse-media screening must come from an approved provider."
2. Three review cards (table below).
3. Sub-section "Electronic declaration" — "Submission records the typed signatory and timestamp in this prototype." Two fields in a row, then consent checkbox with text.
4. Action bar with *Submit application*.

##### Elements

| # | Element | Type | Content / behaviour | Data source (current → target) | Label |
|---|---|---|---|---|---|
| 1 | Card "Investor and relationship" | review card + *Edit* (→ step 1) | *Investor* = legal name or "—" (small: investor type); *Relationship* (small: fund/mandate); *Expected investment* = USD currency format, 0 decimals (small: "`<base currency>` base") | Prototype draft → `GET …/{id}` | [O] |
| 2 | Card "KYC / AML profile" | review card + *Edit* (→ step 3) | *Owners / controllers* = count of named owners (small "Screening population"); *Source of funds* (small: funding jurisdictions); *Declarations* "Review required" / "No self-declared flags" (small "Provider checks still mandatory") | Prototype | [O] |
| 3 | Card "Tax, bank and evidence" | review card + *Edit* (→ step 4) | *Tax residence* (small: FATCA); *Funding bank* (small: account holder); *Required evidence* `x/9` (small "`n` OCR complete") | Prototype | [O] |
| 4 | Consent text | label | "I confirm that I am authorised to submit this application, the information is accurate to the best of my knowledge, and Matanho / the investment manager may verify identity, ownership, source of funds, source of wealth, tax status, sanctions, PEP and adverse-media information for KYC/AML purposes. I understand that automated extraction and AI-assisted triage support the review but do not make the final client-acceptance decision." | static | [O] |

##### Tables

None.

##### Inputs & validation

| Field | Control | Required | Options / default / placeholder | Validation today (code) | Target validation | Error message |
|---|---|---|---|---|---|---|
| *Authorised signatory name* (`signatureName`) | text | **Yes** | — | `required` | must match a listed signatory [P] | browser required message |
| *Capacity / title* (`signatureCapacity`) | text | **Yes** | placeholder "e.g. Trustee, Director, CIO" | `required` | — | browser required message |
| Consent (`consent`) | checkbox | **Yes** | unchecked | `required` (checked via `checkValidity`) | `consent: literal true` (API) | browser "Please check this box if you want to proceed." |
| All previous steps | — | — | — | submit re-validates panes 1→6 with messages | server re-validates required fields and evidence | per step; API 400 `incomplete_application` "Complete the missing items before submitting" with `details.fields` and `details.evidence` |

##### Actions

| Control | Enabled when | Permission | Effect (state change, toast text, navigation) | Wiring / API | Label |
|---|---|---|---|---|---|
| *Edit* (× 3) | always | public | Jumps to step 1, 3 or 4 without validation | Prototype | [O] |
| *Submit application* | step 6 | public | (1) validate panes 1→6; first failure → jump to that step + message. (2) run triage if never run (else reuse stored result). (3) reference `LP-<YYYY>-<10000…99998>` (random). (4) build record (Business rules). (5) prepend to `matanho-onboarding-v10`; remove draft key; storage failure → console warning only. (6) hide form and side panel; show 5.C.7. | Prototype → `POST /api/v1/public/applications/{id}/submit`; on 400 `incomplete_application` show toast "Application incomplete — Still needed: `<items>`" (behaviour of the retired bridge) [P] | [O] |

##### Modals & drawers

AI-assisted triage details (5.C.0) is reachable from the side panel.

##### States

- Empty: cards show "—" for missing values, `0/9`. **[O]**
- Error: validation as above; no network errors today. **[O]**
- Disabled: none (the submit button is never disabled). **[O]** Target: disabled with "Submitting…" while the request runs. **[P]**
- Conditional: *Declarations* tile text as described. **[O]**

##### Business rules & calculations

- Submitted record (prototype) **[O]**: `{id: ref, name, type, channel:'Investor / LP portal', stage:'Submitted', risk: triage risk, identity:'Queued', screening:'Provider checks required', funds:'Queued', docsDone: all uploaded files (incl. optional), docsTotal: 9, owner:'Client Services intake', sla:'Just now', slaState:'Digital submission', progress:25, next:'Run approved identity, sanctions, PEP and adverse-media screening; review OCR consistency and source-of-funds evidence.', applicant:{registrationRef, email, phone, country, expectedInvestment, relationship, mandate, sourceOfFunds, sourceOfWealth, beneficialOwnerCount, beneficialOwners, signatories, purpose, activity, taxResidence, fatca, crs, bank{name, holder, country, account, currency, swift}, documents, declarations{pep, sanctions, adverseMedia, highRiskJurisdiction}, signature{name, capacity, submittedAt}}, ai:{status:'ATS triage complete · provider screening pending', modelVersion, documentCompleteness: round(docsDone/docsTotal×100), reviewPriorityScore: High 80 / Medium 55 / Low 25, exceptions[{code, message, resolved:false}], disposition:'<risk> review risk · external screening required', humanReviewRequired:true, finalDecision:null, caveat}, timeline:[[time, 'Investor / LP application submitted', 'Digital application captured with n evidence item(s), OCR metadata and AI-assisted triage.']]}`.
- Server submit (today) **[O API]**: requires legal name, email, country and the API required slots; allocates `ONB-######` (sequence from 104830) and `KYC-####` (from 1001); application status Submitted, `consentAt` set; KYC case created in stage Screening (SLA 4 h); events "Online application submitted" and "Automated pre-screen queued"; outbox `kyc.screening.requested`; email "Matanho application received (ONB-…)"; notification to `onboarding.manage` holders "New application: `<name>`"; audit `application.submitted`.

##### Edge cases

- Triage run earlier and data changed afterwards → the stale risk and flags are submitted. **[O]**
- `documentCompleteness` exceeds 100 % when optional slots are uploaded (e.g. 11/9 → 122 %). **[O]**
- Random `LP-` reference can collide; not checked. **[O]**
- Consent state is not saved in the draft; after reload it is unchecked. **[O]**
- Signature name is not checked against the signatory list. **[O]**
- Expected investment is formatted as USD whatever the base currency. **[O]**

##### Gaps, defects & open questions

- **DEF-479** Reference format mismatch — UI `LP-YYYY-NNNNN` (random), API `ONB-######` (sequence), current SRD 5.C `ONB-####`, FR-ONB-006 `ONB-######`. FR-ONB-035: Display only the server-issued `ONB-######` — AC: success panel reference equals the admin case reference.
- **DEF-480** 21 collected fields are dropped from the submitted record: incorporationDate, regulatedStatus, regulator, licenceRef, website, registeredAddress, baseCurrency, investorClassification, primaryContact, ownershipNarrative, authorityNarrative, annualVolume, transactionFrequency, fundingJurisdictions, expectedCurrencies, sourceFundsNarrative, taxId, giin, usIndicia, evidenceNote, complianceContact; consent itself is not recorded.
- **DEF-481** `ai.documentCompleteness` can exceed 100 % because `docsDone` counts optional documents while `docsTotal` counts required ones. FR-ONB-036: completeness = uploaded required ÷ required — AC: never > 100 %.
- **DEF-482** Stale triage — the stored triage result is not recomputed when data changes before submit. FR-ONB-037: server runs pre-screen on submit from stored data only — AC: changing PEP after a client triage run changes the case risk.
- **DEF-483** Large-investment threshold mismatch — UI flag `VALUE_EDD` at ≥ 1,000,000; API screening stub rates Medium at ≥ 5,000,000. Q-164: Enhanced-review value threshold? — default: 1,000,000 USD equivalent, configurable in policy.
- FR-ONB-038: Electronic declaration stores signatory name, capacity, consent text version, timestamp, IP and user agent — AC: admin case shows all six.

---

#### 5.C.7 Submission result and resume (`/` success panel; `/?resume=<id>.<token>`, public)

| Attribute | Value |
| --- | --- |
| Purpose | Confirm receipt with a reference; (target) let the applicant resume a draft or answer an evidence request from the emailed link. **[O]/[P]** |
| Access | Anonymous; resume requires a valid, unexpired draft token. **[O API]** |
| Prototype layer | V65 `public-onboarding.html` (success panel). Resume handling exists only in the disabled `onboarding-bridge.js`. |
| Wiring status | Prototype (success panel from local data). Resume: API implemented (`GET /api/v1/public/applications/{id}?verified=1` with `X-Draft-Token`), UI not wired. |
| Entry points | Successful submit (5.C.6). Target: resume link in draft email; evidence-request email when the case is in ClientAction. |
| Exit points | None (no button). |

##### Layout

1. Success panel replacing the form: ✓ mark, eyebrow, heading, paragraph, three tiles.
2. Rail and form head remain above/left (see edge cases); side panel hidden.

##### Elements

| # | Element | Type | Content / behaviour | Data source (current → target) | Label |
|---|---|---|---|---|---|
| 1 | Eyebrow / heading | text | "APPLICATION RECEIVED" / "Your investor record is now in review." | static | [O] |
| 2 | Paragraph | text | "Document OCR, completeness checks and AI-assisted triage have been packaged with the original evidence. Approved sanctions/PEP/adverse-media providers and a human Compliance reviewer complete the controlled KYC/AML decision." | static | [O] |
| 3 | Tile *Application* | tile | `#successRef` = `LP-YYYY-NNNNN`; small "Use this reference in correspondence" | Prototype → API submit `ref` (`ONB-######`) | [O] |
| 4 | Tile *AI ATS* | tile | `#successAi` "`<risk>` risk · provider checks pending"; small "Advisory pre-screen" | Prototype → [P] "Queued" (from API `screening`) | [O] |
| 5 | Tile *Final decision* | tile | "Human review" / "Mandatory control" | static | [O] |
| 6 | Resume notice (target) | toast | "Documents requested — Please upload: `<slot labels>`" when case stage = ClientAction; "Documents received — Your additional evidence was added to `<ref>`." after follow-up upload | API `GET …/{id}` `requestedSlots` | [P] (behaviour of retired bridge) |

##### Tables

None.

##### Inputs & validation

None on the result panel. Resume link: token must match and be unexpired (30 days) → else 404 "Application not found or link expired". **[O API]**

##### Actions

| Control | Enabled when | Permission | Effect (state change, toast text, navigation) | Wiring / API | Label |
|---|---|---|---|---|---|
| Open resume link `/?resume=<id>.<token>` | draft email received | token holder | Target: store `{id, token}` in browser (`mx-onboarding-draft`), strip `resume` from URL, `GET …/{id}?verified=1` (stamps `email_verified_at`), restore fields and uploaded-file names; if status ≠ Draft and stage ≠ ClientAction → forget the draft | API implemented; UI [P] | [O API]/[P] |
| Follow-up evidence upload | case stage ClientAction | token holder | Target: upload to requested slots; when no requested slot is empty the case returns to ComplianceReview and `onboarding.manage` holders are notified "`<name>`: requested evidence received" | API `POST …/{id}/evidence` (allowed in ClientAction) | [O API]/[P] |

##### Modals & drawers

None.

##### States

- Empty: n/a. Loading: none. Error: none today. **[O]**
- Conditional: target "follow-up" mode when resuming an application in ClientAction (only requested slots editable). **[P]**

##### Business rules & calculations

- Server resume view returns `form` with tax ID blanked (`taxIdOnFile` flag), owners as `[name, '', pct]` (owner ID never returned), `evidence[]`, `requiredSlots`, `requestedSlots`, `caseStage`. **[O API]**
- Draft token: 256-bit random, stored only as SHA-256; expiry 30 days; draft-create rate limit 20 per hour per IP in production (500 in dev); all public routes 600 per 15 min (5000 in dev). **[O API]**

##### Edge cases

- No "Start another application" action; a second application needs a page reload. **[O]**
- The V65 hero promises "Resume on this device" only; the emailed link is sent by the API but nothing in the UI uses it. **[O]**

##### Gaps, defects & open questions

- **DEF-484** Magic-link resume (FR-ONB-002) implemented in the API but not wired in the V65 UI (bridge disabled).
- FR-ONB-039: Resume via emailed link restores all fields and uploaded evidence names on any device and marks the email verified — AC: `email_verified_at` set on first link use; files listed with name and size.
- FR-ONB-040: Submission receipt email and success panel show the same `ONB-######` — AC: identical strings.

---

**5.E Custodian / Counterparty Portal (port 3104)** — new section after 5.D.

New in V61 **[V61]**: "Counterparty can enter the executed trade during the day. Later, the same counterparty can submit its official day-end cash, holdings and trade-control totals. Day-end evidence supports an uploaded official file and SHA-256 fingerprinting when available. Portal submissions are available to the manager's reconciliation staging area on the same deployment origin." The repository renders it from `legacy-static/v65/custodian-portal.html` as a single public page. **[O]** It is entirely `Prototype`: no authentication, no bridge, no API, no database model; all data lives in one browser localStorage key.

---
