'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { usePathname } from 'next/navigation';
import { loadPlatformFlags } from '@/lib/investee/api';
import { isNativeLive, nativePageFor } from '@/lib/native-pages';
import { InvesteePortal } from '@/components/InvesteePortal';
import { NativeShell } from '@/components/native/NativeShell';

type Flags = { state: 'idle' } | { state: 'loading' } | { state: 'ready'; liveActions: string[] } | { state: 'failed' };

/**
 * Chooses per route between a native React screen and the V8 runtime (D-14). Flags are fetched only once a
 * native-capable route is visited; runtime routes mount the runtime straight away, as before. A failed flags
 * call falls back to the runtime, which shows its own retry panel instead of sample data (INO-016).
 */
export function PortalSwitch({ children }: { children: ReactNode }) {
  const pathname = usePathname() ?? '/';
  const native = nativePageFor(pathname);
  const [flags, setFlags] = useState<Flags>({ state: 'idle' });

  useEffect(() => {
    if (!native || flags.state !== 'idle') return;
    setFlags({ state: 'loading' });
    loadPlatformFlags()
      .then((f) => setFlags({ state: 'ready', liveActions: Array.isArray(f?.investee?.liveActions) ? f.investee.liveActions : [] }))
      .catch(() => setFlags({ state: 'failed' }));
  }, [native, flags.state]);

  if (native && (flags.state === 'idle' || flags.state === 'loading')) {
    return <p role="status" style={{ padding: 24, fontFamily: 'system-ui, sans-serif', color: '#6b7280' }}>Loading...</p>;
  }
  if (native && flags.state === 'ready' && isNativeLive(pathname, flags.liveActions)) {
    return (
      <NativeShell liveActions={flags.liveActions} pathname={pathname}>
        {children}
      </NativeShell>
    );
  }
  // Runtime route, or a native route whose loader is not live: the native page must not mount (it would call the API).
  return (
    <>
      <InvesteePortal />
      {!native && <div hidden>{children}</div>}
    </>
  );
}
