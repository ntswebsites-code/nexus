import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { loginSchema, registerSchema } from '@matanho/shared';
import { config } from '../config';
import { login, logout, me, register } from '../controllers/authController';
import { requireAuth } from '../middleware/requireAuth';
import { validateBody } from '../middleware/validate';

// Brute-force protection for credential endpoints (per IP).
const credentialLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: config.isProduction ? 20 : 200,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: { code: 'rate_limited', message: 'Too many attempts, try again later' } },
});

export const authRoutes = Router();

authRoutes.post('/register', credentialLimiter, validateBody(registerSchema), register);
authRoutes.post('/login', credentialLimiter, validateBody(loginSchema), login);
authRoutes.post('/logout', logout);
authRoutes.get('/me', requireAuth, me);
