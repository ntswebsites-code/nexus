# 9.1 (from the backend draft)

### 9.1 Current architecture **[O]** (30 Sep 2026)

```mermaid
flowchart TB
  subgraph browsers [Browsers]
    b1[Admin 3100 legacy UI, bridge ON]
    b2[Investor 3101 V59 prototype, bridge OFF]
    b3[Onboarding 3102 prototype, bridge OFF]
    b4[Company 3103 native React]
    b5[Custodian 3104 static prototype]
  end
  subgraph api [Express API 4100]
    auth[auth: login, MFA, reset, invitations]
    v1[v1 modules: public onboarding, KYC, clients, documents, investor, investor staff, company, private markets, admin, notifications, files]
    audit[audit hash chain]
    outbox[outbox writer]
  end
  worker[Outbox worker: notifications, email, screening stub]
  db[(MySQL 8, 55 tables)]
  fs[(Encrypted file store volume, AES-256-GCM)]
  smtp[SMTP or console log]
  b1 -->|cookie session, origin guard| api
  b4 --> api
  b2 -. login only .-> api
  b3 -. not wired .-> api
  b1 -.-> ls1[(localStorage for unmigrated pages)]
  b2 -.-> ls2[(in-memory demo data)]
  b3 -.-> ls3[(localStorage and IndexedDB)]
  b5 -.-> ls4[(localStorage)]
  api --> db
  api --> fs
  worker --> db
  worker --> smtp
  b1 -->|signed download URL| fs
```

The signed download URL is served by the API's `/api/v1/files/:id/download` route (drawn directly to the store for clarity). Portal login/MFA/invite pages come from the shared `portal-kit` and call `/api/auth/*` on every portal, including investor and onboarding.
