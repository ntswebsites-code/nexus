/**
 * Public onboarding (R4-6) checks.
 *
 * Part 1 needs no database or API: form mapping for directors, entity rules, owner/director round trip.
 * Part 2 needs a disposable MySQL with migrations applied AND the API running on API_URL
 * (default http://localhost:4100) with INTEGRATION_AV_SCAN=fake; it runs only with E2E_CONFIRM=throwaway-db:
 * create draft -> autosave -> upload (clean, EICAR rejected) -> incomplete submit refused -> submit ->
 * admin loop-back (simulated in the DB exactly as POST /kyc/cases/:id/request-evidence writes it) ->
 * tracker -> applicant upload auto-returns to review -> reply idempotency -> magic link single use.
 *
 *   npx tsx scripts/test-onboarding.ts
 *   E2E_CONFIRM=throwaway-db npx tsx scripts/test-onboarding.ts
 */
process.env.DATABASE_URL ??= 'mysql://test:test@localhost:3306/test';

export {};

let failures = 0;
const check = (name: string, cond: unknown, detail?: unknown) => {
  if (cond) console.log(`  PASS  ${name}`);
  else {
    failures++;
    console.log(`  FAIL  ${name}`, detail === undefined ? '' : JSON.stringify(detail));
  }
};

async function offline() {
  console.log('form mapping');
  const { mapPublicForm, applicantFormView, v65Missing } = await import('../src/modules/kyc/public-form');
  const dirs = [{ name: ' Jane Moyo ', role: 'Director', email: 'jane@example.test' }, { name: '', role: '', email: '' }];
  const { formData } = mapPublicForm({ legalName: 'Acme Pension Fund', primaryEmail: 'ops@example.test' }, { directors: dirs }, null);
  check('directors trimmed and blanks dropped', Array.isArray(formData.directors) && (formData.directors as unknown[]).length === 1 && (formData.directors as { name: string }[])[0]!.name === 'Jane Moyo', formData.directors);
  const kept = mapPublicForm({ legalName: 'Acme Pension Fund' }, {}, formData);
  check('directors survive a PATCH that omits them', Array.isArray(kept.formData.directors) && (kept.formData.directors as unknown[]).length === 1);
  const view = applicantFormView(formData);
  check('applicant view returns directors', view.directors.length === 1 && !('directors' in view.form));

  console.log('entity rules');
  const base = { formVersion: 'v65', legalName: 'A', registrationRef: 'R', jurisdiction: 'ZW', registeredAddress: 'x', primaryEmail: 'a@b.test', primaryContact: 'C', sourceFundsNarrative: 'n', expectedActivity: 'n', taxResidence: 'ZW', bankName: 'B', bankHolder: 'A', bankCountry: 'ZW', bankAccountEnc: 'enc', signatureName: 'S', signatureCapacity: 'D', signatories: [{ name: 'S' }] };
  check('entity without directors is incomplete', v65Missing(base, 1, 'Trust / foundation').some((m) => /director/i.test(m)));
  check('entity with directors is complete', v65Missing({ ...base, directors: [{ name: 'D' }] }, 1, 'Trust / foundation').length === 0);
  check('individual needs no directors', v65Missing(base, 1, 'Individual / HNW').length === 0);
  check('no owners is incomplete', v65Missing(base, 0, 'Individual / HNW').some((m) => /beneficial owner/i.test(m)));
}

const API = (process.env.E2E_API ?? process.env.API_URL ?? 'http://localhost:4100').replace(/\/+$/, '');

async function http<T>(path: string, init: { method?: string; token?: string; body?: unknown; form?: FormData } = {}): Promise<{ status: number; body: T }> {
  const headers: Record<string, string> = {};
  if (init.token) headers['X-Draft-Token'] = init.token;
  if (init.body !== undefined) headers['Content-Type'] = 'application/json';
  const res = await fetch(`${API}/api/v1/public${path}`, { method: init.method ?? 'GET', headers, body: init.form ?? (init.body !== undefined ? JSON.stringify(init.body) : undefined) });
  const text = await res.text();
  return { status: res.status, body: (text ? JSON.parse(text) : {}) as T };
}
const file = (slot: string, name: string, content: string, mime = 'application/pdf') => {
  const fd = new FormData();
  fd.set('slot', slot);
  fd.set('file', new Blob([content], { type: mime }), name);
  return fd;
};

