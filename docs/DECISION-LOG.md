# Decision log (decisions made on the owner's behalf)

Rule used: 1) plan/specs/guides in the repo, 2) existing code patterns, 3) simplest option that is easy to change later.
Only irreversible or data-deleting steps are skipped and logged.

| # | Date | What was unclear | Decision | Why |
|---|---|---|---|---|
| D-01 | 2026-10-03 | Test accounts cannot approve/route/fill orders or progress seeded flows (ADA-001/002/024) | Create dedicated test-only personas with the needed roles in the UAT seed; passwords only in git-ignored secrets file | Owner instruction: just create accounts and use them; seed-only, reversible |
| D-02 | 2026-10-03 | Fixing issues in the legacy custodian/onboarding HTML portals while round 4 replaced them with native React | Merge round-4 branches first, fix on the merged code, re-test on the merged code | Avoids fixing code that is deleted and avoids merge conflicts |
| D-03 | 2026-10-03 | QA testers shared one browser cookie jar on localhost, which overwrote sessions | Re-test uses a different hostname alias per tester (localhost / 127.0.0.1 / [::1] / machine name) against the same local stack | Cookies are per host; no code change needed |
| D-04 | 2026-10-03 | UAT API refused to start with fake integrations (WP-8 production guard) | Set ALLOW_FAKE_INTEGRATIONS=1 on UAT only, INTEGRATION_MARKET_DATA=public | Real vendors do not exist yet; UAT only, backup at /root/env.production.bak-rc9 |
| D-05 | 2026-10-03 | Severity names: owner asked for critical/major/minor, testers used blocker/major/minor/polish | Treat blocker = critical, polish = minor in reports | Same meaning, no data loss |
| D-06 | 2026-10-03 | Where seeds create a persona with maker-and-checker the same person (ADA-017) | Fix the seed so checker differs from maker | SoD is a platform rule |
| D-07 | 2026-10-03 | The "no push" instruction after an earlier approved push of dev | Nothing pushed from now until the owner says so; `dev` was pushed earlier (commit 2b4cfea) at the owner's request | Owner's latest instruction wins |
| D-08 | 2026-10-03 | Browser testing was costing too many tokens | Owner stopped ALL browser activity; verification is by builds, type checks, API/unit tests and direct endpoint calls; browser-only items are listed as not browser-verified | Owner instruction; overrides the earlier browser re-test requirement |
