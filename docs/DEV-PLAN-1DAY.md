# One-day development plan to UAT

Branch: `dev` (created from `main`). Written 1 Oct 2026. Companion documents: `docs/SRD.md` (what the platform must do), `docs/BUILD-PLAN.md` (why this architecture, options, estimates), `docs/srd/REGISTER.md` (every new requirement, rule, question and defect).

**The constraint.** One day of development, then user acceptance testing (UAT) starts the next morning. **The goal.** On UAT day, every journey in the cut line (section 3) works from the first click to the last visible result, on real persistence, with the staff action in the admin console, an audit event and a notification, in a deployed environment.

**Keep going.** Finishing a task, a workstream, or a phase is not a stop. Log results to PROGRESS.md and continue to the next phase immediately. Checkpoints in section 6 are notes you write while work continues. Skip only the single item that needs a decision with no default, a schema change while the schema is frozen, an external vendor that has not been selected, or a host deploy that was forbidden. Write that skip down and take the next item that can be built and tested locally.

**Click-through when the build is in place.** Before treating the cut line as done, sign in as each persona and click through every journey in section 3. A page that should be live must not show the Demo data ribbon. A failed request, a blank error, or a broken layout is a defect: fix it and click that journey again. API checks do not replace the click-through.

## 1. What "fully functional from A to Z" can honestly mean in one day

The whole SRD is about 380 new functional requirements across five portals plus the admin workspace. That is weeks of work, not one day, and this plan does not pretend otherwise. The plan delivers the **largest coherent slice that is credible**:

* **Live and tested end to end (the cut line):** access and security, staff-assisted onboarding to LP first login, the LP documents/notices/requests round trip, capital call to paid, and the investee reporting loop. These are the five journeys the business story needs.
* **Attempted, with explicit cut gates:** dealing, term sheet issue and signing, public onboarding to a KYC case, distributions, the custodian day-end submission.
* **Not attempted (shown as "Demo data" in the UI, never pretending to be live):** cap table, governance, forecast workbook, data-room upload, procurement, reports centre and exports, realtime, malware scanning, S3 storage, production hardening, legal review of e-signatures.

Everything outside the cut line keeps its demo data and shows a persistent "Demo data" ribbon, so testers can tell live from demo at a glance. The honest probability that each journey passes its UAT script at code freeze is in section 3.

## 2. Decisions needed before the clock starts (defaults are binding for the day)

| # | Decision | Default used if you say nothing |
| --- | --- | --- |
| D1 | **Commit the baseline.** The working tree holds about 170 uncommitted changes (the whole Phase 1 backend, the portal swaps, the SRD). Parallel agent worktrees are created from a commit, so without a baseline commit on `dev` they would start from an empty codebase. | Log results to PROGRESS.md and continue to the next phase immediately. One commit on `dev`: "Baseline: Phase 1 API, LP and Investee portals, SRD v2". |
| D2 | Fund is a first-class entity (BUILD-PLAN Q-NEW-01) | Yes: `funds`, `fund_commitments`, `lp_holdings` |
| D3 | LP roles (Q-NEW-02) | Viewer, Signatory, Manager map onto the existing investor roles `finance`, `admin`, `investment`/`auditor`; permission codes `lp.*` |
| D4 | Relationship to NVCCZ (Q-NEW-04) | Reference only. Logic is ported natively into `backend/api`; NVCCZ is not a runtime dependency |
| D5 | Source of NAV per unit (Q-NEW-05) | Stored on `funds` and seeded; staff can edit in the console |
| D6 | E-signature standard (Q-NEW-07) | Typed name + authority + consent + step-up MFA + document hash. Not legally reviewed; flagged in UAT notes |
| D7 | UAT environment | The existing stack at `/opt/matanho-nexus` on 207.180.234.151 (no separate production yet). DB dump and image tags before every deploy |
| D8 | MySQL for parallel work | Each workstream gets its own schema on the local MySQL. **Needs a MySQL admin login (or Docker) to create schemas**; if not available, workstreams share one schema and serialise migrations |
| D9 | Mail in UAT | A Mailpit container captures all email; no real email is sent |

## 3. UAT scope cut line

Value 5 = business critical. P(live) is the estimated chance the journey passes its UAT script at code freeze.

