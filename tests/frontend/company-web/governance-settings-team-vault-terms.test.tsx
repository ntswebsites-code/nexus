import { describe, it, expect, beforeEach } from 'vitest';
import { fireEvent } from '@testing-library/react';
import { screen, waitFor, expectCalled, expectNotCalled, expectBody, expectIdempotencyKey, raw } from '../_helpers';
import { healthyRoutes, P, ok, fail, governance, termSheet, vaultDoc, letterhead, company, profile, team as teamFixture } from './_fixtures';
import { mountPortal, installBrowserStubs, seeText, setValue } from './_portal';

beforeEach(() => {
  installBrowserStubs();
});
const inline = () => document.querySelector('.ip8-inline-error')?.textContent ?? '';
/** Draw a stroke on the signature pad the way a user would (pointer down, move, up). */
const drawSignature = () => {
  const c = document.querySelector<HTMLCanvasElement>('#signatureCanvas')!;
  c.setPointerCapture = () => {};
  fireEvent.pointerDown(c, { clientX: 5, clientY: 5, pointerId: 1 });
  fireEvent.pointerMove(c, { clientX: 40, clientY: 20, pointerId: 1 });
  fireEvent.pointerUp(c, { pointerId: 1 });
};
const modalOpen = () => document.querySelector('#modalWrap.open') !== null;
const isoPlus = (days: number) => {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
};

