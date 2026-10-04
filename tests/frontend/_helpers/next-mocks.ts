import { vi } from 'vitest';
import { createElement, type AnchorHTMLAttributes, type ReactNode } from 'react';

/** Writable router: assert on `router.push` / `router.replace` calls; set the route with `setRoute`. */
export const router = {
  push: vi.fn(),
  replace: vi.fn(),
  back: vi.fn(),
  forward: vi.fn(),
  refresh: vi.fn(),
  prefetch: vi.fn(),
};
export const routerState = { pathname: '/', params: new URLSearchParams() };

export const redirect = vi.fn((url: string): never => {
  throw new Error(`NEXT_REDIRECT:${url}`);
});

export function setRoute(pathname: string, search = ''): void {
  routerState.pathname = pathname;
  routerState.params = new URLSearchParams(search);
}
export function resetNext(): void {
  Object.values(router).forEach((f) => f.mockReset());
  setRoute('/');
  redirect.mockReset();
  redirect.mockImplementation((url: string): never => {
    throw new Error(`NEXT_REDIRECT:${url}`);
  });
}

export const navigationMock = {
  useRouter: () => router,
  usePathname: () => routerState.pathname,
  useSearchParams: () => routerState.params,
  useParams: () => ({}),
  redirect,
  permanentRedirect: redirect,
  notFound: () => {
    throw new Error('NEXT_NOT_FOUND');
  },
};

type LinkProps = Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'href'> & {
  href: string | { pathname?: string };
  children?: ReactNode;
  prefetch?: boolean;
  replace?: boolean;
  scroll?: boolean;
};
export const linkMock = {
  default: ({ href, children, prefetch: _p, replace: _r, scroll: _s, ...rest }: LinkProps) =>
    createElement('a', { href: typeof href === 'string' ? href : (href.pathname ?? ''), ...rest }, children),
};

export const imageMock = {
  default: ({ src, alt, fill: _f, priority: _p, ...rest }: Record<string, unknown>) =>
    createElement('img', { src: typeof src === 'string' ? src : '', alt: alt as string, ...rest }),
};

export const headersMock = {
  headers: async () => new Headers(),
  cookies: async () => ({ get: () => undefined, getAll: () => [], has: () => false, set: vi.fn(), delete: vi.fn() }),
};
