/** Adapter names. No imports here: config/env.ts reads this list to build the INTEGRATION_<NAME> flags. */
export const INTEGRATION_NAMES = [
  'email',
  'screening',
  'identity-verification',
  'market-data',
  'custodian-feed',
  'bank-statement',
  'payment',
  'esign',
  'av-scan',
  'llm',
  'sso',
  'object-storage',
  'regulator-filing',
  'broker-routing',
] as const;

export type IntegrationName = (typeof INTEGRATION_NAMES)[number];
export type IntegrationMode = 'fake' | 'live' | 'public' | 'native' | 'file-drop' | 'local' | 's3';

/** Modes beyond fake|live for adapters that ship a real implementation; the first entry is the default. */
const SPECS: Partial<Record<IntegrationName, readonly [IntegrationMode, ...IntegrationMode[]]>> = {
  esign: ['native', 'fake', 'live'],
  'object-storage': ['local', 's3', 'fake'],
  'market-data': ['fake', 'public', 'live'],
  'custodian-feed': ['file-drop', 'fake', 'live'],
  'broker-routing': ['fake', 'file-drop', 'live'],
};
export const integrationModes = (name: IntegrationName): readonly [IntegrationMode, ...IntegrationMode[]] => SPECS[name] ?? ['fake', 'live'];
/** True for modes that are real, supported deployments (not simulations, not vendor stubs). */
export const isRealMode = (mode: IntegrationMode) => mode !== 'fake' && mode !== 'live';

/** `identity-verification` -> `INTEGRATION_IDENTITY_VERIFICATION`. */
export const integrationEnvKey = (name: IntegrationName) => `INTEGRATION_${name.toUpperCase().replace(/-/g, '_')}`;
