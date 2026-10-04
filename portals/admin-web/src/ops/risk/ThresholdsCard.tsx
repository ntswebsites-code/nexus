'use client';

import { useState } from 'react';
import { api } from '../api';
import { Alert, Card, Field, FieldGrid, FormModal, Loaded, str, useResource } from '../ui';
import { risk } from './common';

export interface ScenarioThresholds {
  liquidityEscalate: number;
  liquidityReview: number;
  lossEscalatePct: number | null;
  lossReviewPct: number | null;
}
export interface ThresholdPayload {
  thresholds: ScenarioThresholds;
  defaults: ScenarioThresholds;
  reference: ScenarioThresholds & { note: string };
  canEdit: boolean;
}

const x = (v: number) => `${v}x`;
const pct = (v: number | null) => (v === null ? 'off' : `${v}%`);

/** BR-029: the scenario state thresholds are policy parameters, shown here and edited with risk.manage and a fresh authenticator code. */
export function ThresholdsCard() {
  const res = useResource<ThresholdPayload>(() => api.get<ThresholdPayload>(risk('/scenario-thresholds')), []);
  const [editing, setEditing] = useState(false);
  return (
    <Card
      title="Scenario thresholds"
      actions={
        res.state === 'ok' &&
        res.data.canEdit && (
          <button className="ops-btn small" type="button" onClick={() => setEditing(true)}>
            Edit thresholds
          </button>
        )
      }
    >
      <Loaded res={res} what="the scenario thresholds">
        {(p) => (
          <>
            <div className="ops-table-wrap">
              <table className="ops-table">
                <caption className="ops-sr">Scenario state thresholds</caption>
                <thead>
                  <tr>
                    <th>Rule</th>
                    <th className="r">Escalate</th>
                    <th className="r">Review</th>
                    <th>Meaning</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td>Liquidity coverage</td>
                    <td className="r">below {x(p.thresholds.liquidityEscalate)}</td>
                    <td className="r">below {x(p.thresholds.liquidityReview)}</td>
                    <td>Liquid assets divided by the redemption amount after the shock.</td>
                  </tr>
                  <tr>
                    <td>Loss against NAV</td>
                    <td className="r">{p.thresholds.lossEscalatePct === null ? 'off' : `at least ${pct(p.thresholds.lossEscalatePct)}`}</td>
                    <td className="r">{p.thresholds.lossReviewPct === null ? 'off' : `at least ${pct(p.thresholds.lossReviewPct)}`}</td>
                    <td>Post-shock loss as a percent of NAV.</td>
                  </tr>
                </tbody>
              </table>
            </div>
            <p className="ops-muted" style={{ marginTop: 6 }}>
              Reference values from the policy: liquidity {x(p.reference.liquidityEscalate)} / {x(p.reference.liquidityReview)}, loss {pct(p.reference.lossEscalatePct)} / {pct(p.reference.lossReviewPct)}.
            </p>
            {editing && <Editor current={p.thresholds} reference={p.reference} onClose={() => setEditing(false)} onSaved={res.reload} />}
          </>
        )}
      </Loaded>
    </Card>
  );
}

function Editor({ current, reference, onClose, onSaved }: { current: ScenarioThresholds; reference: ScenarioThresholds; onClose: () => void; onSaved: () => void }) {
  const [vals, setVals] = useState({
    liquidityEscalate: String(current.liquidityEscalate),
    liquidityReview: String(current.liquidityReview),
    lossEscalatePct: current.lossEscalatePct === null ? '' : String(current.lossEscalatePct),
    lossReviewPct: current.lossReviewPct === null ? '' : String(current.lossReviewPct),
  });
  const set = (k: keyof typeof vals) => (e: React.ChangeEvent<HTMLInputElement>) => setVals((v) => ({ ...v, [k]: e.target.value }));
  const bad = (v: string) => v.trim() !== '' && !(Number(v) > 0);
  const liqErr = Number(vals.liquidityEscalate) > Number(vals.liquidityReview) ? 'Escalate coverage must not be above review coverage' : null;
  const lossErr =
    vals.lossEscalatePct.trim() !== '' && vals.lossReviewPct.trim() !== '' && Number(vals.lossReviewPct) > Number(vals.lossEscalatePct)
      ? 'Review loss must not be above escalation loss'
      : null;
  return (
    <FormModal
      kicker="Risk policy"
      title="Scenario thresholds"
      subtitle="Applies to every scenario run from now on. Needs a fresh authenticator code and is audited."
      submitLabel="Save thresholds"
      onClose={onClose}
      onDone={onSaved}
      disabled={bad(vals.liquidityEscalate) || bad(vals.liquidityReview) || bad(vals.lossEscalatePct) || bad(vals.lossReviewPct) || !!liqErr || !!lossErr}
      onSubmit={(fd, key) =>
        api.put(
          risk('/scenario-thresholds'),
          {
            liquidityEscalate: Number(vals.liquidityEscalate),
            liquidityReview: Number(vals.liquidityReview),
            lossEscalatePct: vals.lossEscalatePct.trim() === '' ? null : Number(vals.lossEscalatePct),
            lossReviewPct: vals.lossReviewPct.trim() === '' ? null : Number(vals.lossReviewPct),
            reason: str(fd, 'reason'),
          },
          { idempotencyKey: key },
        )
      }
    >
      <FieldGrid>
        <Field label="Liquidity coverage: escalate below (x)">
          <input className="ops-input" inputMode="decimal" value={vals.liquidityEscalate} onChange={set('liquidityEscalate')} />
        </Field>
        <Field label="Liquidity coverage: review below (x)">
          <input className="ops-input" inputMode="decimal" value={vals.liquidityReview} onChange={set('liquidityReview')} />
        </Field>
        <Field label="Loss: escalate at or above (% of NAV)" hint="Leave empty to switch the loss test off">
          <input className="ops-input" inputMode="decimal" value={vals.lossEscalatePct} onChange={set('lossEscalatePct')} />
        </Field>
        <Field label="Loss: review at or above (% of NAV)">
          <input className="ops-input" inputMode="decimal" value={vals.lossReviewPct} onChange={set('lossReviewPct')} />
        </Field>
        <Field label="Reason" span={2} hint={`Reference: liquidity ${reference.liquidityEscalate}x / ${reference.liquidityReview}x, loss ${reference.lossEscalatePct}% / ${reference.lossReviewPct}%`}>
          <input className="ops-input" name="reason" required minLength={5} maxLength={300} />
        </Field>
      </FieldGrid>
      {(liqErr || lossErr) && <Alert kind="warn">{liqErr ?? lossErr}</Alert>}
    </FormModal>
  );
}
