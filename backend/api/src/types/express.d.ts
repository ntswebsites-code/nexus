import type { AuthUser } from '@matanho/shared';

declare global {
  namespace Express {
    interface Request {
      /** Set by `requireAuth` when a valid session cookie is present. */
      user?: AuthUser;
      /** Set by `requireAuth` alongside `user`. */
      authSession?: {
        id: string;
        mfaPending: boolean;
        mfaVerifiedAt: Date | null;
      };
      /** Set by the requestId middleware. */
      requestId?: string;
      /** Set by `validateQuery`. */
      validatedQuery?: unknown;
    }
  }
}

export {};