| ID | Journey | Portals | Value | P(live) | If it slips |
| --- | --- | --- | --- | --- | --- |
| **J0** | Access and security baseline: login per persona, wrong-portal refusal, invitation, password reset, MFA enrol and step-up, idle timeout, IDOR checks | all | 5 | 90% | Protected. Verification, not new build |
| **J1A** | Staff-assisted onboarding to LP first login: staff creates case, screening, compliance decision (dual control), activation, invitation, LP signs in and sees own client | admin, LP | 5 | 85% | Protected. Seed an activated client and start from the invitation |
| **J2** | LP read journey: dashboard, staff publishes a document, LP lists/previews/downloads (signed URL), signs with step-up, notices with acknowledge, requests and messages with staff replies | admin, LP | 5 | 80% | Protected. Drop notices before documents |
| **J3** | Capital call to paid (and a distribution): staff drafts and allocates pro rata, a second person approves with step-up and issues, LP acknowledges and uploads proof, staff settles (the matcher is not the confirmer), LP sees Paid and updated unfunded | admin, LP | 5 | 65% (distribution 55%) | Ship call to paid; distributions read-only seeded |
| **J5** | Investee reporting loop: staff opens a period, investee uploads the 5 items and KPIs and submits, a different staff user accepts or returns with a note, investee sees the outcome | admin, Investee | 5 | 60% | Reduce to dashboard + reports page; KPI centre stays demo |
| J4 | Dealing: rules, estimate, subscription and redemption with rejection rules, staff queue, approve or reject | LP, admin | 4 | 45% | Demo + ribbon; estimator unit-tested only |
| J6 | Term sheet issue to signature | admin, Investee | 4 | 50% | Issue and read only |
| J1B | Public onboarding form to a KYC case | onboarding, admin | 4 | 45% | Public page stays demo; start from J1A |
| J7 | Custodian day-end to reconciliation | custodian, admin | 3 | 30% | Cut; page stays static with ribbon |
| J9 | Investee messages and data-room read | Investee | 2 | 35% | Cut; ribbon |
| J8 | Investee capital request | Investee, admin | 2 | 20% | Cut |

**Cut order if behind (drop first):** J8, J7, J9, J1B, J6, J4, then reduce J3 to call-to-paid, then J5 to reports only. J0, J1A and J2 are never cut.

## 4. Branching and merge model

```
main            frozen baseline (untouched by this plan)
 └─ dev         integration branch; baseline commit (D1) lands here first
     ├─ ws/0-schema   ws/1-lp-core   ws/2-capital   ws/3-investee   ws/4-custodian
     ├─ ws/5-lp-ui    ws/6-investee-ui   ws/7-ops-console   ws/8-deploy-qa
```

* Each workstream works in its own git worktree and branch off `dev`, with its own MySQL schema and a private port range (41xx for API, 42xx for portals; never the production ports).
* A workstream edits only the directories it owns (section 5). Hot-spot files have one owner: Prisma schema and migrations, `routes/v1.ts`, `packages/shared/**`, role catalogue and seed belong to WS0; `deploy/**` belongs to WS8. Others ask the owner for a diff.
* **One migration for the day**, written by WS0 before checkpoint 1, additive only. After the schema freeze only column additions, through WS0.
* Merge to `dev` at checkpoints or when the workstream is green (typecheck + build + its tests). No force pushes. Log results to PROGRESS.md and continue to the next phase immediately.

## 5. Workstreams

