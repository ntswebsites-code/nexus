import { describe, it, expect } from 'vitest';
import { InvesteeApiError } from '@/lib/investee/api';

describe('InvesteeApiError.describe (rework: no duplicated field names)', () => {
  it('does not repeat reasons the server already put in the "Validation failed" message', () => {
    const e = new InvesteeApiError(400, 'validation_error', 'Validation failed. contactEmail: Invalid email', [{ path: ['contactEmail'], message: 'Invalid email' }]);
    expect(e.describe()).toBe('Validation failed. contactEmail: Invalid email');
  });
  it('appends field problems when the message does not carry them', () => {
    const e = new InvesteeApiError(400, 'validation_error', 'Validation failed', [{ path: 'due', message: 'cannot be in the past' }]);
    expect(e.describe()).toBe('Validation failed - due: cannot be in the past');
  });
  it('register_locked is translated to an instruction, never the raw code', () => {
    const e = new InvesteeApiError(409, 'register_locked', 'locked');
    expect(e.describe()).toMatch(/Record a new transaction/);
    expect(e.describe()).not.toMatch(/register_locked|409/);
  });
  it('limits to three field problems', () => {
    const e = new InvesteeApiError(400, 'validation_error', 'Validation failed', [1, 2, 3, 4, 5].map((i) => ({ path: `f${i}`, message: 'bad' })));
    expect(e.fieldProblems()).toHaveLength(3);
  });
});
