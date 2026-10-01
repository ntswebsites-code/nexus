'use client';

import { useEffect, useState } from 'react';
import { api, ops } from './api';
import { clientLabel } from './lookups';
import { compareDecimals, formatMoney, isDecimal, subDecimals, sumDecimals } from './money';
import type { Fund } from './types';
import { useResource } from './ui';

export interface ExplicitAllocation {
  clientId: string;
  amount: string;
}

/**
 * Explicit allocation grid: one row per commitment of the fund. Reports the rows that
 * have an amount and whether they add up to `total` (BigInt arithmetic, never floats).
 */
export function AllocationEditor({
  fundId,
  total,
  currency,
  onChange,
}: {
  fundId: string;
  total: string;
  currency?: string;
  onChange: (rows: ExplicitAllocation[], valid: boolean) => void;
}) {
  const fund = useResource<Fund>(() => api.get<Fund>(ops(`/funds/${encodeURIComponent(fundId)}`)), [fundId]);
  const [amounts, setAmounts] = useState<Record<string, string>>({});

  const commitments = fund.state === 'ok' ? (fund.data.commitments ?? []).filter((c) => c.status !== 'CLOSED') : [];
  const rows = commitments
    .map((c) => ({ clientId: c.clientId, amount: (amounts[c.clientId] ?? '').replace(/,/g, '').trim() }))
    .filter((r) => r.amount !== '');
  const allNumeric = rows.every((r) => isDecimal(r.amount));
  const sum = sumDecimals(rows.map((r) => r.amount));
  const balanced = isDecimal(total || 'x') && compareDecimals(sum, total) === 0;
  const valid = rows.length > 0 && allNumeric && balanced;

  useEffect(() => {
    onChange(rows, valid);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(rows), valid]);

  if (!fundId) return <p className="ops-muted">Choose a fund to allocate against its commitments.</p>;
  if (fund.state === 'loading') return <div className="ops-loading">Loading commitments…</div>;
  if (fund.state === 'error') return <p className="ops-error-text">Could not load the fund&apos;s commitments, so explicit allocation is not possible.</p>;
  if (commitments.length === 0) return <p className="ops-muted">This fund has no open commitments.</p>;

  return (
    <div className="ops-table-wrap">
      <table className="ops-table">
        <thead>
          <tr>
            <th>LP</th>
            <th className="r">Commitment</th>
            <th className="r">Unfunded</th>
            <th className="r">Amount</th>
          </tr>
        </thead>
        <tbody>
          {commitments.map((c) => (
            <tr key={c.id}>
              <td>{clientLabel(c)}</td>
              <td className="r">{formatMoney(c.commitmentAmount, c.currency)}</td>
              <td className="r">{c.unfunded != null ? formatMoney(c.unfunded, c.currency) : '—'}</td>
              <td className="r">
                <input
                  className="ops-input"
                  style={{ width: 150, textAlign: 'right' }}
                  inputMode="decimal"
                  value={amounts[c.clientId] ?? ''}
                  onChange={(e) => setAmounts((a) => ({ ...a, [c.clientId]: e.target.value }))}
                  aria-label={`Amount for ${clientLabel(c)}`}
                />
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <td colSpan={3}>Allocated {balanced ? '' : `(difference ${formatMoney(subDecimals(total, sum), currency)})`}</td>
            <td className="r">{formatMoney(sum, currency)}</td>
          </tr>
        </tfoot>
      </table>
      {!allNumeric && <p className="ops-error-text">Amounts must be plain numbers, e.g. 125000.00</p>}
      {allNumeric && rows.length > 0 && !balanced && <p className="ops-error-text">Allocations must add up exactly to the total amount.</p>}
    </div>
  );
}
