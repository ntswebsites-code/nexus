import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Wizard } from '@/components/Wizard';
import { expectBody, expectCalled, expectNotCalled, fail, mockApi, ok, raw, screen, waitFor, within } from '../_helpers';
import { application, ENTITY_SLOTS, evidenceRow, filledForm, INDIVIDUAL_SLOTS, meta, P, pdf, renderApp, seedSession, SESSION_KEY, SLOTS, stepHeading, storedSession, stubLocation, userAnyFile } from './_support';

const realLocation = window.location;
beforeEach(() => {
  localStorage.clear();
  window.scrollTo = vi.fn() as never;
});
afterEach(() => {
  Object.defineProperty(window, 'location', { configurable: true, value: realLocation });
  localStorage.clear();
});

const owner = { name: 'Tendai Moyo', nationality: 'Zimbabwean', id: '', pct: '60' };
const signatory = { name: 'Chipo Moyo', role: 'CFO', email: 'chipo@acme.test' };
const director = { name: 'Rudo Dube', role: 'Director', email: '' };
const { bankAccount: _ba, ...formNoBank } = filledForm;

/** A stateful fake of the public onboarding API with real response shapes. */
function backend(over: { app?: Record<string, unknown>; routes?: Record<string, never> } = {}) {
  const state = { app: application(over.app) as ReturnType<typeof application> };
  const api = mockApi({
    [`GET ${P}/onboarding/meta`]: raw(meta),
    [`GET ${P}/applications/:id`]: () => ({ status: 200, body: { application: state.app } }),
    [`PATCH ${P}/applications/:id`]: raw({ ok: true, savedAt: '2026-10-04T08:00:00.000Z' }),
    [`POST ${P}/applications/:id/evidence`]: (req) => {
      const fd = req.body as FormData;
      const slot = String(fd.get('slot')) as keyof typeof SLOTS;
      const file = fd.get('file') as File;
      state.app = { ...state.app, evidence: state.app.evidence.map((e) => (e.slot === slot ? evidenceRow(slot, true, { name: file.name, size: file.size }) : e)) };
      return { status: 201, body: { slot, label: SLOTS[slot], name: file.name, size: file.size, mime: file.type, sha256: 'ab'.repeat(32), scanStatus: 'clean' } };
    },
    [`POST ${P}/applications/:id/submit`]: raw({ ref: 'ONB-100231', status: 'Submitted', screening: 'Queued' }),
    ...over.routes,
  });
  return { api, state };
}
const completeApp = (over: Record<string, unknown> = {}) =>
  application({ form: formNoBank, ownerDetails: [owner], signatories: [signatory], directors: [director], bankAccountOnFile: true, taxIdOnFile: true, evidence: ENTITY_SLOTS.map((s) => evidenceRow(s as keyof typeof SLOTS, true)), ...over });

async function openWizard(over: Parameters<typeof backend>[0] = {}) {
  seedSession();
  const b = backend(over);
  const view = renderApp(<Wizard />);
  await screen.findByRole('heading', { name: 'Investor profile' });
  return { ...b, ...view };
}
const saw = async (t: string | RegExp) => void (await screen.findAllByText(t));
const setv = (label: RegExp | string, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });
const next = (user: ReturnType<typeof renderApp>['user']) => user.click(screen.getByRole('button', { name: 'Continue' }));
const goTo = (user: ReturnType<typeof renderApp>['user'], n: number) => user.click(within(screen.getByRole('navigation', { name: 'Application steps' })).getAllByRole('button')[n]!);

