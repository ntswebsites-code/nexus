import { describe, it, expect, beforeEach } from 'vitest';
import { waitFor, expectCalled, expectNotCalled, expectBody, expectIdempotencyKey } from '../_helpers';
import { healthyRoutes, P, ok, fail, financialReport, reportingRequest, monthKey, monthBounds } from './_fixtures';
import { mountPortal, installBrowserStubs, seeText, setValue, type Mounted } from './_portal';

let stubs: ReturnType<typeof installBrowserStubs>;
beforeEach(() => {
  stubs = installBrowserStubs();
});

const KEY = monthKey(1);
const RETURNED = monthKey(2);
const SUBMITTED = monthKey(3);
const OVERDUE = monthKey(5);
const draftRoute = `POST ${P}/financial-reports/:kind/draft`;

function reportRoutes(extra: Parameters<typeof healthyRoutes>[0] = {}) {
  return healthyRoutes({
    [`GET ${P}/financial-reports`]: ok([
      financialReport({ id: 'it_d1', status: 'DRAFT', isDraft: true, canSubmit: true, title: 'Management accounts · Aug 2026', reportingPeriod: '2026-08' }),
      financialReport({ id: 'it_s1', status: 'SUBMITTED', title: 'Management accounts · Jul 2026', reportingPeriod: '2026-07' }),
      financialReport({ id: 'it_r1', status: 'NEEDS_REVISION', isDraft: true, canSubmit: true, title: 'KPIs · Jun 2026', reportingPeriod: '2026-06', reviewerComment: 'Fix the KPI sheet' }),
    ]),
    [`GET ${P}/reporting/requests`]: ok([
      reportingRequest(KEY),
      reportingRequest(RETURNED, { status: 'RETURNED', portalStatus: 'CHANGES_REQUESTED' }),
      reportingRequest(SUBMITTED, { status: 'SUBMITTED', portalStatus: 'SUBMITTED', canEdit: false, canSubmit: false }),
      reportingRequest(OVERDUE, { dueDate: '2026-01-10' }),
    ]),
    [draftRoute]: (_r, p) => ok({ id: `draft_${p.kind}`, reportType: p.kind, status: 'DRAFT' }, 201),
    [`POST ${P}/financial-reports/period-kpis`]: ok({ periodStart: '', periodEnd: '', totalRevenue: 160, netProfit: 110, cashFlowNet: 25 }, 201),
    [`POST ${P}/financial-reports/submit/:id`]: ok({ submitted: true }),
    ...extra,
  });
}

const sectionBtn = (label: string) => [...document.querySelectorAll<HTMLElement>('#modalBody [data-action="report-section"]')].find((b) => b.textContent!.includes(label))!;
async function fillSection(m: Mounted, label: string, values: Record<string, string>) {
  await m.user.click(sectionBtn(label));
  await m.settle(20);
  for (const [k, v] of Object.entries(values)) setValue(m.q<HTMLInputElement>(`[data-report-field="${k}"]`), v);
}
const INCOME = { merchantRevenue: '100', enterpriseRevenue: '50', otherRevenue: '10', processingCosts: '20', supportLosses: '5', salesMarketing: '10', productEngineering: '10', generalAdmin: '5' };
const BALANCED = { cashAndEquivalents: '100', tradeReceivables: '20', otherCurrentAssets: '0', fixedAssets: '30', otherAssets: '0', tradePayables: '20', accruedExpenses: '10', debt: '40', otherLiabilities: '0', shareCapital: '50', retainedEarnings: '30' };
const CASH = { openingCash: '50', operatingCash: '20', capex: '5', financing: '10' };
const modalOpen = () => document.querySelector('#modalWrap.open') !== null;
const inline = () => document.querySelector('.ip8-inline-error')?.textContent ?? '';

async function openSubmitModal(m: Mounted) {
  await m.goto('reports');
  await m.user.click(m.qa('[data-action="submit-report"]')[0]);
  await m.settle();
}