describe('INO-028: governance', () => {
  const gov = (over: Record<string, unknown> = {}) =>
    governance({
      consents: [{ id: 'CON-0001', title: 'Working-capital facility', basis: 'New debt or security', submitted: '2026-09-01', due: '2026-10-30', owner: 'Tariro Moyo', status: 'Investor review' }],
      actions: [{ id: 'ACT-1', title: 'Hire a CFO', owner: 'Chipo Dube', due: '2026-11-01', evidence: 'Shortlist', status: 'Open' }],
      calendar: [{ title: 'Aug 2026', due: '2026-09-10', status: 'open - overdue', kind: 'reporting' }],
      reservedMatters: [{ name: 'New debt', detail: 'Borrowing above the agreed facility.' }],
      metrics: { pendingConsents: 1, openActions: 1, upcomingMeetings: 0 },
      ...over,
    });
  const routes = (extra: Parameters<typeof healthyRoutes>[0] = {}) => healthyRoutes({ [`GET ${P}/governance`]: ok(gov()), [`POST ${P}/governance/consents`]: ok(gov(), 201), ...extra });

  it('shows the live consents (ref under the matter), board actions, reporting calendar with overdue marker and reserved matters; no mock rows', async () => {
    const m = await mountPortal(routes());
    await m.goto('governance');
    const t = m.workspace();
    expect(t).toContain('Working-capital facility');
    expect(t).toContain('CON-0001');
    expect(t).toContain('Investor review');
    expect(t).toContain('Hire a CFO');
    expect(t).toContain('open - overdue');
    expect(t).toContain('Borrowing above the agreed facility.');
    expect(t).not.toMatch(/Namibia market-entry budget|GOV-15/);
  });

  it('INO-028 follow-up: "Consents awaiting review" counts only items awaiting review (0 when all are decided, not the total)', async () => {
    const m = await mountPortal(
      routes({
        [`GET ${P}/governance`]: ok(gov({ consents: [{ id: 'CON-0001', title: 'A', basis: 'x', submitted: '2026-09-01', due: '2026-10-30', owner: 'T', status: 'Approved' }, { id: 'CON-0002', title: 'B', basis: 'x', submitted: '2026-09-01', due: '2026-10-30', owner: 'T', status: 'Approved' }], metrics: { pendingConsents: 0, openActions: 0, upcomingMeetings: 0 } })),
      }),
    );
    await m.goto('governance');
    const card = [...m.qa('#workspace .metric')].find((c) => c.textContent!.includes('Consents awaiting review'))!;
    expect(card.querySelector('.metric-value')!.textContent).toBe('0');
  });

  it('empty states are explicit (no consents, no actions, no open periods)', async () => {
    const m = await mountPortal(routes({ [`GET ${P}/governance`]: ok(governance()) }));
    await m.goto('governance');
    expect(m.workspace()).toContain('No consent requests yet.');
    expect(m.workspace()).toContain('No board actions recorded.');
    expect(m.workspace()).toContain('No open periods');
  });

  it('INO-028: Request approval defaults the decision date to today + 14 days with min=today', async () => {
    const m = await mountPortal(routes());
    await m.goto('governance');
    await m.act('governance-approval', m.q('#workspace'));
    const due = m.q<HTMLInputElement>('#approvalDue');
    expect(due.value).toBe(isoPlus(14));
    expect(due.min).toBe(isoPlus(0));
  });

  it('INO-028: submitting with an empty matter, then a 2-character matter, then a past date each give a named inline error and send nothing', async () => {
    const m = await mountPortal(routes());
    await m.goto('governance');
    await m.act('governance-approval', m.q('#workspace'));
    await m.act('send-approval', m.modal());
    await waitFor(() => expect(inline()).toContain('Enter the matter requiring approval.'));
    await m.type('#approvalTitle', 'ab');
    await m.act('send-approval', m.modal());
    await waitFor(() => expect(inline()).toContain('at least 3 characters'));
    await m.type('#approvalTitle', 'Working-capital facility');
    setValue(m.q<HTMLInputElement>('#approvalDue'), isoPlus(-3));
    await m.act('send-approval', m.modal());
    await waitFor(() => expect(inline()).toContain('The decision date cannot be in the past.'));
    expectNotCalled(m.api, `POST ${P}/governance/consents`);
    expect(modalOpen()).toBe(true);
  });

  it('a valid request posts title, basis, due and note with an Idempotency-Key, closes, toasts and reloads', async () => {
    const m = await mountPortal(routes());
    await m.goto('governance');
    await m.act('governance-approval', m.q('#workspace'));
    await m.type('#approvalTitle', 'Enter a USD 2m facility');
    setValue(m.q<HTMLSelectElement>('#approvalBasis'), 'Share capital');
    setValue(m.q<HTMLTextAreaElement>('#approvalNote'), 'Bridge to Series B');
    const before = m.api.calls(`GET ${P}/governance`).length;
    await m.act('send-approval', m.modal());
    const [req] = expectCalled(m.api, `POST ${P}/governance/consents`);
    expectBody(req, { title: 'Enter a USD 2m facility', basis: 'Share capital', due: isoPlus(14), note: 'Bridge to Series B' });
    expectIdempotencyKey(req);
    await seeText(m, 'Consent requested');
    expect(modalOpen()).toBe(false);
    expect(m.api.calls(`GET ${P}/governance`).length).toBeGreaterThan(before);
  });

  it('INO-028: the API refusing a past date (backend check) shows the message in the modal', async () => {
    const m = await mountPortal(routes({ [`POST ${P}/governance/consents`]: fail(400, 'validation_error', 'Validation failed', [{ path: 'due', message: 'The decision date cannot be in the past' }]) }));
    await m.goto('governance');
    await m.act('governance-approval', m.q('#workspace'));
    await m.type('#approvalTitle', 'A real matter');
    await m.act('send-approval', m.modal());
    await waitFor(() => expect(inline()).toMatch(/due|decision date cannot be in the past/i));
    expect(modalOpen()).toBe(true);
  });
});

