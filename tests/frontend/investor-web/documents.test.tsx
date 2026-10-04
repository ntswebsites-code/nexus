import { describe, it, expect, vi, beforeEach } from 'vitest';
import { LpDocumentCentreScreen } from '@/components/lp-portal/screens/lp-document-centre-screen';
import { toast } from 'sonner';
import { ok, fail, screen, waitFor, within, expectCalled, expectNoUnmocked } from '../_helpers';
import { API, liveApi, renderLp, list, FUND_PE, useNodeBlob } from './_lp';

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));
vi.mock('@/lib/lp-portal/realtime', async () => (await import('./_rt')).rtMock);

const doc = (over: Record<string, unknown> = {}) => ({
  id: 'doc-1', name: 'Q2 2026 Statement', fundId: FUND_PE.fundId, fundName: 'Growth Fund I', category: 'QUARTERLY_STATEMENT', period: '2026-Q2',
  publishedDate: '2026-07-01', version: '1', status: 'PUBLISHED', accessScope: 'FUND_LP', checksumSha256: 'abc123', permissions: ['VIEW', 'DOWNLOAD'],
  fileSizeBytes: 204800, pageCount: 4, mimeType: 'application/pdf', history: [], ...over,
});
const DOCS = [
  doc(),
  doc({ id: 'doc-2', name: 'Distribution Notice - DIST-2610-01', category: 'DISTRIBUTIONS', period: null }),
  doc({ id: 'doc-3', name: 'Call Notice 13', category: 'CALL_NOTICE', status: 'REQUIRES_SIGNATURE' }),
];
const SUMMARY = { total: 3, byCategory: [{ category: 'QUARTERLY_STATEMENT', count: 1 }, { category: 'DISTRIBUTIONS', count: 1 }, { category: 'CALL_NOTICE', count: 1 }], newThisWeek: 2, requiresSignature: 1, secureDownloadsYtd: 7 };

function routes(over: Record<string, unknown> = {}) {
  return {
    [`GET ${API}/documents/summary`]: ok(SUMMARY),
    [`GET ${API}/documents/:id/preview`]: ok({}),
    [`GET ${API}/documents/:id/download`]: ok({}),
    [`GET ${API}/documents/:id`]: (_r: unknown, p: Record<string, string>) => ok(DOCS.find((d) => d.id === p.id) ?? doc()),
    [`GET ${API}/documents`]: ok(list(DOCS, { pageSize: 20 })),
    ...over,
  } as never;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
  vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: vi.fn(() => 'blob:preview'), revokeObjectURL: vi.fn() }));
});

const table = async () => within(await screen.findByRole('table'));
const ready = async () => (await table()).findAllByText('Q2 2026 Statement');
const rowOf = async (name: string) => (await (await table()).findAllByText(name))[0].closest('tr')!;

