import { z } from 'zod';

export const CURRENCIES = ['USD', 'ZWG', 'ZAR'] as const;

export const decimalString = (max: number, dp: number) =>
  z
    .union([z.string(), z.number()])
    .transform((v) => String(v).trim())
    .refine((v) => new RegExp(`^-?\\d{1,${max}}(\\.\\d{1,${dp}})?$`).test(v), { message: `Enter a number with at most ${dp} decimals` });

export const isoDay = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD')
  .refine((v) => !Number.isNaN(Date.parse(`${v}T00:00:00Z`)), 'Invalid date');

/** Free-text fields are stored and exported to spreadsheets: refuse formula prefixes and markup (CSV / HTML injection). */
export const safeText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .refine((v) => !/^[=+@\t\r]/.test(v) && !/^-(?!\d)/.test(v), 'Text may not start with =, +, @ or - (spreadsheet formula)')
    .refine((v) => !/<\/?[a-z!][^>]*>/i.test(v), 'Text may not contain HTML tags');

/** Unambiguous ISO 8601 date-time with a UTC offset, e.g. 2026-10-02T09:30:00Z or 2026-10-02T09:30:00+02:00. */
const ISO_DATETIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,9})?)?(Z|[+-]\d{2}:?\d{2})$/;

export const executionSchema = z.object({
  tradeRef: safeText(64).pipe(z.string().min(1, 'Trade reference is required')),
  executionAt: z
    .string({ error: 'Execution time is required' })
    .trim()
    .refine((v) => ISO_DATETIME.test(v) && !Number.isNaN(Date.parse(v)), 'Use an ISO date-time with a time zone, e.g. 2026-10-02T09:30:00Z'),
  accountRef: z.string({ error: 'Account is required' }).trim().min(1, 'Account is required').max(64),
  ticker: z.string({ error: 'Ticker is required' }).trim().min(1, 'Ticker is required').max(32).transform((v) => v.toUpperCase()),
  isin: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{2}[A-Z0-9]{9}\d$/, 'Invalid ISIN')
    .optional()
    .or(z.literal('').transform(() => undefined)),
  side: z.enum(['BUY', 'SELL']),
  quantity: decimalString(16, 8).refine((v) => Number.isNaN(Number(v)) || Number(v) > 0, 'Quantity must be greater than zero'),
  price: decimalString(12, 8).refine((v) => Number.isNaN(Number(v)) || Number(v) > 0, 'Price must be greater than zero'),
  currency: z.enum(CURRENCIES),
  settlementDate: isoDay.optional().or(z.literal('').transform(() => undefined)),
  broker: safeText(120).optional(),
  note: safeText(2000).optional(),
});
export type ExecutionInput = z.infer<typeof executionSchema>;

/** Fields a counterparty may correct on a not-yet-matched execution. The trade reference is the key and never changes. */
export const amendSchema = executionSchema
  .omit({ tradeRef: true })
  .partial()
  .extend({ reason: z.string({ error: 'Give a reason for the amendment' }).trim().min(3, 'Give a reason for the amendment').max(500) });

export const cancelSchema = z.object({ reason: z.string({ error: 'Give a reason for the cancellation' }).trim().min(3, 'Give a reason for the cancellation').max(500) });