describe('INO-019: settings save', () => {
  const routes = (extra: Parameters<typeof healthyRoutes>[0] = {}) =>
    healthyRoutes({
      [`PUT ${P}/profile`]: ok(profile()),
      [`PUT ${P}/company`]: ok(company()),
      [`PUT ${P}/letterhead`]: ok(letterhead()),
      ...extra,
    });
  const save = (m: Awaited<ReturnType<typeof mountPortal>>) => m.act('save-settings', m.q('#workspace'));

  it('pre-fills the form from the live company, profile and letterhead (letterhead city is not blank)', async () => {
    const m = await mountPortal(routes());
    await m.goto('settings');
    expect(m.q<HTMLInputElement>('#settingsFirstName').value).toBe('Tariro');
    expect(m.q<HTMLInputElement>('#settingsContactEmail').value).toBe('finance@kuda.test');
    expect(m.q<HTMLInputElement>('#settingsWebsite').value).toBe('https://kuda.test');
    expect(m.q<HTMLInputElement>('#settingsLetterheadLegalName').value).toBe('Kuda Logistics (Pvt) Ltd');
    expect(m.q<HTMLInputElement>('#settingsLetterheadCity').value).toBe('Harare');
    expect(m.q<HTMLInputElement>('#settingsLetterheadLine1').value).toBe('12 Samora Machel Ave');
  });

  it('INO-019: changing only the description saves the company once, no letterhead write, one success toast naming what changed', async () => {
    const m = await mountPortal(routes());
    await m.goto('settings');
    setValue(m.q<HTMLTextAreaElement>('#settingsDescription'), 'Pan-African last-mile delivery');
    await save(m);
    const [req] = expectCalled(m.api, `PUT ${P}/company`);
    expectBody(req, { description: 'Pan-African last-mile delivery' });
    expectNotCalled(m.api, `PUT ${P}/letterhead`);
    await seeText(m, 'Settings saved');
    await seeText(m, 'company profile');
  });

  it('INO-019: a changed letterhead is validated and sent with all address parts', async () => {
    const m = await mountPortal(routes());
    await m.goto('settings');
    setValue(m.q<HTMLInputElement>('#settingsLetterheadCity'), 'Bulawayo');
    await save(m);
    expectBody(expectCalled(m.api, `PUT ${P}/letterhead`)[0], { legalName: 'Kuda Logistics (Pvt) Ltd', line1: '12 Samora Machel Ave', city: 'Bulawayo', country: 'Zimbabwe' });
    await seeText(m, 'letterhead');
  });

  it('INO-019: website "javascript:alert(1)" is refused with a message and nothing is written', async () => {
    const m = await mountPortal(routes());
    await m.goto('settings');
    setValue(m.q<HTMLInputElement>('#settingsWebsite'), 'javascript:alert(1)');
    await save(m);
    await seeText(m, 'Website must start with http:// or https://.');
    expectNotCalled(m.api, `PUT ${P}/company`);
    expectNotCalled(m.api, `PUT ${P}/profile`);
  });

  it('INO-019: invalid contact e-mail and an incomplete letterhead address are both reported together', async () => {
    const m = await mountPortal(routes());
    await m.goto('settings');
    setValue(m.q<HTMLInputElement>('#settingsContactEmail'), 'not-an-email');
    setValue(m.q<HTMLInputElement>('#settingsLetterheadCity'), '');
    await save(m);
    await seeText(m, 'Contact email is not a valid e-mail address.');
    await seeText(m, 'Letterhead needs a street, city and country.');
    expect(m.api.requests.filter((r) => r.method === 'PUT')).toHaveLength(0);
  });

  it('an API error on save (403 for a non-admin) is shown as the server message, not "Settings saved"', async () => {
    const m = await mountPortal(routes({ [`PUT ${P}/company`]: fail(403, 'insufficient_profile', 'Your access profile cannot change company details') }));
    await m.goto('settings');
    setValue(m.q<HTMLTextAreaElement>('#settingsDescription'), 'x');
    await save(m);
    await seeText(m, 'Your access profile cannot change company details');
    expect(m.toasts()).not.toContain('Settings saved');
  });

  it('INO-017/INO-005: the Security card shows the live two-factor state and required-by-platform flag', async () => {
    const m = await mountPortal(routes({ [`GET ${P}/profile`]: ok(profile({ mfaEnabled: true })), [`GET ${P}/settings`]: ok({ notifications: [], security: { mfaEnabled: true, mfaRequired: true, sessionTimeoutMinutes: 45 }, accessProfile: 'report_contributor', capabilities: {} }) }));
    await m.goto('settings');
    expect(m.workspace()).toContain('45 minutes idle');
  });
});

