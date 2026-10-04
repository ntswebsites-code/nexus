/**
 * LP "Documents to sign" page (portals/investor-web .../signatures) = portal-kit EsignInbox against the
 * real /esign/me/* response shapes (backend esign.routes.ts meRoutes).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import SignaturesPage from '@/app/(lp)/lp-portal/signatures/page';
import { mockApi, raw, fail, expectCalled, expectNotCalled, expectNoUnmocked } from '../_helpers';

const ME = { id: 'sg-1', status: 'PENDING', name: 'Ann Alpha', roleLabel: 'Authorised signatory', signedAt: null };
const request = (over: Record<string, unknown> = {}) => ({
  id: 'es-1', ref: 'ESG-00007', title: 'Capital call 13 acknowledgement', message: 'Please sign by Friday.', status: 'PENDING', expiresAt: '2099-07-20T00:00:00Z',
  completedAt: null, hasSealed: false, actionable: true, me: ME,
  signers: [{ name: 'Ann Alpha', roleLabel: 'Authorised signatory', status: 'PENDING', signedAt: null }, { name: 'Bob Beta', roleLabel: 'Director', status: 'SIGNED', signedAt: '2026-07-01T10:00:00Z' }],
  myFields: [{ kind: 'SIGNATURE', page: 2, label: null }],
  ...over,
});
const DONE = request({ id: 'es-2', ref: 'ESG-00005', title: 'Subscription agreement', status: 'COMPLETED', actionable: false, hasSealed: true, completedAt: '2026-06-01T00:00:00Z', me: { ...ME, status: 'SIGNED', signedAt: '2026-05-30T00:00:00Z' } });
const detail = (r: ReturnType<typeof request>) => ({ request: { ...r, consent: { text: 'I agree to sign electronically.' } }, actionable: r.actionable });

const E = '/api/v1/esign/me/requests';
function routes(over: Record<string, unknown> = {}) {
  return {
    [`GET ${E}`]: raw({ data: [request(), DONE] }),
    [`GET ${E}/es-1`]: raw(detail(request())),
    [`GET ${E}/es-2`]: raw(detail(DONE)),
    [`GET ${E}/:id/document`]: raw({}),
    [`POST ${E}/es-1/sign`]: raw({ signed: true, status: 'PENDING', ref: 'ESG-00007' }),
    [`POST ${E}/es-1/decline`]: raw({ declined: true, status: 'DECLINED' }),
    ...over,
  } as never;
}
beforeEach(() => {
  vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: vi.fn(() => 'blob:pdf'), revokeObjectURL: vi.fn() }));
});

async function openSigner(over: Record<string, unknown> = {}) {
  const api = mockApi(routes(over));
  const user = userEvent.setup();
  render(<SignaturesPage />);
  await user.click(await screen.findByRole('button', { name: 'Review and sign' }));
  await screen.findByText('Your signature');
  return { api, user };
}
const consent = (user: ReturnType<typeof userEvent.setup>) => user.click(screen.getByRole('checkbox'));

describe('LP e-sign inbox and signing', () => {
  it('lists requests with ref, title and the right action per row', async () => {
    const api = mockApi(routes());
    render(<SignaturesPage />);
    expect(await screen.findByText('Capital call 13 acknowledgement')).toBeInTheDocument();
    expect(screen.getByText('Subscription agreement')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Review and sign' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'View' })).toBeInTheDocument();
    expect(screen.getByText(/ESG-00007/)).toBeInTheDocument();
    expectNoUnmocked();
    expectCalled(api, `GET ${E}`);
  });

  it('empty inbox says nothing needs signing', async () => {
    mockApi(routes({ [`GET ${E}`]: raw({ data: [] }) }));
    render(<SignaturesPage />);
    expect(await screen.findByText('Nothing needs your signature right now.')).toBeInTheDocument();
  });

  it('list failure shows the API message', async () => {
    mockApi(routes({ [`GET ${E}`]: fail(500, 'INTERNAL', 'E-sign unavailable') }));
    render(<SignaturesPage />);
    expect(await screen.findByRole('alert')).toHaveTextContent('E-sign unavailable');
  });

  it('opening a request shows signers, the placement hint and loads the PDF', async () => {
    const { api } = await openSigner();
    expect(screen.getByText(/signing as Ann Alpha, Authorised signatory/)).toBeInTheDocument();
    expect(screen.getByText('Bob Beta')).toBeInTheDocument();
    expect(screen.getByText(/signature box is on page 2/)).toBeInTheDocument();
    await waitFor(() => expectCalled(api, `GET ${E}/:id/document`));
    expect(await screen.findByTitle('Capital call 13 acknowledgement')).toBeInTheDocument();
  });

  it('LPC-004: Sign is disabled until consent is given and the typed name matches the registered name', async () => {
    const { user, api } = await openSigner();
    const sign = screen.getByRole('button', { name: 'Sign document' });
    expect(sign).toBeDisabled(); // no consent yet
    await consent(user);
    expect(sign).toBeEnabled(); // prefilled with the registered name
    const input = screen.getByLabelText('Type your full name');
    await user.clear(input);
    await user.type(input, 'Someone Else');
    expect(sign).toBeDisabled();
    expect(screen.getByRole('alert')).toHaveTextContent('The typed name must match your registered name: Ann Alpha.');
    await user.clear(input);
    await user.type(input, '  ann   ALPHA ');
    expect(sign).toBeEnabled(); // case and spacing insensitive
    expect(api.calls(`POST ${E}/es-1/sign`)).toHaveLength(0);
  });

  it('typed signature POST carries mode, typed name and consent; then the inbox reloads with a notice', async () => {
    const { user, api } = await openSigner();
    await consent(user);
    await user.click(screen.getByRole('button', { name: 'Sign document' }));
    await screen.findByText('Signed ESG-00007.');
    const [r] = expectCalled(api, `POST ${E}/es-1/sign`);
    expect(r.body).toEqual({ mode: 'TYPED', typedName: 'Ann Alpha', consent: true });
    expect(api.calls(`GET ${E}`).length).toBeGreaterThanOrEqual(2);
  });

  it('API rejection of the signature is shown in the panel and the user stays on the document', async () => {
    const { user } = await openSigner({ [`POST ${E}/es-1/sign`]: fail(400, 'validation_error', 'The typed name must match your registered name (Ann Alpha)') });
    await consent(user);
    await user.click(screen.getByRole('button', { name: 'Sign document' }));
    const alerts = await screen.findAllByRole('alert');
    expect(alerts.some((a) => /must match your registered name/.test(a.textContent ?? ''))).toBe(true);
    expect(screen.getByRole('button', { name: 'Sign document' })).toBeInTheDocument();
  });

  it('draw mode cannot sign without a drawn signature', async () => {
    const { user } = await openSigner();
    await consent(user);
    await user.click(screen.getByRole('button', { name: 'Draw' }));
    expect(screen.getByRole('button', { name: 'Sign document' })).toBeDisabled();
  });

  it('step-up: first sign answers step_up_required, the code is confirmed, then the sign is retried', async () => {
    let signs = 0;
    const { user, api } = await openSigner({
      [`POST ${E}/es-1/sign`]: () => (signs++ === 0 ? fail(403, 'step_up_required', 'Confirm with your authenticator') : raw({ signed: true, status: 'PENDING', ref: 'ESG-00007' })),
      'POST /api/v1/auth/mfa/step-up': raw({ ok: true }),
    });
    await consent(user);
    await user.click(screen.getByRole('button', { name: 'Sign document' }));
    const dlg = await screen.findByRole('dialog');
    const confirm = within(dlg).getByRole('button', { name: 'Confirm' });
    expect(confirm).toBeDisabled();
    await user.type(within(dlg).getByLabelText('Authentication code'), '12ab3456');
    expect((within(dlg).getByLabelText('Authentication code') as HTMLInputElement).value).toBe('123456');
    await user.click(confirm);
    await screen.findByText('Signed ESG-00007.');
    expect(expectCalled(api, 'POST /api/v1/auth/mfa/step-up')[0].body).toEqual({ code: '123456' });
    expect(api.calls(`POST ${E}/es-1/sign`)).toHaveLength(2);
  });

  it('step-up cancelled: nothing is signed and the user is told so', async () => {
    const { user, api } = await openSigner({ [`POST ${E}/es-1/sign`]: fail(403, 'step_up_required', 'Confirm') });
    await consent(user);
    await user.click(screen.getByRole('button', { name: 'Sign document' }));
    const dlg = await screen.findByRole('dialog');
    await user.click(within(dlg).getByRole('button', { name: 'Cancel' }));
    const alerts = await screen.findAllByRole('alert');
    expect(alerts.some((a) => /Nothing was signed/.test(a.textContent ?? ''))).toBe(true);
    expect(api.calls(`POST ${E}/es-1/sign`)).toHaveLength(1);
  });

  it('signer without MFA enrolment is told to set it up', async () => {
    const { user } = await openSigner({ [`POST ${E}/es-1/sign`]: fail(403, 'mfa_enrolment_required', 'MFA enrolment required') });
    await consent(user);
    await user.click(screen.getByRole('button', { name: 'Sign document' }));
    const alerts = await screen.findAllByRole('alert');
    expect(alerts.some((a) => /Set up two-factor authentication/.test(a.textContent ?? ''))).toBe(true);
  });

  it('decline needs a reason of 3+ characters, then POSTs it and shows a notice', async () => {
    const { user, api } = await openSigner();
    await user.click(screen.getByRole('button', { name: 'Decline to sign' }));
    const confirm = screen.getByRole('button', { name: 'Confirm decline' });
    expect(confirm).toBeDisabled();
    await user.type(screen.getByPlaceholderText('Tell the sender why you are declining'), 'ab');
    expect(confirm).toBeDisabled();
    await user.type(screen.getByPlaceholderText('Tell the sender why you are declining'), 'c wrong amount');
    await user.click(confirm);
    await screen.findByText('You declined ESG-00007.');
    expect(expectCalled(api, `POST ${E}/es-1/decline`)[0].body).toEqual({ reason: 'abc wrong amount' });
    expectNotCalled(api, `POST ${E}/es-1/sign`);
  });

  it('a completed request opens read-only with sealed PDF and certificate downloads and no sign controls', async () => {
    const api = mockApi(routes());
    const user = userEvent.setup();
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
    render(<SignaturesPage />);
    await user.click(await screen.findByRole('button', { name: 'View' }));
    expect(await screen.findByText(/Everyone has signed/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Sign document' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Download certificate' }));
    await waitFor(() => expect(click).toHaveBeenCalled());
    const docs = api.calls(`GET ${E}/:id/document`);
    expect(docs[docs.length - 1].query.get('variant')).toBe('certificate');
    click.mockRestore();
  });
});
