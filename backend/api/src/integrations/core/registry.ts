import { config } from '../../config';
import { prisma } from '../../lib/prisma';
import { instrument } from './calls';
import { INTEGRATION_NAMES, integrationEnvKey, type IntegrationMode, type IntegrationName } from './names';
import type { AdapterBase, AdapterMeta, HealthResult } from './types';

import { meta as emailMeta, type EmailAdapter } from '../email/types';
import { FakeEmail } from '../email/fake';
import { live as emailLive } from '../email/live';
import { meta as smsMeta, type SmsAdapter } from '../sms/types';
import { FakeSms } from '../sms/fake';
import { live as smsLive } from '../sms/live';
import { meta as screeningMeta, type ScreeningAdapter } from '../screening/types';
import { FakeScreening } from '../screening/fake';
import { live as screeningLive } from '../screening/live';
import { meta as idvMeta, type IdentityVerificationAdapter } from '../identity-verification/types';
import { FakeIdentityVerification } from '../identity-verification/fake';
import { live as idvLive } from '../identity-verification/live';
import { meta as marketMeta } from '../market-data/meta';
import { getMarketDataAdapter } from '../market-data';
import type { MarketDataAdapter } from '../market-data/types';
import { meta as custodianMeta } from '../custodian-feed/meta';
import { getCustodianFeedAdapter } from '../custodian-feed';
import type { CustodianFeedAdapter } from '../custodian-feed/types';
import { meta as bankMeta, type BankStatementAdapter } from '../bank-statement/types';
import { FakeBankStatement } from '../bank-statement/fake';
import { live as bankLive } from '../bank-statement/live';
import { meta as paymentMeta, type PaymentAdapter } from '../payment/types';
import { FakePayment, settlePendingPayments } from '../payment/fake';
import { live as paymentLive } from '../payment/live';
import { meta as esignMeta } from '../esign/meta';
import { getESignAdapter } from '../esign';
import type { ESignAdapter } from '../esign/types';
import { meta as avMeta, type AvScanAdapter } from '../av-scan/types';
import { FakeAvScan, EICAR } from '../av-scan/fake';
import { live as avLive } from '../av-scan/live';
import { meta as llmMeta, type LlmAdapter } from '../llm/types';
import { FakeLlm } from '../llm/fake';
import { live as llmLive } from '../llm/live';
import { meta as ssoMeta, type SsoAdapter } from '../sso/types';
import { FakeSso } from '../sso/fake';
import { live as ssoLive } from '../sso/live';
import { meta as storageMeta } from '../object-storage/meta';
import { objectStorageAdapter } from '../object-storage';
import type { ObjectStorage } from '../object-storage/types';
import { meta as filingMeta, type RegulatorFilingAdapter } from '../regulator-filing/types';
import { FakeRegulatorFiling } from '../regulator-filing/fake';
import { live as filingLive } from '../regulator-filing/live';
import { meta as brokerMeta, type BrokerRoutingAdapter } from '../broker-routing/types';
import { FakeBrokerRouting } from '../broker-routing/fake';
import { live as brokerLive } from '../broker-routing/live';

export interface AdapterMap {
  email: EmailAdapter;
  sms: SmsAdapter;
  screening: ScreeningAdapter;
  'identity-verification': IdentityVerificationAdapter;
  'market-data': MarketDataAdapter & AdapterBase;
  'custodian-feed': CustodianFeedAdapter & AdapterBase;
  'bank-statement': BankStatementAdapter;
  payment: PaymentAdapter;
  esign: ESignAdapter & AdapterBase;
  'av-scan': AvScanAdapter;
  llm: LlmAdapter;
  sso: SsoAdapter;
  'object-storage': ObjectStorage & AdapterBase;
  'regulator-filing': RegulatorFilingAdapter;
  'broker-routing': BrokerRoutingAdapter;
}

export interface TestContext {
  userEmail: string;
}
interface Entry<T extends AdapterBase> {
  meta: AdapterMeta;
  fake?: () => T;
  live?: T;
  /** Adapters with real modes beyond fake|live (esign native, market-data public, ...) build their own (already logged) instance. */
  build?: () => T;
  /** The admin "test call": exercises the adapter end to end and returns a short summary. */
  test: (a: T, ctx: TestContext, mode: IntegrationMode) => Promise<unknown>;
}
const entry = <T extends AdapterBase>(e: Entry<T>) => e;
const today = () => new Date().toISOString().slice(0, 10);

