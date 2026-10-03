import { integrationMode } from '../common';
import { instrument } from '../core/calls';
import type { BrokerRoutingAdapter } from './types';
import { FakeBrokerRouting } from './fake';
import { FileDropBrokerRouting } from './file-drop';
import { live } from './live';

export type BrokerRoutingMode = 'fake' | 'file-drop' | 'live';

/** `INTEGRATION_BROKER_ROUTING=fake|file-drop|live` (default fake; production uses file-drop until a FIX session is built). */
export const brokerRoutingMode = (env: NodeJS.ProcessEnv = process.env): BrokerRoutingMode => integrationMode<BrokerRoutingMode>('INTEGRATION_BROKER_ROUTING', ['fake', 'file-drop', 'live'], 'fake', env);

/** The raw implementation for a mode (no call logging). */
export const brokerRoutingFor = (mode: BrokerRoutingMode): BrokerRoutingAdapter => (mode === 'live' ? live : mode === 'file-drop' ? new FileDropBrokerRouting() : new FakeBrokerRouting());

/** The registry's builder: the selected implementation with every operation logged to `integration_calls`. */
export const buildBrokerRoutingAdapter = (env: NodeJS.ProcessEnv = process.env): BrokerRoutingAdapter => {
  const mode = brokerRoutingMode(env);
  return instrument('broker-routing', mode, brokerRoutingFor(mode));
};
