'use client';

import { useState } from 'react';
import { api, v1 } from '@/ops/api';
import { useCan } from '@/ops/session';
import { openLink } from '@/ops/suite';
import { Alert, Field, FieldGrid, FormModal, Loaded, str, useResource } from '@/ops/ui';

/**
 * FR-DASH-005: "Investment pack" on the Command Centre. Generates the NAV pack (released NAV runs in a date range with
 * the market-value-to-NAV bridge and the latest run's lines) as a PDF through the reports module, then opens it.
 */
interface Lookups {
  portfolios: { id: string; ref: string; name: string }[];
}
interface RunResult {
  id: string;
  ref: string;
  hasFile: boolean;
}

const iso = (d: Date) => d.toISOString().slice(0, 10);

export function defaultPackRange(now = new Date()): { from: string; to: string } {
  const to = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 3, now.getUTCDate()));
  return { from: iso(from), to: iso(to) };
}

export function InvestmentPackButton() {
  const canCreate = useCan('reports.create');
  const [open, setOpen] = useState(false);
  const [made, setMade] = useState<RunResult | null>(null);
  const range = defaultPackRange();

  return (
    <>
      <button className="ops-btn" type="button" disabled={!canCreate} title={canCreate ? 'Generate the investment pack as a PDF' : 'Needs reports.create'} onClick={() => { setMade(null); setOpen(true); }}>
        Investment pack
      </button>
      {open && (
        <FormModal
          title="Investment pack"
          subtitle="A PDF of released NAV runs for the period with the bridge from market value to NAV and the latest run's lines. It is stored under Reports with a hash."
          submitLabel="Generate pack"
          onClose={() => setOpen(false)}
          onSubmit={(fd, key) => api.post<RunResult>(v1('/reports/runs'), { key: 'NAV_PACK', format: 'PDF', params: { portfolioId: str(fd, 'portfolioId'), from: str(fd, 'from'), to: str(fd, 'to') } }, { idempotencyKey: key })}
          onDone={(r) => {
            const run = r as RunResult;
            setMade(run);
            setOpen(false);
            if (run?.hasFile) void openLink(v1(`/reports/runs/${run.id}/link`)).catch(() => undefined);
          }}
        >
          <PackFields range={range} />
        </FormModal>
      )}
      {made && <Alert kind="info">Investment pack {made.ref} generated. It is under Reports, Generated reports.</Alert>}
    </>
  );
}

function PackFields({ range }: { range: { from: string; to: string } }) {
  const lookups = useResource<Lookups>(() => api.get<Lookups>(v1('/reports/lookups')), []);
  return (
    <Loaded res={lookups} what="portfolios">
      {(l) => (
        <FieldGrid>
          <Field label="Portfolio">
            <select className="ops-input" name="portfolioId" required>
              {l.portfolios.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} ({p.ref})
                </option>
              ))}
            </select>
          </Field>
          <Field label="From">
            <input className="ops-input" type="date" name="from" defaultValue={range.from} required />
          </Field>
          <Field label="To">
            <input className="ops-input" type="date" name="to" defaultValue={range.to} required />
          </Field>
        </FieldGrid>
      )}
    </Loaded>
  );
}
