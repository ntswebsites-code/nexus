import type { AuthUser } from '@matanho/shared';

declare global {
  namespace Express {
    interface Request {
      /** Set by `requireAuth` when a valid session cookie is present. */
      user?: AuthUser;
    }
  }
}

export {};