describe('Reporting Centre: schedule, drafts, history, templates (INO-004)', () => {
  it('schedule lists the real reporting requests with humanised status (no enums), marks overdue periods', async () => {
    const m = await mountPortal(reportRoutes());
    await m.goto('reports');
    const t = m.workspace();
    expect(t).toContain('Reporting open');
    expect(t).toContain('Changes requested');
    expect(t).toContain('Submitted');
    expect(t).toMatch(/Overdue/);
    expect(t).not.toMatch(/REPORTING_OPEN|CHANGES_REQUESTED|NEEDS_REVISION|rp_\d{4}/);
  });

  it('draft workspace lists only the real draft / returned reports; submitted ones are not drafts', async () => {
    const m = await mountPortal(reportRoutes());
    await m.goto('reports');
    await m.user.click([...m.qa('[data-action="report-tab"]')].find((b) => b.textContent === 'Draft workspace')!);
    const t = m.q('#workspace').textContent!;
    expect(t).toContain('Management accounts · Aug 2026');
    expect(t).toContain('KPIs · Jun 2026');
    expect(t).not.toContain('Management accounts · Jul 2026');
    expect(t).toContain('Needs revision');
    expect(t).not.toMatch(/NEEDS_REVISION|it_d1/);
  });

  it('draft workspace has an empty state when there are no drafts (not demo rows)', async () => {
    const m = await mountPortal(reportRoutes({ [`GET ${P}/financial-reports`]: ok([]) }));
    await m.goto('reports');
    await m.user.click([...m.qa('[data-action="report-tab"]')].find((b) => b.textContent === 'Draft workspace')!);
    expect(m.q('#workspace').textContent).not.toMatch(/Q2 2026 Investor Report|RPT-0\d\d/);
  });

  it('submission history shows humanised type/status and period, with no UUIDs or enums', async () => {
    const m = await mountPortal(reportRoutes());
    await m.goto('reports');
    await m.user.click([...m.qa('[data-action="report-tab"]')].find((b) => b.textContent === 'Submission history')!);
    const t = m.q('#workspace').textContent!;
    expect(t).toContain('Income statement');
    expect(t).toContain('Submitted');
    expect(t).not.toMatch(/INCOME_STATEMENT|SUBMITTED\b|DRAFT\b/);
  });

  it('templates tab lists the four real downloadable templates', async () => {
    const m = await mountPortal(reportRoutes());
    await m.goto('reports');
    await m.user.click([...m.qa('[data-action="report-tab"]')].find((b) => b.textContent === 'Templates')!);
    const types = m.qa('#workspace [data-action="download-template"][data-template]').map((e) => e.dataset.template);
    expect(types).toEqual(['INCOME_STATEMENT', 'BALANCE_SHEET', 'CASHFLOW_STATEMENT', 'OPERATIONAL_KPIS']);
  });

  it('a template download requests GET /financial-reports/template/:type and saves the file under the server filename', async () => {
    const m = await mountPortal(
      reportRoutes({
        [`GET ${P}/financial-reports/template/:type`]: { status: 200, body: 'xlsx-bytes', headers: { 'content-disposition': 'attachment; filename="balance-sheet-template.xlsx"', 'content-type': 'application/octet-stream' } },
      }),
    );
    await m.goto('reports');
    await m.user.click([...m.qa('[data-action="report-tab"]')].find((b) => b.textContent === 'Templates')!);
    await m.user.click(m.q('#workspace [data-template="BALANCE_SHEET"]'));
    await seeText(m, 'Template downloaded');
    expect(expectCalled(m.api, `GET ${P}/financial-reports/template/:type`)[0].path.endsWith('/BALANCE_SHEET')).toBe(true);
    expect(stubs.downloads.map((d) => d.name)).toEqual(['balance-sheet-template.xlsx']);
  });

  it('a template download failure shows the API message, not a silent no-op', async () => {
    const m = await mountPortal(reportRoutes({ [`GET ${P}/financial-reports/template/:type`]: fail(404, 'not_found', 'Template not found') }));
    await m.goto('reports');
    await m.user.click(m.qa('[data-action="download-template"]')[0]);
    await seeText(m, 'Template not found');
  });

  it('opening a history row fetches /financial-reports/:id and shows the report in a drawer', async () => {
    const m = await mountPortal(reportRoutes({ [`GET ${P}/financial-reports/it_s1`]: ok(financialReport({ id: 'it_s1', title: 'Management accounts · Jul 2026', status: 'SUBMITTED' })) }));
    await m.goto('reports');
    await m.user.click([...m.qa('[data-action="report-tab"]')].find((b) => b.textContent === 'Submission history')!);
    await m.user.click(m.q('#workspace [data-action="live-report-detail"][data-id="it_s1"]'));
    await waitFor(() => expect(m.drawer().textContent).toContain('Management accounts · Jul 2026'));
    expectCalled(m.api, `GET ${P}/financial-reports/it_s1`);
    expect(m.drawer().textContent).not.toMatch(/it_s1|SUBMITTED\b/);
  });
});

