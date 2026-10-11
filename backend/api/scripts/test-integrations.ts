/**
 * Integrations layer checks (WP-8).
 *
 * Part 1 needs no database: startup rules (live without credentials refuses, production refuses fake), live stubs,
 * redaction and the deterministic fakes. Part 2 needs a disposable MySQL with migrations applied and runs only with
 * E2E_CONFIRM=throwaway-db: every fake round-trips and persists, the call log is written, failure simulation works.
 *
 *   npx tsx scripts/test-integrations.ts                         # part 1
 *   E2E_CONFIRM=throwaway-db npx tsx scripts/test-integrations.ts # parts 1 and 2
 */
process.env.DATABASE_URL ??= 'mysql://test:test@localhost:3306/test';

let failures = 0;
const check = (name: string, cond: unknown, detail?: unknown) => {
  if (cond) console.log(`  PASS  ${name}`);
  else {
    failures++;
    console.log(`  FAIL  ${name}`, detail === undefined ? '' : JSON.stringify(detail));
  }
};

async function main() {
  const { INTEGRATION_NAMES } = await import('../src/integrations/core/names');
  const { validateIntegrationConfig, getAdapter } = await import('../src/integrations/core/registry');
  const { redact } = await import('../src/integrations/core/calls');
  const { NotConfiguredError } = await import('../src/integrations/core/types');
  const { liveStub } = await import('../src/integrations/core/live');
  const { meta: screeningMeta } = await import('../src/integrations/screening/types');
  const { EICAR, FakeAvScan } = await import('../src/integrations/av-scan/fake');
  const { FakeMarketDataProvider } = await import('../src/integrations/market-data/fake');
  const { FakeScreening } = await import('../src/integrations/screening/fake');
  const { FakeBankStatement } = await import('../src/integrations/bank-statement/fake');
  const { FakeSso, fakeSsoCode } = await import('../src/integrations/sso/fake');
  const { parseStatement, statementVariance } = await import('../src/modules/cash/cash.engine');

  console.log('startup rules');
  const allFake = Object.fromEntries(INTEGRATION_NAMES.map((n) => [n, 'fake'])) as Record<(typeof INTEGRATION_NAMES)[number], 'fake' | 'live'>;
  check('fake everywhere is fine outside production', validateIntegrationConfig({ modes: allFake, env: {}, isProduction: false, allowFake: false }).length === 0);
  const liveNeeding = validateIntegrationConfig({ modes: { ...allFake, screening: 'live' }, env: {}, isProduction: false, allowFake: false });
  check('live without credentials refuses to start and names the variables', liveNeeding.length === 1 && screeningMeta.requiredEnv.every((k) => liveNeeding[0]!.includes(k)), liveNeeding);
  check(
    'live with credentials passes',
    validateIntegrationConfig({ modes: { ...allFake, screening: 'live' }, env: { SCREENING_API_KEY: 'x' }, isProduction: false, allowFake: false }).length === 0,
  );
  const prod = validateIntegrationConfig({ modes: allFake, env: {}, isProduction: true, allowFake: false });
  check('production refuses fake adapters', prod.some((p) => p.startsWith('INTEGRATION_SCREENING=fake')) && prod.some((p) => p.startsWith('INTEGRATION_PAYMENT=fake')), prod);
  check('production exempts email only when SMTP is set', prod.some((p) => p.startsWith('INTEGRATION_EMAIL=')) && !validateIntegrationConfig({ modes: allFake, env: { SMTP_HOST: 'smtp' }, isProduction: true, allowFake: false }).some((p) => p.startsWith('INTEGRATION_EMAIL=')));
  check('object storage and llm fakes are production-acceptable', !prod.some((p) => p.startsWith('INTEGRATION_OBJECT_STORAGE=') || p.startsWith('INTEGRATION_LLM=')));
  check('ALLOW_FAKE_INTEGRATIONS lifts the production guard', validateIntegrationConfig({ modes: allFake, env: {}, isProduction: true, allowFake: true }).length === 0);

  console.log('live stubs and redaction');
  const stub = liveStub<{ health(): Promise<{ ok: boolean; detail: string }>; screen(): Promise<void> }>({ name: 'screening', requiredEnv: ['SCREENING_API_URL', 'SCREENING_API_KEY'], vendorCalls: { screen: 'POST /screenings' } });
  let thrown: unknown;
  await stub.screen().catch((e) => (thrown = e));
  check('live stub throws NotConfiguredError naming the env vars', thrown instanceof NotConfiguredError && String((thrown as Error).message).includes('SCREENING_API_URL'), String(thrown));
  check('NotConfiguredError is a 503 HttpError', (thrown as { status?: number }).status === 503);
  check('live stub health reports instead of throwing', (await stub.health()).ok === false);
  const red = redact({ to: 'a@b.c', text: 'secret link', password: 'p', data: Buffer.from('abc'), nested: { token: 't', keep: 1 }, messageId: 'm1' }) as Record<string, unknown>;
  check('redaction removes bodies, secrets and bytes', red.text === '[redacted]' && red.password === '[redacted]' && red.data === '[redacted]' && (red.nested as { token: string }).token === '[redacted]' && red.messageId === 'm1' && red.to === 'a@b.c', red);
  check('redaction summarises raw buffers', JSON.stringify(redact(Buffer.from('abcd'))) === '{"bytes":4}');

  console.log('deterministic fakes');
  const av = new FakeAvScan();
  check('av-scan flags EICAR', (await av.scan({ name: 'e.txt', mime: 'text/plain', data: Buffer.from(`prefix ${EICAR} suffix`, 'latin1') })).verdict === 'infected');
  check('av-scan passes clean data', (await av.scan({ name: 'a.txt', mime: 'text/plain', data: Buffer.from('hello') })).verdict === 'clean');
  const md = new FakeMarketDataProvider();
  const ctx = (iso: string) => ({ now: new Date(`${iso}T10:00:00Z`) });
  const p1 = (await md.fetchQuotes(['AAA.ZW'], ctx('2026-10-01'))).items;
  const p2 = (await md.fetchQuotes(['AAA.ZW'], ctx('2026-10-01'))).items;
  const p3 = (await md.fetchQuotes(['AAA.ZW'], ctx('2026-10-02'))).items;
  check('market data is deterministic per ticker and date', p1[0]!.price === p2[0]!.price && p1[0]!.price !== p3[0]!.price);
  const fx = (await md.fetchFx([{ from: 'ZWG', to: 'USD' }, { from: 'USD', to: 'ZWG' }], ctx('2026-10-01'))).items;
  check('fx cross rates are roughly consistent', Math.abs(Number(fx[0]!.rate) * Number(fx[1]!.rate) - 1) < 0.05, fx);
  const scr = new FakeScreening();
  const base = { caseRef: 'KYC-1001', legalName: 'Clean Ltd', ownerNames: ['Jane Doe'], pep: false, declaredSanctions: false, declaredAdverseMedia: false, country: 'Zimbabwe', taxResidence: 'Zimbabwe', expectedInvestment: 100, documentsPresent: 3 };
  const clean = await scr.screen(base);
  check('screening fake: clean applicant is Low risk with four Clear checks', clean.risk === 'Low' && clean.results.length === 4 && clean.results.every((r) => r.outcome === 'Clear') && clean.provider === 'stub-screening-v1', clean);
  check('screening fake: declared sanctions is a High-risk Match', (await scr.screen({ ...base, declaredSanctions: true })).results[0]!.outcome === 'Match');
  check('screening fake: large ticket without red flags is Medium', (await scr.screen({ ...base, expectedInvestment: 6_000_000 })).risk === 'Medium');
  const stmt = await new FakeBankStatement().fetchStatement({ accountRef: 'CLG-1001', from: '2026-10-01', to: '2026-10-03', currency: 'USD', openingBalance: '100.00' });
  const parsed = parseStatement('JSON', stmt.json, {});
  check('bank statement fake parses with the cash engine and foots', parsed.errors.length === 0 && statementVariance(parsed.opening!, parsed.closing!, parsed.lines).isZero(), parsed.errors);
  check('bank statement fake emits CAMT.053 XML', stmt.xml.includes('camt.053') && stmt.xml.includes('<Ntry>'));
  const { isCamtStatement } = await import('../src/modules/custodian/custodian.cash-bridge');
  const camtParsed = parseStatement('CAMT053', stmt.xml, {});
  check('custodian CAMT bridge detects XML and parses via cash.engine', isCamtStatement(stmt.xml) && camtParsed.errors.length === 0 && camtParsed.accountRef === 'CLG-1001', camtParsed.errors);
  const code = fakeSsoCode('a@b.co');
  check('fake SSO code round-trips outside production', (await new FakeSso().completeLogin({ code })).email === 'a@b.co');
  check('fake SSO rejects a tampered code', await new FakeSso().completeLogin({ code: `${code}x` }).then(() => false, () => true));

  if (process.env.E2E_CONFIRM !== 'throwaway-db') {
    console.log('\nDatabase checks skipped (set E2E_CONFIRM=throwaway-db against a disposable MySQL to run them).');
    return;
  }

  const { prisma } = await import('../src/lib/prisma');
  const { clearStateCache } = await import('../src/integrations/core/calls');
  const { settlePendingPayments } = await import('../src/integrations/payment/fake');
  const { storeFile } = await import('../src/lib/storage');
  const { sendMail } = await import('../src/lib/mailer');

  console.log('persistence (fake mode)');
  const calls = (adapter: string, operation: string) => prisma.integrationCall.count({ where: { adapter, operation } });
  const tag = `it-${Date.now()}`;

  await sendMail(`${tag}@example.invalid`, `Subject ${tag}`, 'body with a link https://example.invalid/reset?token=abc');
  const mail = await prisma.integrationInbox.findFirst({ where: { adapter: 'email', kind: 'email' }, orderBy: { createdAt: 'desc' } });
  check('email fake stores the message in the inbox', (mail?.payload as { subject?: string } | undefined)?.subject === `Subject ${tag}`);
  const mailCall = await prisma.integrationCall.findFirst({ where: { adapter: 'email', operation: 'send' }, orderBy: { createdAt: 'desc' } });
  check('email call is logged with the body redacted', mailCall?.status === 'OK' && JSON.stringify(mailCall.request).includes('[redacted]') && !JSON.stringify(mailCall.request).includes('token=abc'));

  const pay = getAdapter('payment');
  const first = await pay.instruct({ reference: tag, amount: '10.00', currency: 'USD', beneficiaryName: 'B', beneficiaryAccount: 'ACC-1' });
  check('payment starts PENDING and is idempotent on reference', first.status === 'PENDING' && (await pay.instruct({ reference: tag, amount: '10.00', currency: 'USD', beneficiaryName: 'B', beneficiaryAccount: 'ACC-1' })).paymentRef === first.paymentRef);
  await settlePendingPayments(0);
  check('payment is SETTLED after a tick', (await pay.getStatus({ paymentRef: first.paymentRef })).status === 'SETTLED');
  const bad = await pay.instruct({ reference: `${tag}-f`, amount: '1.00', currency: 'USD', beneficiaryName: 'B', beneficiaryAccount: 'FAIL-9' });
  await settlePendingPayments(0);
  check('payment to a FAIL account ends FAILED', (await pay.getStatus({ paymentRef: bad.paymentRef })).status === 'FAILED');

  const sign = getAdapter('esign');
  const chain = sign.verifyChain('REF-1', 'a'.repeat(64), [], null);
  check('esign adapter verifies an empty chain and reports its mode', chain.ok && ['native', 'fake', 'live'].includes(sign.mode));
  check('esign adapter health is available', typeof (await sign.health()).ok === 'boolean');

  const store = getAdapter('object-storage');
  const key = `zz${tag.replace(/\W/g, '')}`;
  await store.put(key, Buffer.from('payload'));
  check('object storage round-trips encrypted bytes', (await store.get(key)).toString() === 'payload');

  const broker = getAdapter('broker-routing');
  const ack = await broker.routeOrder({ orderRef: tag, brokerCode: 'B1', ticker: 'AAA.ZW', side: 'BUY', quantity: '10', limitPrice: '2.500000' });
  const fills = await broker.fetchFills({ brokerOrderRef: ack.brokerOrderRef });
  check('broker routing acknowledges then fills at the limit', ack.status === 'ACKNOWLEDGED' && fills.status === 'FILLED' && fills.fills[0]!.price === '2.500000');

  const filing = await getAdapter('regulator-filing').submit({ regulator: 'SECZ', formCode: 'F1', filingRef: tag, payloadSha256: 'b'.repeat(64) });
  check('regulator filing returns a receipt', filing.status === 'ACKNOWLEDGED' && filing.receiptRef.startsWith('FAKE-SECZ-'));

  await getAdapter('llm').complete({ prompt: 'hello' });
  check('every adapter call is logged to integration_calls', (await calls('payment', 'instruct')) >= 2 && (await calls('object-storage', 'put')) >= 1 && (await calls('llm', 'complete')) >= 1);

  console.log('upload scanning');
  let rejected = '';
  await storeFile({ name: 'eicar.txt', mime: 'text/plain', data: Buffer.from(EICAR, 'latin1') }).catch((e) => (rejected = (e as { code?: string }).code ?? ''));
  check('storeFile rejects an infected upload', rejected === 'malware_detected', rejected);
  const ok = await storeFile({ name: 'ok.txt', mime: 'text/plain', data: Buffer.from('fine') });
  check('storeFile stores a clean upload', ok.scanStatus === 'clean');

  console.log('failure simulation');
  await prisma.integrationState.upsert({ where: { adapter: 'av-scan' }, update: { failureMode: 'error', failuresRemaining: 2 }, create: { adapter: 'av-scan', failureMode: 'error', failuresRemaining: 2 } });
  clearStateCache('av-scan');
  const failed: string[] = [];
  for (let i = 0; i < 3; i++) await getAdapter('av-scan').scan({ name: 'a', mime: 'text/plain', data: Buffer.from('x') }).then(() => failed.push('ok'), (e) => failed.push((e as { code?: string }).code ?? 'err'));
  check('N simulated failures then recovery', failed.join() === 'integration_simulated_failure,integration_simulated_failure,ok', failed);
  const errRow = await prisma.integrationCall.findFirst({ where: { adapter: 'av-scan', status: 'ERROR' }, orderBy: { createdAt: 'desc' } });
  check('failed calls are logged as ERROR', errRow?.error?.includes('Simulated failure'));
  await prisma.integrationState.delete({ where: { adapter: 'av-scan' } }).catch(() => undefined);
  clearStateCache();

  await prisma.$disconnect();
}

main()
  .then(() => {
    console.log(failures ? `\n${failures} check(s) FAILED` : '\nAll checks passed');
    process.exit(failures ? 1 : 0);
  })
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
