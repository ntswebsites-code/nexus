import { describe, it, expect } from 'vitest';
import {
  parseDecimal, formatMoney, formatMoneyCompact, formatPercent, formatMultiple, formatUnits, formatDate,
  formatFileSize, niceAxisMax, createIdempotencyKey, daysUntil,
} from '@/lib/lp-portal/format';
import {
  mapCapitalCallRow, mapCapitalCallStatus, mapDistributionRow, mapDistributionType, mapDealingRequestRow,
  mapDocumentRow, mapDocumentCategory, mapNoticeRow, mapNoticeStatus, mapServiceRequestRow, mapMessageThreadRow,
  mapRequestStatus, mapRequestPriority, mapDashboardAction, mapRecentActivityRow, mapHistoryChartPoint,
  mapSessionFund, mapAccountActivityRow, mapActivityEntryKind, mapThreadParticipants, mapPerformanceStructure,
} from '@/lib/lp-portal/mappers';
import { resolveLpLinkedRecordHref, resolveRequestTypeHref, resolveDocumentHref } from '@/lib/lp-portal/navigation';
import { getApiErrorMessage, getApiFieldErrors, getApiErrorCode } from '@/lib/lp-portal/use-lp-api';

describe('format', () => {
  it('parseDecimal tolerates null, empty, junk', () => {
    expect(parseDecimal(null)).toBe(0);
    expect(parseDecimal('')).toBe(0);
    expect(parseDecimal('abc')).toBe(0);
    expect(parseDecimal('1250000.50')).toBe(1250000.5);
  });
  it('formatMoney formats decimal strings, compact thresholds', () => {
    expect(formatMoney('1234.5')).toBe('$1,234.50');
    expect(formatMoney(null)).toBe('$0.00');
    expect(formatMoneyCompact('1500000')).toBe('$1.50M');
    expect(formatMoneyCompact('2500')).toBe('$2.5K');
    expect(formatMoneyCompact('2500000000')).toBe('$2.50B');
    expect(formatMoneyCompact('999')).toBe('$999.00');
  });
  it('formatPercent treats API decimals as fractions', () => {
    expect(formatPercent('0.1870')).toBe('18.7%');
    expect(formatPercent('18.7')).toBe('18.7%');
    expect(formatPercent(null)).toBe('0.0%');
  });
  it('multiples, units, file size', () => {
    expect(formatMultiple('1.5')).toBe('1.50x');
    expect(formatUnits('1234.5')).toBe('1,234.50');
    expect(formatFileSize(0)).toBe('—');
    expect(formatFileSize(undefined)).toBe('—');
    expect(formatFileSize(500)).toBe('500 B');
    expect(formatFileSize(2048)).toBe('2.0 KB');
    expect(formatFileSize(3 * 1024 * 1024)).toBe('3.0 MB');
  });
  it('formatDate handles empty, invalid, date-only (no TZ shift) and datetime', () => {
    expect(formatDate(null)).toBe('—');
    expect(formatDate('not-a-date')).toBe('not-a-date');
    expect(formatDate('2026-03-15')).toBe('Mar 15, 2026');
    expect(formatDate('2026-03-15', 'long')).toBe('March 15, 2026');
    expect(formatDate('2026-03-15T10:30:00', 'datetime')).toMatch(/Mar 15, 2026/);
  });
  it('daysUntil is whole days from today', () => {
    const d = new Date();
    d.setDate(d.getDate() + 3);
    const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    expect(daysUntil(iso)).toBe(3);
  });
  it('idempotency keys are unique', () => {
    expect(createIdempotencyKey()).not.toBe(createIdempotencyKey());
  });
  it('niceAxisMax scales with the data (axis fix: a 1.25M peak must not sit on a 0-50 axis)', () => {
    expect(niceAxisMax(1.25)).toBe(2);
    expect(niceAxisMax(0)).toBeGreaterThan(0);
    expect(niceAxisMax(43)).toBe(50);
    expect(niceAxisMax(120)).toBe(200);
    for (const v of [0.3, 1.25, 7, 49, 51, 900, 1234]) expect(niceAxisMax(v)).toBeGreaterThanOrEqual(v);
  });
});

