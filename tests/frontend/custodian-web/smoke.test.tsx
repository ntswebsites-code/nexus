import { describe, it, expect } from 'vitest';
import { Notice, Badge } from '@/components/ui';
import { renderWithProviders, screen } from '../_helpers';

describe('custodian-web smoke: setup', () => {
  it('Notice uses role=alert only for errors', () => {
    renderWithProviders(
      <>
        <Notice kind="error">Boom</Notice>
        <Notice kind="ok">Fine</Notice>
        <Badge value="active" />
      </>,
    );
    expect(screen.getByRole('alert')).toHaveTextContent('Boom');
    expect(screen.getByText('Fine')).toHaveAttribute('role', 'status');
    expect(screen.getByText('active')).toHaveClass('cx-badge', 'ok');
  });
});
