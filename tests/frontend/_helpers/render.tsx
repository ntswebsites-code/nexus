import { render, type RenderOptions, type RenderResult } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactElement, ReactNode } from 'react';

export interface ProviderOptions extends Omit<RenderOptions, 'wrapper'> {
  /** Extra provider wrapper(s), outermost first, e.g. [SessionProvider] for admin-web. */
  providers?: Array<(props: { children: ReactNode }) => ReactElement>;
}

/** render() + a userEvent instance. Next router/link/image are already mocked in setup.ts. */
export function renderWithProviders(
  ui: ReactElement,
  { providers = [], ...opts }: ProviderOptions = {},
): RenderResult & { user: ReturnType<typeof userEvent.setup> } {
  const Wrapper = ({ children }: { children: ReactNode }) =>
    providers.reduceRight<ReactElement>((acc, P) => <P>{acc}</P>, <>{children}</>);
  return { user: userEvent.setup(), ...render(ui, { wrapper: Wrapper, ...opts }) };
}
