import { vi, expect } from 'vitest';
import { act } from '@testing-library/react';
import { InvesteePortal } from '@/components/InvesteePortal';
import { IP8_PAGE_TO_PATH } from '@/lib/nav';
import { mockApi, renderWithProviders, waitFor, setRoute, type Routes, type MockApi } from '../_helpers';
import { healthyRoutes, P } from './_fixtures';

/** Recordable window.location (jsdom cannot navigate). */
export function stubLocation(search = '', pathname = '/') {
  const assign = vi.fn();
  vi.stubGlobal('location', { search, pathname, href: `http://localhost${pathname}${search}`, assign, replace: vi.fn(), origin: 'http://localhost' });
  return { assign };
}

/** jsdom has no canvas, object URLs or anchor downloads: stub the browser APIs the portal uses. */
export function installBrowserStubs() {
  const downloads: { name: string; blob: Blob }[] = [];
  const created: Blob[] = [];
  (URL as unknown as { createObjectURL: (b: Blob) => string }).createObjectURL = (b: Blob) => {
    created.push(b);
    return `blob:test/${created.length}`;
  };
  (URL as unknown as { revokeObjectURL: () => void }).revokeObjectURL = () => {};
  const click = HTMLAnchorElement.prototype.click;
  HTMLAnchorElement.prototype.click = function (this: HTMLAnchorElement) {
    if (this.download) {
      const blob = created[Number(this.href.split('/').pop()) - 1];
      downloads.push({ name: this.download, blob });
      return;
    }
    return click.call(this);
  };
  HTMLCanvasElement.prototype.getContext = (() => ({ clearRect() {}, beginPath() {}, moveTo() {}, lineTo() {}, stroke() {}, fillRect() {}, scale() {} })) as never;
  HTMLCanvasElement.prototype.toBlob = function (cb: BlobCallback) {
    cb(new Blob(['png'], { type: 'image/png' }));
  };
  return { downloads, restore: () => (HTMLAnchorElement.prototype.click = click) };
}

const tick = (ms = 30) => act(() => new Promise<void>((r) => setTimeout(r, ms)));

export interface Mounted {
  api: MockApi;
  container: HTMLElement;
  user: ReturnType<typeof renderWithProviders>['user'];
  rerender: ReturnType<typeof renderWithProviders>['rerender'];
  /** Click the sidebar entry for a runtime page id ('reports', 'cap-table', ...). */
  goto: (page: string) => Promise<void>;
  q: <T extends HTMLElement = HTMLElement>(sel: string) => T;
  qa: <T extends HTMLElement = HTMLElement>(sel: string) => T[];
  /** Click the first element with data-action=<name> inside root (default: document). */
  act: (name: string, root?: ParentNode) => Promise<void>;
  workspace: () => string;
  modal: () => HTMLElement;
  drawer: () => HTMLElement;
  toasts: () => string;
  settle: (ms?: number) => Promise<void>;
  type: (sel: string, text: string) => Promise<void>;
}

/** Renders the real InvesteePortal + real runtime with the network mocked; resolves once the first load has finished. */
export async function mountPortal(routes: Routes = healthyRoutes(), opts: { path?: string } = {}): Promise<Mounted> {
  setRoute(opts.path ?? '/');
  try {
    window.sessionStorage.clear();
    window.localStorage.clear();
  } catch {
    /* ignore */
  }
  const api = mockApi(routes);
  const r = renderWithProviders(<InvesteePortal />);
  const c = r.container;
  const q = <T extends HTMLElement = HTMLElement>(sel: string) => {
    const el = document.querySelector<T>(sel);
    if (!el) throw new Error(`element not found: ${sel}`);
    return el;
  };
  const qa = <T extends HTMLElement = HTMLElement>(sel: string) => [...document.querySelectorAll<T>(sel)];
  await waitFor(() => expect(api.calls(`GET ${P}/health`).length + api.calls(`GET ${P}/profile`).length).toBeGreaterThan(0), { timeout: 8000 });
  await waitFor(() => expect(c.querySelector('.workspace')?.textContent?.length ?? 0).toBeGreaterThan(20), { timeout: 8000 });
  await tick(80);
  const m: Mounted = {
    api,
    container: c,
    user: r.user,
    rerender: r.rerender,
    q,
    qa,
    goto: async (page) => {
      await r.user.click(q(`[data-action="navigate"][data-page="${page}"]`));
      // next/navigation is mocked: do what Next does after router.push, update the pathname and re-render.
      setRoute(IP8_PAGE_TO_PATH[page] ?? '/');
      r.rerender(<InvesteePortal />);
      await tick();
    },
    act: async (name, root = document) => {
      const el = root.querySelector<HTMLElement>(`[data-action="${name}"]`);
      if (!el) throw new Error(`no [data-action="${name}"] in view`);
      await r.user.click(el);
      await tick();
    },
    workspace: () => c.querySelector('.workspace')?.textContent ?? '',
    modal: () => q('#modalWrap'),
    drawer: () => q('#drawer'),
    toasts: () => c.querySelector('#toasts')?.textContent ?? '',
    settle: (ms = 60) => tick(ms),
    type: async (sel, text) => {
      const el = q<HTMLInputElement>(sel);
      await r.user.clear(el);
      if (text) await r.user.type(el, text);
    },
  };
  return m;
}

/** Waits until something the runtime rendered contains the text. */
export async function seeText(m: Mounted, text: string | RegExp, scope: () => string = () => document.body.textContent ?? '') {
  await waitFor(() => {
    const t = scope();
    if (typeof text === 'string') expect(t).toContain(text);
    else expect(t).toMatch(text);
  }, { timeout: 4000 });
}

/** Sets a form control's value the way the runtime reads it (fires input+change). */
export function setValue(el: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement, value: string) {
  const proto = el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(el, value);
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
}
