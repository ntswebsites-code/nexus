/**
 * R4-5 LP portal remainder: SSE stream, notification/display preferences, statements.
 *
 * Offline part (no DB, no API): routing with merged multi-client preferences, category mapping, as-of preference
 * helper, statement quarters, stream cursor parsing.
 *
 * Live part (optional): set E2E_API (default http://localhost:4100), E2E_LP_COOKIE (an investor `nexus_session`
 * cookie pair, e.g. "nexus_session=...") and E2E_ORIGIN to check the stream handshake (content type, ready event,
 * heartbeat framing), the statements list/download (application/pdf) and the report file name.
 *
 *   npx tsx scripts/test-lp-remainder.ts
 */
import { decideRoute, lpCategory, mergeLpPrefs } from '../src/modules/notifications/delivery';
import { quarterEndOnOrBefore } from '../src/modules/lp-portal/routes/session.routes';
import { parseQuarter, quartersUpTo } from '../src/modules/lp-portal/routes/statements.routes';
import { streamCursor } from '../src/modules/lp-portal/routes/stream.routes';

let failures = 0;
const check = (name: string, cond: unknown, detail?: unknown) => {
  if (!cond) failures++;
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${name}${!cond && detail !== undefined ? ` ${JSON.stringify(detail)}` : ''}`);
};

const base = { wantsEmail: true, platformEmail: true, criticalChannel: 'in_app', prefs: [] as never[] };

function offline() {
  console.log('preferences');
  check('service_request maps to Messages', lpCategory('service_request.updated') === 'Messages');
  check('dealing maps to CapitalCalls', lpCategory('dealing.status') === 'CapitalCalls');
  const off = { inAppDocuments: false, emailDocuments: false, digest: 'off' };
  const r = decideRoute({ ...base, type: 'document.published', lp: off });
  check('muted documents: no bell, no email', !r.inApp && r.email === 'off', r);
  const r2 = decideRoute({ ...base, type: 'distribution.issued', lp: { ...off, digest: 'weekly' } });
  check('other category still delivered, weekly digest', r2.inApp && r2.email === 'weekly', r2);
  const r3 = decideRoute({ ...base, type: 'service_request.updated', lp: { inAppMessages: false, emailMessages: true, digest: 'off' } });
  check('requests follow the Messages switch', !r3.inApp && r3.email === 'now', r3);

  const merged = mergeLpPrefs([
    { inAppDocuments: false, emailDocuments: false, digest: 'daily' },
    { inAppDocuments: true, emailDocuments: false, digest: 'weekly' },
  ])!;
  check('multi-client: bell stays on when any client wants it', merged.inAppDocuments === true);
  check('multi-client: email off only when all off', merged.emailDocuments === false);
  check('multi-client: disagreeing digests fall back to immediate', merged.digest === 'off');
  check('merge of nothing is null', mergeLpPrefs([null, undefined]) === null);

  console.log('display preferences / statements / stream');
  check('quarter end on a quarter end', quarterEndOnOrBefore('2026-06-30') === '2026-06-30');
  check('quarter end mid quarter -> previous', quarterEndOnOrBefore('2026-08-15') === '2026-06-30');
  check('quarter end Feb -> previous year Q4', quarterEndOnOrBefore('2026-02-10') === '2025-12-31');
  check('quarter end bad date', quarterEndOnOrBefore('') === null);
  check('parseQuarter Q2', JSON.stringify(parseQuarter('2026-Q2')) === '{"period":"2026-Q2","start":"2026-04-01","end":"2026-06-30"}');
  check('parseQuarter rejects junk', parseQuarter('2026-Q5') === null && parseQuarter('x') === null);
  const qs = quartersUpTo('2026-02-10', 3).map((q) => q.period);
  check('quartersUpTo wraps the year', qs.join() === '2026-Q1,2025-Q4,2025-Q3', qs);
  const now = new Date('2026-10-03T10:00:00Z');
  check('cursor defaults to now', streamCursor(undefined, undefined, now).getTime() === now.getTime());
  check('cursor from Last-Event-ID', streamCursor('abc:lp_notification@2026-10-03T09:59:00.000Z', undefined, now).toISOString() === '2026-10-03T09:59:00.000Z');
  check('stale cursor ignored', streamCursor(undefined, '2020-01-01T00:00:00Z', now).getTime() === now.getTime());
}

async function live() {
  const cookie = process.env.E2E_LP_COOKIE;
  if (!cookie) {
    console.log('live part skipped (set E2E_LP_COOKIE)');
    return;
  }
  const api = process.env.E2E_API ?? 'http://localhost:4100';
  const headers = { Cookie: cookie, Origin: process.env.E2E_ORIGIN ?? 'http://localhost:3002' };
  console.log('live');
  const ac = new AbortController();
  const res = await fetch(`${api}/api/v1/lp-portal/realtime/stream`, { headers, signal: ac.signal });
  check('stream 200 text/event-stream', res.status === 200 && (res.headers.get('content-type') ?? '').startsWith('text/event-stream'), res.status);
  const reader = res.body!.getReader();
  const first = new TextDecoder().decode((await reader.read()).value);
  check('stream sends retry and ready', first.includes('retry:') || first.includes('event: ready'), first);
  ac.abort();
  const list: any = await (await fetch(`${api}/api/v1/lp-portal/statements`, { headers })).json();
  check('statements list', Array.isArray(list?.data?.items), list);
  const period = list?.data?.items?.[0]?.period;
  if (period) {
    const pdf = await fetch(`${api}/api/v1/lp-portal/statements/${period}/download`, { headers });
    const buf = Buffer.from(await pdf.arrayBuffer());
    check('statement is a PDF', pdf.status === 200 && buf.subarray(0, 5).toString() === '%PDF-', pdf.status);
  }
  const job: any = await (await fetch(`${api}/api/v1/lp-portal/performance/report/download?period=1Y`, { headers })).json();
  const id = job?.data?.jobId;
  if (id) {
    const dl = await fetch(`${api}/api/v1/lp-portal/reports/${id}/download`, { headers });
    check('report file name', /fund-performance-.+-\d{4}-\d{2}-\d{2}\.pdf/.test(dl.headers.get('content-disposition') ?? ''), dl.headers.get('content-disposition'));
  }
}

offline();
live()
  .catch((e) => {
    failures++;
    console.log('  FAIL  live', e instanceof Error ? e.message : e);
  })
  .finally(() => {
    console.log(failures ? `${failures} FAILED` : 'ALL PASSED');
    process.exit(failures ? 1 : 0);
  });