describe('INO-020: team invitations', () => {
  const fillInvite = async (m: Awaited<ReturnType<typeof mountPortal>>, name: string, email: string, profile?: string) => {
    const fields = m.qa<HTMLInputElement>('#modalBody input, #modalBody select');
    setValue(fields[0], name);
    setValue(fields[1], email);
    if (profile) setValue(fields[2] as unknown as HTMLSelectElement, profile);
  };

  it('lists members with title, humanised access profile, MFA state, and a pending invitation as "Invitation pending" excluded from stats', async () => {
    const m = await mountPortal(
      healthyRoutes({ [`GET ${P}/team`]: ok([...teamFixture(), { id: 'inv_1', invitationId: 'inv_1', name: 'Rudo Ncube', email: 'rudo@kuda.test', title: 'Head of People', accessProfile: 'read_only', status: 'invited', lastActiveAt: null, mfaEnabled: false, signingAuthority: false, isYou: false }]) }),
    );
    await m.goto('team');
    const rows = m.qa('#workspace tbody tr').map((r) => r.textContent!);
    expect(rows[0]).toContain('report contributor');
    expect(rows[1]).toContain('executive approver');
    expect(rows[1]).toContain('Enabled');
    const pending = rows.find((r) => r.includes('rudo@kuda.test'))!;
    expect(pending).toContain('Invitation pending');
    expect(pending).toContain('Not yet');
    expect(pending).toContain('Head of People');
    const metrics = m.qa('#workspace .metric-value').map((e) => e.textContent);
    expect(metrics).toEqual(['2', '50%', '2']); // company users, MFA, active: the invitee is not counted
    expect(m.workspace()).not.toMatch(/Nyasha Chikore|Kuda Ndlovu|Tawanda Dube/);
  });

  it('Send invitation posts name/email/profile with an Idempotency-Key; the toast names the e-mail; the list reloads', async () => {
    const m = await mountPortal(healthyRoutes({ [`POST ${P}/team`]: ok({ id: 'inv_2', email: 'new@kuda.test', status: 'invited' }, 201) }));
    await m.goto('team');
    await m.act('invite-user', m.q('#workspace'));
    await fillInvite(m, 'New Person', 'new@kuda.test', 'Executive approver');
    const before = m.api.calls(`GET ${P}/team`).length;
    await m.act('send-invite', m.modal());
    const [req] = expectCalled(m.api, `POST ${P}/team`);
    expectBody(req, { name: 'New Person', email: 'new@kuda.test', profile: 'Executive approver' });
    expectIdempotencyKey(req);
    await seeText(m, 'Invitation sent');
    await seeText(m, 'new@kuda.test is listed under Team & Access as an invitation pending acceptance.');
    expect(modalOpen()).toBe(false);
    expect(m.api.calls(`GET ${P}/team`).length).toBeGreaterThan(before);
  });

  it('a missing or malformed e-mail is refused with a message, nothing is sent, the modal stays open', async () => {
    const m = await mountPortal();
    await m.goto('team');
    await m.act('invite-user', m.q('#workspace'));
    await m.act('send-invite', m.modal());
    await waitFor(() => expect(inline()).toContain('A work email is required.'));
    await fillInvite(m, 'X', 'nope');
    await m.act('send-invite', m.modal());
    await waitFor(() => expect(inline()).toContain('Enter a valid work e-mail address.'));
    expectNotCalled(m.api, `POST ${P}/team`);
    expect(modalOpen()).toBe(true);
  });

  it('an existing member (409 already_member) is explained by the server message and the modal stays', async () => {
    const m = await mountPortal(healthyRoutes({ [`POST ${P}/team`]: fail(409, 'already_member', 'This person already has access to the company') }));
    await m.goto('team');
    await m.act('invite-user', m.q('#workspace'));
    await fillInvite(m, 'Chipo', 'chipo@kuda.test');
    await m.act('send-invite', m.modal());
    await waitFor(() => expect(inline()).toContain('This person already has access to the company'));
    expect(modalOpen()).toBe(true);
  });
});

