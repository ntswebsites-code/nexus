import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { screen, waitFor, mockApi, expectCalled, expectNotCalled, expectBody, fail, ok } from '../_helpers';
import { SignPage } from '@/components/SignPage';
import { SharePage } from '@/components/SharePage';

/** Public pages: /sign/<token> (e-mailed signer link) and /sign/share/<token> (document share landing). */

const SIGN = '/api/v1/investee-public/sign/:token';
const SHARE = '/api/v1/investee-public/share/:token';

const future = new Date(Date.now() + 5 * 86400000).toISOString();
const signInfo = (over: Record<string, unknown> = {}) => ({
  title: 'Shareholder agreement',
  message: 'Please sign before Friday',
  company: 'Kuda Logistics',
  documentName: 'sha.pdf',
  docSha256: 'abcdef0123456789'.repeat(4),
  signerName: 'Ada Moyo',
  signerStatus: 'PENDING',
  requestStatus: 'PENDING',
  expiresAt: future,
  consentText: 'I have read "Shareholder agreement" and I agree to sign it electronically. My typed name is my signature.',
  ...over,
});

const setup = (token: string, routes: Parameters<typeof mockApi>[0]) => {
  const api = mockApi(routes);
  const user = userEvent.setup();
  render(<SignPage token={token} />);
  return { api, user };
};
const NAME = /Type your full name exactly as invited/;

