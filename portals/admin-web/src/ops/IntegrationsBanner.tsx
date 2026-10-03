'use client';

import { api, v1 } from './api';
import { Alert, useResource } from './ui';

/** Persistent /ops banner: shown only when a production build still runs simulated (fake) integration adapters. */
export function IntegrationsBanner() {
  const res = useResource<{ production: boolean; fakeAdapters: string[]; count: number }>(() => api.get(v1('/admin-core/integrations/banner')), []);
  if (res.state !== 'ok' || !res.data.production || res.data.count === 0) return null;
  return (
    <Alert kind="warn">
      Simulated integrations are active in production: {res.data.fakeAdapters.join(', ')}. These adapters do not reach a real provider (Administration, Integrations).
    </Alert>
  );
}
