# 9.6 (from the backend draft)

### 9.6 Error handling **[O]**

- Envelope: `{ "error": { "code": "snake_case", "message": "Human readable", "details"?: … } }`.
- Validation failures: 400 `bad_request`, message "Validation failed", `details: [{ path, message }]`.
- 5xx responses never carry a stack trace in production; outside production they include `details.stack`.
- Every response carries `X-Request-Id`.
- Rate-limited responses: 429 `rate_limited`, with IETF draft-7 `RateLimit` headers.

| Status | Codes in use |
| --- | --- |
| 400 | `bad_request` (includes validation), `invalid_json`, `incomplete_application` |
| 401 | `unauthorized`, `invalid_credentials`, `mfa_required`, `invalid_mfa_code`, **`step_up_required`**, **`mfa_enrolment_required`** |
| 403 | `forbidden`, `permission_denied`, `portal_access_denied`, `origin_not_allowed`, `registration_disabled`, `compliance_role_required`, `role_locked`, `invalid_signature`, `no_client_access`, `no_company_access`, `sod_violation` (capital, snapshot, document, reporting pack) |
| 404 | `not_found` (also used for out-of-scope investor and company ids, and for bad or expired draft tokens) |
| 409 | `conflict`, `email_taken`, `version_conflict`, `invalid_transition`, `invalid_state`, `approval_blocked`, `activation_blocked`, `sod_violation` (KYC, cash account), `already_submitted`, `already_member`, `mfa_already_enrolled`, `self_lockout`, `self_reset`, `last_admin`, `duplicate` |
| 413 | `payload_too_large` |
| 429 | `rate_limited` |
| 500 | `internal_error` |
| 503 | Health check only (`status: degraded`) |

- **DEF-509** Step-up and MFA-enrolment failures return **401** (`step_up_required`, `mfa_enrolment_required`), but earlier text of this section and FR-AUTH-011 specify 403. Decide which is canonical. The admin bridge already reacts to the 401.
- **DEF-510** `sod_violation` is 409 in KYC and cash accounts but 403 elsewhere. Earlier text of this section names `maker_checker_violation` with 409. Unify the code and status.
- **DEF-511** `validation_failed`, `locked` (423) and `dependency_unavailable` (503) are specified but not implemented. Validation errors use `bad_request`.
- **DEF-512** Two routes (investor create-request, document upload) return raw zod issues in `details` instead of `{path, message}`.
