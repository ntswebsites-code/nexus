# STATE MACHINES (from the 5D draft)

Who triggers: **C** = company user, **S** = fund staff, **SYS** = system/scheduler.

**1. Applicant / application (NVCCZ pipeline; Nexus scope is Q-NEW)**
```mermaid
stateDiagram-v2
  [*] --> SCREENING_PENDING
  SCREENING_PENDING --> SCREENING: S start screening
  SCREENING --> REJECTED_SCREENING: S score below minimum
  SCREENING --> SHORTLISTED: S shortlist
  SHORTLISTED --> ACTIVE_DD: S initiate due diligence
  ACTIVE_DD --> DUE_DILIGENCE_COMPLETED: S complete DD (gate)
  DUE_DILIGENCE_COMPLETED --> TERM_SHEET: S create term sheet (provisions company + user)
  TERM_SHEET --> TERM_SHEET_NEGOTIATION: S counter-offer
  TERM_SHEET --> UNDER_BOARD_REVIEW: both parties signed
  TERM_SHEET_NEGOTIATION --> UNDER_BOARD_REVIEW: both parties signed
  UNDER_BOARD_REVIEW --> BOARD_APPROVED: S board decision
  UNDER_BOARD_REVIEW --> BOARD_CONDITIONAL: S
  UNDER_BOARD_REVIEW --> BOARD_REJECTED: S
  BOARD_APPROVED --> INVESTMENT_IMPLEMENTATION: S initiate
  INVESTMENT_IMPLEMENTATION --> DISBURSED: S release tranche (compliance cleared, KYC verified)
  DISBURSED --> FUNDED: S all tranches
  FUNDED --> PORTFOLIO_MANAGEMENT: S
```
Guards: create term sheet only in TERM_SHEET or TERM_SHEET_NEGOTIATION; the company account (user + company) is created idempotently at term-sheet creation; progress % shown to the company: SUBMITTED 5, SCREENING_PENDING 5, SCREENING 10, PENDING_SHORTLISTING 5, SHORTLISTED 10, ACTIVE_DD/UNDER_DUE_DILIGENCE 20, DUE_DILIGENCE_COMPLETED 30, TERM_SHEET 40, TERM_SHEET_NEGOTIATION 45, UNDER_BOARD_REVIEW 50, BOARD_CONDITIONAL 55, BOARD_APPROVED 60, INVESTMENT_IMPLEMENTATION 70, DISBURSED 85 + 15 × (Σ DISBURSED / requested) (100 when fully disbursed), FUNDED 95, PORTFOLIO_MANAGEMENT 100, rejected stages 0.

