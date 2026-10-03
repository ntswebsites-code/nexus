'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { api, apiRequest, qs, v1 } from '@/ops/api';
import { CA_TYPES, CaStatusBadge, STATUS_LABEL, TYPE_LABEL, terms, type CaDetail, type CaEvent, type CaList, type CaUpcoming } from '@/ops/corporate-actions';
import { useCan } from '@/ops/session';
import type { SecurityRow } from '@/ops/types';
import { Card, Empty, Field, FieldGrid, FormModal, formatDate, Loaded, optStr, PageHeader, str, useResource } from '@/ops/ui';

const PAGE = 25;
const STATUSES = ['ANNOUNCED', 'CONFIRMED', 'PROCESSED', 'CANCELLED'];

function Tile({ label, value, hint, onClick, active }: { label: string; value: string; hint?: string; onClick?: () => void; active?: boolean }) {
  return (
    <button type="button" className="ops-tile" onClick={onClick} style={{ textAlign: 'left', cursor: onClick ? 'pointer' : 'default', borderColor: active ? 'var(--ops-blue)' : undefined }}>
      <p style={{ textTransform: 'uppercase', letterSpacing: '0.07em', fontSize: 10, fontWeight: 800 }}>{label}</p>
      <h3 style={{ fontSize: 26, margin: '6px 0 2px' }}>{value}</h3>
      {hint && <p>{hint}</p>}
    </button>
  );
}

export default function CorporateActionsPage() {
  const router = useRouter();
  const canCreate = useCan('operations.view');
  const [tab, setTab] = useState<'upcoming' | 'all'>('upcoming');
  const [status, setStatus] = useState('');
  const [type, setType] = useState('');
  const [securityId, setSecurityId] = useState('');
  const [offset, setOffset] = useState(0);
  const [creating, setCreating] = useState(false);

  const securities = useResource<SecurityRow[]>(() => api.get<SecurityRow[]>(v1('/securities')), []);
  const upcoming = useResource<CaUpcoming>(() => apiRequest<CaUpcoming>('GET', v1('/corporate-actions/upcoming?days=90')), []);
  const list = useResource<CaList>(
    () => apiRequest<CaList>('GET', v1(`/corporate-actions/events${qs({ status, type, securityId, limit: String(PAGE), offset: String(offset) })}`)),
    [status, type, securityId, offset],
  );
  const filter = (set: (v: string) => void) => (v: string) => {
    setOffset(0);
    setTab('all');
    set(v);
  };
  const open = (e: CaEvent) => router.push(`/ops/corporate-actions/${encodeURIComponent(e.id)}`);

  return (
    <>
      <PageHeader
        kicker="Operations"
        title="Corporate actions"
        subtitle="Dividends, splits, bonus and scrip issues, rights and mergers on the securities you hold: confirmed, entitled from the record-date positions, elected, and processed by a second person."
        actions={
          canCreate && (
            <button className="ops-btn primary" type="button" onClick={() => setCreating(true)}>
              New corporate action
            </button>
          )
        }
      />

      <Loaded res={list} what="corporate actions">
        {(l) => (
          <>
            <div className="ops-tiles">
              <Tile label="Upcoming" value={String(l.summary.upcoming)} hint="Ex-date today or later, not processed" onClick={() => setTab('upcoming')} active={tab === 'upcoming'} />
              <Tile label="Awaiting confirmation" value={String(l.summary.awaitingConfirmation)} hint="Announced" onClick={() => filter(setStatus)('ANNOUNCED')} active={status === 'ANNOUNCED'} />
              <Tile label="Awaiting processing" value={String(l.summary.awaitingProcessing)} hint="Confirmed, needs a second person" onClick={() => filter(setStatus)('CONFIRMED')} active={status === 'CONFIRMED'} />
              <Tile label="Processed" value={String(l.summary.processed)} hint="Applied to the books" onClick={() => filter(setStatus)('PROCESSED')} active={status === 'PROCESSED'} />
            </div>

            {tab === 'upcoming' ? (
              <Card title="Upcoming events (next 90 days)" actions={<button className="ops-btn small" type="button" onClick={() => setTab('all')}>All events</button>}>
                <Loaded res={upcoming} what="upcoming events">
                  {(u) =>
                    u.data.length === 0 ? (
                      <Empty>Nothing is due in the next 90 days. Use New corporate action to record an announcement.</Empty>
                    ) : (
                      <EventTable rows={u.data} onOpen={open} />
                    )
                  }
                </Loaded>
              </Card>
            ) : (
              <Card title="All events" actions={<button className="ops-btn small" type="button" onClick={() => setTab('upcoming')}>Upcoming</button>}>
                <div className="ops-filters">
                  <Field label="Security">
                    <select className="ops-input" value={securityId} onChange={(e) => filter(setSecurityId)(e.target.value)}>
                      <option value="">All securities</option>
                      {securities.state === 'ok' &&
                        securities.data.map((s) => (
                          <option key={s.id} value={s.id}>
                            {s.ticker} · {s.name}
                          </option>
                        ))}
                    </select>
                  </Field>
                  <Field label="Type">
                    <select className="ops-input" value={type} onChange={(e) => filter(setType)(e.target.value)}>
                      <option value="">All types</option>
                      {CA_TYPES.map((t) => (
                        <option key={t} value={t}>
                          {TYPE_LABEL[t]}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Status">
                    <select className="ops-input" value={status} onChange={(e) => filter(setStatus)(e.target.value)}>
                      <option value="">All statuses</option>
                      {STATUSES.map((s) => (
                        <option key={s} value={s}>
                          {STATUS_LABEL[s]}
                        </option>
                      ))}
                    </select>
                  </Field>
                </div>
                {l.data.length === 0 ? <Empty>No corporate actions match these filters.</Empty> : <EventTable rows={l.data} onOpen={open} />}
                <div className="ops-actions" style={{ marginTop: 12, justifyContent: 'space-between' }}>
                  <span className="ops-muted">{l.total === 0 ? '0 events' : `${offset + 1}–${Math.min(offset + PAGE, l.total)} of ${l.total}`}</span>
                  <span>
                    <button className="ops-btn small" type="button" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - PAGE))}>
                      Previous
                    </button>{' '}
                    <button className="ops-btn small" type="button" disabled={offset + PAGE >= l.total} onClick={() => setOffset(offset + PAGE)}>
                      Next
                    </button>
                  </span>
                </div>
              </Card>
            )}
          </>
        )}
      </Loaded>

      {creating && <NewEventModal securities={securities.state === 'ok' ? securities.data : []} onClose={() => setCreating(false)} onDone={(d) => router.push(`/ops/corporate-actions/${encodeURIComponent(d.id)}`)} />}
    </>
  );
}