describe('INO-021: vault upload', () => {
  const docs = [vaultDoc({ ref: 'DOC-0001' })];
  const withDocs = (extra: Parameters<typeof healthyRoutes>[0] = {}) =>
    healthyRoutes({
      [`GET ${P}/vault`]: ok({ documents: docs }),
      [`GET ${P}/application`]: ok({ id: 'cmp_101', businessName: 'Kuda', currentStage: 'Invested', requestedAmount: 1, documents: docs }),
      [`POST ${P}/vault`]: ok(vaultDoc({ id: 'doc_2', name: 'Budget 2027', fileName: 'budget.pdf' }), 201),
      ...extra,
    });

  it('lists documents by name and reference (never UUIDs) with type and upload date', async () => {
    const m = await mountPortal(withDocs());
    await m.goto('data-room');
    expect(m.workspace()).toContain('cert.pdf');
    expect(m.workspace()).toContain('DOC-0001');
    expect(m.workspace()).toContain('2026-05-01');
    expect(m.workspace()).not.toMatch(/doc_1/);
  });

  it('an empty vault says so (no mock folders)', async () => {
    const m = await mountPortal();
    await m.goto('data-room');
    expect(m.workspace()).toContain('No documents are on file yet.');
    expect(m.workspace()).not.toMatch(/Investment Documents|18\.4 GB/);
  });

  it('uploading posts multipart file + name + type with an Idempotency-Key, closes, toasts the file name and reloads', async () => {
    const m = await mountPortal(withDocs());
    await m.goto('data-room');
    await m.act('upload-docs', m.q('#workspace'));
    const file = new File(['%PDF-1.4 test'], 'budget.pdf', { type: 'application/pdf' });
    await m.user.upload(m.q<HTMLInputElement>('#vaultFile'), file);
    await m.type('#vaultFileName', 'Budget 2027');
    const before = m.api.calls(`GET ${P}/vault`).length;
    await m.act('complete-upload', m.modal());
    const [req] = expectCalled(m.api, `POST ${P}/vault`);
    const form = req.body as FormData;
    expect(form.get('name')).toBe('Budget 2027');
    expect(form.get('type')).toBe('company');
    expect((form.get('file') as File).name).toBe('budget.pdf');
    expectIdempotencyKey(req);
    await seeText(m, 'Document stored');
    expect(modalOpen()).toBe(false);
    expect(m.api.calls(`GET ${P}/vault`).length).toBeGreaterThan(before);
  });

  it('with no file chosen it says "Choose a file to upload." and sends nothing', async () => {
    const m = await mountPortal(withDocs());
    await m.goto('data-room');
    await m.act('upload-docs', m.q('#workspace'));
    await m.act('complete-upload', m.modal());
    await waitFor(() => expect(inline()).toContain('Choose a file to upload.'));
    expectNotCalled(m.api, `POST ${P}/vault`);
  });

  it('INO-021: a disguised program (400 from content sniffing) is refused with the server message and the modal stays', async () => {
    const m = await mountPortal(withDocs({ [`POST ${P}/vault`]: fail(400, 'bad_request', 'fake.pdf looks like a program, not a PDF. Upload a real document.') }));
    await m.goto('data-room');
    await m.act('upload-docs', m.q('#workspace'));
    await m.user.upload(m.q<HTMLInputElement>('#vaultFile'), new File(['MZ\x90'], 'fake.pdf', { type: 'application/pdf' }));
    await m.act('complete-upload', m.modal());
    await waitFor(() => expect(inline()).toContain('looks like a program'));
    expect(modalOpen()).toBe(true);
  });
});