describe('INO-002: the submit-report modal uses real periods, owners and blank values', () => {
  it('periods come from the open/returned reporting requests (submitted ones excluded, labelled with due date), owners from /team, inputs start blank', async () => {
    const m = await mountPortal(reportRoutes());
    await openSubmitModal(m);
    const periods = m.qa<HTMLOptionElement>('#reportPackPeriod option').map((o) => [o.value, o.textContent]);
    const keys = periods.map((p) => p[0]);
    expect(keys).toContain(KEY);
    expect(keys).toContain(RETURNED);
    expect(keys).toContain(OVERDUE);
    expect(keys).not.toContain(SUBMITTED);
    expect(periods.find((p) => p[0] === KEY)![1]).toMatch(/Open · due \d{2} \w{3} \d{4}/);
    expect(periods.find((p) => p[0] === RETURNED)![1]).toMatch(/Returned for changes · due/);
    const owners = m.qa<HTMLOptionElement>('#reportPackOwner option').map((o) => o.textContent);
    expect(owners).toEqual(['Tariro Moyo · CFO', 'Chipo Dube · CEO']);
    expect(modalOpen()).toBe(true);
    for (const el of m.qa<HTMLInputElement>('#modalBody [data-report-field]')) expect(el.value, el.dataset.reportField).toBe('');
    expect(m.modal().textContent).not.toMatch(/Zambezi|Tariro Moyo · CFO · Nyasha/);
  });
});