| WS | Owns | Delivers | Done when |
| --- | --- | --- | --- |
| **WS0 Schema and contracts** | `backend/api/prisma/**`, `routes/v1.ts`, `lib/**`, `config/**`, `packages/shared/**`, role catalogue, `seed.ts` | The one migration (about 18 tables: funds, commitments, holdings, capital calls and allocations, distributions and allocations, notices and receipts, dealing requests, idempotency keys, term sheets, counterparties and their submissions) plus column additions; shared types and zod schemas for the LP and Investee contracts; facade helpers (envelope, LP context, permission, idempotency); stub routers returning contract-valid shapes; role bundles; runtime flags | `typecheck` and API build green; stub `GET /api/v1/lp-portal/session` returns the contract shape. **Checkpoint 1** |
| **WS1 LP core** | `modules/lp-portal/**` (except capital and dealing) | Session, dashboard, account activity (read-time union), documents (list, detail, summary, signed download, preview), notices (list, detail, acknowledge), requests and messages (mapped to service requests and threads), organisation read, settings | Contract harness green for these domains for persona A; persona B gets 404 on A's ids |
| **WS2 Capital and dealing** | `modules/capital/**`, `modules/dealing/**`, LP capital and dealing routes | Call and distribution lifecycle (draft, allocate pro rata to unfunded, approve with step-up, issue, acknowledge, confirm payment, settle), one-page notice PDF, dealing rules and estimator with the six hard validations, staff routes, audit and outbox events, idempotency | Unit tests for unfunded, acknowledge-is-not-paid, minimum balance, notice period; harness green for capital |
| **WS3 Investee backend and term sheets** | `modules/investee-portal/**`, `modules/term-sheets/**`, `modules/company/**` | `/api/v1/investee-portal` dashboard, profile, reports (schedule, history, submit through the existing pack flow), KPIs, terms, settings; term sheet issue and sign with evidence; thread start | Payload schema tests green; open, submit, accept proven by script |
| **WS4 Custodian and onboarding** | `modules/custodian/**`, `modules/kyc/public.routes.ts`, `portals/custodian-web/**`, `portals/onboarding-web/**` | Counterparty auth and endpoints; custodian bridge posting to the API with a server-side hash; onboarding field and evidence-slot mapping | J7 and J1B pass or are cut at checkpoint 3 |
| **WS5 LP UI wiring** | `portals/investor-web/**` | Real credentialed API client with envelope errors and idempotency keys; per-domain flags; "Demo data" ribbon; step-up modal on `step_up_required` (the LP UI has none today); polling; numeric-string fixes | Each flipped domain renders live data, no console errors |
| **WS6 Investee UI wiring** | `portals/company-web/**` | Port the live loaders and actions from the NVCCZ frontend; retarget to `/api/v1/investee-portal`; allowlist of live actions; ribbon on fixture pages | Dashboard, reports, terms, signatures, settings read live; actions persist |
| **WS7 Ops console** | `portals/admin-web/src/app/(ops)/**` | Native React staff screens in a separate route group: funds and commitments, capital call run and settle, distributions, notice publishing, dealing queue, term sheet issue, counterparty submissions; a small bridge link in the legacy sidebar | A staff user completes the staff side of J3, J4, J6 |
| **WS8 Deploy, seed, QA** | `deploy/**`, `backend/api/scripts/**`, seeds, `tools/**` | Mailpit, `deploy.sh` and `rollback.sh` (section 8), seed exporter from the LP mock store, personas, contract harness, Playwright journeys, smoke suite, UAT scripts, a rehearsal deploy to a scratch stack | Rehearsal deploy at checkpoint 3 succeeds; smoke suite automated |

## 6. Schedule

T+0 is the start of the day (decisions D1 to D9 use the defaults in section 2). Times are elapsed hours. The plan assumes about 13 working hours before a local verification pass. Log results to PROGRESS.md and continue to the next phase immediately.

| Elapsed | Activity | Gate |
| --- | --- | --- |
| T+0:00 | D1 baseline commit on `dev`; typecheck baseline; create worktrees, per-agent schemas and ports; confirm scope cut | Scope frozen |
| T+0:30 to T+2:00 | **Block 1.** WS0 writes the migration, shared types and stub routers. Everyone else scaffolds against the mock: WS5 client and flags, WS6 adapter port, WS7 console kit, WS8 Mailpit and seed exporter | |
| **T+2:00** | **Checkpoint 1:** schema v1 and stubs merged; Prisma client regenerated; typecheck green; harness shows stubs shape-valid. If later than T+2:30, auto-cut J4, J6, J7 | Log results to PROGRESS.md and continue to the next phase immediately. |
| T+2:00 to T+5:00 | **Block 2.** WS1 session, dashboard, documents, notices; WS2 capital; WS3 reporting adapter; WS4 onboarding mapping; WS5 and WS6 wiring; WS7 funds and call run | |
| T+4:30 | Schema freeze: column additions only, through WS0 | |
| **T+5:00** | **Checkpoint 2 (integration 1):** merge to `dev`, rebuild, run the harness; flip the first flag groups on the dev stack; J0, J1A, J2 smoke by hand | Log results to PROGRESS.md and continue to the next phase immediately. |
| T+5:00 to T+8:00 | **Block 3.** J3 and J5 end to end, then J4 and J6; staff screens; E2E scripts; seeds final | |
| **T+7:00** | **Checkpoint 3 (integration 2):** J3 and J5 happy paths green; local verification of the migration; per-journey decision: stay, ribbon or cut | Log results to PROGRESS.md and continue to the next phase immediately. |
| **T+8:00** | **Feature freeze:** fixes only | |
| T+8:00 to T+10:00 | **Block 4:** bug fixing, all-journey E2E, flag configuration, tester documents. Start image builds from T+9:30 to surface build errors early | |
| **T+10:00** | **Code freeze:** tag `uat-rc1` on `dev` | |
| T+10:00 to T+11:00 | Final builds, DB dump, artefacts staged | |
| **T+11:00** | **Deploy to UAT** (section 8): migrate, seed, restart, set flags, verify hosts and certificates | |
| T+11:30 to T+12:30 | Smoke suite S1 to S12, blocker-only fix-forward | |
| **T+12:30** | **Go/no-go for UAT.** Publish the known-issues sheet | |
| T+12:30 to T+13:30 | Handover: personas, scripts, defect channel; overnight on-call for blockers only | |

