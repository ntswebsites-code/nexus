# J18 — Release Acceptance Sign-off Pack (prepared 12 October 2026)

**Candidate:** release `uat-2026-10-c` (commit `a41c957`, on top of `3ebffe0` + `730f3cd`)
**Environment:** production `http://207.180.234.151` — portal domains nexus/investor/onboarding/company/custodian.matanho.com; API api.nexus.matanho.com
**Basis:** UAT cycle UAT-2026-10-A; every P0 module lifecycle executed with real records; production deployed and audited live with a real browser.

## Status summary for reviewers

| Wave | Result |
|------|--------|
| Entry gates G01–G06 | ✅ 5 pass, 1 conditional (G03 — target values proposed; **approved by cycle owner 12 Oct**) |
| Source inspection flags IF-01–IF-15 | ✅ 11 Closed–Not Present · 3 Accepted–Documented · 3 Verified–Proof Scheduled (proof landed in named cases) |
| Wave 1 (DEP/IAM/DAT) | ✅ 21/21 pass (8 defects found → fixed → retested) |
| Wave 2 (17 modules) | ✅ all P0 lifecycles pass |
| Wave 3 (CON/MOD/REG/RPT) | ✅ 4/4 pass |
| NFR-001–009 | ✅ 8 pass · 1 documented scope decision (Firefox/Safari not installed) |
| Journeys J01–J18 | ✅ 17 pass · 1 partial (J13 sandbox model service — conditional by design) |
| Production deployment | ✅ `uat-2026-10-c` live; smoke 50 pass / 0 fail / 6 skip; live portal audit 0 console errors |
| Defects raised this cycle | DEF-2026-001..008 — **all fixed and retested** (incl. the login-deadlock S1 found during NFR execution) |

## Authority matrix (Manual §14)

| # | Authority | Evidence to review | Status |
|---|-----------|--------------------|--------|
| 1 | UAT Lead | Full cycle: gates, flags, waves, journeys, deployment (`uat-execution/*`) | ⬜ signature |
| 2 | Investment Director | ORD/CON/RES: `Wave1-results.md`, `Wave3-results.md`, gold oracles (buy→NAV, fills, mandate gate) | ⬜ signature |
| 3 | Operations Lead | REC/CSH/OPS: `Wave2-results.md` (statement import, dedupe, SoD on journals), DEF-2026-008 resolution | ⬜ signature |
| 4 | Finance / Fund Accounting | NAV/ACC: `Wave2-results.md` (NAV-00007 lifecycle, recalc→release), period close, oracle evidence | ⬜ signature |
| 5 | Compliance / Risk | KYC, limits, filings: ONB (9-slot evidence enforcement), REG approval chain, RSK conflict detection | ⬜ signature |
| 6 | Security / Platform | IAM/DAT/NFR/DEP: `Wave1-results.md`, `Wave3-results.md`, `NFR-results.md`, credential purge record | ⬜ signature |
| 7 | Investor Services Owner | LP journeys: live portal audit (`Production-portal-audit.md`), LP-001–006, J10 metrics | ⬜ signature |
| 8 | Release Sponsor | Everything above + standing production (`Production-deployment.md`) | ⬜ signature |

## Conditions attached to acceptance

1. **Credential rotation (external action):** the ZeptoMail key and production `users.json` passwords were exposed in dev logs during this cycle and must be rotated. Purged from code and git; rotation is the owner's action.
2. **J13** remains conditional on the sandbox model service (target surface); the on-platform model governance lifecycle is fully verified.
3. **NFR-006** executed on Chromium only; Firefox/Safari is a recorded scope decision, not an unrecorded exemption.
4. **Test residue:** UAT probe records (a paused connector, J01 client CL-00420, J05 execution `UAT-BROWSER-MV50RASH`, probe journals/orders) exist in the sandbox and are cleared by the documented reset procedure before go-live if desired.

**Rule (Manual §14):** each signature must identify build `uat-2026-10-c`, tested scope, unresolved risk, and supporting evidence. Prototype/UI-only acceptance is not production authorisation — this pack is accompanied by end-to-end server-side evidence for every P0 control.
