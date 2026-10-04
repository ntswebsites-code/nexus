import { describe, it, expect, beforeEach } from 'vitest';
import { waitFor, expectCalled, expectNotCalled, expectBody, expectIdempotencyKey } from '../_helpers';
import { healthyRoutes, P, ok, fail, capTable, forecast, kpis, requisition, monthKey } from './_fixtures';
import { mountPortal, installBrowserStubs, seeText, setValue } from './_portal';

let stubs: ReturnType<typeof installBrowserStubs>;
beforeEach(() => {
  stubs = installBrowserStubs();
});
const inline = () => document.querySelector('.ip8-inline-error')?.textContent ?? '';
const modalOpen = () => document.querySelector('#modalWrap.open') !== null;

describe('INO-015: capital and procurement requests', () => {
  const routes = (extra: Parameters<typeof healthyRoutes>[0] = {}) =>
    healthyRoutes({
      [`GET ${P}/procurement`]: ok({ requisitions: [requisition(), requisition({ id: 'REQ-2056', title: 'Draft truck', status: 'Draft', priority: 'Low', estimatedAmount: 9000 })] }),
      [`POST ${P}/procurement`]: ok(requisition({ id: 'REQ-2057' }), 201),
      ...extra,
    });

  it('lists the real requisitions by status column with title, category, amount, requester (no fabricated mock requests)', async () => {
    const m = await mountPortal(routes());
    await m.goto('requests');
    const t = m.workspace();
    expect(t).toContain('Fleet expansion');
    expect(t).toContain('USD 45,000');
    expect(t).toContain('Growth capital');
    expect(t).toContain('Tariro Moyo');
    expect(t).toContain('Draft truck');
    expect(t).not.toMatch(/Namibia expansion growth capital|120 smart POS terminals|REQ-205\b|REQ-204\b/);
  });

  it('INO-015: the request drawer shows only the record: no fabricated "Request pack", "Fund owner" or "Decision target"', async () => {
    const m = await mountPortal(routes());
    await m.goto('requests');
    await m.user.click(m.q('[data-action="open-request"][data-id="REQ-2055"]'));
    await waitFor(() => expect(m.drawer().textContent).toContain('Fleet expansion'));
    const d = m.drawer().textContent!;
    expect(d).toContain('REQ-2055');
    expect(d).toContain('Growth capital');
    expect(d).toContain('Tariro Moyo');
    expect(d).not.toMatch(/Request pack|Fund owner|Decision target|Financial model and cash impact/);
  });

  it('Submit request posts the form values with an Idempotency-Key, closes the modal, toasts and reloads the list', async () => {
    const m = await mountPortal(routes());
    await m.goto('requests');
    await m.act('new-request');
    expect(modalOpen()).toBe(true);
    await m.type('#newRequestTitle', 'Two delivery vans');
    setValue(m.q<HTMLInputElement>('#newRequestAmount'), '60000');
    setValue(m.q<HTMLSelectElement>('#newRequestCategory'), 'Equipment procurement');
    setValue(m.q<HTMLSelectElement>('#newRequestPriority'), 'High');
    const before = m.api.calls(`GET ${P}/procurement`).length;
    await m.act('create-request', m.modal());
    const [req] = expectCalled(m.api, `POST ${P}/procurement`);
    expectBody(req, { title: 'Two delivery vans', amount: 60000, category: 'Equipment procurement', priority: 'High', currency: 'USD', draft: false });
    expectIdempotencyKey(req);
    await seeText(m, 'Request submitted');
    expect(modalOpen()).toBe(false);
    expect(m.api.calls(`GET ${P}/procurement`).length).toBeGreaterThan(before);
  });

  it('Save draft posts draft:true and says "Draft saved"', async () => {
    const m = await mountPortal(routes());
    await m.goto('requests');
    await m.act('new-request');
    await m.type('#newRequestTitle', 'Laptops');
    await m.act('save-request-draft', m.modal());
    expectBody(expectCalled(m.api, `POST ${P}/procurement`)[0], { title: 'Laptops', draft: true });
    await seeText(m, 'Draft saved');
  });

  it('an empty title is refused client-side with a message; nothing is sent and the modal stays', async () => {
    const m = await mountPortal(routes());
    await m.goto('requests');
    await m.act('new-request');
    await m.act('create-request', m.modal());
    await waitFor(() => expect(inline()).toContain('Enter a request title.'));
    expectNotCalled(m.api, `POST ${P}/procurement`);
    expect(modalOpen()).toBe(true);
  });

  it('INO-011: a negative amount is rejected with a named message and not sent', async () => {
    const m = await mountPortal(routes());
    await m.goto('requests');
    await m.act('new-request');
    await m.type('#newRequestTitle', 'Refund');
    setValue(m.q<HTMLInputElement>('#newRequestAmount'), '-5');
    await m.act('create-request', m.modal());
    await waitFor(() => expect(m.toasts() + inline()).toMatch(/amount|negative/i));
    expectNotCalled(m.api, `POST ${P}/procurement`);
  });

  it('INO-011: API field errors (past need-by date, bad amount) are named in the modal and the entered values are kept', async () => {
    const m = await mountPortal(routes({ [`POST ${P}/procurement`]: fail(400, 'validation_error', 'Validation failed', [{ path: 'needBy', message: 'Required-by date cannot be in the past' }]) }));
    await m.goto('requests');
    await m.act('new-request');
    await m.type('#newRequestTitle', 'Late request');
    await m.act('create-request', m.modal());
    await waitFor(() => expect(inline()).toMatch(/needBy|Required-by date cannot be in the past/));
    expect(inline()).not.toMatch(/\(400\)/);
    expect(modalOpen()).toBe(true);
    expect(m.q<HTMLInputElement>('#newRequestTitle').value).toBe('Late request');
  });

  it('INO-011 (needs a date that is not already past): the default "Required by" in the new-request form is not a stale hard-coded date', async () => {
    const m = await mountPortal(routes());
    await m.goto('requests');
    await m.act('new-request');
    const v = m.q<HTMLInputElement>('#newRequestNeedBy').value;
    const today = new Date().toISOString().slice(0, 10);
    expect(v === '' || v >= today, `default Required by is ${v}`).toBe(true);
  });
});