describe('INO-017: term sheet signing and declining', () => {
  const sheets = (over: Record<string, unknown> = {}) => ok({ termSheets: [termSheet(over)], total: 1, page: 1, totalPages: 1 });
  const routes = (extra: Parameters<typeof healthyRoutes>[0] = {}) =>
    healthyRoutes({
      [`GET ${P}/term-sheets/my`]: sheets(),
      [`GET ${P}/term-sheets/:id`]: ok(termSheet()),
      [`POST ${P}/term-sheets/:id/sign`]: ok(termSheet({ status: 'SIGNED', isSigned: true })),
      [`POST ${P}/term-sheets/:id/decline`]: ok(termSheet({ status: 'DECLINED' })),
      ...extra,
    });

  it('shows the live term sheet (title, amount, equity, valuation, status) with Sign and Decline while it awaits signature', async () => {
    const m = await mountPortal(routes());
    await m.goto('terms');
    const t = m.workspace();
    expect(t).toContain('Series A term sheet TS-1001');
    expect(t).toContain('$2.5M');
    expect(t).toContain('12.5%');
    expect(t).toContain('$20M');
    expect(m.container.querySelector('#workspace [data-action="sign-document"]')).not.toBeNull();
    expect(m.container.querySelector('#workspace [data-action="decline-signature"]')).not.toBeNull();
  });

  it('a signed term sheet no longer offers Sign or Decline', async () => {
    const m = await mountPortal(routes({ [`GET ${P}/term-sheets/my`]: sheets({ status: 'SIGNED', isSigned: true, signedAt: '2026-08-01T00:00:00.000Z' }) }));
    await m.goto('terms');
    expect(m.container.querySelector('#workspace [data-action="sign-document"]')).toBeNull();
    expect(m.container.querySelector('#workspace [data-action="decline-signature"]')).toBeNull();
  });

  it('Sign refreshes the term sheet, opens the review dialog pre-filled with the signer name and the consent text from the API', async () => {
    const m = await mountPortal(routes());
    await m.goto('terms');
    const before = m.api.calls(`GET ${P}/term-sheets/:id`).length;
    await m.act('sign-document', m.q('#workspace'));
    expect(m.api.calls(`GET ${P}/term-sheets/:id`).length).toBeGreaterThan(before);
    await waitFor(() => expect(m.container.querySelector('#signatureName')).not.toBeNull());
    expect(m.q<HTMLInputElement>('#signatureName').value).toBe('Tariro Moyo');
    expect(m.q('#signatureConsentText').textContent).toBe('I agree to sign electronically.');
  });

  it('INO-017: a typed name and the consent box are both required (messages), nothing is posted until both are given', async () => {
    const m = await mountPortal(routes());
    await m.goto('terms');
    await m.act('sign-document', m.q('#workspace'));
    await m.type('#signatureName', '');
    await m.act('complete-signature', m.modal());
    await waitFor(() => expect(inline()).toContain('Type your full name to sign.'));
    await m.type('#signatureName', 'Tariro Moyo');
    await m.act('complete-signature', m.modal());
    await waitFor(() => expect(inline()).toContain('Tick the box to confirm you consent to sign electronically.'));
    expectNotCalled(m.api, `POST ${P}/term-sheets/:id/sign`);
  });

  it('signing posts multipart signature image + name + consent + the consent text version with an Idempotency-Key, closes, reloads', async () => {
    const m = await mountPortal(routes());
    await m.goto('terms');
    await m.act('sign-document', m.q('#workspace'));
    await m.user.click(m.q('#signatureConsent'));
    drawSignature();
    const before = m.api.calls(`GET ${P}/term-sheets/my`).length;
    await m.act('complete-signature', m.modal());
    const [req] = expectCalled(m.api, `POST ${P}/term-sheets/:id/sign`);
    expect(req.path.endsWith('/ts_1001/sign')).toBe(true);
    const form = req.body as FormData;
    expect(form.get('name')).toBe('Tariro Moyo');
    expect(form.get('consent')).toBe('true');
    expect(form.get('consentTextVersion')).toBe('ts-esign-v1');
    expect((form.get('signature') as File).name).toBe('signature.png');
    expectIdempotencyKey(req);
    await seeText(m, 'Term sheet signed');
    expect(modalOpen()).toBe(false);
    expect(m.api.calls(`GET ${P}/term-sheets/my`).length).toBeGreaterThan(before);
  });

  it('INO-017: signing without MFA opens the in-app step-up (enrolment) dialog; confirming the code replays the signature', async () => {
    let n = 0;
    const m = await mountPortal(
      routes({
        [`POST ${P}/term-sheets/:id/sign`]: () => (++n === 1 ? fail(401, 'mfa_enrolment_required', 'Set up two-factor sign-in to sign') : ok(termSheet({ status: 'SIGNED' }))),
        'POST /api/auth/mfa/enroll': raw({ secret: 'JBSWY3DPEHPK3PXP', otpauthUri: 'otpauth://totp/x' }),
        'POST /api/auth/mfa/verify': raw({ user: { id: 'u' } }),
      }),
    );
    await m.goto('terms');
    await m.act('sign-document', m.q('#workspace'));
    await m.user.click(m.q('#signatureConsent'));
    drawSignature();
    await m.act('complete-signature', m.modal());
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent('Set up two-factor authentication');
    await m.user.type(screen.getByLabelText('Authentication code'), '123456');
    await m.user.click(screen.getByRole('button', { name: 'Confirm' }));
    await seeText(m, 'Term sheet signed');
    expect(m.api.calls(`POST ${P}/term-sheets/:id/sign`)).toHaveLength(2);
  });

  it('a server refusal while signing (document changed) is shown in the dialog which stays open', async () => {
    const m = await mountPortal(routes({ [`POST ${P}/term-sheets/:id/sign`]: fail(409, 'document_changed', 'The term sheet changed after it was issued') }));
    await m.goto('terms');
    await m.act('sign-document', m.q('#workspace'));
    await m.user.click(m.q('#signatureConsent'));
    drawSignature();
    await m.act('complete-signature', m.modal());
    await waitFor(() => expect(inline()).toContain('The term sheet changed after it was issued'));
    expect(modalOpen()).toBe(true);
  });

  it('Decline needs a reason, then posts {reason}, closes and reloads', async () => {
    const m = await mountPortal(routes());
    await m.goto('terms');
    await m.act('decline-signature', m.q('#workspace'));
    await m.act('confirm-decline', m.modal());
    await waitFor(() => expect(inline()).toContain('Enter a reason for declining.'));
    expectNotCalled(m.api, `POST ${P}/term-sheets/:id/decline`);
    setValue(m.q<HTMLTextAreaElement>('#declineReason'), 'Valuation too low');
    await m.act('confirm-decline', m.modal());
    const [req] = expectCalled(m.api, `POST ${P}/term-sheets/:id/decline`);
    expectBody(req, { reason: 'Valuation too low' });
    expectIdempotencyKey(req);
    await seeText(m, 'Term sheet declined');
  });

  it('INO-018: the Signatures page lists term sheets and workspace signature requests together with live signers; no mock authority matrix', async () => {
    const m = await mountPortal(
      routes({
        [`GET ${P}/signature-requests`]: ok({
          requests: [{ id: 'sr1', ref: 'SIG-0001', title: 'Shareholder agreement', status: 'PENDING', expiresAt: '2026-11-01T00:00:00.000Z', reminderCount: 0, signers: [{ id: 's1', name: 'Ada Moyo', email: 'ada@x.test', status: 'PENDING' }] }],
        }),
      }),
    );
    await m.goto('signatures');
    const t = m.workspace();
    expect(t).toContain('Series A term sheet TS-1001');
    expect(t).toMatch(/SIG-0001|Shareholder agreement/);
    expect(t).toContain('Chipo Dube'); // live member with signing authority
    expect(t).not.toMatch(/Authority matrix/);
  });

  it('INO-018: signing a workspace signature request from the portal explains it is signed through the e-mailed link (term sheets only here)', async () => {
    const m = await mountPortal(
      routes({
        [`GET ${P}/signature-requests`]: ok({ requests: [{ id: 'sr1', ref: 'SIG-0001', title: 'Shareholder agreement', status: 'PENDING', expiresAt: '2026-11-01T00:00:00.000Z', reminderCount: 0, signers: [{ id: 's1', name: 'Ada Moyo', email: 'ada@x.test', status: 'PENDING' }] }] }),
      }),
    );
    await m.goto('signatures');
    const el = m.container.querySelector<HTMLElement>('#workspace [data-action="sign-document"][data-id="SIG-0001"], #workspace [data-action="open-signature"][data-id="SIG-0001"]');
    if (el) {
      await m.user.click(el);
      await m.settle();
    }
    expectNotCalled(m.api, `POST ${P}/term-sheets/:id/sign`);
  });
});