**2. Term sheet**
```mermaid
stateDiagram-v2
  [*] --> DRAFT: S create (stage TERM_SHEET)
  DRAFT --> DRAFT: S edit
  DRAFT --> FINAL: S finalise (notifies company)
  FINAL --> FINAL: C signs OR S signs (one signature each, immutable)
  FINAL --> SIGNED: second party signs
  SIGNED --> [*]
```
Guards: signing requires FINAL; a party cannot sign twice; no update/finalise once any signature exists or `isSigned`; company signs as `applicant` (e-mail equals the deal's applicant e-mail), fund signs as `investor` (admin or fund manager). On SIGNED while the deal is at TERM_SHEET/TERM_SHEET_NEGOTIATION → deal moves to UNDER_BOARD_REVIEW (email + memo + execution pack). **[P]** Nexus adds states Issued (visible to company) and Expired/Withdrawn.

**3. Financial report (typed statement) — NVCCZ**
```mermaid
stateDiagram-v2
  [*] --> DRAFT: C create draft (requires open reporting request)
  DRAFT --> DRAFT: C edit data / attach file
  DRAFT --> PENDING: C submit bundle
  NEEDS_REVISION --> PENDING: C resubmit
  REJECTED --> PENDING: C resubmit
  PENDING --> ACCEPTED: S accept (core statements need accounting payload)
  PENDING --> REJECTED: S reject
  PENDING --> NEEDS_REVISION: S request revision
  ACCEPTED --> NEEDS_REVISION: SYS post-accept sync failure
```
Guards: edits and file replacement only in DRAFT, NEEDS_REVISION, REJECTED; submit validates open request, balance, numeric, variance; reviewer must have submitted-state report (DRAFT cannot be reviewed); **[P]** reviewer ≠ submitter, return needs a note (Nexus).

**3b. Reporting period (Nexus, enforced today)**
```mermaid
stateDiagram-v2
  [*] --> open: S open period (due date, mandatory attachments)
  open --> submitted: C submit (all required items present; variance rules)
  returned --> submitted: C resubmit
  submitted --> accepted: S accept (reviewer != submitter)
  submitted --> returned: S return (note required)
```
Item: Due → Complete on first file; Complete → Due when the last file is removed; Accepted files cannot be deleted.

**4. Requisition / drawdown request**
```mermaid
stateDiagram-v2
  [*] --> DRAFT: C create (amount within tranche)
  DRAFT --> PENDING_VC_EXECUTIVE_REVIEW: C submit (use-of-funds attached, tranche re-check)
  PENDING_VC_EXECUTIVE_REVIEW --> DRAFT: C cancel
  PENDING_VC_EXECUTIVE_REVIEW --> APPROVED: S VC CFO or SYSADMIN
  PENDING_VC_EXECUTIVE_REVIEW --> REJECTED: S reject with reason
  PENDING_VC_EXECUTIVE_REVIEW --> RETURNED: S return for information
  REJECTED --> PENDING_VC_EXECUTIVE_REVIEW: C resubmit (content must change)
  RETURNED --> PENDING_VC_EXECUTIVE_REVIEW: C resubmit (content must change)
  APPROVED --> RFQ_SENT: SYS auto RFQ top 5 vendors
  RFQ_SENT --> CONVERTED_TO_PO: S award and PO
  CONVERTED_TO_PO --> [*]: goods received (GRN) and paid
```
Reservation: PENDING_VC_EXECUTIVE_REVIEW, PENDING_APPROVAL, APPROVED, RFQ_SENT, CONVERTED_TO_PO hold the drawdown; DRAFT, REJECTED, CANCELLED, RETURNED release it. V8 columns map: Draft = DRAFT/REJECTED/RETURNED/CANCELLED; Under review = PENDING_*; Approved = APPROVED/RFQ_SENT; Fulfilled = CONVERTED_TO_PO + received.

**5. Signature request [P]**
```mermaid
stateDiagram-v2
  [*] --> Pending: C or S request (document locked copy)
  Pending --> PartiallySigned: first signatory signs
  PartiallySigned --> Signed: last signatory signs (certificate issued, document locked)
  Pending --> Declined: signatory declines (reason)
  PartiallySigned --> Declined: signatory declines
  Pending --> Cancelled: requester voids
  Pending --> Expired: SYS due date + grace passes
  Declined --> [*]
```
Guards: signatory must be named and within the authority matrix; step-up MFA ≤ 5 min; consent ticked; signature image present; sequential order enforced when selected; reminders only while Pending/PartiallySigned.

**6. Consent request (governance) [P]**
```mermaid
stateDiagram-v2
  [*] --> Draft: C
  Draft --> Submitted: C submit (memo + category + decision date)
  Submitted --> InformationRequested: S asks questions
  InformationRequested --> Submitted: C responds
  Submitted --> InvestorReview: S assigns
  InvestorReview --> BoardReview: S escalates
  InvestorReview --> Approved: S decision
  BoardReview --> Approved: S decision
  InvestorReview --> Rejected: S decision (reason)
  BoardReview --> Rejected: S decision (reason)
  Submitted --> Withdrawn: C withdraw
```
Guards: decision requires a reason; company cannot edit after submit; decision notifies the requester.

**7. Message thread [P] (aligned with Nexus questions)**
```mermaid
stateDiagram-v2
  [*] --> open: C or S create thread
  open --> open: C or S post message
  open --> resolved: C or S resolve
  resolved --> [*]
```
Guard: replies blocked when resolved (409 `invalid_state`); reopen not allowed (Q-NEW).

**8. Cap table transaction (NVCCZ)**
```mermaid
stateDiagram-v2
  [*] --> DRAFT: S create issuance or transfer
  DRAFT --> PENDING_APPROVAL: S submit
  PENDING_APPROVAL --> EXECUTED: S approver executes (GL post + certificate + sync)
  DRAFT --> REJECTED: S
  PENDING_APPROVAL --> REJECTED: S
  EXECUTED --> PENDING_APPROVAL: SYS post-execution side-effect failure (rollback)
```

**9. Forecast version [P]**
```mermaid
stateDiagram-v2
  [*] --> draft: C new working version from latest submitted
  draft --> submitted: C approver submits (approver != preparer)
  submitted --> accepted: S accept
  submitted --> returned: S return with note
  returned --> draft: C edit
  accepted --> superseded: next version accepted
```
Month cell lifecycle: forecast → actual-open (current month) → actual-locked (after acceptance or close day).
