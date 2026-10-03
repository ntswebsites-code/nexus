'use client';

import { useState } from 'react';
import { api, describeError, v1 } from '@/ops/api';
import { Badge, type CopilotReply } from '@/ops/admin-core';
import { useCan } from '@/ops/session';
import { Alert, Card, Empty, formatDateTime, Loaded, PageHeader, useResource } from '@/ops/ui';

interface Suggest {
  enabled: boolean;
  suggestions: string[];
}
interface Hist {
  id: string;
  question: string;
  intent: string;
  answer: string;
  at: string;
}

export default function CopilotPage() {
  const can = useCan('dashboard.view');
  const suggest = useResource<Suggest>(() => api.get<Suggest>(v1('/admin-core/copilot/suggestions')), []);
  const history = useResource<Hist[]>(() => api.get<Hist[]>(v1('/admin-core/copilot/history')), []);
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [thread, setThread] = useState<CopilotReply[]>([]);

  if (!can) {
    return (
      <>
        <PageHeader kicker="Insight" title="Investment Copilot" />
        <Alert>Your role does not include the dashboard. Ask an administrator for the dashboard.view permission.</Alert>
      </>
    );
  }

  async function ask(text: string) {
    const question = text.trim();
    if (question.length < 3 || busy) return;
    setBusy(true);
    setError('');
    try {
      const r = await api.post<CopilotReply>(v1('/admin-core/copilot/ask'), { question });
      setThread((t) => [r, ...t]);
      setQ('');
      history.reload();
    } catch (e) {
      setError(describeError(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <PageHeader
        kicker="Insight"
        title="Investment Copilot"
        subtitle="Ask about positions, orders, NAV, breaks, risk and cash. Answers come from live platform data you are permitted to see, each with its sources. It does not give investment advice."
      />
      <Loaded res={suggest} what="the Copilot">
        {(s) =>
          !s.enabled ? (
            <Alert kind="warn">The Copilot is switched off in Settings (Feature flags).</Alert>
          ) : (
            <>
              <Card>
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    void ask(q);
                  }}
                  style={{ display: 'flex', gap: 8 }}
                >
                  <input className="ops-input" style={{ flex: 1 }} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Ask a question about the book" maxLength={500} aria-label="Question" />
                  <button className="ops-btn primary" type="submit" disabled={busy || q.trim().length < 3}>
                    {busy ? 'Looking…' : 'Ask'}
                  </button>
                </form>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 10 }}>
                  {s.suggestions.map((x) => (
                    <button key={x} className="ops-btn small" type="button" disabled={busy} onClick={() => void ask(x)}>
                      {x}
                    </button>
                  ))}
                </div>
                <Alert>{error}</Alert>
              </Card>
              {thread.map((r) => (
                <Card key={r.id} title={r.question} actions={<Badge tone="blue">{r.intent}</Badge>}>
                  <p>{r.answer}</p>
                  {r.table && (
                    <div className="ops-table-wrap">
                      <table className="ops-table">
                        <thead>
                          <tr>
                            {r.table.columns.map((c) => (
                              <th key={c}>{c}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {r.table.rows.map((row, i) => (
                            <tr key={i}>
                              {row.map((cell, j) => (
                                <td key={j}>{cell}</td>
                              ))}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                  {r.sources.length > 0 && (
                    <p className="ops-muted" style={{ marginTop: 10 }}>
                      Sources:{' '}
                      {r.sources.map((src, i) => (
                        <span key={i}>
                          {i > 0 && ' · '}
                          <a href={src.href}>{src.label}</a> ({src.endpoint}, {src.rows} rows, {formatDateTime(src.asOf)})
                        </span>
                      ))}
                    </p>
                  )}
                </Card>
              ))}
              <Card title="Your recent questions">
                <Loaded res={history} what="history">
                  {(h) =>
                    h.length === 0 ? (
                      <Empty>No questions yet.</Empty>
                    ) : (
                      <ul style={{ margin: 0, paddingLeft: 18 }}>
                        {h.map((x) => (
                          <li key={x.id}>
                            <button className="ops-btn small" type="button" disabled={busy} onClick={() => void ask(x.question)}>
                              {x.question}
                            </button>{' '}
                            <span className="ops-muted">{formatDateTime(x.at)}</span>
                          </li>
                        ))}
                      </ul>
                    )
                  }
                </Loaded>
              </Card>
            </>
          )
        }
      </Loaded>
    </>
  );
}