## 7. How each domain goes live safely and cheaply

* **The mock is the oracle.** The LP portal's `mock-api.ts` and `mock-store.ts` define the exact response shapes. A contract harness calls the real endpoint and the mock for the same persona and compares shapes and seeded values. The Investee runtime's live payload types do the same job there.
* **Per-domain runtime flags with rollback.** LP domains go live in groups: G1 session, settings, organisation; G2 dashboard, capital, activity; G3 documents, notices, requests; G4 dealing. A flag flip plus a restart is the rollback. Investee uses an allowlist of live actions.
* **No silent fallback to demo data.** A live domain that errors shows an error, never fake data, so UAT does not hide defects. A domain left in demo shows the ribbon.
* **Port only what is cheap.** NVCCZ code is used as a reference. Only pure logic is ported (the dealing estimator and validations, call visibility and unfunded formulas, term sheet rules). The services tied to the general ledger or to NVCCZ's raw-SQL report tables are not ported.
* **Security defects in NVCCZ are not copied.** The research found a letterhead IDOR, unguarded cap-table registry endpoints, an unfiltered company update and a logged temporary password; none of these are ported.
* **Money actions require step-up MFA** (approve and issue a call, confirm payment, sign, approve dealing). `mfa_required` is turned on for approver and signatory roles in UAT so step-up is real.

## 8. Deploy and rollback runbook (UAT host)

The server has no git checkout; deploys are tarball-based (`/opt/matanho-nexus`). WS8 turns the procedure used so far into two scripts.

**`deploy.sh` (repeatable):**
1. `mysqldump --single-transaction` of the database and a snapshot of the file store, into `/root/nexus-backups/`.
2. Tag the running images `:pre-<release>` for the API, worker and each portal being changed.
3. Upload the release tarball (excluding `node_modules`, `.next`, `.env*`, `secrets`); remove replaced directories before extracting (extracting never deletes old files).
4. `docker compose -f deploy/docker-compose.prod.yml build <services>` (detached, logged).
5. `prisma migrate deploy` once (the `migrate` service), then `up -d --no-deps <services>`; one worker instance only.
6. Run the smoke suite (below) and abort to rollback on failure.

**`rollback.sh`:** retag the `:pre-<release>` images as `:latest` and `up -d --no-deps`; flip affected domain flags off. The schema is additive, so no down-migration is needed.

**Smoke suite S1 to S12:** health and migration version; login per persona type; LP session for client A and 404 for client B's ids; dashboard values equal seed; documents list and signed download; notice publish and LP receipt; capital call issue and LP visibility; acknowledge and upload; settle and Paid; investee period submit and staff accept; audit chain verify; a mail arrives in Mailpit.

**Hosts and certificates:** the six existing hostnames and the single certificate cover everything (custodian was added on 1 Oct). Only Mailpit would need a new name, and it can stay on an internal port.

## 9. Quality gates

