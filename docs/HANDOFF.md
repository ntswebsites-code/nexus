# Hand-off to the build agent

Written 1 Oct 2026 by the architect session. From here the architect only **designs and directs**; a separate build agent does the building. This file is the entry point. Read it first, then the plan.

## 1. Where everything is

Repository: `C:\Users\lysp\Downloads\matanho-nexus-v56-deployment` (git, branch **`dev`**, baseline commit `10ffc9b` plus the hand-off commit on top). `main` is the untouched pre-baseline state; do not build on it.

| What | Path |
| --- | --- |
| **THE PLAN (follow this)** | `docs/DEV-PLAN-1DAY.md` |
| Why this architecture; options, estimates, target architecture, phases | `docs/BUILD-PLAN.md` |
| What the platform must do (SRD v2: sections 1-15, appendices) | `docs/SRD.md` |
| Per-page breakdown of every portal (section 5) | `docs/srd/5A-admin.md`, `5B-lp-portal.md`, `5C-onboarding-portal.md`, `5D-investee-portal.md`, `5E-custodian-portal.md` |
| API contracts, domain models, state machines, business rules, roles, gap analyses per portal | `docs/srd/appendix/*.md` (e.g. `5B__api-contract.md`, `5B__domain-model.md`, `5D__api-contract.md`, `backend__11.2.md`) |
| Every new requirement / rule / question / defect with its ID | `docs/srd/REGISTER.md` |
| Portal structure and how to build/deploy a portal | `docs/PORTALS.md` |
| Current architecture and auth design | `docs/ARCHITECTURE.md` |

Reference code that is **read-only inspiration, never a runtime dependency**: the sibling product whose UIs were imported: frontend `C:\Users\lysp\Downloads\nvccz-new`, backend `C:\Users\lysp\Downloads\nvccz` (LP services in `src/services/lpPortal/*`, term sheets, applicant portal, cap table). Do not read its `.env*`, logs or credential spreadsheets.

## 2. State of the world today

**Done and live (UAT host `207.180.234.151`, stack in `/opt/matanho-nexus`):**
- Phase 1 API (Express 5 + Prisma + MySQL, `backend/api`): identity with MFA/step-up/invitations/reset, KYC and public applications, clients and cash accounts, documents and encrypted files, notifications, RBAC/admin, audit hash chain, outbox + worker. About 139 routes, 55 tables.
- Six hostnames with valid HTTPS (one certificate): `nexus` (admin), `investor.nexus` (LP), `onboarding.nexus`, `company.nexus` (Investee), `custodian.nexus`, `api.nexus`, all under `matanho.com`.
- **LP portal** (`portals/investor-web`) and **Investee portal** (`portals/company-web`) were swapped in on 30 Sep. Both sign-in gated; both run on **hard-coded demo data** (LP: `src/lib/lp-portal/mock-api.ts` + `mock-store.ts`, a stub `api-client.ts`; Investee: fixtures inside a 200 KB runtime with `liveOnly:false`). The signed-in user supplies only name and sign-out. Investor-role accounts are turned away from the Investee portal.
- Custodian portal (3104) is a static prototype, public, no API.
- Admin portal (3100) is the V56 prototype through a data bridge; only RBAC, settings, audit, cash accounts and the Private Markets company-reporting hub call the API.

**Not built (this is the work):** the API that the LP and Investee portals need (`/api/v1/lp-portal/*` 70 methods, `/api/v1/investee-portal/*`), the fund-operations data model (funds, commitments, capital calls, distributions, notices, dealing, term sheets), the staff-side screens that create that data, custodian and public-onboarding wiring, seeds, tests and a repeatable deploy. Gap numbers: of the 70 LP methods, 1 is covered, 31 partial, 38 missing; of 57 Investee capabilities, 13 covered, 18 partial, 26 missing.

**Honest scope.** The whole SRD is not achievable in one day. The plan targets the largest credible slice (journeys J0, J1A, J2, J3, J5 protected; J4, J6, J1B, J7, J8, J9 attempted with cut gates). Everything else stays on demo data with a visible "Demo data" ribbon.

## 3. Where to start (first hour)