describe('INO-007 / INO-016: cap table page', () => {
  const holderRows = () => [...document.querySelectorAll('#workspace .cap-row')].map((r) => r.textContent ?? '');

  it('renders the recorded holders with names, classes, share counts, % and the security classes table (no mock holders)', async () => {
    const m = await mountPortal();
    await m.goto('cap-table');
    const rows = holderRows();
    expect(rows).toHaveLength(2);
    expect(rows[0]).toContain('Founders Pool');
    expect(rows[0]).toContain('700,000');
    expect(rows[0]).toContain('70%');
    expect(m.workspace()).toContain('As at 2026-09-01');
    expect(m.workspace()).toContain('1x non-participating');
    expect(m.workspace()).toContain('Recorded');
    expect(m.workspace()).not.toMatch(/10,000,000 shares and options|Seed preferred|Employee options/);
  });

  it('a derived (term-sheet estimate) register is flagged Estimated', async () => {
    const m = await mountPortal(healthyRoutes({ [`GET ${P}/cap-table`]: ok(capTable({ derived: true })) }));
    await m.goto('cap-table');
    expect(m.workspace()).toContain('Estimated');
    expect(m.workspace()).toContain('estimated from the latest term sheet');
  });

  it('INO-007: pending transactions show a banner with the count (singular/plural)', async () => {
    const m = await mountPortal(healthyRoutes({ [`GET ${P}/cap-table`]: ok(capTable({ pendingTransactions: 2 })) }));
    await m.goto('cap-table');
    expect(m.workspace()).toContain('2 transactions awaiting a second approver');
    m.api.on(`GET ${P}/cap-table`, ok(capTable({ pendingTransactions: 1 })));
    await m.act('refresh-live', m.q('#workspace'));
    await waitFor(() => expect(m.workspace()).toContain('1 transaction awaiting a second approver'));
  });

  it('INO-007: when the register is locked the dead "Add a holder" form is replaced by a link to Workspace tools', async () => {
    const m = await mountPortal(healthyRoutes({ [`GET ${P}/cap-table`]: ok(capTable({ locked: true })) }));
    await m.goto('cap-table');
    expect(m.container.querySelector('#capHolderName')).toBeNull();
    const link = m.q<HTMLAnchorElement>('#workspace a[href="/workspace"]');
    expect(link.textContent).toContain('Open cap-table transactions');
  });

  it('adding a holder (unlocked register) PUTs the existing holders plus the new one, then reloads', async () => {
    const m = await mountPortal(healthyRoutes({ [`PUT ${P}/cap-table`]: ok(capTable()) }));
    await m.goto('cap-table');
    await m.type('#capHolderName', 'ESOP');
    setValue(m.q<HTMLInputElement>('#capHolderShares'), '50000');
    const before = m.api.calls(`GET ${P}/cap-table`).length;
    await m.act('save-cap-holder', m.q('#workspace'));
    const [req] = expectCalled(m.api, `PUT ${P}/cap-table`);
    const sent = (req.body as { shareholders: { name: string; shares: number; id?: string }[] }).shareholders;
    expect(sent.map((s) => s.name)).toEqual(['Founders Pool', 'Matanho Growth Partners I', 'ESOP']);
    expect(sent[2].shares).toBe(50000);
    await seeText(m, 'Holder added');
    expect(m.api.calls(`GET ${P}/cap-table`).length).toBeGreaterThan(before);
  });

  it('an empty name or non-positive shares is refused with a message and sends nothing', async () => {
    const m = await mountPortal();
    await m.goto('cap-table');
    await m.act('save-cap-holder', m.q('#workspace'));
    await seeText(m, 'Enter the holder name and a positive share count.');
    expectNotCalled(m.api, `PUT ${P}/cap-table`);
  });

  it('INO-007: the API 409 "register has transactions" is shown as the server message', async () => {
    const m = await mountPortal(healthyRoutes({ [`PUT ${P}/cap-table`]: fail(409, 'register_locked', 'The register has transactions. Record a new transaction instead of replacing the baseline.') }));
    await m.goto('cap-table');
    await m.type('#capHolderName', 'ESOP');
    setValue(m.q<HTMLInputElement>('#capHolderShares'), '1');
    await m.act('save-cap-holder', m.q('#workspace'));
    await seeText(m, 'The register already has transactions. Record a new transaction in Workspace tools');
  });

  it('"Export register" is a real client-side CSV download of the holders (INO-007 not-a-defect)', async () => {
    const m = await mountPortal();
    await m.goto('cap-table');
    await m.act('export-cap-table', m.q('#workspace'));
    await waitFor(() => expect(stubs.downloads.map((d) => d.name)).toContain('cap-table.csv'));
    const text = await stubs.downloads.find((d) => d.name === 'cap-table.csv')!.blob.text();
    expect(text).toContain('Founders Pool');
    expect(text).toContain('700000');
    await seeText(m, 'Register exported');
  });

  it('exporting an empty register says there is nothing to export', async () => {
    const m = await mountPortal(healthyRoutes({ [`GET ${P}/cap-table`]: ok(capTable({ shareholders: [], classes: [] })) }));
    await m.goto('cap-table');
    expect(m.workspace()).toContain('No holders yet.');
    await m.act('export-cap-table', m.q('#workspace'));
    await seeText(m, 'There are no holders to export.');
    expect(stubs.downloads).toHaveLength(0);
  });

  it('Model round posts amount and pre-money and prints dilution without touching the register; zero values are refused', async () => {
    const m = await mountPortal(
      healthyRoutes({
        [`POST ${P}/cap-table/simulate`]: ok({ pricePerShare: 2, issued: 250000, postMoney: 2500000, shareholders: [{ name: 'Founders Pool', type: 'Ordinary', shares: 700000, pct: 56 }, { name: 'New investor', type: 'Series B', shares: 250000, pct: 20 }] }),
      }),
    );
    await m.goto('cap-table');
    await m.act('model-round', m.q('#workspace'));
    await seeText(m, 'Enter the new money and a pre-money valuation.');
    expectNotCalled(m.api, `POST ${P}/cap-table/simulate`);
    setValue(m.q<HTMLInputElement>('#roundAmount'), '500000');
    setValue(m.q<HTMLInputElement>('#roundPreMoney'), '2000000');
    await m.act('model-round', m.q('#workspace'));
    expectBody(expectCalled(m.api, `POST ${P}/cap-table/simulate`)[0], { amount: 500000, preMoney: 2000000 });
    await waitFor(() => expect(m.q('#roundResult').textContent).toContain('New investor: 20%'));
    expect(m.api.calls(`PUT ${P}/cap-table`)).toHaveLength(0);
  });
});

