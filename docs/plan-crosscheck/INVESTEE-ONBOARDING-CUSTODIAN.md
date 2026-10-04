# Plan cross-check: investee (FR-CMP), onboarding (FR-ONB), custodian, business rules 5D

Code audit, read-only, no browser. "unverified" = looked, could not confirm in code. The register has FR-CMP-008..048 (41) and 32 FR-ONB ids (016..047) in this slice.

## Counts (built / partial / missing / adapter / n-a)
| Slice | Built | Partial | Missing | Adapter | N/A |
|---|---|---|---|---|---|
| FR-CMP-008..048 (41) | 29 | 11 | 1 | 0 | 0 |
| FR-ONB-016..047 (32) | 22 | 8 | 2 | 0 | 0 |
| FR-AUTH-018 custodian access | 1 | 0 | 0 | 0 | 0 |
| 5E custodian headline functions (7) | 5 | 1 | 0 | 1 | 0 |
| 5D business rules BR-246..276 (31) | 13 | 17 | 1 | 0 | 0 |

Global caveat: the company-web investee UI is the V8 mock runtime (components/investee-portal-v8-mock) fed by a live payload; pages go live only when the matching API keys are live (INVESTEE_LIVE_ACTIONS, default off, TODO M9). Unmatched investee endpoints return 501 (investee.routes.ts line 1100).

## FR-CMP partial / missing (CMP-035 is Missing, the rest Partial)
| id | requirement | what exists | what is missing | evidence |
|---|---|---|---|---|
| CMP-009 | No mock mode in production; Demo ribbon | DemoRibbon component, liveOnly set when any page live | production guard forcing liveOnly not found (unverified) | portals/company-web/src/components/InvesteePortal.tsx, DemoRibbon.tsx |
| CMP-016 | Server drafts, 409 version_conflict | PUT /reporting/requests/:period/draft, POST /financial-reports/:kind/draft | no version_conflict in investee module | backend/api/src/modules/investee-portal/investee.routes.ts |
| CMP-018 | Correct .xlsx templates via signed URL, with template version | GET /financial-reports/template/:type, header lists per type | no xlsx writer or version stamp found (unverified) | investee.routes.ts:167 |
| CMP-019 | Submit blocked for BS imbalance, missing attachments, >50% revenue fall | submit routes, mandatory items | no balance-sheet equation or variance-note check, no BR-251/252 messages | investee.service.ts, company.service.ts |
| CMP-021 | Actuals from accepted reports only, locked, `locked` error | forecast month lock/unlock endpoints | auto-population from accepted reports and server `locked` refusal unverified | investee-portal/workspace/workspace.routes.ts:105 |
| CMP-030 | Reserved matters maintained by staff per company | list shown in term sheet | hard-coded constant RESERVED_MATTERS, no staff-maintained table or UI | investee-portal/workspace/records.ts:147 |
| CMP-033 | Staff configure signing authorities | signingAuthority/title on CompanyUser, gates sign-off | staff screen to configure per company unverified | investee-portal/remainders/signoff.ts |
| CMP-035 | Tranche panel, blocks over-draw with exact message | /procurement GET/POST | committed/reserved/available calc and over-draw refusal not found | investee.routes.ts:1032 |
| CMP-036 | Drill-down thread with evidence answers | question threads, board action evidence | drill-down request on a drawdown item and "Drill-down requested" state not found | investee-portal/workspace/records.ts |
| CMP-038 | Vault upload, version, share, download, access profiles | GET/POST /vault, content-type byte check | FIXES-LOG INO-021: download/preview/delete not built; versioning and access-profile filtering unverified | docs/FIXES-LOG.md |
| CMP-044 | External-access log from audit events | GET /access, access-review model | no query of document.downloaded / reporting.file.downloaded events found | investee.routes.ts, schema.prisma InvesteeAccessReview |
| CMP-046 | Security card with real MFA state and session timeout | mfaEnabled in profile payload | session timeout not surfaced (unverified) | investee.routes.ts:189 |