async function online() {
  const { prisma } = await import('../src/lib/prisma');
  const email = `onb-${Date.now()}@example.test`;
  type Err = { error?: { code?: string; details?: { fields?: string[]; evidence?: string[] } } };

  console.log('meta');
  const meta = await http<{ investorTypes: { value: string; entity: boolean; requiredSlots: string[] }[]; slots: unknown[] }>('/onboarding/meta');
  check('meta lists entity types with required slots', meta.status === 200 && meta.body.investorTypes.some((t) => t.entity && t.requiredSlots.length >= 9));

  console.log('draft');
  const created = await http<{ id: string; token: string }>('/applications', { method: 'POST', body: { email, applicantType: 'Trust / foundation', name: 'Flow Test Trust' } });
  check('draft created', created.status === 201 && !!created.body.token, created);
  const { id, token } = created.body;
  const form = { formVersion: 'v65', investorType: 'Trust / foundation', legalName: 'Flow Test Trust', registrationRef: 'T-100', jurisdiction: 'Zimbabwe', registeredAddress: '1 Test Rd', primaryEmail: email, primaryContact: 'Tess Tester', sourceFundsNarrative: 'Trust capital', expectedActivity: 'Quarterly subscriptions', taxResidence: 'Zimbabwe', taxId: 'TX-999', bankName: 'Test Bank', bankHolder: 'Flow Test Trust', bankCountry: 'Zimbabwe', bankAccount: '1234567890', signatureName: 'Tess Tester', signatureCapacity: 'Trustee', pep: 'no' };
  const people = { owners: [{ name: 'Owen Owner', nationality: 'ZW', id: 'ID-1', pct: '60' }], signatories: [{ name: 'Tess Tester', role: 'Trustee', email }] };
  const patched = await http('/applications/' + id, { method: 'PATCH', token, body: { form, ...people, directors: [{ name: 'Dora Director', role: 'Trustee', email: '' }] } });
  check('autosave ok', patched.status === 200, patched);
  const wrong = await http('/applications/' + id, { token: 'nope' });
  check('wrong token is 404', wrong.status === 404);
  const got = await http<{ application: { directors: { name: string }[]; ownerDetails: { name: string }[]; bankAccountOnFile: boolean; form: Record<string, string> } }>('/applications/' + id, { token });
  check('resume restores directors, owners; secrets are not echoed', got.body.application.directors[0]?.name === 'Dora Director' && got.body.application.ownerDetails[0]?.name === 'Owen Owner' && got.body.application.bankAccountOnFile && got.body.application.form.taxId === '');
  await http('/applications/' + id, { method: 'PATCH', token, body: { form: { ...form, taxId: '', bankAccount: '' }, owners: [{ name: 'Owen Owner', nationality: 'ZW', id: '', pct: '60' }] } });
  const owner = await prisma.beneficialOwner.findFirst({ where: { applicationId: id } });
  check('blank owner id on resume keeps the stored one', !!owner?.idNumberEnc);

  console.log('evidence + antivirus');
  // F9 content sniffing rejects a .pdf that is not a PDF before the scanner runs, so the test string keeps a PDF header.
  const eicar = 'X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*';
  const bad = await http<Err>(`/applications/${id}/evidence`, { method: 'POST', token, form: file('doc1', 'virus.pdf', `%PDF-1.4 ${eicar}`) });
  check('infected upload rejected 422 malware_detected', bad.status === 422 && bad.body.error?.code === 'malware_detected', bad);
  const audit = await prisma.auditEvent.findFirst({ where: { objectId: id, action: 'kyc.evidence.rejected_malware' } });
  check('rejection is audited', !!audit);

  console.log('submit gate');
  const early = await http<Err>(`/applications/${id}/submit`, { method: 'POST', token, body: { consent: true } });
  check('submit with missing evidence refused 400 with the missing list', early.status === 400 && (early.body.error?.details?.evidence?.length ?? 0) > 0, early);
  const ok = await http<{ scanStatus: string }>(`/applications/${id}/evidence`, { method: 'POST', token, form: file('doc1', 'a.pdf', '%PDF-1.4 clean') });
  check('clean upload accepted and marked clean', ok.status === 201 && ok.body.scanStatus === 'clean', ok);
  for (const s of meta.body.investorTypes.find((t) => t.value === 'Trust / foundation')!.requiredSlots.filter((s) => s !== 'doc1')) {
    await http(`/applications/${id}/evidence`, { method: 'POST', token, form: file(s, `${s}.pdf`, '%PDF-1.4 ' + s) });
  }
  const sub = await http<{ ref: string }>(`/applications/${id}/submit`, { method: 'POST', token, body: { consent: true } });
  check('submit ok with ONB ref', sub.status === 200 && /^ONB-/.test(sub.body.ref), sub);
  const again = await http<Err>(`/applications/${id}/submit`, { method: 'POST', token, body: { consent: true } });
  check('second submit refused (409)', again.status === 409, again);

  console.log('tracker + loop-back');
  const st1 = await http<{ status: { submitted: boolean; stage: { key: string }; requested: unknown } }>(`/applications/${id}/status`, { token });
  check('tracker shows submitted, nothing requested', st1.body.status.submitted && st1.body.status.stage.key === 'received' && st1.body.status.requested === null, st1.body);
  const c = await prisma.kycCase.findUniqueOrThrow({ where: { applicationId: id } });
  await prisma.$transaction([
    prisma.kycEvidence.update({ where: { applicationId_slot: { applicationId: id, slot: 'doc2' } }, data: { fileId: null, status: 'Missing' } }),
    prisma.kycCase.update({ where: { id: c.id }, data: { stage: 'ClientAction' } }),
    prisma.kycCaseEvent.create({ data: { caseId: c.id, title: 'Evidence requested from applicant', detail: 'Address evidence. Please send a recent utility bill.' } }),
    prisma.kycCaseEvent.create({ data: { caseId: c.id, title: 'Internal risk note', detail: 'must not leak' } }),
  ]);
  const st2 = await http<{ status: { stage: { key: string }; requested: { slots: { key: string }[]; message: string } | null; updates: { title: string }[] } }>(`/applications/${id}/status`, { token });
  check('loop-back visible: action stage, requested slot and message', st2.body.status.stage.key === 'action' && st2.body.status.requested?.slots[0]?.key === 'doc2' && /utility bill/.test(st2.body.status.requested.message), st2.body);
  check('internal events are not exposed', !st2.body.status.updates.some((u) => /Internal/.test(u.title)));
  const r1 = await http<{ duplicate: boolean }>(`/applications/${id}/reply`, { method: 'POST', token, body: { message: 'Bill uploaded, thanks' } });
  const r2 = await http<{ duplicate: boolean }>(`/applications/${id}/reply`, { method: 'POST', token, body: { message: 'Bill uploaded, thanks' } });
  check('reply is idempotent', r1.status === 201 && r1.body.duplicate === false && r2.body.duplicate === true, [r1, r2]);
  await http(`/applications/${id}/evidence`, { method: 'POST', token, form: file('doc2', 'bill.pdf', '%PDF-1.4 bill') });
  const back = await prisma.kycCase.findUniqueOrThrow({ where: { id: c.id } });
  check('applicant upload returns the case to compliance review', back.stage === 'ComplianceReview', back.stage);

  console.log('magic link');
  await prisma.kycCase.update({ where: { id: c.id }, data: { stage: 'ClientAction' } });
  const req1 = await http('/onboarding/resume-link', { method: 'POST', body: { email } });
  const req2 = await http('/onboarding/resume-link', { method: 'POST', body: { email: `nobody-${email}` } });
  check('resume-link answers 202 for known and unknown emails alike', req1.status === 202 && req2.status === 202);
  const mail = (await prisma.outboxEvent.findMany({ where: { type: 'email.send' }, orderBy: { id: 'desc' }, take: 30 })).map((e) => e.payload as { to?: string; text?: string }).find((p) => p.to === email && /resume\?link=/.test(p.text ?? ''));
  const link = mail?.text?.match(/resume\?link=([A-Za-z0-9_-]+)/)?.[1];
  check('email carries a one-time link', !!link);
  if (link) {
    const ex = await http<{ id: string; token: string }>('/onboarding/resume', { method: 'POST', body: { link } });
    check('link exchanges for a fresh draft token', ex.status === 200 && ex.body.id === id && ex.body.token !== token, ex);
    const replay = await http('/onboarding/resume', { method: 'POST', body: { link } });
    check('replayed link is refused', replay.status === 404);
    const stale = await http('/applications/' + id + '/status', { token });
    check('old token no longer works after exchange', stale.status === 404);
    const fresh = await http(`/applications/${id}/status`, { token: ex.body.token });
    check('new token works', fresh.status === 200);
  }
  await prisma.$disconnect();
}

async function main() {
  await offline();
  if (process.env.E2E_CONFIRM === 'throwaway-db') {
    console.log(`\nflow against ${API}`);
    await online();
  } else console.log('\n(flow part skipped: set E2E_CONFIRM=throwaway-db with a disposable DB and the API running)');
  console.log(failures ? `\n${failures} check(s) FAILED` : '\nAll checks passed');
  process.exit(failures ? 1 : 0);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