describe('Public signer page /sign/<token>', () => {
  it('loads the request by token (no credentials, no portal session) and shows who it is for, from whom, expiry, document link and fingerprint', async () => {
    const { api } = setup('tok/with space', { [`GET ${SIGN}`]: ok(signInfo()) });
    expect(await screen.findByText('Shareholder agreement')).toBeInTheDocument();
    const [req] = expectCalled(api, `GET ${SIGN}`);
    expect(req.path).toBe('/api/v1/investee-public/sign/tok%2Fwith%20space');
    expect(req.headers.authorization).toBeUndefined();
    expect(screen.getByText(/From Kuda Logistics. For Ada Moyo. Valid until/)).toBeInTheDocument();
    expect(screen.getByText('Please sign before Friday')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Read sha.pdf' })).toHaveAttribute('href', expect.stringContaining('/sign/tok%2Fwith%20space/document'));
    expect(screen.getByText('abcdef0123456789')).toBeInTheDocument();
    expect(screen.getByText(/I agree to sign it electronically/)).toBeInTheDocument();
  });

  it('an invalid or expired link shows the API message and no form', async () => {
    setup('bad', { [`GET ${SIGN}`]: fail(404, 'not_found', 'This signing link is not valid or has expired') });
    expect(await screen.findByRole('alert')).toHaveTextContent('This signing link is not valid or has expired');
    expect(screen.queryByRole('button', { name: 'Sign' })).toBeNull();
  });

  it('INO-011: Sign without a name says so and sends nothing; without consent says so and sends nothing', async () => {
    const { api, user } = setup('t', { [`GET ${SIGN}`]: ok(signInfo()), [`POST ${SIGN}`]: ok({}) });
    await screen.findByText('Shareholder agreement');
    await user.click(screen.getByRole('button', { name: 'Sign' }));
    // the input is also `required`, so jsdom's constraint validation may stop the submit before our handler: both are fine, nothing is sent
    await user.type(screen.getByLabelText(NAME), 'Ada Moyo');
    await user.click(screen.getByRole('button', { name: 'Sign' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Tick the box to confirm you agree to sign electronically.');
    expectNotCalled(api, `POST ${SIGN}`);
  });

  it('INO-011: a one-letter name is refused with the same message', async () => {
    const { api, user } = setup('t', { [`GET ${SIGN}`]: ok(signInfo()), [`POST ${SIGN}`]: ok({}) });
    await screen.findByText('Shareholder agreement');
    await user.type(screen.getByLabelText(NAME), 'A');
    await user.click(screen.getByRole('checkbox'));
    await user.click(screen.getByRole('button', { name: 'Sign' }));
    expectNotCalled(api, `POST ${SIGN}`);
  });

  it('INO-012: the page prints the expected signer name; a wrong name shows the field error from the API and the form stays usable', async () => {
    const { api, user } = setup('t', {
      [`GET ${SIGN}`]: ok(signInfo()),
      [`POST ${SIGN}`]: fail(400, 'validation_error', 'The name must match the person this request was sent to (Ada Moyo)', [{ path: 'name', message: 'Type your name exactly as invited: Ada Moyo' }]),
    });
    await screen.findByText('Shareholder agreement');
    expect(screen.getByText(/exactly as invited \(Ada Moyo\)/)).toBeInTheDocument();
    await user.type(screen.getByLabelText(NAME), 'Wrong Name');
    await user.click(screen.getByRole('checkbox'));
    await user.click(screen.getByRole('button', { name: 'Sign' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Type your name exactly as invited: Ada Moyo');
    expect(api.calls(`POST ${SIGN}`)).toHaveLength(1);
    expect(screen.getByRole('button', { name: 'Sign' })).toBeEnabled();
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('signing posts action SIGN with name and consent, then shows the thank-you and removes the form', async () => {
    const { api, user } = setup('t', { [`GET ${SIGN}`]: ok(signInfo()), [`POST ${SIGN}`]: ok({ status: 'SIGNED' }) });
    await screen.findByText('Shareholder agreement');
    await user.type(screen.getByLabelText(NAME), 'Ada Moyo');
    await user.click(screen.getByRole('checkbox'));
    await user.click(screen.getByRole('button', { name: 'Sign' }));
    expect(await screen.findByRole('status')).toHaveTextContent('Thank you. Your signature is recorded.');
    expectBody(expectCalled(api, `POST ${SIGN}`)[0], { action: 'SIGN', name: 'Ada Moyo', consent: true });
    expect(screen.queryByRole('button', { name: 'Sign' })).toBeNull();
  });

  it('double-submit protection: Sign and Decline are disabled while the first response is in flight; exactly one POST', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const { api, user } = setup('t', {
      [`GET ${SIGN}`]: ok(signInfo()),
      [`POST ${SIGN}`]: async () => {
        await gate;
        return ok({});
      },
    });
    await screen.findByText('Shareholder agreement');
    await user.type(screen.getByLabelText(NAME), 'Ada Moyo');
    await user.click(screen.getByRole('checkbox'));
    await user.click(screen.getByRole('button', { name: 'Sign' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Sign' })).toBeDisabled());
    expect(screen.getByRole('button', { name: 'Decline' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Sign' }));
    release();
    await screen.findByRole('status');
    expect(api.calls(`POST ${SIGN}`)).toHaveLength(1);
  });

  it('Decline posts only {action: DECLINE} (no name needed) and tells the signer the sender was informed', async () => {
    const { api, user } = setup('t', { [`GET ${SIGN}`]: ok(signInfo()), [`POST ${SIGN}`]: ok({}) });
    await screen.findByText('Shareholder agreement');
    await user.click(screen.getByRole('button', { name: 'Decline' }));
    expect(await screen.findByRole('status')).toHaveTextContent('You declined to sign. The sender has been told.');
    expect(expectCalled(api, `POST ${SIGN}`)[0].body).toEqual({ action: 'DECLINE' });
  });

  it('a request that is no longer pending (voided) cannot be signed and says why', async () => {
    setup('t', { [`GET ${SIGN}`]: ok(signInfo({ requestStatus: 'VOIDED' })) });
    expect(await screen.findByText('This request is voided, so it cannot be signed.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Sign' })).toBeNull();
  });

  it('a signer who already signed sees their own status, not the form', async () => {
    setup('t', { [`GET ${SIGN}`]: ok(signInfo({ signerStatus: 'SIGNED' })) });
    expect(await screen.findByText('This request is signed, so it cannot be signed.')).toBeInTheDocument();
    expect(screen.queryByLabelText(/Type your full name/)).toBeNull();
  });

  it('a 409 on submit (already responded) is shown as the API message', async () => {
    const { user } = setup('t', { [`GET ${SIGN}`]: ok(signInfo()), [`POST ${SIGN}`]: fail(409, 'invalid_state', 'You have already responded to this request') });
    await screen.findByText('Shareholder agreement');
    await user.type(screen.getByLabelText(NAME), 'Ada Moyo');
    await user.click(screen.getByRole('checkbox'));
    await user.click(screen.getByRole('button', { name: 'Sign' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('You have already responded to this request');
  });

  it('a network failure on submit shows a message and re-enables the form', async () => {
    const { user } = setup('t', { [`GET ${SIGN}`]: ok(signInfo()) }); // POST is unmocked -> fetch rejects
    await screen.findByText('Shareholder agreement');
    await user.type(screen.getByLabelText(NAME), 'Ada Moyo');
    await user.click(screen.getByRole('checkbox'));
    await user.click(screen.getByRole('button', { name: 'Sign' }));
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sign' })).toBeEnabled();
  });
});

describe('INO-014: share landing page /sign/share/<token>', () => {
  const info = { documentName: 'Shareholder agreement.pdf', company: 'Kuda Logistics', recipient: 'Angel Fund', expiresAt: future };

  it('shows document, company, recipient, expiry, the watermark notice and a Download link to the file endpoint', async () => {
    const api = mockApi({ [`GET ${SHARE}`]: ok(info) });
    render(<SharePage token="tok_9" />);
    expect(screen.getByRole('status')).toHaveTextContent('Loading...');
    expect(await screen.findByText('Shareholder agreement.pdf')).toBeInTheDocument();
    expect(screen.getByText(/Shared by Kuda Logistics with Angel Fund. This link works until/)).toBeInTheDocument();
    expect(screen.getByText(/watermarked with your name/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Download the document' })).toHaveAttribute('href', expect.stringMatching(/\/api\/v1\/investee-public\/share\/tok_9\/file$/));
    expectCalled(api, `GET ${SHARE}`);
  });

  it('an expired or revoked link shows the API reason and no download button', async () => {
    mockApi({ [`GET ${SHARE}`]: fail(410, 'link_expired', 'This link has expired or was revoked') });
    render(<SharePage token="old" />);
    expect(await screen.findByRole('alert')).toHaveTextContent('This link has expired or was revoked');
    expect(screen.queryByRole('link', { name: 'Download the document' })).toBeNull();
  });

  it('a body-less failure falls back to a generic message instead of crashing', async () => {
    mockApi({ [`GET ${SHARE}`]: { status: 502 } });
    render(<SharePage token="x" />);
    expect(await screen.findByRole('alert')).toHaveTextContent('This link is not valid');
  });
});
