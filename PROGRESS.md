# Progress

Local build on `dev`. Nothing was deployed.

## Phases

| Phase | Status | What was built | Verification |
| --- | --- | --- | --- |
| P0 Decisions and plumbing | Complete (earlier) | Idempotency, envelopes, flags, role catalogue, live routers | Prior API typecheck and local smoke |
| P1 LP read-only | Complete (earlier) | Documents, notices, session, IDOR fix for document reads | Clicked in the investor portal |
| P2 Capital and distributions | Complete (earlier) | Capital call to paid. Maker issues after the checker approves | CC-00002 paid in the browser |
| P3 Dealing | Complete | Subscription submit now sends `bankAccountId` and `requestedDealingDate`. The queue shows Process on Awaiting funds / Under review and Approve on Awaiting NAV | LP manager submitted DLR-00001 (subscription, bank stored) and DLR-00002 (redemption, 100 units). Operations accepted and processed both. The investment director approved both. Both are `COMPLETED`. No Demo data ribbon |
| P4 Performance, service desk, organisation | Complete (earlier) | Performance PDF, bank-instruction verify, colleague flows | Prior local checks |
| P5 Investee reporting | Complete (earlier) | Staff open a period, company submits, staff accepts | PC-101 2026-10 accepted in the browser |
| P6 Term sheets | Complete | Compliance can countersign (`term_sheets.approve`). Company sign, countersign, and execute | TS-1004 is `EXECUTED`. Compliance countersigned. The director, who issued it, marked it executed |
| P7 Cap table and governance | Complete within the schema freeze | Register, forecast, and governance live on the existing `Setting` store | Cap CSV and round simulate clicked earlier. Seven new GL tables were not added |
| P8 Requests, data room, messages, forecast | Complete (earlier) | Capital request, vault, threads, forecast | REQ-2055 approved in the browser. The decision does not move cash |
| P9 Custodian | Complete | Day-end submit, second-user approve, staff accept. Server SHA-256 | Execution `TR-3987788` received. Package `CDE-10001` is `Accepted` with a stored SHA-256. Trade count 1 |
| J1B Public onboarding | Complete | Live public wizard (already wired) | `ONB-104830` submitted with the nine required evidence files. Staff Onboarding page shows `KYC-1001`, stage Screening, 9/11 evidence. No Demo data ribbon on the public form |
| P10 Hardening | Local checks done. Host items skipped | Auth smoke follows the configured portal origins | API, admin, and investor typechecks passed. Root typecheck passed. `npm run smoke -w @matanho/api` passed (26 checks) |

## Assumptions

- The schema stays frozen. Cap table, governance, forecast, and capital requests keep using the `Setting` JSON store.
- Sanctions screening stays the advisory stub `stub-screening-v1`. No external vendor was selected.
- An open-ended fund is available when the LP has an active commitment, even if the commitment amount is 0. The position lives on the holding (184,233.4821 units).
- Compliance is the second term-sheet approver, so the issuer is not the only person who can countersign.
- The LP manager can subscribe and redeem because that role ranks at or above signatory.
- Host deploy stays forbidden. Production object storage and a malware scanner were not added.

## Blockers

- UAT host deploy was not run. Deploy remains forbidden.
- No penetration test, k6 load test, or backup restore drill. Those need a host and a drill environment that are not part of this local run.
- Mailpit is not running, so the mail smoke check still skips.
- The workstream scripts `test-ws1.ts` through `test-ws4.ts` refuse to run unless `E2E_CONFIRM=throwaway-db`. They were not pointed at the local UAT database.

## Manual follow-up

- Leave the local API and portals running if you want to click the same journeys. Sign-in details stay in the secrets file and are not written here.
- A worker process is not running, so queued notification emails are not delivered until a worker starts.
- Do not deploy this branch to the UAT host.