## FR-ONB partial / missing (ONB-024 and ONB-034 are Missing, the rest Partial)
| id | requirement | what exists | what is missing | evidence |
|---|---|---|---|---|
| ONB-022 | Persist due date, escalation, channel; honour in email and SLA | SLA due computed per stage (slaDue) | staff-set due date and escalation inputs not found | backend/api/src/modules/kyc/kyc.routes.ts:159-200 |
| ONB-023 | Persist suitability inputs; Mandate donut from mandate state | riskProfile, liquidityNeed columns | donut/mandate state wiring unverified | prisma/schema.prisma OnboardingApplication |
| ONB-024 | Dual-control warning before becoming preparer | server enforces kyc_dual_control on decision | confirm text "You will not be able to record the decision" absent from UI | kyc.routes.ts:293; grep portals |
| ONB-026 | Pre-select case, badge, real case-pack export | queue, badge data | case-pack export (manifest, hashes, rationale) endpoint not found | kyc.routes.ts |
| ONB-029 | Typed columns for step-1 fields | many typed columns | incorporation date, regulator, licence ref, website, registered address held in formData JSON | schema.prisma, kyc/public-form.ts |
| ONB-032 | Tax and funding account typed; DRAFT bank account | TIN encrypted (taxIdEnc), bank account encrypted in formData, draft cash account at activation | FATCA/GIIN/CRS and SWIFT/currency in JSON; no draft bank account record from the funding account | kyc.service.ts:370 |
| ONB-033 | Single slot catalogue (label, help, types, required-by) via API | /onboarding/meta (slots key+label, requiredSlots per type) | help text and accepted types not in catalogue | kyc/public-extra.routes.ts:66 |
| ONB-034 | Server OCR with candidate suggestions | none | no OCR code in kyc or portals/onboarding-web | grep ocr |
| ONB-038 | Declaration stores name, capacity, consent version, time, IP, UA | name, version, timestamp | IP and user agent capture unverified | kyc/public.routes.ts:377 |
| ONB-040 | Receipt email matches success panel ref | ref issued on submit | receipt email on submit unverified | kyc/public.routes.ts |

## FR-AUTH-018 and custodian portal (5E)
Built: invite grant kind custodian, login/invite/reset-password pages, counterparty-scoped routes, execution submit, bulk CSV with control totals, amend/cancel with reason, day-end submit/approve, statements, users. MFA on custodian login unverified.
| id | requirement | what exists | what is missing | evidence |
|---|---|---|---|---|
| 5E-feed (ADAPTER) | Custodian SWIFT/API/MT535-536/CAMT.053 feed | file-drop feed plus fake adapter, CSV/JSON only | real integration and message parsing need a vendor (TODO M10) | docs/TODO.md, modules/custodian |
| 5E-dayend | Day-end control-total validation | count and totals in bulk path | validation beyond trade count for the day-end package unverified | custodian.ops.ts, GAP-018 |

## 5D business rules, partial / missing (BR-270 Missing, rest Partial)
| id | requirement | what exists | what is missing | evidence |
|---|---|---|---|---|
| BR-246 | Only open-request period; exact message | period model, submit routes | exact message not in code | grep backend/api/src |
| BR-249 | Edit only DRAFT/NEEDS_REVISION/REJECTED by owner | draft routes | "Report does not belong to you" not found | investee.service.ts |
| BR-250 | Numeric strictness, churn >1 as percent | zod schemas | message and churn rule unverified | investee.contract.ts |
| BR-251 | Balance sheet equation check | BS draft kind | no tolerance check or message | investee.service.ts |
| BR-252 | Revenue-fall variance note | none | not found | investee.service.ts |
| BR-254 | Notify staff; VIEWED_BY_INVESTEE receipts throttled 15 min | submit notifies, mail log | read-receipt events not found | investee-portal/remainders/mail.ts |
| BR-257..261 | KPI formulas | partial (grossProfit at investee.service.ts:459) | full formula set and formulasVersion unverified | investee.service.ts |
| BR-263..265 | Forecast maths server-validated | cells and locks stored | server validation of totals and scenario summaries unverified | workspace/insights.ts |
| BR-270 | Tranche committed/reserved/available | none | not found | investee-portal |
| BR-271..273 | Drawdown validation, ledger approval, resubmission fingerprint | procurement POST, requisitions table | validations and fingerprint rule unverified | workspace/records.ts |

Top gaps: no tranche/over-draw control (CMP-035, BR-270); no server checks for balance-sheet equation, revenue-fall variance, owner-only editing (CMP-019, BR-249..252); no OCR (ONB-034).