1. Read `docs/DEV-PLAN-1DAY.md` completely (sections 3 scope cut, 4 branching, 5 workstreams, 6 schedule, 8 deploy runbook).
2. Verify the baseline: `git status` clean on `dev`; `npm install`; `npm run typecheck`; `npm run build -w @matanho/api`. Fix only what blocks the baseline.
3. Set up isolation as in plan section 4: one git worktree and branch `ws/<id>` per workstream off `dev`, its own MySQL schema and private ports. Local MySQL listens on 127.0.0.1:3306; creating extra schemas needs an admin login, so if you do not have one, share one schema and serialise migrations.
4. **Start WS0 first** (plan section 5): the single additive Prisma migration (~18 tables), shared types/zod for the LP and Investee contracts (derive from `portals/investor-web/src/lib/api/lp-portal-api.ts` and the 5B/5D API-contract appendices), stub routers returning contract-valid shapes, role catalogue changes, runtime flags. Everything else depends on this; target checkpoint 1 about two hours in.
5. In parallel, the independent workstreams can start on mocks: LP UI wiring (WS5), Investee UI wiring (WS6), ops console kit (WS7), deploy/seed/QA (WS8: Mailpit, seed exporter from the LP mock store, contract harness).
6. Then follow the schedule, checkpoints and cut order in the plan.

## 4. Guardrails (non-negotiable)

- **Do not stop between tasks or phases.** When the item you are on is implemented and tested, record the result in `docs/HANDOVER-STATUS.md` and start the next unfinished item in `docs/DEV-PLAN-1DAY.md` (then `docs/BUILD-PLAN.md` section 7) yourself. Do not wait for a checkpoint, a status review, or an instruction to continue. Skip only that one item when it needs a decision with no default, a schema change while the schema is frozen, an external vendor that has not been selected, or a host deploy that was forbidden. Write the skip down and take the next item that can be built and tested locally.
- Work on `dev` and `ws/*` branches only. **Never push to GitHub, never force-push, never rewrite history** unless the product owner says so.
- One migration for the day, additive only; schema freeze at the plan's checkpoint; hot-spot files (Prisma schema, `routes/v1.ts`, `packages/shared/**`, role catalogue, seeds) have a single owner (WS0).
- Use the mock as the oracle: the real API must return the same shapes as `mock-api.ts` for the same persona. Per-domain flags with rollback by flag. **No silent fallback to demo data when a live call fails.**
- Money actions need step-up MFA and maker/checker (the matcher is not the confirmer; the approver is not the maker). Every state change writes an audit event. Scope everything by client/company (IDOR tests are part of done).
- Never copy NVCCZ security defects (letterhead IDOR, unguarded cap-table list, unfiltered company update, logged temporary password).
- Secrets: never commit `.env*`, `secrets/`, credentials, or print them. Test credentials come from the seed users file, delivered out of band.
- Local runs use unusual free ports (not 3100-3104/4100/8080 etc.); production ports are untouchable.
- Do not run tests that write data against anything but a disposable local database.

## 5. Deploying to UAT (when the plan says so)

The server has no git checkout; deploys are tarballs into `/opt/matanho-nexus`, built there with Docker Compose behind host nginx. SSH: `ssh -i ~/.ssh/id_ed25519 root@207.180.234.151` (key auth; avoid bursts of parallel connections, the server resets them). The runbook is in the plan section 8 and was proven on 30 Sep and 1 Oct: back up and tag `:pre-<release>` images, upload a tarball (exclude `node_modules`, `.next`, `.env*`, `secrets`), delete replaced directories before extracting, `docker compose -f deploy/docker-compose.prod.yml build <services>` (detached, logged), then `up -d --no-deps <services>` (without `--no-deps` the `migrate` job re-runs), then smoke tests. Other projects share this server (NTS Property OS, LYSP and others): touch only the `matanho-nexus-*` containers and `/opt/matanho-nexus`. Restarting the host nginx affects them all; do it only for config changes and test with `nginx -t` first.

## 6. Decisions already made (defaults, binding for the day)

Fund is a first-class entity; LP roles map Viewer/Signatory/Manager onto the existing investor roles with `lp.*` permission codes; NVCCZ is reference only (logic ported natively); NAV per unit is stored on `funds` and seeded; e-signature = typed name + authority + consent + step-up + document hash (not legally reviewed); UAT runs on the existing server; Mailpit captures all mail. Other open questions are in `docs/SRD.md` section 13 with defaults; if something blocks you and has no default, stop that workstream's item, record it, and ask the architect.

