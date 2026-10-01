import { z } from 'zod';
import { PORTAL_IDS } from './portals';

/** Password policy shared by the API (enforcement) and portals (hints). */
export const PASSWORD_MIN_LENGTH = 10;
export const PASSWORD_MAX_LENGTH = 128;

export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .email('Enter a valid email address')
  .max(254);

export const passwordSchema = z
  .string()
  .min(PASSWORD_MIN_LENGTH, `Password must be at least ${PASSWORD_MIN_LENGTH} characters`)
  .max(PASSWORD_MAX_LENGTH);

export const registerSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
  name: z.string().trim().min(1).max(120).optional(),
});

export const loginSchema = z.object({
  email: emailSchema,
  // Do not apply the length policy on login - only check that something was sent.
  password: z.string().min(1).max(PASSWORD_MAX_LENGTH),
  /** Optional: ask the API to verify the account may use this portal. */
  portal: z.enum(PORTAL_IDS).optional(),
});

export type RegisterRequest = z.infer<typeof registerSchema>;
export type LoginRequest = z.infer<typeof loginSchema>;

/** A role granted to a user inside one portal (see database/seed/role-catalog.json). */
export interface AuthRole {
  portal: string;
  key: string;
  label: string;
}

/** Safe, public representation of a user. Never contains credentials. */
export interface AuthUser {
  id: string;
  email: string;
  name: string | null;
  roles: AuthRole[];
  /** Flattened permission codes granted through the user's roles. */
  permissions: string[];
  createdAt: string;
}

export interface AuthResponse {
  user: AuthUser;
  /** Present when the session still needs a second factor: verify a code, or enrol first. */
  mfa?: 'verify' | 'enroll';
}

export const mfaCodeSchema = z.object({ code: z.string().trim().regex(/^\d{6}$/, 'Enter the 6-digit code') });

export const forgotPasswordSchema = z.object({
  email: emailSchema,
  portal: z.enum(PORTAL_IDS).optional(),
});

export const resetPasswordSchema = z.object({
  token: z.string().min(20).max(200),
  password: passwordSchema,
});

export const acceptInvitationSchema = z.object({
  token: z.string().min(20).max(200),
  name: z.string().trim().min(1).max(120).optional(),
  password: passwordSchema,
});

export interface MfaEnrollResponse {
  secret: string;
  otpauthUri: string;
}

export interface InvitationPreview {
  email: string;
  name: string | null;
  portal: string;
  existingAccount: boolean;
  expiresAt: string;
}

export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
}

export interface HealthResponse {
  status: 'ok' | 'degraded';
  service: string;
  environment: string;
  uptimeSeconds: number;
  timestamp: string;
  database?: 'up' | 'down';
}
