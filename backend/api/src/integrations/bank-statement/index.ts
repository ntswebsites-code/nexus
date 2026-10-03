import { getAdapter } from '../core/registry';
import type { BankStatementAdapter } from './types';

export * from './types';

/** The configured bank-statement adapter (INTEGRATION_BANK_STATEMENT=fake|live). Every call is logged to integration_calls. */
export const getBankStatementAdapter = (): BankStatementAdapter => getAdapter('bank-statement');
