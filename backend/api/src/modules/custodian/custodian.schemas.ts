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

export const executionSchema = z.object({
  tradeRef: z.string().trim().min(1).max(64),
  executionAt: z.string().refine((v) => !Number.isNaN(Date.parse(v)), 'Invalid execution time'),
  accountRef: z.string().trim().min(1).max(64),
  ticker: z.string().trim().min(1).max(32).transform((v) => v.toUpperCase()),
  isin: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{2}[A-Z0-9]{9}\d$/, 'Invalid ISIN')
    .optional()
    .or(z.literal('').transform(() => undefined)),
  side: z.enum(['BUY', 'SELL']),
  quantity: decimalString(16, 8).refine((v) => Number(v) > 0, 'Quantity must be greater than zero'),
  price: decimalString(12, 8).refine((v) => Number(v) > 0, 'Price must be greater than zero'),
  currency: z.enum(CURRENCIES),
  settlementDate: isoDay.optional().or(z.literal('').transform(() => undefined)),
  broker: z.string().trim().max(120).optional(),
  note: z.string().trim().max(2000).optional(),
});
export type ExecutionInput = z.infer<typeof executionSchema>;

/** Fields a counterparty may correct on a not-yet-matched execution. The trade reference is the key and never changes. */
export const amendSchema = executionSchema
  .omit({ tradeRef: true })
  .partial()
  .extend({ reason: z.string().trim().min(3, 'Give a reason for the amendment').max(500) });

export const cancelSchema = z.object({ reason: z.string().trim().min(3, 'Give a reason for the cancellation').max(500) });
