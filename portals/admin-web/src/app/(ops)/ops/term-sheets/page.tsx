'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { api, ops } from '@/ops/api';
import { CompanySelect } from '@/ops/lookups';
import { compareDecimals, isDecimal } from '@/ops/money';
import { useCan } from '@/ops/session';
import type { TermSheet } from '@/ops/types';
import {
  amount,
  Card,
  DateText,
  Empty,
  Field,
  FieldGrid,
  FormModal,
  Loaded,
  Money,
  optStr,
  PageHeader,
  StatusBadge,
  str,
  useResource,
} from '@/ops/ui';

export default function TermSheetsPage() {
  const router = useRouter();
  const canCreate = useCan('term_sheets.create');
  const [creating, setCreating] = useState(false);
  const sheets = useResource<TermSheet[]>(() => api.get<TermSheet[]>(ops('/term-sheets')), []);

  return (
    <>
      <PageHeader
        kicker="Private markets · J6"
        title="Term sheets"
        subtitle="Prepare a term sheet, have a second person approve it, then issue it to the company for signature in the Investee portal."
        actions={
          canCreate && (
            <button className="ops-btn primary" type="button" onClick={() => setCreating(true)}>
              New term sheet
            </button>
          )
        }
      />
      <Card>
        <Loaded res={sheets} what="term sheets">
          {(rows) =>
            rows.length === 0 ? (
              <Empty>No term sheets yet.</Empty>
            ) : (
              <div className="ops-table-wrap">
                <table className="ops-table">
                  <thead>
                    <tr>
                      <th>Term sheet</th>
                      <th>Company</th>
                      <th className="r">Investment</th>
                      <th className="r">Valuation</th>
                      <th className="r">Equity</th>
                      <th>Issued</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((t) => (
                      <tr key={t.id} className="clickable" onClick={() => router.push(`/ops/term-sheets/${encodeURIComponent(t.id)}`)}>
                        <td>
                          <strong>{t.title}</strong>
                          <span className="ops-sub">
                            {t.ref ?? t.id.slice(0, 8)}
                            {t.versionNo ? ` · v${t.versionNo}` : ''}
                          </span>
                        </td>
                        <td>{t.companyName ?? t.company?.name ?? t.companyId}</td>
                        <td className="r">
                          <Money value={t.investmentAmount} currency={t.currency} />
                        </td>
                        <td className="r">
                          <Money value={t.valuation} currency={t.currency} />
                        </td>
                        <td className="r">{t.equityPercentage}%</td>
                        <td>
                          <DateText value={t.issuedAt} />
                        </td>
                        <td>
                          <StatusBadge status={t.status} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )
          }
        </Loaded>
      </Card>
      {creating && (
        <FormModal
          wide
          kicker="Term sheet · draft"
          title="New term sheet"
          subtitle="Saved as a draft. The company sees it only once it is approved and issued."
          submitLabel="Save draft"
          onClose={() => setCreating(false)}
          onSubmit={(fd, key) => {
            const investmentAmount = amount(fd, 'investmentAmount');
            const valuation = amount(fd, 'valuation');
            const equityPercentage = amount(fd, 'equityPercentage');
            if (![investmentAmount, valuation, equityPercentage].every(isDecimal)) throw new Error('Amounts and equity must be plain numbers.');
            if (compareDecimals(equityPercentage, '0') <= 0 || compareDecimals(equityPercentage, '100') > 0) throw new Error('Equity must be between 0 and 100%.');
            const keyTerms = str(fd, 'keyTerms')
              .split('\n')
              .map((l) => l.trim())
              .filter(Boolean);
            return api.post<TermSheet>(
              ops('/term-sheets'),
              {
                company: str(fd, 'companyId'),
                title: str(fd, 'title'),
                currency: str(fd, 'currency').toUpperCase(),
                investmentAmount,
                valuation,
                equityPercentage,
                keyTerms: keyTerms.length ? keyTerms : undefined,
                conditions: optStr(fd, 'conditions'),
                timeline: optStr(fd, 'timeline'),
              },
              { idempotencyKey: key },
            );
          }}
          onDone={(r) => {
            const t = r as TermSheet | undefined;
            if (t?.id) router.push(`/ops/term-sheets/${encodeURIComponent(t.id)}`);
            else sheets.reload();
          }}
        >
          <FieldGrid>
            <Field label="Company">
              <CompanySelect name="companyId" required />
            </Field>
            <Field label="Title">
              <input className="ops-input" name="title" required maxLength={255} placeholder="Series A term sheet" />
            </Field>
            <Field label="Investment amount">
              <input className="ops-input" name="investmentAmount" inputMode="decimal" required />
            </Field>
            <Field label="Pre-money valuation">
              <input className="ops-input" name="valuation" inputMode="decimal" required />
            </Field>
            <Field label="Equity (%)">
              <input className="ops-input" name="equityPercentage" inputMode="decimal" required />
            </Field>
            <Field label="Currency">
              <input className="ops-input" name="currency" required maxLength={3} defaultValue="USD" />
            </Field>
            <Field label="Key terms" span={2} hint="One term per line">
              <textarea className="ops-input" name="keyTerms" rows={4} />
            </Field>
            <Field label="Conditions precedent" span={2}>
              <textarea className="ops-input" name="conditions" rows={3} />
            </Field>
            <Field label="Timeline" span={2}>
              <textarea className="ops-input" name="timeline" rows={2} />
            </Field>
          </FieldGrid>
        </FormModal>
      )}
    </>
  );
}