describe('Document Centre', () => {
  it('lists documents with fund names, title-cased categories/status and size, requesting page 1 of 20', async () => {
    const api = liveApi(routes());
    renderLp(<LpDocumentCentreScreen />);
    const t = await table();
    expect((await t.findAllByText('Q2 2026 Statement')).length).toBeGreaterThan(0);
    expect(t.getAllByText('Growth Fund I').length).toBe(3);
    expect(t.getByText('Statements')).toBeInTheDocument();
    expect(t.getByText('Capital Calls')).toBeInTheDocument();
    expect(t.getAllByText('Published').length).toBe(2); // not "PUBLISHED"
    expect(t.queryByText('PUBLISHED')).not.toBeInTheDocument();
    expect(t.queryByText(FUND_PE.fundId)).not.toBeInTheDocument();
    const list1 = api.calls(`GET ${API}/documents`)[0];
    expect(list1.query.get('page')).toBe('1');
    expect(list1.query.get('pageSize')).toBe('20');
    expect(list1.query.get('category')).toBeNull();
    expectNoUnmocked();
  });

  it('LPC-008: a distribution notice is categorised "Distributions" (not Capital Calls)', async () => {
    liveApi(routes());
    renderLp(<LpDocumentCentreScreen />);
    const row = await rowOf('Distribution Notice - DIST-2610-01');
    expect(within(row).getByText('Distributions')).toBeInTheDocument();
    expect(within(row).queryByText('Capital Calls')).not.toBeInTheDocument();
  });

  it('LPC-008: the Distributions tab asks the API for DISTRIBUTIONS (it used to ask for MANUAL and hid the notices)', async () => {
    const api = liveApi(routes());
    const { user } = renderLp(<LpDocumentCentreScreen />);
    await ready();
    api.on(`GET ${API}/documents`, ok(list([DOCS[1]], { pageSize: 20 })));
    await user.click(screen.getByRole('button', { name: /^Distributions/ }));
    await waitFor(() => expect(api.calls(`GET ${API}/documents`).some((r) => r.query.get('category') === 'DISTRIBUTIONS')).toBe(true));
    expect(api.calls(`GET ${API}/documents`).some((r) => r.query.get('category') === 'MANUAL')).toBe(false);
    expect(await rowOf('Distribution Notice - DIST-2610-01')).toBeInTheDocument();
  });

  it('category tabs send the API category codes', async () => {
    const api = liveApi(routes());
    const { user } = renderLp(<LpDocumentCentreScreen />);
    await ready();
    await user.click(screen.getByRole('button', { name: /^Capital Calls/ }));
    await waitFor(() => expect(api.calls(`GET ${API}/documents`).some((r) => r.query.get('category') === 'CALL_NOTICE')).toBe(true));
    await user.click(screen.getByRole('button', { name: /^Statements/ }));
    await waitFor(() => expect(api.calls(`GET ${API}/documents`).some((r) => r.query.get('category') === 'QUARTERLY_STATEMENT')).toBe(true));
  });

  it('search is debounced and sent as q, resetting to page 1', async () => {
    const api = liveApi(routes());
    const { user } = renderLp(<LpDocumentCentreScreen />);
    await ready();
    const before = api.calls(`GET ${API}/documents`).length;
    await user.click(screen.getByPlaceholderText('Search documents...'));
    await user.paste('statement');
    await waitFor(() => expect(api.calls(`GET ${API}/documents`).some((r) => r.query.get('q') === 'statement')).toBe(true));
    // a single request for the whole word, not one per keystroke
    expect(api.calls(`GET ${API}/documents`).length - before).toBeLessThanOrEqual(2);
    expect(api.calls(`GET ${API}/documents`).find((r) => r.query.get('q') === 'statement')!.query.get('page')).toBe('1');
  });

  it('pagination: counts come from the API as NUMBERS (string totals used to break page state) and Next requests page 2', async () => {
    const api = liveApi(routes({ [`GET ${API}/documents`]: ok(list(DOCS, { pageSize: '20', total: '45', totalPages: '3', page: '1' })) }));
    const { user } = renderLp(<LpDocumentCentreScreen />);
    await ready();
    expect(screen.getByRole('button', { name: 'Previous page' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Next page' }));
    await waitFor(() => expect(api.calls(`GET ${API}/documents`).some((r) => r.query.get('page') === '2')).toBe(true));
    await user.click(screen.getByRole('button', { name: '3' }));
    await waitFor(() => expect(api.calls(`GET ${API}/documents`).some((r) => r.query.get('page') === '3')).toBe(true));
  });

  it('download fetches the document endpoint and toasts; a failure toasts the API message', async () => {
    useNodeBlob();
    const api = liveApi(routes());
    const { user } = renderLp(<LpDocumentCentreScreen />);
    await ready();
    await user.click(screen.getByRole('button', { name: 'Download Q2 2026 Statement' }));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Document downloaded.'));
    expectCalled(api, `GET ${API}/documents/doc-1/download`);
    api.on(`GET ${API}/documents/:id/download`, fail(403, 'LP_FORBIDDEN', 'You do not have download permission'));
    await user.click(screen.getByRole('button', { name: 'Download Q2 2026 Statement' }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('You do not have download permission'));
  });

  it('selecting a row loads that document detail and preview; an unavailable preview is reported, not silent', async () => {
    const api = liveApi(
      routes({
        [`GET ${API}/documents/:id/preview`]: (_r: unknown, p: Record<string, string>) => (p.id === 'doc-3' ? { status: 415, body: { success: false, code: 'LP_UNSUPPORTED', message: 'Unsupported' } } : ok({})),
      }),
    );
    const { user } = renderLp(<LpDocumentCentreScreen />);
    await rowOf('Call Notice 13');
    await waitFor(() => expectCalled(api, `GET ${API}/documents/doc-1`)); // first row selected by default
    await user.click(await rowOf('Call Notice 13'));
    await waitFor(() => expectCalled(api, `GET ${API}/documents/doc-3`));
    await waitFor(() => expect(toast.error).toHaveBeenCalled());
  });

  it('?document= deep link selects that document', async () => {
    const api = liveApi(routes());
    renderLp(<LpDocumentCentreScreen initialDocumentId="doc-3" />);
    await waitFor(() => expectCalled(api, `GET ${API}/documents/doc-3`));
  });

  it('error state is shown with the API message', async () => {
    liveApi(routes({ [`GET ${API}/documents`]: fail(500, 'internal', 'Documents unavailable') }));
    renderLp(<LpDocumentCentreScreen />);
    expect(await screen.findByText(/Documents unavailable/)).toBeInTheDocument();
  });

  it('empty state renders 0 results without crashing', async () => {
    liveApi(routes({ [`GET ${API}/documents`]: ok(list([], { pageSize: 20, totalPages: 0, total: 0 })), [`GET ${API}/documents/summary`]: ok({ total: 0, byCategory: [], newThisWeek: 0, requiresSignature: 0, secureDownloadsYtd: 0 }) }));
    renderLp(<LpDocumentCentreScreen />);
    await screen.findByPlaceholderText('Search documents...');
    await waitFor(() => expect(screen.queryByText('Loading documents…')).not.toBeInTheDocument());
    expect(document.body.textContent).not.toMatch(/NaN|undefined/);
  });

  it('KPI cards reflect the summary counts', async () => {
    liveApi(routes());
    renderLp(<LpDocumentCentreScreen />);
    await ready();
    await waitFor(() => expect(document.body.textContent).toContain('7'));
    expect(document.body.textContent).not.toMatch(/NaN/);
  });
});
