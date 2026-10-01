'use client';

import { useEffect } from 'react';

type Listener = EventListenerOrEventListenerObject;

interface CapturedListener {
  target: 'document' | 'window';
  type: string;
  listener: Listener;
}

declare global {
  interface Window {
    __matanhoLegacyBooted?: Record<string, boolean>;
    /** Set by bridge scripts: resolves once live API data is in `window.__mxData`. */
    __matanhoBridgeReady?: Promise<unknown>;
  }
}

/** Bridge scripts (public/legacy/js/bridge/*) run before the prototype scripts. */
const BRIDGE_PREFIX = '/legacy/js/bridge/';
const BRIDGE_TIMEOUT_MS = 15_000;

async function awaitBridge() {
  const ready = window.__matanhoBridgeReady;
  if (!ready) return;
  let timer: number | undefined;
  try {
    await Promise.race([
      ready,
      new Promise((resolve) => {
        timer = window.setTimeout(() => {
          console.warn('[legacy-runtime] bridge data not ready in time; continuing with prototype data');
          resolve(undefined);
        }, BRIDGE_TIMEOUT_MS);
      }),
    ]);
  } catch (error) {
    console.error('[legacy-runtime] bridge failed', error);
  } finally {
    window.clearTimeout(timer);
  }
}

/**
 * Insert every script at once with `async=false`. The browser downloads them in
 * parallel and still evaluates them strictly in document order, which is what
 * the prototype's patch chain (v33 → v56) depends on.
 */
function loadScriptsInOrder(srcs: string[]): Promise<void> {
  return new Promise((resolve) => {
    if (srcs.length === 0) {
      resolve();
      return;
    }
    let remaining = srcs.length;
    const done = () => {
      remaining -= 1;
      if (remaining <= 0) resolve();
    };
    for (const src of srcs) {
      const el = document.createElement('script');
      el.src = src;
      el.async = false;
      el.onload = done;
      el.onerror = () => {
        console.error(`[legacy-runtime] failed to load ${src}`);
        done();
      };
      document.body.appendChild(el);
    }
  });
}

function callListener(listener: Listener, target: EventTarget, event: Event) {
  try {
    if (typeof listener === 'function') listener.call(target, event);
    else listener.handleEvent(event);
  } catch (error) {
    console.error('[legacy-runtime] listener failed', error);
  }
}

function markReady() {
  document.documentElement.dataset.legacyReady = '1';
}

/**
 * Executes the original prototype scripts, in order, after the markup is in the
 * document.
 *
 * The original pages loaded their scripts while `document.readyState` was
 * `"loading"`, so every script deferred its bootstrap to `DOMContentLoaded`.
 * When Next.js hydrates, the document is already `complete`. To keep the exact
 * original start-up sequence we (1) report `readyState === "loading"` while the
 * scripts are evaluated, (2) capture `DOMContentLoaded` / `load` listeners they
 * register, and (3) invoke them once every script has been evaluated.
 */
export function LegacyScripts({ portalId, scripts }: { portalId: string; scripts: string[] }) {
  useEffect(() => {
    const booted = (window.__matanhoLegacyBooted ??= {});
    // React StrictMode runs effects twice in development; boot exactly once.
    if (booted[portalId]) {
      markReady();
      return;
    }
    booted[portalId] = true;

    let cancelled = false;
    const failSafe = window.setTimeout(markReady, 12_000 + BRIDGE_TIMEOUT_MS);

    const run = async () => {
      const captured: CapturedListener[] = [];

      const nativeDocAdd = document.addEventListener.bind(document);
      const nativeWinAdd = window.addEventListener.bind(window);

      const capture = (
        target: 'document' | 'window',
        native: typeof nativeDocAdd,
      ): typeof nativeDocAdd =>
        ((type: string, listener: Listener | null, options?: boolean | AddEventListenerOptions) => {
          if (
            listener &&
            (type === 'DOMContentLoaded' ||
              (target === 'window' && type === 'load') ||
              (target === 'document' && type === 'readystatechange'))
          ) {
            captured.push({ target, type, listener });
            return;
          }
          native(type, listener as EventListener, options);
        }) as typeof nativeDocAdd;

      document.addEventListener = capture('document', nativeDocAdd);
      window.addEventListener = capture('window', nativeWinAdd);

      let readyState: DocumentReadyState = 'loading';
      Object.defineProperty(document, 'readyState', {
        configurable: true,
        get: () => readyState,
      });

      const restore = () => {
        document.addEventListener = nativeDocAdd;
        window.addEventListener = nativeWinAdd;
        delete (document as { readyState?: unknown }).readyState;
      };

      try {
        // Bridge first: it fetches live API data that the prototype scripts read
        // while they evaluate (window.__mxData), so it must be in place before them.
        await loadScriptsInOrder(scripts.filter((s) => s.startsWith(BRIDGE_PREFIX)));
        await awaitBridge();
        await loadScriptsInOrder(scripts.filter((s) => !s.startsWith(BRIDGE_PREFIX)));
      } finally {
        if (cancelled) return;
        // -> readyState "interactive": fire DOMContentLoaded (+ readystatechange)
        readyState = 'interactive';
        for (const c of captured.filter((x) => x.type === 'readystatechange')) {
          callListener(c.listener, document, new Event('readystatechange'));
        }
        for (const c of captured.filter((x) => x.type === 'DOMContentLoaded')) {
          const target = c.target === 'document' ? document : window;
          callListener(c.listener, target, new Event('DOMContentLoaded', { bubbles: true }));
        }

        // -> readyState "complete": fire load handlers.
        readyState = 'complete';
        restore();
        for (const c of captured.filter((x) => x.type === 'readystatechange')) {
          callListener(c.listener, document, new Event('readystatechange'));
        }
        for (const c of captured.filter((x) => x.target === 'window' && x.type === 'load')) {
          callListener(c.listener, window, new Event('load'));
        }
        if (typeof window.onload === 'function') {
          try {
            window.onload.call(window, new Event('load'));
          } catch (error) {
            console.error('[legacy-runtime] window.onload failed', error);
          }
        }
        window.dispatchEvent(new CustomEvent('matanho:legacy-ready', { detail: { portalId } }));
        window.clearTimeout(failSafe);
        markReady();
      }
    };

    void run();
    return () => {
      // Intentionally not cancelling: the boot must complete exactly once even
      // if StrictMode simulates an unmount/remount cycle.
      cancelled = false;
    };
  }, [portalId, scripts]);

  return null;
}
