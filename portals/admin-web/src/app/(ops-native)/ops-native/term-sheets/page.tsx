'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { api, ops } from '@/ops/api';
import { CompanySelect } from '@/ops/lookups';
import { compareDecimals, isDecimal } from '@/ops/money';
import { useCan } from '@/ops/session';
import type { TermSheet, TermSheetTemplate } from '@/ops/types';
import {
  ActionButton,
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
  const [addingTemplate, setAddingTemplate] = useState(false);
  const sheets = useResource<TermSheet[]>(() => api.get<TermSheet[]>(ops('/term-sheets')), []);
  const templates = useResource<TermSheetTemplate[]>(() => api.get<TermSheetTemplate[]>(ops('/term-sheets/templates?includeArchived=true')), []);

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
                      <tr key={t.id} className="clickable" onClick={() => router.push(`/ops-native/term-sheets/${encodeURIComponent(t.id)}`)}>
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
      <Card
        title="Template library"
        actions={
          canCreate && (
            <button className="ops-btn" type="button" onClick={() => setAddingTemplate(true)}>
              New template
            </button>
          )
        }
      >
        <Loaded res={templates} what="templates">
          {(rows) =>
            rows.length === 0 ? (
              <Empty>No templates yet. A template pre-fills key terms, conditions and timeline for a new term sheet.</Empty>
            ) : (
              <div className="ops-table-wrap">
                <table className="ops-table">
                  <thead>
                    <tr>
                      <th>Template</th>
                      <th>Status</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((tpl) => (
                      <tr key={tpl.id}>
                        <td>
                          <strong>{tpl.name}</strong>
                          <span className="ops-sub">{tpl.description ?? ''}</span>
                        </td>
                        <td>
                          <StatusBadge status={tpl.status} />
                        </td>
                        <td>
                          {canCreate && (
                            <ActionButton
                              label={tpl.status === 'ACTIVE' ? 'Archive' : 'Restore'}
                              onRun={(key) => api.patch(ops(`/term-sheets/templates/${encodeURIComponent(tpl.id)}`), { status: tpl.status === 'ACTIVE' ? 'ARCHIVED' : 'ACTIVE' }, { idempotencyKey: key })}
                              onDone={templates.reload}
                            />
                          )}
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
      {addingTemplate && (
        <FormModal
          wide
          kicker="Term sheet · template"
          title="New template"
          submitLabel="Save template"
          onClose={() => setAddingTemplate(false)}
          onSubmit={(fd, key) => {
            const keyTerms = str(fd, 'keyTerms')
              .split('\n')
              .map((l) => l.trim())
              .filter(Boolean);
            return api.post(
              ops('/term-sheets/templates'),
              { name: str(fd, 'name'), description: optStr(fd, 'description'), keyTerms: keyTerms.length ? keyTerms : undefined, conditions: optStr(fd, 'conditions'), timeline: optStr(fd, 'timeline') },
              { idempotencyKey: key },
            );
          }}
          onDone={() => {
            setAddingTemplate(false);
            templates.reload();
          }}
        >
          <FieldGrid>
            <Field label="Name">
              <input className="ops-input" name="name" required maxLength={120} />
            </Field>
            <Field label="Description">
              <input className="ops-input" name="description" maxLength={400} />
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
                templateId: optStr(fd, 'templateId'),
              },
              { idempotencyKey: key },
            );
          }}
          onDone={(r) => {
            const t = r as TermSheet | undefined;
            if (t?.id) router.push(`/ops-native/term-sheets/${encodeURIComponent(t.id)}`);
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
            <Field label="Start from template" span={2} hint="Optional. Anything you leave blank is filled in from the template.">
              <select className="ops-input" name="templateId" defaultValue="">
                <option value="">No template</option>
                {(templates.state === 'ok' ? templates.data : []).filter((tpl) => tpl.status === 'ACTIVE').map((tpl) => (
                  <option key={tpl.id} value={tpl.id}>
                    {tpl.name}
                  </option>
                ))}
              </select>
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
