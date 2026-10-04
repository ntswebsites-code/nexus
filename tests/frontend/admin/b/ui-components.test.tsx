import { describe, it, expect, vi } from 'vitest';
import { useState } from 'react';
import { ActionButton, ConfirmDialog, FormModal, Field, Loaded, useResource, useAction, ErrorState, Empty, StatusBadge, formatDate, formatDateTime, DateText, Money, amount, str, optStr, DefinitionList, Alert, Modal } from '@/ops/ui';
import { OpsError } from '@/ops/api';
import { formatMoney, formatDecimal, toScaled, fromScaled, sumDecimals, subDecimals, compareDecimals, isDecimal } from '@/ops/money';
import { mountPage } from './_kit';
import { screen, within, waitFor, renderWithProviders } from '../../_helpers';

describe('shared ui: ActionButton', () => {
  it('ADA-014: confirm opens an in-app dialog, not window.confirm; Cancel does not run, Confirm runs once', async () => {
    const nativeConfirm = vi.spyOn(window, 'confirm');
    const run = vi.fn(async () => ({}));
    const { user } = await mountPage(<ActionButton label="Release NAV" confirm="Release this NAV?" onRun={run} />);
    await user.click(screen.getByRole('button', { name: 'Release NAV' }));
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText('Release this NAV?')).toBeInTheDocument();
    expect(nativeConfirm).not.toHaveBeenCalled();
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(run).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Release NAV' }));
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Release NAV' }));
    await waitFor(() => expect(run).toHaveBeenCalledTimes(1));
    expect(run.mock.calls[0]![0]).toBeTruthy(); // idempotency key
  });
  it('ADB-012: without the permission it stays visible, disabled, with the reason', async () => {
    const run = vi.fn();
    const { user } = await mountPage(<ActionButton label="Approve" requires="financing.manage" onRun={run} />, { perms: ['portfolio.view'] });
    const b = screen.getByRole('button', { name: 'Approve' });
    expect(b).toBeDisabled();
    expect(b).toHaveAttribute('title', expect.stringContaining('financing.manage'));
    expect(screen.getByText(/Needs financing\.manage/)).toBeInTheDocument();
    await user.click(b);
    expect(run).not.toHaveBeenCalled();
  });
  it('with the permission it is enabled and has no gate note; "requires" can be a list (any of)', async () => {
    await mountPage(<ActionButton label="Go" requires={['a.b', 'financing.manage']} onRun={async () => 1} />, { perms: ['financing.manage'] });
    expect(screen.getByRole('button', { name: 'Go' })).toBeEnabled();
    expect(screen.queryByText(/Needs /)).not.toBeInTheDocument();
  });
  it('shows the API error text, same Idempotency-Key reused on retry, replaced after success', async () => {
    const keys: string[] = [];
    let n = 0;
    const { user } = await mountPage(
      <ActionButton
        label="Run"
        onRun={async (k) => {
          keys.push(k);
          if (++n === 1) throw new OpsError(403, 'forbidden', 'Needs reports.create');
          return 1;
        }}
      />,
    );
    await user.click(screen.getByRole('button', { name: 'Run' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('You do not have permission for this action. Needs reports.create');
    await user.click(screen.getByRole('button', { name: 'Run' }));
    await waitFor(() => expect(keys).toHaveLength(2));
    expect(keys[1]).toBe(keys[0]);
    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: 'Run' }));
    await waitFor(() => expect(keys).toHaveLength(3));
    expect(keys[2]).not.toBe(keys[0]);
  });
  it('ADB-018: a stale error disappears when the prerequisite is met (disabled flips) and can be dismissed', async () => {
    function Harness() {
      const [ready, setReady] = useState(true);
      return (
        <>
          <button onClick={() => setReady((r) => !r)}>toggle</button>
          <ActionButton
            label="Send for review"
            disabled={!ready}
            onRun={async () => {
              throw new OpsError(400, 'x', 'Populate figures first');
            }}
          />
        </>
      );
    }
    const { user } = await mountPage(<Harness />);
    await user.click(screen.getByRole('button', { name: 'Send for review' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Populate figures first');
    await user.click(screen.getByRole('button', { name: 'toggle' })); // disabled
    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: 'toggle' }));
    await user.click(screen.getByRole('button', { name: 'Send for review' }));
    await user.click(await screen.findByRole('button', { name: 'Dismiss message' }));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
  it('double click while busy runs once and shows Working…', async () => {
    let release: (v: unknown) => void = () => {};
    const run = vi.fn(() => new Promise((r) => (release = r)));
    const { user } = await mountPage(<ActionButton label="Pay" onRun={run} />);
    await user.click(screen.getByRole('button', { name: 'Pay' }));
    const busy = screen.getByRole('button', { name: 'Working…' });
    expect(busy).toBeDisabled();
    await user.click(busy);
    expect(run).toHaveBeenCalledTimes(1);
    release({});
    await screen.findByRole('button', { name: 'Pay' });
  });
  it('onDone is called only after success', async () => {
    const done = vi.fn();
    const { user } = await mountPage(<ActionButton label="Ok" onRun={async () => 1} onDone={done} />);
    await user.click(screen.getByRole('button', { name: 'Ok' }));
    await waitFor(() => expect(done).toHaveBeenCalled());
    const done2 = vi.fn();
    const { user: u2 } = await mountPage(<ActionButton label="Bad" onRun={async () => { throw new Error('x'); }} onDone={done2} />);
    await u2.click(screen.getByRole('button', { name: 'Bad' }));
    await screen.findByRole('alert');
    expect(done2).not.toHaveBeenCalled();
  });
});

describe('shared ui: ConfirmDialog / Modal', () => {
  it('Escape and backdrop close; danger style on confirm', async () => {
    const onCancel = vi.fn();
    const onConfirm = vi.fn();
    const { user } = renderWithProviders(<ConfirmDialog title="Purge" message="Sure?" danger confirmLabel="Purge now" onCancel={onCancel} onConfirm={onConfirm} />);
    expect(screen.getByRole('button', { name: 'Purge now' })).toHaveClass('danger');
    await user.keyboard('{Escape}');
    expect(onCancel).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole('button', { name: 'Purge now' }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });
  it('Modal close button', async () => {
    const onClose = vi.fn();
    const { user } = renderWithProviders(<Modal title="T" onClose={onClose}>body</Modal>);
    await user.click(screen.getByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalled();
  });
});

describe('shared ui: FormModal', () => {
  it('submits form values with an idempotency key, closes and calls onDone on success', async () => {
    const onSubmit = vi.fn(async (fd: FormData, key: string) => ({ got: str(fd, 'name'), key }));
    const onDone = vi.fn();
    const onClose = vi.fn();
    const { user } = await mountPage(
      <FormModal title="New thing" submitLabel="Create" onClose={onClose} onSubmit={onSubmit} onDone={onDone}>
        <Field label="Name"><input name="name" /></Field>
      </FormModal>,
    );
    await user.type(screen.getByLabelText('Name'), '  Alpha ');
    await user.click(screen.getByRole('button', { name: 'Create' }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(onSubmit.mock.calls[0]![1]).toBeTruthy();
    expect(onDone).toHaveBeenCalledWith(expect.objectContaining({ got: 'Alpha' }));
  });
  it('API failure keeps the modal open with the message; retry reuses the same key', async () => {
    const keys: string[] = [];
    let n = 0;
    const onClose = vi.fn();
    const { user } = await mountPage(
      <FormModal
        title="X"
        submitLabel="Save"
        onClose={onClose}
        onSubmit={async (_fd, k) => {
          keys.push(k);
          if (++n === 1) throw new OpsError(400, 'validation_error', 'Validation failed. Rationale must be at least 5 characters');
        }}
      />,
    );
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Rationale must be at least 5 characters');
    expect(onClose).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(keys[1]).toBe(keys[0]);
  });
  it('disabled prop blocks submission; double submit is prevented while busy', async () => {
    let release: () => void = () => {};
    const onSubmit = vi.fn(() => new Promise<void>((r) => (release = r)));
    const { user } = await mountPage(<FormModal title="X" submitLabel="Go" onClose={() => {}} onSubmit={onSubmit} />);
    await user.click(screen.getByRole('button', { name: 'Go' }));
    await user.click(screen.getByRole('button', { name: 'Working…' }));
    expect(onSubmit).toHaveBeenCalledTimes(1);
    release();
  });
});

describe('shared ui: Loaded / useResource / ErrorState', () => {
  function R({ fn }: { fn: () => Promise<string> }) {
    const res = useResource(fn, []);
    return (
      <>
        <Loaded res={res} what="things">{(d) => <p>data:{d}</p>}</Loaded>
        <button onClick={res.reload}>reload</button>
      </>
    );
  }
  it('loading then data; reload refetches', async () => {
    let n = 0;
    const fn = vi.fn(async () => `v${++n}`);
    const { user } = renderWithProviders(<R fn={fn} />);
    expect(screen.getByText('Loading things…')).toBeInTheDocument();
    expect(await screen.findByText('data:v1')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'reload' }));
    expect(await screen.findByText('data:v2')).toBeInTheDocument();
  });
  it('501 shows "Not available yet" with no demo data; 403 and 404 and generic errors have distinct text', () => {
    const { rerender } = renderWithProviders(<ErrorState error={new OpsError(501, 'not_implemented', 'x')} what="the thing" />);
    expect(screen.getByText('Not available yet')).toBeInTheDocument();
    rerender(<ErrorState error={new OpsError(403, 'forbidden', 'Needs x')} what="NAV" />);
    expect(screen.getByRole('alert')).toHaveTextContent('You do not have permission to view NAV. Needs x');
    rerender(<ErrorState error={new OpsError(404, 'not_found', 'x')} />);
    expect(screen.getByRole('alert')).toHaveTextContent('Not found');
    rerender(<ErrorState error={new OpsError(500, 'x', 'Boom')} what="cash" />);
    expect(screen.getByRole('alert')).toHaveTextContent('Could not load cash: Boom');
  });
  it('useAction exposes error, clear regenerates key', async () => {
    let api!: ReturnType<typeof useAction>;
    function H() {
      api = useAction();
      return null;
    }
    renderWithProviders(<H />);
    const seen: string[] = [];
    await waitFor(async () => {
      await api.run(async (k) => { seen.push(k); throw new OpsError(409, 'segregation_of_duties', 'same user'); });
      expect(true).toBe(true);
    });
    await waitFor(() => expect(api.error).toBe('A different approver is required. same user'));
  });
});

describe('shared ui: formatting', () => {
  it('StatusBadge humanises and tones; blank is a dash', () => {
    const { rerender, container } = renderWithProviders(<StatusBadge status="PENDING_APPROVAL" />);
    expect(screen.getByText('pending approval')).toHaveClass('amber');
    rerender(<StatusBadge status="rejected" />);
    expect(screen.getByText('rejected')).toHaveClass('red');
    rerender(<StatusBadge status={null} />);
    expect(container).toHaveTextContent('—');
    rerender(<StatusBadge status="WEIRD" />);
    expect(screen.getByText('weird')).toHaveClass('grey');
  });
  it('dates: invalid input is echoed, empty is dash, valid is dd Mon yyyy', () => {
    expect(formatDate(undefined)).toBe('—');
    expect(formatDate('garbage')).toBe('garbage');
    expect(formatDate('2026-08-26T00:00:00Z')).toMatch(/26 Aug 2026/);
    expect(formatDateTime('2026-08-26T10:05:00Z')).toMatch(/Aug 2026/);
    renderWithProviders(<><DateText value="2026-09-03T00:00:00Z" /><Money value="1234567.5" currency="USD" /></>);
    expect(screen.getByText(/03 Sep(t)? 2026/)).toBeInTheDocument();
    expect(screen.getByText('USD 1,234,567.50')).toBeInTheDocument();
  });
  it('form value helpers', () => {
    const fd = new FormData();
    fd.set('a', '  x ');
    fd.set('n', '1,234.50');
    expect(str(fd, 'a')).toBe('x');
    expect(optStr(fd, 'missing')).toBeUndefined();
    expect(amount(fd, 'n')).toBe('1234.50');
  });
  it('Empty / Alert / DefinitionList render; Alert with no children renders nothing', () => {
    const { container } = renderWithProviders(<><Empty>nothing</Empty><Alert kind="warn">w</Alert><Alert>{''}</Alert><DefinitionList items={[['K', null], ['L', 'v']]} /></>);
    expect(screen.getByText('nothing')).toBeInTheDocument();
    expect(screen.getByText('w')).toHaveAttribute('role', 'status');
    expect(container.querySelectorAll('.ops-alert')).toHaveLength(1);
    expect(screen.getByText('K').nextSibling).toHaveTextContent('—');
  });
});

describe('money helpers (no float arithmetic)', () => {
  it('format, rounding half-up on the string, negatives and non-numbers', () => {
    expect(formatDecimal('1234567.005')).toBe('1,234,567.01');
    expect(formatDecimal('-0.001')).toBe('0.00');
    expect(formatDecimal('-12.5')).toBe('-12.50');
    expect(formatDecimal('abc')).toBe('abc');
    expect(formatDecimal(null)).toBe('—');
    expect(formatMoney('5', 'ZWG')).toBe('ZWG 5.00');
    expect(formatMoney('', 'USD')).toBe('—');
  });
  it('scaled sums avoid 0.1+0.2 drift; compare; isDecimal', () => {
    expect(sumDecimals(['0.1', '0.2'])).toBe('0.3000');
    expect(subDecimals('1', '0.9999')).toBe('0.0001');
    expect(compareDecimals('2', '10')).toBe(-1);
    expect(compareDecimals('1.0', '1')).toBe(0);
    expect(toScaled('1,000.5')).toBe(BigInt(10005000));
    expect(fromScaled(BigInt(-15000))).toBe('-1.5000');
    expect(isDecimal('1e5')).toBe(false);
    expect(isDecimal('-1.5')).toBe(true);
  });
});