function EventTable({ rows, onOpen }: { rows: CaEvent[]; onOpen: (e: CaEvent) => void }) {
  return (
    <div className="ops-table-wrap">
      <table className="ops-table">
        <thead>
          <tr>
            <th>Event</th>
            <th>Security</th>
            <th>Type and terms</th>
            <th>Ex-date</th>
            <th>Record</th>
            <th>Pay</th>
            <th>Election by</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((e) => (
            <tr key={e.id} className="clickable" onClick={() => onOpen(e)}>
              <td>
                <strong>{e.ref}</strong>
                <span className="ops-sub">{e.makerName ?? ''}</span>
              </td>
              <td>
                {e.ticker}
                <span className="ops-sub">{e.securityName}</span>
              </td>
              <td>
                {TYPE_LABEL[e.type] ?? e.type}
                <span className="ops-sub">{terms(e)}</span>
              </td>
              <td>{formatDate(e.exDate)}</td>
              <td>{formatDate(e.recordDate)}</td>
              <td>{formatDate(e.payDate)}</td>
              <td>{e.electionDeadline ? formatDate(e.electionDeadline) : '—'}</td>
              <td>
                <CaStatusBadge status={e.status} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const clean = (v: string | undefined) => v?.replace(/,/g, '');

function NewEventModal({ securities, onClose, onDone }: { securities: SecurityRow[]; onClose: () => void; onDone: (d: CaDetail) => void }) {
  const [type, setType] = useState<string>('CASH_DIVIDEND');
  const elective = type === 'SCRIP_DIVIDEND' || type === 'RIGHTS_ISSUE';
  const ratio = type !== 'CASH_DIVIDEND';
  const rate = type === 'CASH_DIVIDEND' || elective || type === 'MERGER';
  const rateLabel = type === 'RIGHTS_ISSUE' ? 'Subscription price per share' : type === 'MERGER' ? 'Cash per share (0 if none)' : 'Cash per share';
  return (
    <FormModal
      title="New corporate action"
      kicker="Corporate actions"
      subtitle="Record an announcement. It starts as Announced; someone confirms it, the entitlements are calculated from the record-date positions, and a second person processes it."
      submitLabel="Create"
      wide
      onClose={onClose}
      onDone={(r) => onDone(r as CaDetail)}
      onSubmit={(fd, key) => {
        const body: Record<string, unknown> = {
          securityId: str(fd, 'securityId'),
          type,
          exDate: str(fd, 'exDate'),
          recordDate: str(fd, 'recordDate'),
          payDate: str(fd, 'payDate'),
        };
        if (rate) body.rate = clean(optStr(fd, 'rate')) ?? null;
        if (ratio) {
          body.ratioNew = clean(optStr(fd, 'ratioNew')) ?? null;
          body.ratioOld = clean(optStr(fd, 'ratioOld')) ?? null;
        }
        if (type === 'CASH_DIVIDEND' || type === 'SCRIP_DIVIDEND') body.withholdingPct = clean(optStr(fd, 'withholdingPct')) ?? '0';
        if (elective) {
          body.electionDeadline = optStr(fd, 'electionDeadline') ?? null;
          body.defaultOption = optStr(fd, 'defaultOption') ?? null;
        }
        if (type === 'MERGER') body.targetSecurityId = optStr(fd, 'targetSecurityId') ?? null;
        if (type !== 'CASH_DIVIDEND' && fd.get('cashInLieu') === 'on') {
          body.cashInLieu = true;
          body.cilPrice = clean(optStr(fd, 'cilPrice')) ?? null;
        }
        if (optStr(fd, 'description')) body.description = optStr(fd, 'description');
        return api.post<CaDetail>(v1('/corporate-actions/events'), body, { idempotencyKey: key });
      }}
    >
      <FieldGrid>
        <Field label="Security" span={2}>
          <select className="ops-input" name="securityId" required defaultValue="">
            <option value="" disabled>
              Choose a security
            </option>
            {securities.map((s) => (
              <option key={s.id} value={s.id}>
                {s.ticker} · {s.name} ({s.currency})
              </option>
            ))}
          </select>
        </Field>
        <Field label="Type" span={2}>
          <select className="ops-input" value={type} onChange={(e) => setType(e.target.value)}>
            {CA_TYPES.map((t) => (
              <option key={t} value={t}>
                {TYPE_LABEL[t]}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Ex-date">
          <input className="ops-input" type="date" name="exDate" required />
        </Field>
        <Field label="Record date" hint="Holdings at this date are entitled">
          <input className="ops-input" type="date" name="recordDate" required />
        </Field>
        <Field label="Pay date">
          <input className="ops-input" type="date" name="payDate" required />
        </Field>
        {elective && (
          <Field label="Election deadline" hint="Last day holders can choose; on or before the pay date">
            <input className="ops-input" type="date" name="electionDeadline" required />
          </Field>
        )}
        {rate && (
          <Field label={rateLabel}>
            <input className="ops-input" name="rate" inputMode="decimal" required={type !== 'MERGER'} placeholder="0.00" />
          </Field>
        )}
        {ratio && (
          <>
            <Field label="New shares" hint={type === 'STOCK_SPLIT' ? 'A 2-for-1 split is 2 new for 1 held' : 'New shares per the held shares below'}>
              <input className="ops-input" name="ratioNew" inputMode="decimal" required />
            </Field>
            <Field label="For every held">
              <input className="ops-input" name="ratioOld" inputMode="decimal" required />
            </Field>
          </>
        )}
        {(type === 'CASH_DIVIDEND' || type === 'SCRIP_DIVIDEND') && (
          <Field label="Withholding tax, %" hint="Deducted from the cash paid">
            <input className="ops-input" name="withholdingPct" inputMode="decimal" defaultValue="0" />
          </Field>
        )}
        {type === 'MERGER' && (
          <Field label="Acquirer security" span={2}>
            <select className="ops-input" name="targetSecurityId" required defaultValue="">
              <option value="" disabled>
                Choose the security holders receive
              </option>
              {securities.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.ticker} · {s.name}
                </option>
              ))}
            </select>
          </Field>
        )}
        {elective && (
          <Field label="If a holder does not elect" span={2}>
            <select className="ops-input" name="defaultOption" defaultValue={type === 'RIGHTS_ISSUE' ? 'LAPSE' : 'CASH'}>
              {type === 'RIGHTS_ISSUE' ? (
                <>
                  <option value="LAPSE">Let the rights lapse</option>
                  <option value="TAKE_UP">Take up the rights</option>
                </>
              ) : (
                <>
                  <option value="CASH">Take the cash</option>
                  <option value="SCRIP">Take scrip shares</option>
                </>
              )}
            </select>
          </Field>
        )}
        {type !== 'CASH_DIVIDEND' && (
          <>
            <Field label="Pay cash in lieu of fractions" hint="Off: fractions of a share are only reported">
              <input type="checkbox" name="cashInLieu" />
            </Field>
            <Field label="Cash-in-lieu price per share" hint="Required when cash in lieu is on">
              <input className="ops-input" name="cilPrice" inputMode="decimal" />
            </Field>
          </>
        )}
        <Field label="Notes" span={2}>
          <textarea className="ops-input" name="description" rows={2} maxLength={1000} />
        </Field>
      </FieldGrid>
    </FormModal>
  );
}