describe('onboarding: starting an application', () => {
  it('shows the start screen without a session and offers every investor type from /meta', async () => {
    mockApi({ [`GET ${P}/onboarding/meta`]: raw(meta) });
    renderApp(<Wizard />);
    expect(await screen.findByRole('heading', { name: 'Apply to invest with Matanho' })).toBeInTheDocument();
    await waitFor(() => expect(screen.getAllByRole('option')).toHaveLength(7));
    expect(screen.getByRole('option', { name: 'Individual / HNW' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Resume an application' })).toHaveAttribute('href', '/resume');
    expect(screen.getByRole('button', { name: 'Start application' })).toBeDisabled();
  });

  it('falls back to the built-in investor types when /meta is unavailable', async () => {
    mockApi({ [`GET ${P}/onboarding/meta`]: fail(500, 'internal_error', 'down') });
    renderApp(<Wizard />);
    await screen.findByRole('heading', { name: 'Apply to invest with Matanho' });
    expect(screen.getAllByRole('option')).toHaveLength(7);
  });

  it('requires a valid email, creates the draft (email, type, name, sendLink), stores the session and opens step 1 prefilled', async () => {
    const api = mockApi({ [`GET ${P}/onboarding/meta`]: raw(meta), [`POST ${P}/applications`]: ok({}, 201), [`PATCH ${P}/applications/:id`]: raw({ ok: true, savedAt: 'x' }) });
    api.on(`POST ${P}/applications`, { status: 201, body: { id: 'app-9', token: 'tok-9' } });
    const { user } = renderApp(<Wizard />);
    await screen.findByRole('heading', { name: 'Apply to invest with Matanho' });
    await waitFor(() => expect(screen.getAllByRole('option')).toHaveLength(7));
    const btn = screen.getByRole('button', { name: 'Start application' });
    await user.type(screen.getByLabelText(/Contact email/), 'not-an-email');
    expect(btn).toBeDisabled();
    await user.clear(screen.getByLabelText(/Contact email/));
    await user.type(screen.getByLabelText(/Contact email/), 'cfo@acme.test');
    await user.type(screen.getByLabelText(/Legal name/), 'Acme Holdings Ltd');
    await user.selectOptions(screen.getByLabelText('Investor type'), 'Trust / foundation');
    await user.click(btn);
    const [req] = await waitFor(() => expectCalled(api, `POST ${P}/applications`));
    expectBody(req, { email: 'cfo@acme.test', applicantType: 'Trust / foundation', name: 'Acme Holdings Ltd', sendLink: true });
    expect(await screen.findByRole('heading', { name: 'Investor profile' })).toBeInTheDocument();
    expect(storedSession()).toEqual({ id: 'app-9', token: 'tok-9' });
    expect(screen.getByRole('status')).toHaveTextContent('Draft saved. We emailed a private link to cfo@acme.test so you can continue on any device.');
    expect(screen.getByLabelText(/^Legal name/)).toHaveValue('Acme Holdings Ltd');
    expect(screen.getByLabelText('Investor type')).toHaveValue('Trust / foundation');
    expect(screen.getByLabelText(/Primary contact email/)).toHaveValue('cfo@acme.test');
  });

  it('a refused start (rate limit) shows the API message and stays on the start screen', async () => {
    mockApi({ [`GET ${P}/onboarding/meta`]: raw(meta), [`POST ${P}/applications`]: fail(429, 'rate_limited', 'Too many applications started, try again later') });
    const { user } = renderApp(<Wizard />);
    await user.type(await screen.findByLabelText(/Contact email/), 'cfo@acme.test');
    await user.click(screen.getByRole('button', { name: 'Start application' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Too many applications started, try again later');
    expect(screen.getByRole('button', { name: 'Start application' })).toBeEnabled();
    expect(storedSession()).toBeNull();
  });
});

describe('onboarding: resume and boot states', () => {
  it('a ?resume=<id>.<token> link stores the session, removes the secret from the URL and loads the saved draft', async () => {
    stubLocation('?resume=app-7.tok-abc.def');
    const replaceState = vi.spyOn(window.history, 'replaceState');
    const { api } = backend({ app: { id: 'app-7', form: filledForm, ownerDetails: [owner] } });
    renderApp(<Wizard />);
    await screen.findByRole('heading', { name: 'Investor profile' });
    expect(storedSession()).toEqual({ id: 'app-7', token: 'tok-abc.def' });
    expect(replaceState).toHaveBeenCalledWith(null, '', '/');
    const [req] = expectCalled(api, `GET ${P}/applications/:id`);
    expect(req.path).toBe(`${P}/applications/app-7`);
    expect(req.headers['x-draft-token']).toBe('tok-abc.def');
    expect(screen.getByLabelText(/^Legal name/)).toHaveValue('Acme Holdings Ltd');
  });

  it('hydrates everything from the server: form, owners, signatories, directors and "on file" notes for secrets', async () => {
    const { user } = await openWizard({ app: { form: formNoBank, ownerDetails: [owner], signatories: [signatory], directors: [director], taxIdOnFile: true, bankAccountOnFile: true } });
    expect(screen.getByLabelText(/^Registration/)).toHaveValue('REG-12345');
    expect(screen.getByLabelText(/Primary contact name/)).toHaveValue('Chipo Moyo');
    await goTo(user, 1);
    expect(screen.getAllByLabelText('Full name').map((i) => (i as HTMLInputElement).value)).toEqual(['Tendai Moyo', 'Rudo Dube', 'Chipo Moyo']);
    expect(screen.getByLabelText('Ownership percent')).toHaveValue('60');
    await goTo(user, 3);
    expect(screen.getAllByText('On file. Leave blank to keep it.')).toHaveLength(2);
    expect(screen.getByLabelText(/Tax identification number/)).toHaveValue('');
  });

  it('INO-029 (known gap, not fixed): a resumed draft reopens on step 1 with all data restored', async () => {
    await openWizard({ app: completeApp() });
    expect(stepHeading()).toHaveTextContent('Investor profile');
    expect(screen.getByLabelText(/^Legal name/)).toHaveValue('Acme Holdings Ltd');
    expect(screen.getByText('9 uploaded')).toBeInTheDocument();
  });

  it('an expired draft link (404) clears the stored session and offers to start again', async () => {
    seedSession();
    mockApi({ [`GET ${P}/onboarding/meta`]: raw(meta), [`GET ${P}/applications/:id`]: fail(404, 'not_found', 'Application not found or link expired') });
    renderApp(<Wizard />);
    expect(await screen.findByText('That draft link has expired. Start again or request a new link by email.')).toBeInTheDocument();
    expect(localStorage.getItem(SESSION_KEY)).toBeNull();
    expect(screen.getByRole('button', { name: 'Start application' })).toBeInTheDocument();
  });

  it('a network failure while loading shows a retry hint, not a blank page', async () => {
    seedSession();
    mockApi({ [`GET ${P}/onboarding/meta`]: raw(meta) });
    renderApp(<Wizard />);
    expect(await screen.findByRole('alert')).toHaveTextContent('We could not load your application. Check your connection and refresh.');
    expect(localStorage.getItem(SESSION_KEY)).not.toBeNull();
  });

  it('an already submitted application is sent to the status tracker', async () => {
    const loc = stubLocation();
    seedSession();
    backend({ app: { status: 'Submitted', ref: 'ONB-1' } });
    renderApp(<Wizard />);
    await waitFor(() => expect(loc.replace).toHaveBeenCalledWith('/status'));
  });
});

describe('onboarding: step validation', () => {
  it('step 1: required fields give field-level messages, the first message in the banner, the first field gets focus, and editing clears the message', async () => {
    const { api, user } = await openWizard();
    await next(user);
    await saw('Legal name is required');
    expect(screen.getAllByText('Registration / identity number is required').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Registered / residential address is required').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Primary contact name is required').length).toBeGreaterThan(0);
    expect(screen.getByRole('alert')).toHaveTextContent('Legal name is required');
    expect(document.getElementById('f-legalName-err')).toHaveTextContent('Legal name is required');
    expect(document.getElementById('f-registrationRef-err')).toHaveTextContent('Registration / identity number is required');
    expect(screen.getByLabelText(/^Legal name/)).toHaveAttribute('aria-invalid', 'true');
    await waitFor(() => expect(screen.getByLabelText(/^Legal name/)).toHaveFocus());
    expect(stepHeading()).toHaveTextContent('Investor profile');
    setv(/^Legal name/, 'Acme');
    expect(document.getElementById('f-legalName-err')).toBeNull();
    expectNotCalled(api, `POST ${P}/applications/:id/submit`);
  });

  it('step 1: an invalid email, URL and negative commitment are rejected with specific messages (INO-024)', async () => {
    const { user } = await openWizard({ app: { form: filledForm } });
    setv(/Primary contact email/, 'nope');
    setv(/^Website/, 'acme.com');
    setv(/Expected commitment/, '-500');
    await next(user);
    await saw('Enter a valid email address');
    expect(screen.getAllByText('Start with http:// or https://').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Enter an amount of zero or more').length).toBeGreaterThan(0);
  });

  it('entity types show regulator, licence and narrative fields; Individual / HNW hides them', async () => {
    const { user } = await openWizard({ app: { form: filledForm } });
    expect(screen.getByLabelText(/Regulator \/ supervisory body/)).toBeInTheDocument();
    expect(screen.getByLabelText(/Licence \/ registration reference/)).toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText('Investor type'), 'Individual / HNW');
    expect(screen.queryByLabelText(/Regulator \/ supervisory body/)).toBeNull();
    expect(screen.queryByLabelText(/Licence/)).toBeNull();
    expect(screen.queryByLabelText(/Regulatory status/)).toBeNull();
  });

  it('step 2: an entity must name an owner, a signatory and a director; messages are field level', async () => {
    const { user } = await openWizard({ app: { form: filledForm } });
    await goTo(user, 1);
    await next(user);
    await saw('Add at least one beneficial owner or controller');
    expect(screen.getAllByText('Add at least one authorised signatory').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Add at least one director, trustee or governing person').length).toBeGreaterThan(0);
    expect(screen.getByRole('heading', { name: 'Directors, trustees and governing persons' })).toBeInTheDocument();
    expect(stepHeading()).toHaveTextContent('Ownership and authority');
  });

  it('step 2: an individual needs no director and has no directors section', async () => {
    const { user } = await openWizard({ app: { form: { ...filledForm, investorType: 'Individual / HNW' }, ownerDetails: [owner], signatories: [signatory] } });
    await goTo(user, 1);
    expect(screen.queryByRole('heading', { name: /Directors, trustees/ })).toBeNull();
    await next(user);
    expect(await screen.findByRole('heading', { name: 'KYC / AML declarations' })).toBeInTheDocument();
  });

  it('step 2: ownership over 100%, out-of-range percentages and invalid people emails are rejected', async () => {
    const { user } = await openWizard({ app: { form: filledForm, ownerDetails: [owner, { ...owner, name: 'Second Owner', pct: '50' }], signatories: [signatory], directors: [director] } });
    await goTo(user, 1);
    await next(user);
    await saw('Ownership adds up to 110%, which is over 100%');
    fireEvent.change(screen.getAllByLabelText('Ownership percent')[0]!, { target: { value: '10' } });
    fireEvent.change(screen.getAllByLabelText('Ownership percent')[1]!, { target: { value: '-5' } });
    await next(user);
    await saw('Ownership % must be between 0 and 100');
    fireEvent.change(screen.getAllByLabelText('Ownership percent')[1]!, { target: { value: '20' } });
    fireEvent.change(screen.getAllByLabelText('Email')[0]!, { target: { value: 'bad@' } });
    await next(user);
    await saw('"bad@" is not a valid email address');
  });

  it('owners and people can be added and removed; removing the last row leaves one blank row', async () => {
    const { user } = await openWizard({ app: { form: filledForm, ownerDetails: [owner] } });
    await goTo(user, 1);
    await user.click(screen.getByRole('button', { name: '+ Add owner / controller' }));
    expect(screen.getAllByLabelText('Full name').filter((i) => (i as HTMLInputElement).placeholder === 'Full name').length).toBeGreaterThan(3);
    const removes = screen.getAllByRole('button', { name: 'Remove owner' });
    await user.click(removes[0]!);
    await user.click(screen.getAllByRole('button', { name: 'Remove owner' })[0]!);
    expect(screen.getAllByRole('button', { name: 'Remove owner' })).toHaveLength(1);
    expect(screen.getByLabelText('Ownership percent')).toHaveValue('');
  });

  it('step 3: narratives are required and a negative expected volume is refused (INO-024)', async () => {
    const { user } = await openWizardAt(2, { form: { ...filledForm, sourceFundsNarrative: '', expectedActivity: '' } });
    await next(user);
    await saw('Source of funds explanation is required');
    expect(screen.getAllByText('Expected account activity is required').length).toBeGreaterThan(0);
    setv(/Source of funds explanation/, 'Revenue');
    setv(/Expected account activity/, 'Quarterly');
    setv(/Expected annual transaction volume/, '-500');
    await next(user);
    await saw('Enter an amount of zero or more');
    setv(/Expected annual transaction volume/, '1000.50');
    await next(user);
    expect(await screen.findByRole('heading', { name: 'Tax and bank verification' })).toBeInTheDocument();
  });

  it('step 3: the four declarations default to No and are sent as chosen', async () => {
    const { user, api } = await openWizardAt(2, {});
    for (const l of ['Politically exposed person (PEP)', 'Sanctions exposure', 'Adverse media / legal matters', 'Enhanced-risk jurisdictions']) expect(screen.getByLabelText(l)).toHaveValue('no');
    await user.selectOptions(screen.getByLabelText('Politically exposed person (PEP)'), 'yes');
    await user.click(screen.getByRole('button', { name: 'Save draft' }));
    const reqs = await waitFor(() => expectCalledAtLeast(api));
    expect((reqs.at(-1)!.body as { form: Record<string, string> }).form.pep).toBe('yes');
  });

  it('step 4: bank fields are required; SWIFT and account number formats are checked (INO-024)', async () => {
    const { user } = await openWizardAt(3, { form: { ...formNoBank, taxResidence: '', bankName: '', bankHolder: '', bankCountry: '' }, bankAccountOnFile: false });
    await next(user);
    await saw('Primary tax residence is required');
    expect(screen.getAllByText('Bank / financial institution is required').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Account / IBAN reference is required').length).toBeGreaterThan(0);
    setv(/Primary tax residence/, 'Zimbabwe');
    setv(/Bank \/ financial institution/, 'Stanbic');
    setv(/Account holder/, 'Acme Holdings Ltd');
    setv(/Bank jurisdiction/, 'Zimbabwe');
    setv(/Account \/ IBAN reference/, 'abc');
    setv(/SWIFT/, 'BAD');
    await next(user);
    await saw('SWIFT / BIC must be 8 or 11 characters');
    expect(screen.getAllByText('Enter a valid account number or IBAN').length).toBeGreaterThan(0);
    setv(/Account \/ IBAN reference/, 'ZW12 3456 7890');
    setv(/SWIFT/, 'SBICZWHX');
    await next(user);
    expect(await screen.findByRole('heading', { name: 'Supporting evidence' })).toBeInTheDocument();
  });

  it('INO-024: a bank account holder that differs from the legal name is a warning only and does not block Continue', async () => {
    const { user } = await openWizardAt(3, { form: { ...formNoBank, bankHolder: 'Someone Else (Pvt) Ltd' } });
    const warn = screen.getByText('Account holder should match the legal name; Compliance will review a mismatch.');
    expect(warn).toHaveClass('warn');
    await next(user);
    expect(await screen.findByRole('heading', { name: 'Supporting evidence' })).toBeInTheDocument();
  });

  it('INO-029: stored tax id and bank account show "On file. Leave blank to keep it." and are not demanded again', async () => {
    const { user } = await openWizardAt(3, {});
    expect(screen.getAllByText('On file. Leave blank to keep it.')).toHaveLength(2);
    await next(user);
    expect(await screen.findByRole('heading', { name: 'Supporting evidence' })).toBeInTheDocument();
  });

  it('step 5: Continue is blocked until every required document is uploaded and names the missing ones by label (no blocking alert dialogs)', async () => {
    const alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => undefined);
    const { user } = await openWizardAt(4, { evidence: ENTITY_SLOTS.map((s, i) => evidenceRow(s as keyof typeof SLOTS, i < 7)) });
    await next(user);
    await saw(/Still required: Tax \/ FATCA \/ CRS, Authority to invest/);
    expect(stepHeading()).toHaveTextContent('Supporting evidence');
    expect(alertSpy).not.toHaveBeenCalled();
  });

  it('step 6: signatory name, capacity and the declaration are required before anything is sent', async () => {
    const { api, user } = await openWizardAt(5, {});
    await user.click(screen.getByRole('button', { name: 'Submit application' }));
    await saw('Signatory name is required');
    expect(screen.getAllByText('Capacity / title is required').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Tick the declaration to submit').length).toBeGreaterThan(0);
    expectNotCalled(api, `POST ${P}/applications/:id/submit`);
  });

  it('moving ahead through the rail validates the steps in between; going back never does', async () => {
    const { user } = await openWizard({ app: { form: filledForm } });
    await goTo(user, 4);
    expect(await screen.findByRole('heading', { name: 'Ownership and authority' })).toBeInTheDocument();
    expect(screen.getAllByText('Add at least one beneficial owner or controller').length).toBeGreaterThan(0);
    await goTo(user, 0);
    expect(await screen.findByRole('heading', { name: 'Investor profile' })).toBeInTheDocument();
  });
});

/** Opens the wizard with a complete draft, on the given step (0-based). */
async function openWizardAt(step: number, over: Record<string, unknown>) {
  const ctx = await openWizard({ app: completeApp(over) });
  if (step > 0) await goTo(ctx.user, step);
  return ctx;
}
function expectCalledAtLeast(api: ReturnType<typeof mockApi>) {
  const calls = api.calls(`PATCH ${P}/applications/:id`);
  expect(calls.length).toBeGreaterThan(0);
  return calls;
}

describe('onboarding: document upload', () => {
  const upload = async (label: string, file: File, user = userAnyFile()) => user.upload(screen.getByLabelText(`Upload ${label}`), file);

  it('lists the required documents for the investor type (real labels) plus the two optional ones', async () => {
    await openWizardAt(4, { evidence: ENTITY_SLOTS.map((s) => evidenceRow(s as keyof typeof SLOTS)) });
    for (const s of ENTITY_SLOTS) expect(screen.getByText(SLOTS[s as keyof typeof SLOTS])).toBeInTheDocument();
    const mandate = screen.getByText('Investment mandate').closest('.doc') as HTMLElement;
    expect(within(mandate).getByText('Optional')).toBeInTheDocument();
    expect(within(screen.getByText('Identity / legal existence').closest('.doc') as HTMLElement).getByText('Required')).toBeInTheDocument();
    expect(screen.getByText('0 uploaded')).toBeInTheDocument();
    expect(screen.getByText('9 required')).toBeInTheDocument();
  });

  it('an individual sees only the six individual documents as required', async () => {
    await openWizardAt(4, { form: { ...formNoBank, investorType: 'Individual / HNW' }, evidence: INDIVIDUAL_SLOTS.map((s) => evidenceRow(s as keyof typeof SLOTS)) });
    expect(screen.getByText('6 required')).toBeInTheDocument();
    expect(screen.queryByText('Registry / constitutional extract')).toBeNull();
    expect(screen.queryByText('Authority to invest')).toBeNull();
  });

  it('uploading sends slot + file to the evidence endpoint with the draft token, then shows Received, file name, size and scan result', async () => {
    const { api } = await openWizardAt(4, { evidence: ENTITY_SLOTS.map((s) => evidenceRow(s as keyof typeof SLOTS)) });
    await upload('Identity / legal existence', pdf('registration.pdf', 2048));
    const [req] = await waitFor(() => expectCalled(api, `POST ${P}/applications/:id/evidence`));
    expect(req.headers['x-draft-token']).toBe('tok-123');
    expect(req.path).toBe(`${P}/applications/app-1/evidence`);
    const fd = req.body as FormData;
    expect(fd.get('slot')).toBe('doc1');
    expect((fd.get('file') as File).name).toBe('registration.pdf');
    const card = screen.getByText('Identity / legal existence').closest('.doc') as HTMLElement;
    expect(await within(card).findByText('Received')).toBeInTheDocument();
    expect(within(card).getByText(/registration.pdf · 2 KB · malware scan clean/)).toBeInTheDocument();
    expect(within(card).getByRole('button', { name: 'Replace file' })).toBeInTheDocument();
    expect(screen.getByText('1 uploaded')).toBeInTheDocument();
  });

  it('INO-022 regression: after uploading every required document in the same session, Continue advances to Review', async () => {
    const { user } = await openWizardAt(4, { evidence: ENTITY_SLOTS.map((s) => evidenceRow(s as keyof typeof SLOTS)) });
    for (const s of ENTITY_SLOTS) await upload(SLOTS[s as keyof typeof SLOTS], pdf(`${s}.pdf`), user);
    await waitFor(() => expect(screen.getByText('9 uploaded')).toBeInTheDocument());
    await next(user);
    expect(await screen.findByRole('heading', { name: 'Review and submit' })).toBeInTheDocument();
    expect(screen.queryByText(/Still required/)).toBeNull();
  });

  it('a file over the size limit is refused in the browser with the limit in the message and no request', async () => {
    const { api } = await openWizardAt(4, { evidence: ENTITY_SLOTS.map((s) => evidenceRow(s as keyof typeof SLOTS)) });
    await upload('Address evidence', pdf('huge.pdf', 10 * 1048576 + 1));
    const card = screen.getByText('Address evidence').closest('.doc') as HTMLElement;
    expect(await within(card).findByRole('alert')).toHaveTextContent('File is larger than 10 MB.');
    expectNotCalled(api, `POST ${P}/applications/:id/evidence`);
    expect(within(card).queryByText('Received')).toBeNull();
  });

  it('a malware detection (422) is reported on that card, the slot stays empty and the user can retry', async () => {
    const { api } = await openWizardAt(4, { evidence: ENTITY_SLOTS.map((s) => evidenceRow(s as keyof typeof SLOTS)) });
    api.on(`POST ${P}/applications/:id/evidence`, fail(422, 'malware_detected', 'The file was rejected by the malware scan (Eicar-Test-Signature)'));
    await upload('Source of funds', pdf('eicar.pdf'));
    const card = screen.getByText('Source of funds').closest('.doc') as HTMLElement;
    expect(await within(card).findByRole('alert')).toHaveTextContent('The file was rejected by the malware scan (Eicar-Test-Signature)');
    expect(within(card).getByText('Required')).toBeInTheDocument();
    expect(card).toHaveClass('bad');
    expect(within(card).getByRole('button', { name: 'Choose file' })).toBeEnabled();
  });

  it('INO-023: a program disguised as a PDF is rejected by the server and the message is shown', async () => {
    const { api } = await openWizardAt(4, { evidence: ENTITY_SLOTS.map((s) => evidenceRow(s as keyof typeof SLOTS)) });
    api.on(`POST ${P}/applications/:id/evidence`, fail(400, 'bad_request', 'This file looks like a program, not a document, and was not accepted', { reason: 'content_not_allowed' }));
    await upload('Tax / FATCA / CRS', new File(['MZ\x90\x00'], 'evil.pdf', { type: 'application/pdf' }));
    const card = screen.getByText('Tax / FATCA / CRS').closest('.doc') as HTMLElement;
    expect(await within(card).findByRole('alert')).toHaveTextContent('This file looks like a program, not a document, and was not accepted');
  });

  it('unsupported file types: the picker is limited to PDF/PNG/JPEG/WebP and a file that gets through anyway is refused by the API message', async () => {
    const { api } = await openWizardAt(4, { evidence: ENTITY_SLOTS.map((s) => evidenceRow(s as keyof typeof SLOTS)) });
    const input = screen.getByLabelText('Upload Bank verification') as HTMLInputElement;
    expect(input.accept).toBe('application/pdf,image/png,image/jpeg,image/webp');
    await userEvent.setup().upload(input, new File(['x'], 'run.exe', { type: 'application/x-msdownload' }));
    expectNotCalled(api, `POST ${P}/applications/:id/evidence`);
    api.on(`POST ${P}/applications/:id/evidence`, fail(400, 'bad_request', 'File type application/x-msdownload is not accepted'));
    await userAnyFile().upload(input, new File(['x'], 'run.exe', { type: 'application/x-msdownload' }));
    const card = screen.getByText('Bank verification').closest('.doc') as HTMLElement;
    expect(await within(card).findByRole('alert')).toHaveTextContent('File type application/x-msdownload is not accepted');
  });

  it('Choose file opens the file picker of that card; the button is disabled while uploading', async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((r) => (release = r));
    const { api, user } = await openWizardAt(4, { evidence: ENTITY_SLOTS.map((s) => evidenceRow(s as keyof typeof SLOTS)) });
    const click = vi.spyOn(HTMLInputElement.prototype, 'click');
    const card = screen.getByText('Ownership structure').closest('.doc') as HTMLElement;
    await user.click(within(card).getByRole('button', { name: 'Choose file' }));
    expect(click).toHaveBeenCalled();
    click.mockRestore();
    api.on(`POST ${P}/applications/:id/evidence`, async () => (await gate, { status: 201, body: { slot: 'doc4', name: 'a.pdf', size: 1, scanStatus: 'clean' } }));
    await userAnyFile().upload(screen.getByLabelText('Upload Ownership structure'), pdf('a.pdf'));
    expect(await within(card).findByRole('button', { name: 'Scanning and uploading...' })).toBeDisabled();
    release();
    await waitFor(() => expect(within(card).getByRole('button', { name: /Choose file|Replace file/ })).toBeEnabled());
  });
});


describe('onboarding: save, review and submit', () => {
  it('autosaves about a second after a change: PATCH with the draft token and the whole payload (blank rows dropped)', async () => {
    const { api } = await openWizard({ app: { form: filledForm, ownerDetails: [owner] } });
    setv(/Telephone/, '+263 77 000 0000');
    expect(screen.getByText('Unsaved changes')).toBeInTheDocument();
    const [req] = await waitFor(() => expectCalled(api, `PATCH ${P}/applications/:id`), { timeout: 3000 });
    expect(req.headers['x-draft-token']).toBe('tok-123');
    const body = req.body as { form: Record<string, string>; owners: unknown[]; signatories: unknown[]; directors: unknown[] };
    expect(body.form.telephone).toBe('+263 77 000 0000');
    expect(body.owners).toEqual([owner]);
    expect(body.signatories).toEqual([]);
    await waitFor(() => expect(screen.getByText('Saved')).toBeInTheDocument());
  });

  it('Save draft confirms; a failed save says so and the header shows "Not saved"', async () => {
    const { api, user } = await openWizard({ app: { form: filledForm } });
    await user.click(screen.getByRole('button', { name: 'Save draft' }));
    expect(await screen.findByText('Draft saved.')).toBeInTheDocument();
    api.on(`PATCH ${P}/applications/:id`, fail(500, 'internal_error', 'boom'));
    await user.click(screen.getByRole('button', { name: 'Save draft' }));
    expect(await screen.findByText('Draft not saved. Check your connection and retry.')).toBeInTheDocument();
    expect(screen.getByText('Not saved')).toBeInTheDocument();
  });

  it('if the application was submitted elsewhere (409 on save) the user is sent to the status page', async () => {
    const loc = stubLocation();
    const { api, user } = await openWizard({ app: { form: filledForm } });
    api.on(`PATCH ${P}/applications/:id`, fail(409, 'already_submitted', 'This application has already been submitted'));
    await user.click(screen.getByRole('button', { name: 'Save draft' }));
    await waitFor(() => expect(loc.replace).toHaveBeenCalledWith('/status'));
  });

  it('review summarises what was entered with names, not ids, and counts the uploaded documents', async () => {
    await openWizardAt(5, {});
    const dl = document.querySelector('dl.summary') as HTMLElement;
    const text = dl.textContent ?? '';
    expect(text).toContain('Acme Holdings Ltd (Institutional investor)');
    expect(text).toContain('Tendai Moyo (60%)');
    expect(text).toContain('Rudo Dube');
    expect(text).toContain('Chipo Moyo');
    expect(text).toContain('Politically exposed person: No');
    expect(text).toContain('9 of 9 uploaded');
  });

  it('submits consent plus the full payload, shows the reference and a link to the tracker', async () => {
    const { api, user } = await openWizardAt(5, {});
    setv(/Authorised signatory name/, 'Chipo Moyo');
    setv(/Capacity \/ title/, 'CFO');
    await user.click(screen.getByLabelText(/I confirm that I am authorised/));
    await user.click(screen.getByRole('button', { name: 'Submit application' }));
    const [req] = await waitFor(() => expectCalled(api, `POST ${P}/applications/:id/submit`));
    expect(req.headers['x-draft-token']).toBe('tok-123');
    expectBody(req, { consent: true, form: { legalName: 'Acme Holdings Ltd', signatureName: 'Chipo Moyo', signatureCapacity: 'CFO' }, owners: [owner], signatories: [signatory], directors: [director] });
    expect(await screen.findByText('ONB-100231')).toHaveClass('ref');
    expect(screen.getByRole('heading', { name: 'Thank you. Your application is with us.' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Track my application' })).toHaveAttribute('href', '/status');
  });

  it('double click on Submit sends one request and the button reads "Submitting..."', async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((r) => (release = r));
    const { api, user } = await openWizardAt(5, {});
    api.on(`POST ${P}/applications/:id/submit`, async () => (await gate, { status: 200, body: { ref: 'ONB-1', status: 'Submitted' } }));
    setv(/Authorised signatory name/, 'Chipo Moyo');
    setv(/Capacity \/ title/, 'CFO');
    await user.click(screen.getByLabelText(/I confirm that I am authorised/));
    const btn = screen.getByRole('button', { name: 'Submit application' });
    await user.click(btn);
    const busy = await screen.findByRole('button', { name: 'Submitting...' });
    expect(busy).toBeDisabled();
    await user.click(busy);
    release();
    await screen.findByText('ONB-1');
    expect(api.calls(`POST ${P}/applications/:id/submit`)).toHaveLength(1);
  });

  it('an incomplete application (400 incomplete_application) lists what is missing', async () => {
    const { api, user } = await openWizardAt(5, {});
    api.on(`POST ${P}/applications/:id/submit`, fail(400, 'incomplete_application', 'Complete the missing items before submitting', { fields: ['Legal name'], evidence: ['Identity / legal existence'] }));
    setv(/Authorised signatory name/, 'Chipo Moyo');
    setv(/Capacity \/ title/, 'CFO');
    await user.click(screen.getByLabelText(/I confirm that I am authorised/));
    await user.click(screen.getByRole('button', { name: 'Submit application' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Complete before submitting: Legal name; Identity / legal existence');
    expect(screen.getByRole('button', { name: 'Submit application' })).toBeEnabled();
  });

  it('a server-side value check on submit (400) shows its message', async () => {
    const { api, user } = await openWizardAt(5, {});
    api.on(`POST ${P}/applications/:id/submit`, fail(400, 'validation_error', 'SWIFT / BIC must be 8 or 11 characters'));
    setv(/Authorised signatory name/, 'Chipo Moyo');
    setv(/Capacity \/ title/, 'CFO');
    await user.click(screen.getByLabelText(/I confirm that I am authorised/));
    await user.click(screen.getByRole('button', { name: 'Submit application' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('SWIFT / BIC must be 8 or 11 characters');
  });

  it('typed text is escaped (INO-029): an HTML name is shown as text in the review', async () => {
    const { container } = await openWizardAt(5, { form: { ...formNoBank, legalName: '<img src=x onerror=alert(1)>' } });
    expect(container.querySelector('img[src="x"]')).toBeNull();
    expect((document.querySelector('dl.summary') as HTMLElement).textContent).toContain('<img src=x onerror=alert(1)>');
  });
});
