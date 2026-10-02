# Decisions needed

Decisions with no default in `docs/SRD.md` section 13 or `docs/DEV-PLAN-1DAY.md`. Each entry records the
interim choice the build took so work could continue; the owner confirms or overrides it.

| # | Area | Question | Interim choice (in code) | Raised |
|---|------|----------|--------------------------|--------|
| D-01 | LP bank instructions | No `lp.*` permission code exists for requesting a bank-instruction change. Which code gates it? | `lp.organisation.view` + LP role SIGNATORY or MANAGER + step-up MFA + Idempotency-Key | WS0 |
| D-02 | LP settings | Notification and display preference updates have no `manage` code (only `lp.settings.manage_mfa`). | Gated by `lp.settings.view`; preferences are per user, not per client | WS0 |
| D-03 | LP reports list | The legacy thin reports list has no dedicated code. | `lp.documents.view` to list, `lp.documents.download` to download | WS0 |
| D-04 | LP request replies | Replying to a service request: `lp.requests.create` or `lp.messages.reply`? | `lp.messages.reply` | WS0 |
| D-05 | Not-yet-built LP endpoints | Status for routes that exist but are not implemented. | 503 `LP_DOMAIN_NOT_LIVE` (`retryable: false`); lists return an empty page | WS0 |
| D-06 | Runtime flags vs API | Should the API refuse domains whose flag is off? | No. Flags only switch the UI between live and demo data; the API always serves real data so the contract harness can compare before a flip | WS0 |
| D-07 | Session unread counts | What counts as an unread request? | Requests in LP status `AWAITING_INVESTOR` (legacy status `Waiting on you`) | WS0 |
| D-08 | Investee contract types | Shared Investee payload types/zod were not derived in WS0. | WS3 derives them from the company-web runtime payload types inside `modules/investee-portal/**`; WS0 only mounts the router | WS0 |
| D-09 | Money formatting | Decimals are emitted as `Decimal.toString()` (`"1000000"`), the mock may show `"1000000.00"`. | The contract harness compares numerically for money fields | WS0 |
| D-10 | LP step-up | Do LP money actions need step-up? | Yes: capital-call acknowledge, payment confirmation, dealing subscribe/redeem require `requireStepUp` (integration fix 54a3b34) | INT |
| D-11 | Notice refs | Reference format for LP notices | Own sequence `NTC-00001` | WS1 |
| D-12 | Report jobs / preferences storage | No tables exist (schema frozen) | Stored as `Setting` rows | WS1 |
| D-13 | Combined IRR | IRR across several funds | `null` when more than one fund is in view; multiples recomputed from totals | WS1 |
| D-14 | Invite fund scope | Identity accept does not copy invited fund scope / LP role | Scope kept in `settings`, applied (narrowing first) on the member's first LP request. Proper fix belongs in identity accept | WS1 |
| D-15 | Pro-rata capital calls | Allocation rule | By commitment, capped at uncalled; remainder to the largest commitment | WS2 |
| D-16 | LP call visibility | Which call statuses LPs see | ISSUED, PARTIALLY_PAID, PAID only | WS2 |
| D-17 | Payment recording SoD | Who may record a payment | Must differ from the user who uploaded the evidence | WS2 |
| D-18 | Distribution split | Basis | Paid-in, else commitment; units for open-ended funds | WS2 |
| D-19 | Subscription fees | Added or deducted (BR-162 vs mock) | Added on top of the amount (BR-162); differs from the mock | WS2 |
| D-20 | Default dealing rules | Fund without dealing rules | Min balance 0, 30-day notice, monthly dealing, 2-day settlement lag | WS2 |
| D-21 | Ops refs | Reference prefixes | `FND-`, `CC-`, `DIST-`, `DLR-`, `CCN-` generated locally (lib/refs.ts untouched) | WS2 |
| D-22 | Investee access | Company users have no portal roles | Investee router checks active CompanyUser membership instead of `requirePortalAccess('company')` | WS3 |
| D-23 | Term sheet statuses | Workflow states | Added `PENDING_APPROVAL`, `APPROVED`, `DECLINED`; `COUNTERSIGNED`/`EXECUTED` reserved (no fund countersign yet) | WS3 |
| D-24 | Term sheet signing | Rules | `sign` profile + recorded signing authority + MFA + step-up; consent version `ts-esign-v1` fixed server-side, hash stored, certificate PDF saved as Document | WS3 |
| D-25 | Investee envelope | Response format | NVCCZ envelope; errors also carry `code` and `error`; company `id` is the company ref | WS3 |
| D-26 | Onboarding evidence | Required slots per investor type | Individual/HNW 6 slots, other V65 types 9 (form still asks 9) | WS4 |
| D-27 | Custodian day-end | Rules | Official file required; only the preparer submits; approval has no step-up; statement date may be 2h ahead (Harare) | WS4 |
| D-28 | Custodian MFA | Second factor | `custodian` added to `MFA_PORTALS` (effective only when `mfa_required` policy is on); no self-service enrolment screen yet | INT |
| D-29 | UAT seed | Client B | `CL-90001`, 20% of the growth fund; notices targeted per organisation | WS8 |
| D-30 | Smoke rollback | Auto-rollback on smoke failure | On by default (`AUTO_ROLLBACK=1`) | WS8 |
| D-31 | LP flags caching | Where flags are cached | In memory per page load; rollback takes effect on next reload | WS5 |
| D-32 | Ops console permissions | Button gating | Approve disabled for the preparer; server stays authoritative; single-user notice targets take a raw user id (no user picker endpoint) | WS7 |

## Confirmed on 2 Oct 2026

The product owner delegated these decisions. **D-01 to D-32 are confirmed as the interim choices in the table above.** Further decisions taken while closing the gaps:

| # | Area | Decision | Why |
|---|------|----------|-----|
| D-33 | Mandatory MFA in UAT | The `mfa_required` policy stays **off**. Step-up MFA still applies to money actions for any account that has enrolled an authenticator. Turn it on later with `SEED_UAT_MFA_REQUIRED=1` and a re-seed. | Forcing every admin, LP and custodian login to enrol would lock out testers without an authenticator on day one. |
| D-34 | Reading UAT mail | All mail goes to Mailpit, which is not exposed publicly. Testers read it through an SSH tunnel to port 8025 on the host (or the owner adds a protected hostname). | No new DNS name or public mail viewer is created without the owner. |
| D-35 | UAT test data | After the automated smoke runs, the UAT workflow data is reset with `SEED_UAT_RESET=1` so testers start from the seeded state. Persona accounts keep their passwords. | Smoke runs consume the open capital call and open reporting period. |
| D-36 | Smoke persona for investee submit | The smoke suite submits the reporting pack as the company approver, not the contributor (the contributor uploads; only an approver holds the `submit_pack` right). | The permission is correct; the test used the wrong persona. |
| D-37 | Scope not built | The V56 admin pages for orders, IBOR, research, risk, reconciliations, NAV, accounting, financing and corporate actions stay prototype pages on demo data. They are outside the UAT cut line (docs/DEV-PLAN-1DAY.md section 3). | One-day scope; the SRD lists their requirements for later phases. |
