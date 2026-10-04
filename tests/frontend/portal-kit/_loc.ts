import { vi } from 'vitest';

/** Replaces window.location with a recordable stub (jsdom cannot navigate). */
export function stubLocation(search = '', pathname = '/login') {
  const assign = vi.fn();
  vi.stubGlobal('location', { search, pathname, href: `http://localhost${pathname}${search}`, assign, replace: vi.fn() });
  return { assign };
}
