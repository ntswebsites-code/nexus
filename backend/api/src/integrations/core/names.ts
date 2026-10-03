/** Adapter names. No imports here: config/env.ts reads this list to build the INTEGRATION_<NAME> flags. */
export const INTEGRATION_NAMES = [
  'email',
  'sms',
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
export type IntegrationMode = 'fake' | 'live';

/** `identity-verification` -> `INTEGRATION_IDENTITY_VERIFICATION`. */
export const integrationEnvKey = (name: IntegrationName) => `INTEGRATION_${name.toUpperCase().replace(/-/g, '_')}`;
