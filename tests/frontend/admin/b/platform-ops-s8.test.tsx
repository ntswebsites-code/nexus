import { describe, it, expect } from 'vitest';
import PortalFlagsPage from '@/app/(ops)/ops/portal-flags/page';
import { RetentionSchedules } from '@/ops/vault-retention';
import { InvestmentPackButton, defaultPackRange } from '@/ops/investment-pack';
import { mountPage } from './_kit';
import { raw, ok, screen, waitFor, expectCalled, expectBody, expectIdempotencyKey } from '../../_helpers';

const flags = (o: Record<string, unknown> = {}) => ({
  env: { lp: { portfolio: true, statements: false }, investee: { liveActions: ['forecast'] }, custodian: { live: false }, onboarding: { live: true }, storage: { backend: 'local' } },
  overrides: { demoMode: false, lp: {}, investeeLiveActions: null, custodianLive: null, onboardingLive: null },
  effective: {},
  version: 3,
  updatedAt: '2026-10-01T08:00:00Z',
  lpDomains: ['portfolio', 'statements'],
  ...o,
});

describe('Portal flags (S26)', () => {
  it('saves overrides with the reason, version and an idempotency key', async () => {
    const { api, user } = await mountPage(<PortalFlagsPage />, { routes: { 'GET /api/v1/platform/flags/admin': raw(flags()), 'PUT /api/v1/platform/flags/admin': raw(flags({ version: 4 })) } });
    await user.selectOptions(await screen.findByLabelText('statements override'), 'live');
    const save = screen.getByRole('button', { name: 'Save flags' });
    expect(save).toBeDisabled();
    await user.type(screen.getByLabelText(/Reason/), 'Enable statements for UAT');
    await user.click(save);
    await waitFor(() => expectCalled(api, 'PUT /api/v1/platform/flags/admin'));
    const req = expectCalled(api, 'PUT /api/v1/platform/flags/admin')[0];
    expectBody(req, { demoMode: false, lp: { statements: true }, version: 3, reason: 'Enable statements for UAT', investeeLiveActions: null });
    expectIdempotencyKey(req);
  });
  it('master demo switch disables the per-area overrides', async () => {
    const { user } = await mountPage(<PortalFlagsPage />, { routes: { 'GET /api/v1/platform/flags/admin': raw(flags()) } });
    await user.click(await screen.findByLabelText('Force every portal to demo data'));
    expect(screen.getByLabelText('statements override')).toBeDisabled();
  });
  it('is blocked without admin.settings', async () => {
    await mountPage(<PortalFlagsPage />, { perms: ['dashboard.view'], routes: { 'GET /api/v1/platform/flags/admin': raw(flags()) } });
    expect(await screen.findByText(/does not include platform settings/)).toBeInTheDocument();
  });
});

const sched = { id: 's1', docType: 'kyc', classification: '*', retentionYears: 7, basis: 'AML', active: true, version: 1, updatedAt: '2026-10-01T00:00:00Z' };
const sch = { data: [sched], activeHolds: 2, documents: 40, types: ['kyc', 'tax'], classifications: ['Internal', 'Restricted'] };

describe('Retention schedules (FR-DOC-017)', () => {
  it('lists schedules and edits one with a reason', async () => {
    const { api, user } = await mountPage(<RetentionSchedules />, { perms: ['documents.view', 'documents.approve'], routes: { 'GET /api/v1/client-ops/vault/retention-schedules': raw(sch), 'PATCH /api/v1/client-ops/vault/retention-schedules/:id': raw({ schedule: sched }) } });
    expect(await screen.findByText('AML')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Edit' }));
    const years = await screen.findByLabelText('Minimum retention (years)');
    await user.clear(years);
    await user.type(years, '10');
    await user.type(screen.getByLabelText('Reason'), 'Policy update 2026');
    await user.click(screen.getByRole('button', { name: 'Save schedule' }));
    await waitFor(() => expectCalled(api, 'PATCH /api/v1/client-ops/vault/retention-schedules/:id'));
    const req = expectCalled(api, 'PATCH /api/v1/client-ops/vault/retention-schedules/:id')[0];
    expectBody(req, { retentionYears: 10, version: 1, reason: 'Policy update 2026' });
    expectIdempotencyKey(req);
  });
  it('hides editing from read-only users', async () => {
    await mountPage(<RetentionSchedules />, { perms: ['documents.view'], routes: { 'GET /api/v1/client-ops/vault/retention-schedules': raw(sch) } });
    expect(await screen.findByText('AML')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Edit' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Add schedule' })).not.toBeInTheDocument();
  });
});

describe('Investment pack (FR-DASH-005)', () => {
  it('defaults to the last three months', () => {
    expect(defaultPackRange(new Date('2026-10-15T10:00:00Z'))).toEqual({ from: '2026-07-15', to: '2026-10-15' });
  });
  it('generates a NAV_PACK PDF run through the reports module', async () => {
    const { api, user } = await mountPage(<InvestmentPackButton />, {
      routes: {
        'GET /api/v1/reports/lookups': ok({ portfolios: [{ id: 'p1', ref: 'PF-1', name: 'Balanced Growth' }] }),
        'POST /api/v1/reports/runs': ok({ id: 'r1', ref: 'RUN-1', hasFile: false }, 201),
      },
    });
    await user.click(screen.getByRole('button', { name: 'Investment pack' }));
    await user.click(await screen.findByRole('button', { name: 'Generate pack' }));
    await waitFor(() => expectCalled(api, 'POST /api/v1/reports/runs'));
    const req = expectCalled(api, 'POST /api/v1/reports/runs')[0];
    expectBody(req, { key: 'NAV_PACK', format: 'PDF' });
    expectIdempotencyKey(req);
    expect(await screen.findByText(/Investment pack RUN-1 generated/)).toBeInTheDocument();
  });
  it('is disabled without reports.create', async () => {
    await mountPage(<InvestmentPackButton />, { perms: ['dashboard.view'] });
    expect(screen.getByRole('button', { name: 'Investment pack' })).toBeDisabled();
  });
});