describe('Save draft (reports.draft) and Validate & submit flows', () => {
  it('Save draft posts one draft per statement for the selected request period, then closes, toasts and reloads', async () => {
    const m = await mountPortal(reportRoutes());
    await openSubmitModal(m);
    await fillSection(m, 'Income statement', INCOME);
    const reloadsBefore = m.api.calls(`GET ${P}/reporting/requests`).length;
    await m.act('save-structured-report', m.modal());
    await seeText(m, 'Report draft saved');
    const calls = expectCalled(m.api, draftRoute, 3);
    expect(calls.map((c) => c.path.split('/').slice(-2)[0])).toEqual(['income-statement', 'balance-sheet', 'cash-flow']);
    const b = monthBounds(KEY);
    expectBody(calls[0], { reportingPeriod: b.periodEnd, periodType: 'MONTHLY', periodStart: b.periodStart, periodEnd: b.periodEnd, templateVersion: 'v1', version: 3, description: 'Prepared by Tariro Moyo · CFO' });
    expect((calls[0].body as { title: string }).title).toBe(`Monthly management accounts · income statement · ${b.label}`);
    expect((calls[0].body as { data: Record<string, number> }).data).toMatchObject({ merchantRevenue: 100, enterpriseRevenue: 50, otherRevenue: 10, processingCosts: 20, generalAdmin: 5 });
    // optimistic-lock version only on the first statement
    expect((calls[1].body as Record<string, unknown>).version).toBeUndefined();
    for (const c of calls) expectIdempotencyKey(c);
    expect(new Set(calls.map((c) => c.idempotencyKey)).size).toBe(3);
    expect(modalOpen()).toBe(false);
    expect(m.api.calls(`GET ${P}/reporting/requests`).length).toBeGreaterThan(reloadsBefore);
    expectNotCalled(m.api, `POST ${P}/financial-reports/submit/:id`);
  });

  it('INO-003: Validate & submit with an unbalanced sheet keeps the modal open, shows the difference inline, posts nothing', async () => {
    const m = await mountPortal(reportRoutes());
    await openSubmitModal(m);
    await fillSection(m, 'Income statement', INCOME);
    await fillSection(m, 'Balance sheet', { ...BALANCED, shareCapital: '40' }); // assets 150 vs L+E 140
    await fillSection(m, 'Cash flow', CASH);
    await m.act('submit-structured-report', m.modal());
    await waitFor(() => expect(inline()).toMatch(/does not balance/));
    expect(inline()).toMatch(/total assets 150 and liabilities plus equity 140 differ by 10/);
    expect(modalOpen()).toBe(true);
    await seeText(m, 'Request failed');
    expectNotCalled(m.api, draftRoute);
    expectNotCalled(m.api, `POST ${P}/financial-reports/submit/:id`);
  });

  it('INO-003: Save draft still saves an unbalanced sheet but the toast says it is unbalanced', async () => {
    const m = await mountPortal(reportRoutes());
    await openSubmitModal(m);
    await fillSection(m, 'Balance sheet', { ...BALANCED, shareCapital: '40' });
    await m.act('save-structured-report', m.modal());
    await seeText(m, 'does not balance');
    expectCalled(m.api, draftRoute, 3);
  });

  it('Validate & submit (balanced) saves 3 drafts, posts period KPIs derived from the lines, then submits the first draft', async () => {
    const m = await mountPortal(reportRoutes());
    await openSubmitModal(m);
    await fillSection(m, 'Income statement', INCOME);
    await fillSection(m, 'Balance sheet', BALANCED);
    await fillSection(m, 'Cash flow', CASH);
    await m.user.click(sectionBtn('Commentary'));
    await m.settle(20);
    const summary = m.modal().querySelector<HTMLTextAreaElement>('[data-report-field="executiveSummary"]');
    if (summary) setValue(summary, 'Strong quarter');
    await m.act('submit-structured-report', m.modal());
    await seeText(m, 'Investor report submitted');
    const drafts = expectCalled(m.api, draftRoute, 3);
    const bs = drafts[1].body as { data: Record<string, number> };
    expect(bs.data).toMatchObject({ totalAssets: 150, totalLiabilities: 70, totalEquity: 80 });
    const [kpi] = expectCalled(m.api, `POST ${P}/financial-reports/period-kpis`);
    const b = monthBounds(KEY);
    expectBody(kpi, { periodStart: b.periodStart, periodEnd: b.periodEnd, totalRevenue: 160, netProfit: 110, cashFlowNet: 25 });
    expectIdempotencyKey(kpi);
    const [sub] = expectCalled(m.api, `POST ${P}/financial-reports/submit/:id`);
    expect(sub.path.endsWith('/submit/draft_income-statement')).toBe(true);
    expectIdempotencyKey(sub);
    if (summary) expect((sub.body as { notes: string }).notes).toContain('Strong quarter');
    expect(modalOpen()).toBe(false);
    // ordering: drafts -> kpis -> submit
    const order = m.api.requests.map((r) => r.path.replace(P, '')).filter((p) => /draft|period-kpis|submit/.test(p) && !p.startsWith('/reporting'));
    expect(order.at(-1)).toBe('/financial-reports/submit/draft_income-statement');
    expect(order.indexOf('/financial-reports/period-kpis')).toBeGreaterThan(order.indexOf('/financial-reports/cash-flow/draft'));
  });

  it('a validation error from the API names the failing field (not a generic "Validation failed") and keeps the modal open', async () => {
    const m = await mountPortal(
      reportRoutes({
        [draftRoute]: fail(400, 'validation_error', 'Validation failed', [{ path: ['data', 'merchantRevenue'], message: 'Must be a number' }]),
      }),
    );
    await openSubmitModal(m);
    await fillSection(m, 'Income statement', INCOME);
    await m.act('save-structured-report', m.modal());
    await waitFor(() => expect(inline()).toMatch(/data\.merchantRevenue: Must be a number/));
    expect(inline()).not.toMatch(/^Check the form\s*Validation failed$/);
    expect(modalOpen()).toBe(true);
    await seeText(m, 'Request failed');
  });

  it('a stale version (409) is shown as the server message and nothing is submitted', async () => {
    const m = await mountPortal(reportRoutes({ [draftRoute]: fail(409, 'conflict', 'This period was changed by someone else. Reload and try again.') }));
    await openSubmitModal(m);
    await fillSection(m, 'Income statement', INCOME);
    await fillSection(m, 'Balance sheet', BALANCED);
    await m.act('submit-structured-report', m.modal());
    await waitFor(() => expect(inline()).toMatch(/changed by someone else/));
    expectNotCalled(m.api, `POST ${P}/financial-reports/submit/:id`);
  });

  it('network failure while saving shows a readable message (no stack/blank)', async () => {
    const m = await mountPortal(reportRoutes());
    await openSubmitModal(m);
    await fillSection(m, 'Income statement', INCOME);
    m.api.on(draftRoute, () => {
      throw new Error('socket hang up');
    });
    await m.act('save-structured-report', m.modal());
    await waitFor(() => expect(inline()).toMatch(/Could not reach the Matanho API/));
  });

  it('double-click protection: a second click while the first save is in flight sends nothing extra', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const m = await mountPortal(
      reportRoutes({
        [draftRoute]: async (_r, p) => {
          await gate;
          return ok({ id: `draft_${p.kind}`, reportType: p.kind }, 201);
        },
      }),
    );
    await openSubmitModal(m);
    await fillSection(m, 'Income statement', INCOME);
    const btn = m.q('#modalFoot [data-action="save-structured-report"], #modalBody [data-action="save-structured-report"]');
    await m.user.click(btn);
    await m.user.click(btn);
    await m.settle(50);
    expect(m.api.calls(draftRoute)).toHaveLength(1); // only the first statement is in flight
    release();
    await seeText(m, 'Report draft saved');
    expect(m.api.calls(draftRoute)).toHaveLength(3); // exactly one save, not two
  });

  it('periods without an open request cannot be posted: choosing none shows an actionable message', async () => {
    const m = await mountPortal(reportRoutes({ [`GET ${P}/reporting/requests`]: ok([reportingRequest(SUBMITTED, { status: 'SUBMITTED', portalStatus: 'SUBMITTED', canEdit: false, canSubmit: false })]) }));
    await openSubmitModal(m);
    expect(m.qa<HTMLOptionElement>('#reportPackPeriod option').map((o) => [o.value, o.textContent])).toEqual([['', 'No open reporting period']]);
    await m.act('save-structured-report', m.modal());
    await waitFor(() => expect(inline()).toMatch(/reporting period|open request/i));
    expectNotCalled(m.api, draftRoute);
  });
});

