import { describe, it, expect } from 'vitest';
import DashboardPage from '@/app/(portal)/page';
import ExecutionsPage from '@/app/(portal)/executions/page';
import BulkUploadPage from '@/app/(portal)/executions/upload/page';
import DayEndPage from '@/app/(portal)/day-end/page';
import StatementsPage from '@/app/(portal)/statements/page';
import HistoryPage from '@/app/(portal)/history/page';
import UsersPage from '@/app/(portal)/users/page';
import NotificationsPage from '@/app/(portal)/notifications/page';
import { mockApi, raw, screen, waitFor } from '../_helpers';
import { renderPortal, shellRoutes } from './_support';

const C = '/api/v1/custodian';
const empty = {
  [`GET ${C}/dashboard`]: raw({ counterparty: { ref: 'CP-1', name: 'Stanbic', type: 'Custodian', accounts: [] }, executions: {}, submittedToday: 0, draftPackages: 0, unreadNotifications: 0, awaitingApproval: [], rejectedPackages: [], exceptions: [], lastStatement: null, feed: { mode: 'file-drop' } }),
  [`GET ${C}/executions`]: raw({ items: [] }),
  [`GET ${C}/executions-batches`]: raw({ items: [] }),
  [`GET ${C}/day-end`]: raw({ items: [] }),
  [`GET ${C}/statements`]: raw({ mode: 'file-drop', adapterError: null, files: [], statements: [] }),
  [`GET ${C}/holdings`]: raw({ date: null, items: [] }),
  [`GET ${C}/history`]: raw({ items: [] }),
  [`GET ${C}/users`]: raw({ canManage: true, items: [] }),
  'GET /api/v1/notifications': raw({ items: [], unread: 0 }),
};

describe('custodian wording', () => {
  it.each([
    ['Dashboard', DashboardPage, 'Stanbic'],
    ['Executions', ExecutionsPage, 'No executions match.'],
    ['Bulk upload', BulkUploadPage, 'No bulk uploads yet.'],
    ['Day-end', DayEndPage, 'No day-end packages yet.'],
    ['Statements', StatementsPage, 'No statement files yet.'],
    ['History', HistoryPage, 'No history yet.'],
    ['Users', UsersPage, 'Invite a colleague'],
    ['Notifications', NotificationsPage, 'You have no notifications.'],
  ] as const)('LPC-021: %s page has no "prototype" or "Demo" wording and no pre-filled demo values', async (_n, Page, ready) => {
    mockApi({ ...empty, ...shellRoutes({ role: 'approver' }) });
    const { container } = renderPortal(<Page />);
    await screen.findAllByText(ready);
    await waitFor(() => expect(screen.queryByText('Loading...')).toBeNull());
    expect(document.body.textContent).not.toMatch(/prototype|\bdemo\b|TRD-2609|DLTA\.ZW|IH Securities/i);
    for (const i of container.querySelectorAll('input[type=text], input:not([type]), input[inputmode]')) expect((i as HTMLInputElement).value).toBe('');
    expect(document.title).not.toMatch(/demo/i);
  });
});
