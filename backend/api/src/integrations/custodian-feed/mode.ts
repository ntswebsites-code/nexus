import { integrationMode } from '../common';
import type { CustodianFeedMode } from './types';

/** `INTEGRATION_CUSTODIAN_FEED=file-drop|fake|live` (default file-drop: admin uploads, nothing external). */
export const custodianFeedMode = (env: NodeJS.ProcessEnv = process.env): CustodianFeedMode => integrationMode<CustodianFeedMode>('INTEGRATION_CUSTODIAN_FEED', ['file-drop', 'fake', 'live'], 'file-drop', env);