## 7. Prompt to give the build agent

Paste the block below as the first message to the build agent.

```
You are the build agent for the Matanho Nexus platform. Repository: C:\Users\lysp\Downloads\matanho-nexus-v56-deployment, branch `dev` (baseline commit 10ffc9b + hand-off commit). An architect session has already produced the specification and plan; your job is to BUILD, following them closely. Do not redesign.

Read, in this order, before touching code:
1. docs/HANDOFF.md  (state of the world, where to start, guardrails)
2. docs/DEV-PLAN-1DAY.md  (THE PLAN: scope cut, workstreams WS0-WS8, schedule, deploy runbook, quality gates)
3. docs/BUILD-PLAN.md  (sections 3, 4, 12: the chosen architecture "Option B" and the one-day detail)
4. docs/SRD.md  (v2 requirements) and the per-portal files in docs/srd/ (5B-lp-portal.md, 5D-investee-portal.md, appendix/5B__api-contract.md, 5B__domain-model.md, 5D__api-contract.md, 5D__domain-model.md, backend__11.2.md)

Goal: by the deadline in the plan, the UAT cut line must work end to end on real persistence on the UAT server: J0 access/security, J1A staff-assisted onboarding to LP first login, J2 LP documents/notices/requests, J3 capital call to paid, J5 investee reporting loop; then J4, J6, J1B, J7 as time allows using the cut order in the plan. Anything not live must show the "Demo data" ribbon.

How to work:
- Start with WS0 (single additive Prisma migration, shared types/zod from portals/investor-web/src/lib/api/lp-portal-api.ts and the SRD API-contract appendices, stub routers returning contract-valid shapes, role catalogue, runtime flags). Then run the other workstreams in parallel (separate git worktrees/branches ws/<id> off dev, own MySQL schema and ports) as described in plan sections 4-6. Merge to dev only when typecheck + build + that workstream's tests are green.
- The mock (portals/investor-web/src/lib/lp-portal/mock-api.ts and mock-store.ts; the Investee runtime payload types) is the executable spec: write a contract harness that compares real API responses to the mock for the same persona, and flip domains live behind per-domain flags with rollback. Never fall back silently to demo data.
- Implement the APIs natively in backend/api as /api/v1/lp-portal/* and /api/v1/investee-portal/*, reusing existing Nexus modules (identity, documents/files, notifications/outbox, audit chain, KYC, clients, cash accounts, company reporting). Use the NVCCZ repos (C:\Users\lysp\Downloads\nvccz-new and \nvccz) only as read-only reference for logic; do not copy their security defects (see HANDOFF section 4).
- Build the staff-side screens in portals/admin-web as a native React ops console in a separate route group (plan WS7); do not rewrite the legacy prototype pages.
- Money actions: step-up MFA + maker/checker + audit event + idempotency key. Scope every query by client/company; include IDOR and segregation-of-duties tests.

Rules: stay on dev and ws/* branches; commit often with clear messages; never push to GitHub, never force-push; never commit .env*, secrets or credentials; use unusual free ports for local runs; do not touch other projects on the UAT server; deploy only with the runbook in plan section 8 (backups, :pre-<release> image tags, --no-deps). If a decision has no default in docs/SRD.md section 13 or the plan, record it in docs/DECISIONS-NEEDED.md and continue with another item; do not stall.

Do not stop when a task, workstream, or phase is done. Update docs/HANDOVER-STATUS.md with what passed, then start the next unfinished item in the plan yourself. Checkpoints are status notes you write while you keep building, not places to wait. Skip a single item only when it needs a missing decision, a frozen-schema change, an unselected vendor, or a host deploy that was forbidden, and move on.
```

## 8. Roles from here

- **Build agent:** implements, tests, and merges per the plan, then starts the next unfinished item without waiting. Writes the checkpoint note in `docs/HANDOVER-STATUS.md` and keeps going. Deploys to UAT only when the plan's runbook is in force and a host deploy has not been forbidden.
- **Architect session:** answers design questions, resolves conflicts between SRD sections, reviews checkpoints and cut decisions, and keeps the SRD and plan consistent. Send questions with the exact file/section reference.