const CATALOG: { [K in IntegrationName]: Entry<AdapterMap[K]> } = {
  email: entry<EmailAdapter>({
    meta: emailMeta,
    fake: () => new FakeEmail(),
    live: emailLive,
    test: (a, ctx) => a.send({ to: ctx.userEmail, subject: '[Matanho Nexus] Integration test', text: 'This is a test message from the integrations screen.' }),
  }),
  sms: entry<SmsAdapter>({ meta: smsMeta, fake: () => new FakeSms(), live: smsLive, test: (a) => a.sendOtp({ to: '+000000000', purpose: 'integration-test' }) }),
  screening: entry<ScreeningAdapter>({
    meta: screeningMeta,
    fake: () => new FakeScreening(),
    live: screeningLive,
    test: (a) =>
      a.screen({ caseRef: 'KYC-0000', legalName: 'Integration Test Ltd', ownerNames: [], pep: false, declaredSanctions: false, declaredAdverseMedia: false, country: 'Zimbabwe', taxResidence: 'Zimbabwe', expectedInvestment: 1000, documentsPresent: 3 }),
  }),
  'identity-verification': entry<IdentityVerificationAdapter>({
    meta: idvMeta,
    fake: () => new FakeIdentityVerification(),
    live: idvLive,
    test: (a) => a.verify({ subjectName: 'Test Person', documentType: 'passport', documentNumber: 'TEST123', country: 'ZW' }),
  }),
  'market-data': entry<AdapterMap['market-data']>({
    meta: marketMeta,
    build: () => getMarketDataAdapter() as AdapterMap['market-data'],
    test: async (a) => {
      const q = await a.fetchQuotes(['TEST.ZW']);
      return { quotes: q.items.length, issues: q.issues.length };
    },
  }),
  'custodian-feed': entry<AdapterMap['custodian-feed']>({
    meta: custodianMeta,
    build: () => getCustodianFeedAdapter() as AdapterMap['custodian-feed'],
    test: async (a) => ({ statements: (await a.listStatements({ limit: 5 })).length }),
  }),
  'bank-statement': entry<BankStatementAdapter>({
    meta: bankMeta,
    fake: () => new FakeBankStatement(),
    live: bankLive,
    test: (a) => a.fetchStatement({ accountRef: 'TEST-ACCOUNT', from: today(), to: today(), currency: 'USD', openingBalance: '1000.00' }),
  }),
  payment: entry<PaymentAdapter>({
    meta: paymentMeta,
    fake: () => new FakePayment(),
    live: paymentLive,
    test: async (a, _c, mode) => {
      const first = await a.instruct({ reference: `integration-test-${Date.now()}`, amount: '1.00', currency: 'USD', beneficiaryName: 'Test Beneficiary', beneficiaryAccount: 'TEST-0001', purpose: 'integration test' });
      if (mode === 'fake') await settlePendingPayments(0);
      return { initial: first.status, after: (await a.getStatus({ paymentRef: first.paymentRef })).status };
    },
  }),
  esign: entry<AdapterMap['esign']>({
    meta: esignMeta,
    build: () => getESignAdapter() as AdapterMap['esign'],
    test: async (a) => ({ mode: a.mode, chain: a.verifyChain('TEST-REF', '0'.repeat(64), [], null).ok }),
  }),
  'av-scan': entry<AvScanAdapter>({
    meta: avMeta,
    fake: () => new FakeAvScan(),
    live: avLive,
    test: async (a, _c, mode) => {
      const clean = await a.scan({ name: 'test.txt', mime: 'text/plain', data: Buffer.from('hello') });
      if (mode !== 'fake') return { clean: clean.verdict };
      const eicar = await a.scan({ name: 'eicar.txt', mime: 'text/plain', data: Buffer.from(EICAR, 'latin1') });
      return { clean: clean.verdict, eicar: eicar.verdict };
    },
  }),
  llm: entry<LlmAdapter>({ meta: llmMeta, fake: () => new FakeLlm(), live: llmLive, test: (a) => a.complete({ prompt: 'Reply with the single word OK.', maxTokens: 8 }) }),
  sso: entry<SsoAdapter>({ meta: ssoMeta, fake: () => new FakeSso(), live: ssoLive, test: (a) => a.beginLogin({ state: 'integration-test', redirectUri: `${config.publicApiUrl}/sso/callback` }) }),
  'object-storage': entry<AdapterMap['object-storage']>({
    meta: storageMeta,
    build: () => objectStorageAdapter() as AdapterMap['object-storage'],
    test: async (a) => {
      const key = `zz${Date.now().toString(16)}integrationtest`;
      await a.put(key, Buffer.from('integration-test'));
      const ok = (await a.get(key)).toString() === 'integration-test';
      await a.delete(key);
      return { roundTrip: ok };
    },
  }),
  'regulator-filing': entry<RegulatorFilingAdapter>({
    meta: filingMeta,
    fake: () => new FakeRegulatorFiling(),
    live: filingLive,
    test: (a) => a.submit({ regulator: 'TEST', formCode: 'T-0', filingRef: 'REG-TEST', payloadSha256: '1'.repeat(64) }),
  }),
  'broker-routing': entry<BrokerRoutingAdapter>({
    meta: brokerMeta,
    fake: () => new FakeBrokerRouting(),
    live: brokerLive,
    test: async (a) => {
      const ack = await a.routeOrder({ orderRef: `TEST-${Date.now()}`, brokerCode: 'TEST', ticker: 'TEST.ZW', side: 'BUY', quantity: '100', limitPrice: '1.000000' });
      return { ack: ack.status, fills: (await a.fetchFills({ brokerOrderRef: ack.brokerOrderRef })).fills.length };
    },
  }),
};

