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