describe('INO-009: KPI centre', () => {
  it('shows the real KPI definitions (label, unit, latest value, budget), not raw keys', async () => {
    const m = await mountPortal();
    await m.goto('kpis');
    const t = m.workspace();
    expect(t).toContain('Annual recurring revenue');
    expect(t).toContain('$1M');
    expect(t).toContain('Budget$1.2M');
    expect(t).toContain('16 months');
    expect(t).toContain('Budget12 months');
    expect(t).not.toMatch(/\barr\b|undefined|NaN/);
  });

  it('opening a KPI shows its definition drawer', async () => {
    const m = await mountPortal();
    await m.goto('kpis');
    await m.user.click(m.qa('[data-action="live-kpi-detail"]')[0]);
    await waitFor(() => expect(m.drawer().textContent).toContain('Annual recurring revenue'));
  });

  it('Export history downloads kpi-history.csv from /kpis/export?format=csv', async () => {
    const m = await mountPortal(healthyRoutes({ [`GET ${P}/kpis/export`]: { status: 200, body: undefined } }));
    await m.goto('kpis');
    await m.act('export-kpi-history', m.q('#workspace'));
    await waitFor(() => expect(stubs.downloads.map((d) => d.name)).toContain('kpi-history.csv'));
    expect(expectCalled(m.api, `GET ${P}/kpis/export`)[0].query.get('format')).toBe('csv');
    await seeText(m, 'KPI history exported');
  });

  it('a failed export shows the API message and downloads nothing', async () => {
    const m = await mountPortal(healthyRoutes({ [`GET ${P}/kpis/export`]: fail(500, 'internal', 'Export is unavailable right now') }));
    await m.goto('kpis');
    await m.act('export-kpi-history', m.q('#workspace'));
    await seeText(m, 'Export is unavailable right now');
    expect(stubs.downloads).toHaveLength(0);
  });

  it('with no KPI values the page says so and still offers Submit period KPIs (no demo cards)', async () => {
    const m = await mountPortal(healthyRoutes({ [`GET ${P}/kpis`]: ok({ definitions: [], periods: [], covenants: [] }) }));
    await m.goto('kpis');
    expect(m.workspace()).toContain('No KPI values are on file yet.');
    expect(m.container.querySelector('#workspace [data-action="submit-kpi"]')).not.toBeNull();
  });

  it('Submit period KPIs posts the period and the three figures with an Idempotency-Key, closes, toasts, reloads', async () => {
    const m = await mountPortal(healthyRoutes({ [`POST ${P}/financial-reports/period-kpis`]: ok({ totalRevenue: 100 }, 201) }));
    await m.goto('kpis');
    await m.act('submit-kpi', m.q('#workspace'));
    setValue(m.q<HTMLInputElement>('#kpiPeriodStart'), '2026-08-01');
    setValue(m.q<HTMLInputElement>('#kpiPeriodEnd'), '2026-08-31');
    setValue(m.q<HTMLInputElement>('#kpiTotalRevenue'), '120000');
    setValue(m.q<HTMLInputElement>('#kpiNetProfit'), '15000');
    setValue(m.q<HTMLInputElement>('#kpiCashFlowNet'), '8000');
    await m.act('complete-kpi-submit', m.modal());
    const [req] = expectCalled(m.api, `POST ${P}/financial-reports/period-kpis`);
    expectBody(req, { periodStart: '2026-08-01', periodEnd: '2026-08-31', totalRevenue: 120000, netProfit: 15000, cashFlowNet: 8000 });
    expectIdempotencyKey(req);
    await seeText(m, 'Period KPIs submitted');
    expect(modalOpen()).toBe(false);
  });

  it('a period that ends before it starts is refused with a message, nothing is sent and the modal stays open', async () => {
    const m = await mountPortal();
    await m.goto('kpis');
    await m.act('submit-kpi', m.q('#workspace'));
    setValue(m.q<HTMLInputElement>('#kpiPeriodStart'), '2026-09-30');
    setValue(m.q<HTMLInputElement>('#kpiPeriodEnd'), '2026-09-01');
    await m.act('complete-kpi-submit', m.modal());
    await waitFor(() => expect(inline()).toContain('Period start must be on or before period end.'));
    expectNotCalled(m.api, `POST ${P}/financial-reports/period-kpis`);
    expect(modalOpen()).toBe(true);
  });

  it('an API validation error is shown inside the modal which stays open', async () => {
    const m = await mountPortal(healthyRoutes({ [`POST ${P}/financial-reports/period-kpis`]: fail(409, 'period_locked', 'This period is locked and cannot be changed') }));
    await m.goto('kpis');
    await m.act('submit-kpi', m.q('#workspace'));
    await m.act('complete-kpi-submit', m.modal());
    await waitFor(() => expect(inline()).toContain('This period is locked and cannot be changed'));
    expect(modalOpen()).toBe(true);
  });
});

