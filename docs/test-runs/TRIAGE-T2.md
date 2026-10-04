# TRIAGE-T2 (RUN-2026-10-04 failures: custodian-ops, ws4, onboarding, investee-workspace, investee-remainders)

Verdicts: (a) real bug, (b) stale test, (c) environment / harness.

## test-custodian-ops (7)
Root cause for all 7: F3 "SoD-clean roles" gave the shipped custodian `approver` role `custodian.executions.submit`
(prisma/seed/role-catalog.json), so the approver can amend. The test assumed an approver cannot. The approver's
successful amend changed price 0.26 -> 0.27, which cascaded into history, day-end notional and approval.
| check | verdict | note |
|---|---|---|
| bulk: batch list shows accepted and rejected | (b) stale | The control-total-mismatch file is kept as a Rejected batch (evidence, by design); list is Accepted + 2 Rejected, test expected 2 rows. Now asserts the statuses. |
| amend: approver without submit permission -> 403 | (b) stale | Role now carries submit. Test uses a throwaway portal-access-only role (user "ro"). Business rule (requirePermission) is unchanged and still enforced. |
| history: submitted then amended | (b) cascade | approver amend no longer happens. |
| day-end: matching declared totals submit | (b) cascade | notional was based on 0.26. |
| day-end: second user approves | (b) cascade | package stayed draft. |
| approved day-end freezes executions | (b) cascade | no approved package. |
| day-end history | (b) cascade | same. |
Change: backend/api/scripts/test-custodian-ops.ts. Re-run: 32 pass, 0 fail.

## test-ws4 (3)
submit -> ONB reference, second submit -> 409, KYC case created: (b) stale. The native onboarding rewrite requires at least
one director / trustee / governing person for entity applicants (v65Missing in src/modules/kyc/public-form.ts), so
`incomplete_application` is correct. Test now sends `directors` on PATCH and submit. The second-submit and KYC-case
checks failed only because the first submit failed. Re-run: 69 pass, 0 fail.

## test-onboarding (crash, then 2 more once it could run)
(c) harness: part 2 used API_URL (default localhost:4100) and ignored E2E_API; the harness runs the API in a sibling
container. Now `E2E_API ?? API_URL ?? default`.
Once the flow ran, two checks failed: "infected upload rejected 422 malware_detected" and "rejection is audited" -> (b) stale.
F9 evidence content sniffing rejects a `.pdf` whose bytes are not a PDF (400 content_type_mismatch) before the antivirus
scan; the test sent the bare EICAR string. The test string now carries a `%PDF-1.4` header so it reaches the scanner. Rule unchanged.
Re-run: 30 pass, 0 fail.

## test-investee-workspace (12)
| check | verdict | note |
|---|---|---|
| each signer has a link [0,0] + 7 dependants (signer page, consent, sign, twice, complete, stale after reminder, voided) | (b) stale | Signer e-mails now go through queueInvesteeMail -> outbox event `investee.mail` (was `email.send`), so the token lookup found nothing and every public call went without a token. Test reads `investee.mail`. Also INO-012: the typed name must equal the invited name, so signers are now "Ada Lovelace" / "Ben Okoye" (test signs with those names). |
| a share link is issued once | (b) stale | INO-014: `url` is the portal landing page `/sign/share/<token>`; the watermarked API download is `fileUrl`. Test asserts both and fetches `fileUrl`. |
| link serves watermarked file / access counted / revoked link 410 | (b) cascade | the test fetched the Next landing page (HTML) instead of the file. |
Change: backend/api/scripts/test-investee-workspace.ts.

## test-investee-remainders (refused to run, then 14 fail + crash, then 2)
Real defect found (a): `backend/api/src/modules/ops/ops.routes.ts` mounted `/investee-review` AFTER the catch-all
`opsRoutes.use(() => throw 501 not_implemented)`, so every staff review/sign-off endpoint answered 501 (cap table, forecast,
governance, reviews, signoffs, company overview). FIX: mount it before the catch-all (next to `/investee-requests`).
Cascade (a): review/stale/query/audit/sign-off request/duplicate/signers checks and the crash in signRequest (no request existed).
(b) stale: "public file is a watermarked PDF" read `url` (now the portal landing page, INO-014); it now fetches `fileUrl`.
(c) harness: the script signs the e-sign request in its own process, so the sign-off completion hook (registered when
`remainders/signoff` loads, normally in the API process) was not registered and the sign-off stayed COMPLETED/REQUESTED
("completion hook marks the sign-off SIGNED", "a signed-off period cannot be requested again"). The script now imports the module.
Also (c): refuses without E2E_CONFIRM=local to run without E2E_CONFIRM=local and needs seed-uat personas + users file. The harness case list
(CONF=local plus seed-uat and users-file mounts, same as test-investee-workspace) now includes it (server-side harness
copy /root/sf-t2.sh; the shared /root/server-flows.sh is not modified by this work package).