describe('Submitting an existing draft from its detail drawer', () => {
  it('opens a draft in the history, then Submit posts /financial-reports/submit/:id and refreshes', async () => {
    const m = await mountPortal(reportRoutes({ [`GET ${P}/financial-reports/it_d1`]: ok(financialReport({ id: 'it_d1', status: 'DRAFT', isDraft: true, canSubmit: true, title: 'Management accounts · Aug 2026' })) }));
    await m.goto('reports');
    await m.user.click([...m.qa('[data-action="report-tab"]')].find((b) => b.textContent === 'Submission history')!);
    await m.user.click(m.q('#workspace [data-action="live-report-detail"][data-id="it_d1"]'));
    await waitFor(() => expect(m.drawer().querySelector('[data-action="submit-financial-report-bundle"]')).not.toBeNull());
    await m.act('submit-financial-report-bundle', m.drawer());
    await seeText(m, 'Report submitted');
    const [req] = expectCalled(m.api, `POST ${P}/financial-reports/submit/:id`);
    expect(req.path.endsWith('/submit/it_d1')).toBe(true);
    expectIdempotencyKey(req);
  });

  it('a submitted report offers no Submit action', async () => {
    const m = await mountPortal(reportRoutes({ [`GET ${P}/financial-reports/it_s1`]: ok(financialReport({ id: 'it_s1', status: 'SUBMITTED' })) }));
    await m.goto('reports');
    await m.user.click([...m.qa('[data-action="report-tab"]')].find((b) => b.textContent === 'Submission history')!);
    await m.user.click(m.q('#workspace [data-action="live-report-detail"][data-id="it_s1"]'));
    await waitFor(() => expect(m.drawer().textContent).toContain('Management accounts'));
    expect(m.drawer().querySelector('[data-action="submit-financial-report-bundle"]')).toBeNull();
  });
});