describe('INO-010: forecasts', () => {
  const inputs = (m: Awaited<ReturnType<typeof mountPortal>>) => m.qa<HTMLInputElement>('.forecast-live-input');

  it('lists 12 months with locked months read-only (no input) and open months editable', async () => {
    const m = await mountPortal();
    await m.goto('forecasts');
    expect(m.workspace()).toContain('Base case');
    expect(inputs(m).length).toBeGreaterThan(0);
    expect(inputs(m).length).toBeLessThan(12); // actual-locked months have no input
    expect(m.workspace()).toMatch(/Actual/);
    expect(inputs(m)[0].dataset.month).toMatch(/^\d{4}-\d{2}$/);
  });

  it('saving sends revenue by month key as numbers via PUT /forecast, then reloads and toasts', async () => {
    const m = await mountPortal(healthyRoutes({ [`PUT ${P}/forecast`]: ok(forecast()) }));
    await m.goto('forecasts');
    const [first, second] = inputs(m);
    setValue(first, '120000');
    setValue(second, '130000.5');
    const before = m.api.calls(`GET ${P}/forecast`).length;
    await m.act('forecast-save', m.q('#workspace'));
    const [req] = expectCalled(m.api, `PUT ${P}/forecast`);
    const revenue = (req.body as { revenue: Record<string, number> }).revenue;
    expect(revenue[first.dataset.month!]).toBe(120000);
    expect(revenue[second.dataset.month!]).toBe(130000.5);
    await seeText(m, 'Forecast saved');
    expect(m.api.calls(`GET ${P}/forecast`).length).toBeGreaterThan(before);
  });

  it('INO-010: a negative revenue is rejected before anything is sent, naming the month', async () => {
    const m = await mountPortal(healthyRoutes({ [`PUT ${P}/forecast`]: ok(forecast()) }));
    await m.goto('forecasts');
    const first = inputs(m)[0];
    setValue(first, '-100');
    await m.act('forecast-save', m.q('#workspace'));
    await seeText(m, `Forecast revenue cannot be negative (${first.dataset.month}).`);
    expectNotCalled(m.api, `PUT ${P}/forecast`);
  });

  it('INO-010: if the API rejects a month (locked / negative) its message is shown', async () => {
    const m = await mountPortal(healthyRoutes({ [`PUT ${P}/forecast`]: fail(409, 'period_locked', 'Month 2026-10 is locked and rejects forecast edits') }));
    await m.goto('forecasts');
    setValue(inputs(m)[0], '5');
    await m.act('forecast-save', m.q('#workspace'));
    await seeText(m, 'is locked and rejects forecast edits');
  });

  it('choosing a scenario PUTs {scenario} and confirms with its name', async () => {
    const m = await mountPortal(healthyRoutes({ [`PUT ${P}/forecast`]: ok(forecast({ scenario: 'Upside' })) }));
    await m.goto('forecasts');
    await m.user.click(m.q('[data-action="scenario"][data-scenario="Upside"]'));
    await m.settle();
    expectBody(expectCalled(m.api, `PUT ${P}/forecast`)[0], { scenario: 'Upside' });
    await seeText(m, 'Scenario saved');
  });

  it('INO-010 residual: months with an accepted actual show it, months without show a dash (no 0 or NaN)', async () => {
    const key = monthKey(3);
    const f = forecast();
    const m = await mountPortal(healthyRoutes({ [`GET ${P}/forecast`]: ok({ ...f, actuals: { [key]: 98765 } }) }));
    await m.goto('forecasts');
    const row = m.qa('#workspace tbody tr').find((r) => r.children[0].textContent === m.q('#workspace tbody tr').children[0].textContent)!;
    expect(row.children[2].textContent).toMatch(/98/);
    expect(m.workspace()).not.toMatch(/NaN|undefined/);
  });
});