* **Per workstream, before any merge to `dev`:** `npm run typecheck`, `npm run build` for the touched packages, and its own tests.
* **Contract harness** (WS8): real API versus mock oracle for each live domain, for two personas (client A and client B).
* **Security checks as automated tests:** IDOR (client B cannot read A's capital calls, documents, notices; company 102 cannot read company 101), segregation of duties (a maker cannot approve their own call; the matcher is not the confirmer; a pack submitter cannot review it), permission refusals, step-up required on money actions, audit event written for every state change, audit chain verifies.
* **Playwright journeys** for J0, J1A, J2, J3, J5 run against the dev stack at each checkpoint.
* **Existing guards stay green:** the legacy bridge check (`tools/legacy-bridge.mjs --check`) and the API smoke and e2e scripts.

## 10. UAT readiness

**Personas** (credentials delivered out of band through the seed users file, never committed): sysadmin; client services (maker); compliance; investment director (approver); operations (settlement); analyst (second reviewer); LP manager, signatory and viewer for client A (Horizon Pension Fund, one private-capital fund and one open-ended fund); an LP signatory for client B (negative tests); investee approver, contributor and viewer for company 101; an investee admin for company 102 (negative tests); custodian submitter and approver if J7 is live.

**Seed content:** client CL-00418 with two funds (three calls and two distributions; units, NAV per unit and dealing rules), 14 published documents, six notices, requests and threads; company 101 with four reporting periods (one open) and covenants; one prospect company with a draft term sheet; one counterparty.

**UAT scripts (each has expected results):** UAT-01 access matrix; 02 onboarding to LP first login; 03 LP dashboard parity with seed; 04 documents with signing; 05 notices; 06 requests and messages; 07 capital call to paid; 08 distribution; 09 subscription; 10 redemption; 11 investee reporting loop; 12 term sheet; 13 custodian; 14 RBAC and segregation-of-duties negatives; 15 IDOR negatives; 16 audit search, export and chain verify; 17 flags and the demo ribbon; 18 session idle timeout, logout and MFA.

**Support:** external health check every minute with email alert; request-id log tailing; an issue log with severities (S1 blocker, S2 major, S3 minor), fix-forward only for S1 and S2 during UAT; a nightly reset script (`reset-uat.sh`) that re-seeds the demo data.

**What testers are told:** UAT covers journeys J0 to J3 and J5, plus whichever of J1B, J4, J6 and J7 survive the checkpoint-3 decision. It tests the integrated slice and its controls (access, scoping, maker/checker, audit), not the whole SRD and not production readiness. Anything with the "Demo data" ribbon is deliberately not live.

## 11. Risks and contingencies

| Risk | Likelihood | Effect | Mitigation |
| --- | --- | --- | --- |
| The 200 KB Investee runtime expects fields the API does not supply | 40% | J5 and J6 shrink | Start from the NVCCZ payload types; fall back to read-only pages |
| Merge conflicts in schema, `routes/v1.ts`, `package.json` | 40% | Lost hour | One owner (WS0); all routers registered up front as stubs |
| No step-up UI in the LP portal | 100% unless built | Money actions fail for enrolled users | WS5 builds the modal in block 1 |
| Image build and deploy time (Next 16, five portals) | 30% overrun | Late deploy | Start builds at T+9:30; deploy API and portals independently |
| Email not delivered (SMTP unset) | 50% | Invitations and notices blocked | Mailpit in the first hour |
| Seed and mock disagree | 50% | UI numbers look wrong | Seed exporter from the mock store; parity checks in the harness |
| First-run migration fails on UAT data | 20% | Deploy blocked | Rehearse on a copy at T+7:00; single additive migration |
| Decisions arrive mid-day | 50% | Rework | Defaults in section 2 are binding |

**What will probably not be finished** (so expectations are set honestly): J7 custodian (70% chance incomplete), J8 capital requests (80%), J4 dealing end to end (55%), J6 term sheet signing (50%), J1B public onboarding (55%), J3 distribution (45%), the structured report builder (90%), the reports centre and exports (85%). Cap table, governance, forecast, data-room upload and team administration are not attempted (100%).

## 12. After UAT day

The remaining phases of `docs/BUILD-PLAN.md` (sections 7 and 8) continue from this slice: performance and report jobs, bank-instruction change and colleague administration workflows, cap table and governance, the structured financial statement builder, realtime, malware scanning, object storage and production hardening.

When the cut line in section 3 is green locally, start the next phase in that list yourself. Log results to PROGRESS.md and continue to the next phase immediately. An unselected vendor (external sanctions screening, malware scanning), object storage, and a forbidden host deploy are skips of those items, not a reason to stop the rest.