// ------------------------------------------------------------------ access

const cache = new Map<string, unknown>();

/** The adapter selected by INTEGRATION_<NAME>, wrapped so every operation is logged to `integration_calls`. */
export function getAdapter<K extends IntegrationName>(name: K): AdapterMap[K] {
  const hit = cache.get(name);
  if (hit) return hit as AdapterMap[K];
  const e = CATALOG[name] as unknown as Entry<AdapterBase>;
  const mode = config.integrations[name];
  const wrapped = e.build ? e.build() : instrument(name, mode, mode === 'live' ? e.live! : e.fake!());
  cache.set(name, wrapped);
  return wrapped as AdapterMap[K];
}

export const adapterMode = (name: IntegrationName): IntegrationMode => config.integrations[name];
export const adapterMeta = (name: IntegrationName): AdapterMeta => CATALOG[name].meta;

/** Env vars `live` needs that are currently empty. */
const requiredEnvFor = (name: IntegrationName, mode: IntegrationMode) => (mode === 'live' ? CATALOG[name].meta.requiredEnv : (CATALOG[name].meta.modeRequiredEnv?.[mode] ?? []));
export const missingEnv = (name: IntegrationName, env: NodeJS.ProcessEnv = process.env) => requiredEnvFor(name, config.integrations[name]).filter((k) => !env[k]);

export async function adapterHealth(name: IntegrationName): Promise<HealthResult> {
  try {
    if (config.integrations[name] === 'fake') {
      const state = await prisma.integrationState.findUnique({ where: { adapter: name } });
      if (state?.failureMode === 'error') return { ok: false, detail: `Failure simulation active${state.failuresRemaining ? ` (${state.failuresRemaining} calls left)` : ''}` };
    }
    // `health` is not instrumented, so call the raw implementation through the wrapper without logging.
    return await getAdapter(name).health();
  } catch (e) {
    return { ok: false, detail: e instanceof Error ? e.message : String(e) };
  }
}

/** Runs the adapter's test call (logged like any call) and reports the outcome. */
export async function runAdapterTest(name: IntegrationName, ctx: TestContext) {
  const started = Date.now();
  const e = CATALOG[name] as unknown as Entry<AdapterBase>;
  try {
    const summary = await e.test(getAdapter(name), ctx, config.integrations[name]);
    return { ok: true, durationMs: Date.now() - started, summary };
  } catch (err) {
    return { ok: false, durationMs: Date.now() - started, error: err instanceof Error ? err.message : String(err), code: (err as { code?: string }).code ?? 'error' };
  }
}

// ------------------------------------------------------------------ startup rules

export interface ValidationInput {
  modes: Record<IntegrationName, IntegrationMode>;
  env: NodeJS.ProcessEnv;
  isProduction: boolean;
  allowFake: boolean;
}

/**
 * Startup rules: `live` needs its credentials; `fake` is refused in production unless ALLOW_FAKE_INTEGRATIONS=1
 * (adapters whose fake is a real, supported deployment, such as email over SMTP or the local encrypted store, are exempt).
 */
export function validateIntegrationConfig(input: ValidationInput): string[] {
  const problems: string[] = [];
  for (const name of INTEGRATION_NAMES) {
    const { meta } = CATALOG[name];
    const mode = input.modes[name];
    if (mode === 'live' || mode === 's3') {
      const missing = (mode === 'live' ? meta.requiredEnv : (meta.modeRequiredEnv?.[mode] ?? [])).filter((k) => !input.env[k]);
      if (missing.length) problems.push(`${integrationEnvKey(name)}=${mode} requires ${missing.join(', ')}`);
    } else if (mode !== 'fake') {
      // Real modes (native, local, public, file-drop) are supported deployments.
    } else if (input.isProduction && !input.allowFake && !meta.productionSafeFake?.(input.env)) {
      problems.push(`${integrationEnvKey(name)}=fake is not allowed in production (set it to live with credentials, or set ALLOW_FAKE_INTEGRATIONS=1)`);
    }
  }
  return problems;
}

/** Throws (refusing to start) when the integration flags are inconsistent. Called by the API and the worker at startup. */
export function assertIntegrationsConfig() {
  const problems = validateIntegrationConfig({ modes: config.integrations, env: process.env, isProduction: config.isProduction, allowFake: config.allowFakeIntegrations });
  if (problems.length) throw new Error(`Invalid integration configuration:\n${problems.map((p) => `  - ${p}`).join('\n')}`);
}

/** Adapters that are `fake` where a production build would be wrong to run them (drives the /ops banner). */
export function fakeInProduction(): IntegrationName[] {
  if (!config.isProduction) return [];
  return INTEGRATION_NAMES.filter((n) => config.integrations[n] === 'fake' && !CATALOG[n].meta.productionSafeFake?.(process.env));
}

export const allAdapterNames = () => [...INTEGRATION_NAMES];
export { settlePendingPayments };
