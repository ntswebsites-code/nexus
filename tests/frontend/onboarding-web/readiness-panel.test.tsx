import { beforeEach, describe, expect, it } from 'vitest';
import userEvent from '@testing-library/user-event';
import { ReadinessPanel } from '@/components/ReadinessPanel';
import { expectCalled, mockApi, raw, screen, waitFor } from '../_helpers';
import { P, readinessView, renderApp } from './_support';

beforeEach(() => localStorage.clear());

describe('onboarding: readiness panel', () => {
  const session = { id: 'app-1', token: 'tok-123' };

  it('renders score, checks and risk badge from the server view', () => {
    renderApp(
      <ReadinessPanel
        session={session}
        readiness={readinessView({ score: 81, riskBand: 'LOW', checks: [{ name: 'Core profile', state: 'good', detail: 'Complete', right: '13/13' }] })}
        onRefresh={async () => undefined}
      />,
    );
    expect(screen.getByTestId('readiness-score')).toHaveTextContent('81%');
    expect(screen.getByTestId('readiness-risk')).toHaveTextContent('LOW review risk');
    expect(screen.getByText('Core profile')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Run AI-assisted pre-screen' })).toBeEnabled();
  });

  it('POST /triage then refreshes readiness via onRefresh', async () => {
    let refreshed = false;
    const api = mockApi({
      [`POST ${P}/applications/:id/triage`]: raw({
        data: { riskBand: 'MEDIUM', summary: 'PEP declared', flags: ['pep'], nextSteps: ['Review PEP'], model: 'fake-triage-v1', at: '2026-10-05T12:00:00.000Z', advisory: true },
      }),
    });
    const { user } = renderApp(
      <ReadinessPanel session={session} readiness={readinessView()} onRefresh={async () => { refreshed = true; }} />,
    );
    await user.click(screen.getByRole('button', { name: 'Run AI-assisted pre-screen' }));
    await waitFor(() => expectCalled(api, `POST ${P}/applications/:id/triage`));
    await waitFor(() => expect(refreshed).toBe(true));
  });

  it('shows the API error when triage fails', async () => {
    mockApi({ [`POST ${P}/applications/:id/triage`]: { status: 429, body: { error: { code: 'rate_limited', message: 'Try again later' } } } });
    const { user } = renderApp(<ReadinessPanel session={session} readiness={readinessView()} onRefresh={async () => undefined} />);
    await user.click(screen.getByRole('button', { name: 'Run AI-assisted pre-screen' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Try again later');
  });
});
