import type { RequestHandler } from 'express';
import type { AuthResponse, LoginRequest, RegisterRequest } from '@matanho/shared';
import { config } from '../config';
import { HttpError } from '../lib/errors';
import {
  clearSessionCookie,
  createSession,
  destroySession,
  purgeExpiredSessions,
  readSessionToken,
  setSessionCookie,
} from '../auth/session';
import { registerUser, verifyCredentials } from '../services/authService';

export const register: RequestHandler = async (req, res) => {
  if (!config.allowSelfRegistration) {
    throw HttpError.forbidden('Self-registration is disabled', 'registration_disabled');
  }
  const user = await registerUser(req.body as RegisterRequest);
  // Registration does not sign the user in and grants no portal access:
  // roles are assigned by an administrator.
  res.status(201).json({ user } satisfies AuthResponse);
};

export const login: RequestHandler = async (req, res) => {
  const user = await verifyCredentials(req.body as LoginRequest);

  // Rotate: replace any session the browser already holds.
  const previous = readSessionToken(req);
  if (previous) await destroySession(previous);

  const { token, expiresAt } = await createSession(user.id, req);
  setSessionCookie(res, token, expiresAt);
  void purgeExpiredSessions().catch(() => undefined);

  res.json({ user } satisfies AuthResponse);
};

export const logout: RequestHandler = async (req, res) => {
  const token = readSessionToken(req);
  if (token) await destroySession(token);
  clearSessionCookie(res);
  res.json({ ok: true });
};

/** Requires `requireAuth` upstream. */
export const me: RequestHandler = (req, res) => {
  res.json({ user: req.user! } satisfies AuthResponse);
};
