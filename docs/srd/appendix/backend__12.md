# 12 (from the backend draft)

### 12. Integrations as built **[O]**

| Integration | As built | Status | Notes / next step [P] |
| --- | --- | --- | --- |
| Email | Plain-text messages via nodemailer SMTP (`SMTP_*`, `MAIL_FROM`; TLS automatically on port 465). When SMTP is unset, emails go to the worker's console log, including their tokens. Delivered only through the outbox worker, with retry. | Built (transport). No templates, DKIM/SPF, bounce handling or HTML. | Configure SMTP in production; add templates and bounce tracking; never log bodies. |
| KYC/AML screening | In-process stub `stub-screening-v1` run by the worker. Sanctions from a fixed watch-list of names; PEP from the applicant's declaration; adverse media from a high-risk country list; document check by file count. Produces a risk rating and advisory results only. | Stubbed | Select a vendor; add the `POST /api/v1/webhooks/screening` HMAC webhook; keep the result advisory. |
| Object storage | Local disk volume (`STORAGE_DIR`, Compose volume `file-storage`), AES-256-GCM per object, SHA-256 recorded, HMAC-signed 5-minute download URLs. | Built (local). S3-compatible storage not started. | Move to S3-compatible, versioned storage; keep the same encryption and signed-URL contract. |
| Malware scanning | none | Not started | ClamAV/ICAP quarantine before files become downloadable. |
| TOTP MFA | In-house RFC 6238 (SHA-1, 6 digits, 30 s, ±1 step drift); secret encrypted at rest. | Built | WebAuthn optional (Q-21). |
| E-signature | In-house: signer, authority, consent, MFA time, document SHA-256, IP. | Built (in-house) | Q-20 unchanged. |
| SMS / OTP | none | Not started | — |
| ZSE / VFEX market data | none | Not started | — |
| Broker executions / instructions | none | Not started | — |
| Custodian feeds | none (the custodian portal is a static prototype) | Not started | — |
| Operating bank (CAMT.053) | none | Not started | — |
| FX rates | FX map imported with each investor snapshot. | Stubbed (manual import) | Approved rate source (BR-018). |
| LLM (copilot) | none | Not started | — |
| Regulators | none | Not started | — |