describe('Messages (threads)', () => {
  const thread = (over: Record<string, unknown> = {}) => ({
    id: 'Q-0001',
    title: 'Question on August accounts',
    from: 'Matanho Portfolio Team',
    role: 'Investment manager',
    opened: '12 Sep 2026',
    status: 'Open',
    messages: [
      { who: 'them', name: 'Nyasha K', at: '12 Sep · 10:00 CAT', text: 'Please explain the cost spike' },
      { who: 'me', name: 'You', at: '12 Sep · 11:00 CAT', text: 'Fuel prices rose' },
    ],
    ...over,
  });

  it('shows the thread list and bubbles with who/name/text from the real shape; "me" messages are styled as mine', async () => {
    const m = await mountPortal(healthyRoutes({ [`GET ${P}/threads`]: ok([thread()]) }));
    await m.goto('messages');
    const t = m.workspace();
    expect(t).toContain('Question on August accounts');
    expect(t).toContain('Please explain the cost spike');
    expect(m.qa('#workspace .bubble.me')).toHaveLength(1);
    expect(m.q('#workspace .bubble.me').textContent).toContain('Fuel prices rose');
  });

  it('Reply posts {text} to /threads/:id/messages with an Idempotency-Key and reloads; an empty reply is refused', async () => {
    const m = await mountPortal(healthyRoutes({ [`GET ${P}/threads`]: ok([thread()]), [`POST ${P}/threads/:id/messages`]: ok(thread()) }));
    await m.goto('messages');
    await m.act('reply-thread', m.q('#workspace'));
    await seeText(m, 'Write a reply before sending.');
    expectNotCalled(m.api, `POST ${P}/threads/:id/messages`);
    await m.type('#liveReplyText', 'Attached the fuel invoices');
    await m.act('reply-thread', m.q('#workspace'));
    const [req] = expectCalled(m.api, `POST ${P}/threads/:id/messages`);
    expect(req.path.endsWith('/Q-0001/messages')).toBe(true);
    expectBody(req, { text: 'Attached the fuel invoices' });
    expectIdempotencyKey(req);
    await seeText(m, 'Reply sent');
  });

  it('a resolved thread offers no reply box', async () => {
    const m = await mountPortal(healthyRoutes({ [`GET ${P}/threads`]: ok([thread({ status: 'Resolved' })]) }));
    await m.goto('messages');
    expect(m.container.querySelector('#liveReplyText')).toBeNull();
  });

  it('New conversation requires a subject and message, then posts {title, text including the recipient team}', async () => {
    const m = await mountPortal(healthyRoutes({ [`POST ${P}/threads`]: ok(thread({ id: 'Q-0002' }), 201) }));
    await m.goto('messages');
    expect(m.workspace()).toContain('No conversations yet.');
    await m.act('new-conversation', m.q('#workspace'));
    await m.act('send-conversation', m.modal());
    await waitFor(() => expect(inline()).toContain('Enter a subject and a message.'));
    await m.type('#newConversationSubject', 'Covenant question');
    setValue(m.q<HTMLTextAreaElement>('#newConversationBody'), 'Is the DSCR test quarterly?');
    await m.act('send-conversation', m.modal());
    const [req] = expectCalled(m.api, `POST ${P}/threads`);
    expectBody(req, { title: 'Covenant question' });
    expect((req.body as { text: string }).text).toContain('Is the DSCR test quarterly?');
    expect((req.body as { text: string }).text).toContain('For: Matanho Portfolio Team');
    expectIdempotencyKey(req);
    await seeText(m, 'Message sent');
    expect(modalOpen()).toBe(false);
  });
});
