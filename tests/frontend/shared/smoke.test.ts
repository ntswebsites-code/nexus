import { describe, it, expect } from 'vitest';
import { createApiClient, ApiError } from '@matanho/shared';
import { fail, loginAs, mockApi, expectCalled } from '../_helpers';

describe('shared smoke: setup', () => {
  it('createApiClient.me() reads the mocked session', async () => {
    const api = mockApi(loginAs('investor'));
    const res = await createApiClient({ baseUrl: 'http://localhost:4100' }).me();
    expect(res.user.email).toBe('investor@example.test');
    expectCalled(api, 'GET /api/auth/me');
  });

  it('maps error envelopes to ApiError', async () => {
    mockApi({ 'GET /api/auth/me': fail(401, 'unauthenticated', 'Not signed in') });
    await expect(createApiClient({ baseUrl: 'http://localhost:4100' }).me()).rejects.toBeInstanceOf(ApiError);
  });
});
