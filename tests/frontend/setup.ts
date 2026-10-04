import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, vi } from 'vitest';
import { cleanup } from '@testing-library/react';
import { resetNext } from './_helpers/next-mocks';

vi.mock('next/navigation', async () => (await import('./_helpers/next-mocks')).navigationMock);
vi.mock('next/link', async () => (await import('./_helpers/next-mocks')).linkMock);
vi.mock('next/image', async () => (await import('./_helpers/next-mocks')).imageMock);
vi.mock('next/headers', async () => (await import('./_helpers/next-mocks')).headersMock);

// jsdom gaps used by Radix/shadcn and layout code.
class RO {
  observe() {}
  unobserve() {}
  disconnect() {}
}
globalThis.ResizeObserver ??= RO as unknown as typeof ResizeObserver;
window.matchMedia ??= ((q: string) => ({
  matches: false,
  media: q,
  onchange: null,
  addListener() {},
  removeListener() {},
  addEventListener() {},
  removeEventListener() {},
  dispatchEvent: () => false,
})) as unknown as typeof window.matchMedia;
Element.prototype.scrollIntoView ??= () => {};
Element.prototype.hasPointerCapture ??= () => false;
Element.prototype.releasePointerCapture ??= () => {};

beforeEach(() => {
  resetNext();
  // Default: any request not set up with mockApi() fails loudly. No real network, ever.
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      throw new Error(`Unmocked fetch: ${String(input)} (use mockApi())`);
    }),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
