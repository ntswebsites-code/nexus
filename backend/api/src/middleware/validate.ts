import type { RequestHandler } from 'express';
import type { ZodType } from 'zod';
import { HttpError } from '../lib/errors';

function fail(issues: { path: PropertyKey[]; message: string }[]): never {
  throw HttpError.badRequest(
    'Validation failed',
    issues.map((i) => ({ path: i.path.map(String).join('.'), message: i.message })),
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
