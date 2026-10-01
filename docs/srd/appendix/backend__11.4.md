# 11.4 (from the backend draft)

### 11.4 Outbox events **[O]** (as built)

Events are written to `outbox_events` in the same transaction as the business change and delivered by the worker. The worker polls every 2 s, handles batches of 25, backs off exponentially and gives up after 8 attempts. Delivery is at-least-once and not idempotent.

| Event type | Consumer (worker handler) | Emitted by |
| --- | --- | --- |
| `email.send` `{to, subject, text}` | SMTP mailer, or console log when SMTP is unset | Password reset link; invitation (7-day link); onboarding draft resume link; application received; evidence request (14-day link); message to applicant; application declined |
| `notify.permission` `{permission, type, title, body?, link?, email?}` | Resolves every active user holding the permission, then creates in-app notifications (and emails when `email` is set) | Permission `onboarding.manage`: application.submitted, kyc.review, kyc.evidence.received, kyc.case.decided. `cash.approve`: cash_account.pending, capital.approval, capital.funding_evidence. `clients.edit`: service_request.created, message.received, document.signed. `documents.edit`: document.review. `reports.create`: snapshot.review. `research.edit`: reporting.submitted, reporting.question.reply |
| `notify.users` `{userIds, type, title, body?, link?, email?}` | In-app notification per active user, plus optional email | Client members: capital.published (email), capital.settled, snapshot.published, service_request.updated (email on Waiting on you / Closed), message.received (email), document.published (email). Company users: reporting.review (period opened, pack accepted/returned, question raised/replied) |
| `kyc.screening.requested` `{caseId}` | Screening stub: writes 4 results, rates risk, moves Screening to ComplianceReview, adds a timeline entry, audits, notifies `onboarding.manage` | Public submit, assisted create, screening refresh |

The domain events proposed earlier in this section (`order.*`, `cash.journal.posted`, `nav.released`, and so on) are **not built**. The outbox currently carries side-effect commands only, not a domain-event stream.
