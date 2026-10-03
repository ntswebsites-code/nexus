import type { RequestHandler } from 'express';
import type { ZodType } from 'zod';
import { HttpError } from '../lib/errors';

/** "declaredCount" -> "Declared count" (last path segment, for readable messages). */
export function fieldLabel(path: string): string {
  const last = path.split('.').filter(Boolean).pop() ?? '';
  const spaced = last
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .trim()
    .toLowerCase();
  return spaced ? spaced.charAt(0).toUpperCase() + spaced.slice(1) : 'Value';
}

const COMPARATORS: Record<string, string> = { '>=': 'at least', '<=': 'at most', '>': 'above', '<': 'below' };

/**
 * Turns zod's default English ("Invalid input: expected string, received undefined") into a phrase that
 * follows the field name ("is required"). Returns null for messages the schema author wrote, which are
 * already complete sentences and are kept as written.
 */
function defaultPhrase(m: string): string | null {
  if (/received undefined|received null/i.test(m)) return 'is required';
  const tooSmall = /^Too small: expected (string|array|set) to have >=(\d+)/.exec(m);
  if (tooSmall) {
    const n = Number(tooSmall[2]);
    if (tooSmall[1] === 'string') return n <= 1 ? 'is required' : `must be at least ${n} characters`;
    return `needs at least ${n} item${n === 1 ? '' : 's'}`;
  }
  const tooBig = /^Too big: expected (string|array|set) to have <=(\d+)/.exec(m);
  if (tooBig) return tooBig[1] === 'string' ? `must be at most ${tooBig[2]} characters` : `allows at most ${tooBig[2]} items`;
  const num = /^Too (?:small|big): expected \w+ to be (>=|<=|>|<)\s*(.+)$/.exec(m);
  if (num) return `must be ${COMPARATORS[num[1]]} ${num[2]}`;
  const typeErr = /^Invalid input: expected (\w+), received (\w+)/.exec(m);
  if (typeErr) {
    if (typeErr[1] === 'number') return 'must be a number';
    if (typeErr[1] === 'boolean') return 'must be true or false';
    return `must be a valid ${typeErr[1]}`;
  }
  const opt = /^Invalid option: expected one of (.+)$/.exec(m);
  if (opt) return `must be one of ${opt[1].replace(/"/g, '').split('|').join(', ')}`;
  if (/^Invalid input$/i.test(m)) return 'is not valid';
  const fmt = /^Invalid (email|url|uuid|cuid|date|datetime)/i.exec(m);
  if (fmt) return `must be a valid ${fmt[1].toLowerCase()}`;
  if (/^Invalid string/i.test(m)) return 'is not in the expected format';
  if (/^(Invalid|Too small|Too big)/.test(m)) return 'is not valid';
  return null;
}

function fail(issues: { path: PropertyKey[]; message: string }[]): never {
  throw HttpError.badRequest(
    'Validation failed',
    issues.map((i) => {
      const path = i.path.map(String).join('.');
      const phrase = defaultPhrase(i.message);
      return { path, message: phrase ? `${fieldLabel(path)} ${phrase}` : i.message };
    }),
  );
}

/** Validates `req.body` against a zod schema and replaces it with the parsed value. */
export const validateBody =
  <T>(schema: ZodType<T>): RequestHandler =>
  (req, _res, next) => {
    const result = schema.safeParse(req.body);
    if (!result.success) fail(result.error.issues);
    req.body = result.data;
    next();
  };

/** Validates the query string; the parsed value is available as `req.validatedQuery`. */
export const validateQuery =
  <T>(schema: ZodType<T>): RequestHandler =>
  (req, _res, next) => {
    const result = schema.safeParse(req.query);
    if (!result.success) fail(result.error.issues);
    req.validatedQuery = result.data;
    next();
  };