describe('mappers', () => {
  const call = {
    id: 'cc1', callNo: 3, fundId: 'f1', fundName: 'Growth Fund I', issueDate: '2026-01-01', dueDate: '2000-01-01',
    currencyCode: 'USD', amount: '200000.00', paid: '50000.00', outstanding: '150000.00', status: 'OVERDUE', acknowledgedAt: null,
  };
  it('capital call row: numbers parsed, status mapped, fund name not id', () => {
    const row = mapCapitalCallRow(call);
    expect(row).toMatchObject({ fund: 'Growth Fund I', amount: 200000, paid: 50000, outstanding: 150000, status: 'Overdue', dueSoon: false });
    expect(mapCapitalCallStatus('PAID')).toBe('Paid');
    expect(mapCapitalCallStatus('ISSUED')).toBe('Issued');
    expect(mapCapitalCallStatus('PARTIALLY_PAID')).toBe('Issued');
  });
  it('LPC-023: distribution type is shown as the API reports it, never re-bucketed', () => {
    expect(mapDistributionType('Exit Proceeds')).toBe('Exit Proceeds');
    expect(mapDistributionType('Dividend')).toBe('Dividend');
    expect(mapDistributionType('RETURN_OF_CAPITAL')).toBe('Return Of Capital');
    expect(mapDistributionType('')).toBe('Distribution');
    const r = mapDistributionRow({
      id: 'd1', reference: 'DIST-008', fundId: 'f1', fundName: 'Growth Fund I', paymentDate: '2026-02-01', type: 'Exit Proceeds',
      currencyCode: 'USD', gross: '100.00', adjustments: '-5.00', netPaid: '95.00', status: 'PAID', destinationBankMasked: null, documentId: null,
    });
    expect(r).toMatchObject({ ref: 'DIST-008', type: 'Exit Proceeds', netPaid: 95, adjustments: -5 });
  });
  it('dealing row: name falls back to lookup then id; status title-cased', () => {
    const base = { id: 'r1', fundId: 'f9', requestType: 'REDEMPTION', status: 'AWAITING_FUNDS', amount: '10', units: '2', redemptionMode: null, currencyCode: 'USD', requestedDealingDate: '2026-07-01', estimateSnapshotId: 'e', isEstimate: true, createdAt: '2026-06-01T00:00:00Z' } as never;
    expect(mapDealingRequestRow(base, { f9: 'Open Fund' })).toMatchObject({ type: 'Redemption', fund: 'Open Fund', status: 'Awaiting Funds' });
    expect(mapDealingRequestRow(base).fund).toBe('f9');
  });
  it('documents: category label, sizes, missing fields', () => {
    expect(mapDocumentCategory('CALL_NOTICE')).toBe('Capital Calls');
    expect(mapDocumentCategory('SOMETHING_NEW')).toBe('Something New');
    const r = mapDocumentRow({
      id: 'doc1', name: 'Q2 Statement.pdf', fundId: 'f1', fundName: 'Growth Fund I', category: 'QUARTERLY_STATEMENT', period: null,
      publishedDate: '2026-07-01', version: '1', status: 'PUBLISHED', accessScope: 'FUND_LP', checksumSha256: 'abc', permissions: ['VIEW'],
      fileSizeBytes: 2048, mimeType: 'application/pdf',
    });
    expect(r).toMatchObject({ category: 'Statements', period: '—', fileSize: '2.0 KB', accessScope: 'FUND LP', fileKind: 'pdf', pages: 1 });
  });
  it('notices: status precedence and kind labels', () => {
    const n = { id: 'n1', title: 'T', status: 'PUBLISHED', fundId: 'f1', shareClass: null, publishedAt: '2026-01-01T00:00:00Z', acknowledgedAt: null } as never;
    expect(mapNoticeStatus(n)).toBe('Unread');
    expect(mapNoticeStatus({ ...(n as object), status: 'OPENED' } as never)).toBe('Opened');
    expect(mapNoticeStatus({ ...(n as object), acknowledgedAt: '2026-01-02' } as never)).toBe('Acknowledged');
    expect(mapNoticeRow({ ...(n as object), kind: 'CAPITAL_CALL', fundName: 'GF' } as never)).toMatchObject({ kind: 'Capital Call', fund: 'GF', requiresAck: true });
  });
  it('QA: request submittedBy accepts the API actor object (no React child crash) or a string', () => {
    const base = { id: 'q1', reference: 'REQ-1082', type: 'DOCUMENT_REQUEST', fundId: 'f1', fundName: 'GF', status: 'SUBMITTED', subject: 's', description: 'd', createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z' };
    expect(mapServiceRequestRow({ ...base, submittedBy: { id: 'u', name: 'Ann', email: 'a@x' } }).submittedBy).toBe('Ann');
    expect(mapServiceRequestRow({ ...base, submittedBy: { email: 'a@x' } }).submittedBy).toBe('a@x');
    expect(mapServiceRequestRow({ ...base, submittedBy: 'Bob' }).submittedBy).toBe('Bob');
    expect(mapServiceRequestRow({ ...base, submittedBy: null }).submittedBy).toBe('You');
    expect(typeof mapServiceRequestRow({ ...base, submittedBy: { id: 'u' } }).submittedBy).toBe('string');
    expect(mapServiceRequestRow(base).type).toBe('Document Request');
  });
  it('request status and priority', () => {
    expect(mapRequestStatus('AWAITING_INVESTOR')).toBe('Awaiting Investor');
    expect(mapRequestStatus('SUBMITTED')).toBe('Submitted');
    expect(mapRequestStatus('IN_REVIEW')).toBe('Under Review');
    expect(mapRequestPriority('URGENT')).toBe('High');
    expect(mapRequestPriority(undefined)).toBe('Medium');
    expect(mapRequestPriority('low')).toBe('Low');
  });
  it('QA: message thread unreadCount string is coerced ("0"+"1" must not concatenate)', () => {
    const t = (u: unknown) => mapMessageThreadRow({ id: 't', subject: 's', fundId: 'f', fundName: 'F', relatedType: 'REQUEST', relatedId: 'REQ-1', status: 'OPEN', lastMessageAt: '2026-01-01T00:00:00Z', lastMessagePreview: 'p', unreadCount: u as number });
    const sum = [t('0'), t('1')].reduce((s, x) => s + x.unread, 0);
    expect(sum).toBe(1);
    expect(t(undefined).unread).toBe(0);
    expect(t('x').unread).toBe(0);
  });
  it('thread participants get initials', () => {
    const p = mapThreadParticipants({ participants: [{ name: 'Jane Doe' }, { name: 'Sam', initials: 'SX' }] } as never);
    expect(p[0].initials).toBe('JD');
    expect(p[1].initials).toBe('SX');
  });
  it('LPC-024: dashboard action and recent activity rows without amount are not $0.00', () => {
    const a = mapDashboardAction({ id: 'a', type: 'CAPITAL_CALL_DUE', severity: 'HIGH', title: 'Call', fundId: 'f1', relatedRecordId: 'x', href: '/h', dueDate: null }, [mapSessionFund({ fundId: 'f1', fundName: 'Growth Fund I' } as never)]);
    expect(a.amount).toBeUndefined();
    expect(a.fund).toBe('Growth Fund I');
    expect(a.label).toBe('Capital Call Due');
    expect(mapDashboardAction({ id: 'a', type: 'T', severity: 's', title: 't', fundId: 'f', relatedRecordId: 'x', href: '/h', dueDate: '2026-02-01', amount: '1500000' }).amount).toBe('$1.50M');
    expect(mapRecentActivityRow({ id: 'r', type: 'T', title: 'L', fundId: 'f', amount: '', status: 's', at: '2026-01-01T00:00:00Z' }).amount).toBe(0);
  });
  it('history chart point scales to millions', () => {
    expect(mapHistoryChartPoint({ date: '2026-01-01', label: 'Q1', nav: '2500000', paidIn: '1000000', distributions: '500000' })).toEqual({ label: 'Q1', nav: 2.5, paidIn: 1, dist: 0.5 });
  });
  it('activity row, kind, structure', () => {
    expect(mapActivityEntryKind('CAPITAL_CALL')).toBe('contribution');
    expect(mapActivityEntryKind('DISTRIBUTION')).toBe('distribution');
    expect(mapActivityEntryKind('MGMT_FEE')).toBe('fee');
    const r = mapAccountActivityRow({ entryId: 'e1', entryType: 'SUBSCRIPTION', fundId: 'f', fundName: 'F', transactionDate: '2026-01-02', amount: '10.5', currency: 'USD', description: '', status: 'POSTED' } as never, 'Alpha');
    expect(r).toMatchObject({ kind: 'subscription', type: 'Subscription', originalAmount: 10.5, status: 'Posted', investor: 'Alpha' });
    expect(mapPerformanceStructure({ operatingModel: 'OPEN_ENDED' })).toBe('Open-End');
    expect(mapPerformanceStructure({ structure: 'PRIVATE_CAPITAL' })).toBe('Closed-End');
  });
});

describe('navigation', () => {
  it('maps linked records to LP routes, encodes ids, unknown => null', () => {
    expect(resolveLpLinkedRecordHref('NOTICE', 'n 1')).toBe('/lp-portal/notices?id=n%201');
    expect(resolveLpLinkedRecordHref('CapitalCall', 'c1')).toBe('/lp-portal/capital-activity?call=c1');
    expect(resolveLpLinkedRecordHref('distribution', 'd1')).toBe('/lp-portal/capital-activity?tab=distributions');
    expect(resolveLpLinkedRecordHref('REQUEST', 'REQ-1082')).toBe('/lp-portal/requests?ref=REQ-1082');
    expect(resolveLpLinkedRecordHref('REDEMPTION', 'r1')).toBe('/lp-portal/subscriptions-redemptions?request=r1');
    expect(resolveLpLinkedRecordHref('LEDGER_ENTRY', 'e1')).toBe('/lp-portal/account-activity?entry=e1');
    expect(resolveLpLinkedRecordHref('WEIRD', 'x')).toBeNull();
    expect(resolveRequestTypeHref('CAPITAL_CALL_QUERY')).toBe('/lp-portal/capital-activity');
    expect(resolveRequestTypeHref('PROFILE_UPDATE')).toBe('/lp-portal/organisation');
    expect(resolveRequestTypeHref('whatever')).toBe('/lp-portal/requests');
    expect(resolveDocumentHref('a/b')).toBe('/lp-portal/documents?document=a%2Fb');
  });
});

describe('error accessors', () => {
  it('read message/code/fieldErrors from LpApiError-like .response, with fallbacks', () => {
    const e = { response: { code: 'LP_VALIDATION', message: 'Bad', fieldErrors: { amountClaimed: 'Too high' } } };
    expect(getApiErrorMessage(e)).toBe('Bad');
    expect(getApiErrorCode(e)).toBe('LP_VALIDATION');
    expect(getApiFieldErrors(e)).toEqual({ amountClaimed: 'Too high' });
    expect(getApiErrorMessage(new Error('boom'))).toBe('boom');
    expect(getApiErrorMessage('x', 'fallback')).toBe('fallback');
    expect(getApiFieldErrors(new Error('x'))).toBeUndefined();
  });
});
