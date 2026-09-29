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
  }
}

function loadScript(src: string): Promise<void> {
  return new Promise((resolve) => {
    const el = document.createElement('script');
    el.src = src;
    // Dynamically inserted scripts are async by default; the prototypes rely on
    // strict, sequential execution order (v33 -> v56 patch each other).
    el.async = false;
    el.onload = () => resolve();
    el.onerror = () => {
      console.error(`[legacy-runtime] failed to load ${src}`);
      resolve();
    };
    document.body.appendChild(el);
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
    if (booted[portalId]) return;
    booted[portalId] = true;

    let cancelled = false;

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
        for (const src of scripts) {
          if (cancelled) break;
          await loadScript(src);
        }
      } finally {
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
