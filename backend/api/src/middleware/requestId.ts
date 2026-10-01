import { randomUUID } from 'node:crypto';
import type { RequestHandler } from 'express';

/** Propagates or assigns an `X-Request-Id`, echoed on the response and recorded in audit events. */
export const requestId: RequestHandler = (req, res, next) => {
  const incoming = req.get('x-request-id');
  const id = incoming && /^[\w.-]{8,64}$/.test(incoming) ? incoming : randomUUID();
  req.requestId = id;
  res.setHeader('X-Request-Id', id);
  next();
};
