# Status board

States: in progress · awaiting re-test · passed · failed · blocked. Updated by the lead agent as work moves.

## Workstream A: QA issues (115 found: see docs/issues/ISSUES-*.md)

| Group | Issues | Owner | State |
|---|---|---|---|
| F1 Fund ops, cash, capital calls, notices, custodian counts | ADA-015/017/021/022/023/025/026/027, ADA-031, ADB-... | fix agent F1 | queued |
| F2 Orders, NAV, accounting, risk, Today | ADA-005..014/016/018/020, ADB-... | fix agent F2 | queued |
| F3 Personas, auth, shell, roles, settings, shared errors | ADA-001..004/024/028/029, ADB-012/014/020/021/026/027/028 | fix agent F3 | queued |
| F4 Market data, securities, integrations | ADA-008/013/019, ADB-022/024 | fix agent F4 | queued |
| F5 IBOR, performance, portfolio lab, private markets, research | ADB-001..011/023 | fix agent F5 | queued |
| F6 Clients, services, vault, reports, regulatory, data, models, staff e-sign | ADB-013..019/025 | fix agent F6 | queued |
| F7 Investee portal | INO-001..021/028..030 | fix agent F7 | queued |
| F8 LP portal | LPC-001..010/022..026 | fix agent F8 | queued |
| F9 Custodian + onboarding + password reset | LPC-011..021, INO-022..027 | fix agent F9 | queued |
| Supervisor | reviews each fix for root cause and scope | supervisor agent | queued |
| Watchdog | detects failed/stalled agents, relaunches | watchdog agent | queued |

## Workstream B: next stages

| Stage | Owner | State |
|---|---|---|
| Round 4 feature packages R4-1..R4-10 | merged into feat/admin-recon-nav | typecheck verifying |
| Deploy uat-rc10 (after fixes pass) | lead | blocked on fixes |
| Turn live-data flags on in UAT | lead | blocked on deploy |
| Real vendors behind adapters | owner (later) | not started |
