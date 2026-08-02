import { z } from 'zod';

const isoDateSchema = z.string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'expected YYYY-MM-DD')
  .refine((value) => {
    const parsed = new Date(`${value}T00:00:00.000Z`);
    return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
  }, 'expected a real calendar date');

const isoDateTimeSchema = z.string().datetime({ offset: true });

const nonnegativeIntegerSchema = z.number().int().nonnegative();

const summarySchema = z.object({
  total_products: nonnegativeIntegerSchema,
  success_count: nonnegativeIntegerSchema,
  failure_count: nonnegativeIntegerSchema,
}).passthrough().superRefine((summary, context) => {
  if (summary.total_products !== summary.success_count + summary.failure_count) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['total_products'],
      message: 'must equal success_count + failure_count',
    });
  }
});

const historyRecordSchema = z.object({}).passthrough().refine(
  (record) => Object.keys(record).length > 0,
  'history records cannot be empty',
);

const historyResultSchema = z.object({
  product_id: z.string().trim().min(1),
  price: z.number().finite().positive(),
  unit_price: z.number().finite().positive().nullable().optional(),
  status: z.string().trim().min(1).optional(),
}).passthrough();

function validateEnvelopeIdentity(payload, context) {
  if (payload.run_id && !payload.run_id.startsWith(payload.run_date)) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['run_id'],
      message: 'must start with run_date',
    });
  }
  if (payload.generated_at.slice(0, 10) !== payload.run_date) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['generated_at'],
      message: 'calendar date must match run_date',
    });
  }
}

/**
 * Common envelope shared by both the legacy daily snapshots and current run payloads.
 * Optional fields deliberately remain optional so the historical files stay immutable.
 */
export const historyRunPayloadSchema = z.object({
  run_id: z.string().trim().min(1).optional(),
  run_date: isoDateSchema,
  generated_at: isoDateTimeSchema,
  currency: z.string().trim().min(1).optional(),
  summary: summarySchema,
  results: z.array(historyResultSchema),
  failures: z.array(historyRecordSchema).optional().default([]),
  offers: z.array(historyRecordSchema).optional().default([]),
}).passthrough().superRefine(validateEnvelopeIdentity);

export const historyErrorPayloadSchema = z.object({
  run_id: z.string().trim().min(1).optional(),
  run_date: isoDateSchema,
  generated_at: isoDateTimeSchema,
  engine_summary: z.object({}).passthrough(),
  errors: z.array(historyRecordSchema),
  fatal: z.boolean().optional(),
}).passthrough().superRefine(validateEnvelopeIdentity);

export const latestHistoryPayloadSchema = z.object({
  run_id: z.string().trim().min(1).optional(),
  generated_at: isoDateTimeSchema,
  currency: z.string().trim().min(1).optional(),
  summary: summarySchema,
  items: z.array(historyResultSchema),
  failures: z.array(historyRecordSchema).optional().default([]),
  offers: z.array(historyRecordSchema).optional().default([]),
  run_file: z.string().trim().min(1).optional(),
}).passthrough();

const manifestRunEntrySchema = z.object({
  run_id: z.string().trim().min(1),
  run_date: isoDateSchema,
  generated_at: isoDateTimeSchema.nullable(),
  run_file: z.string().trim().min(1),
  error_file: z.string().trim().min(1),
  success_count: nonnegativeIntegerSchema.nullable(),
  failure_count: nonnegativeIntegerSchema.nullable(),
  status: z.string().trim().min(1),
}).passthrough();

const manifestDailyEntrySchema = z.object({
  run_date: isoDateSchema,
  run_ids: z.array(z.string().trim().min(1)),
  latest_run_id: z.string().trim().min(1).nullable(),
  total_runs: nonnegativeIntegerSchema,
}).passthrough();

/**
 * The arrays stay optional for legacy manifests that only exposed `files`.
 * Canonical equivalence with the discovered run payloads is checked by storage.
 */
export const historyManifestPayloadSchema = z.object({
  updated_at: isoDateTimeSchema.nullable().optional(),
  files: z.array(z.string().trim().min(1)).optional().default([]),
  runs: z.array(manifestRunEntrySchema).optional().default([]),
  daily: z.array(manifestDailyEntrySchema).optional().default([]),
}).passthrough();

export function validateHistoryRunPayload(rawPayload) {
  return historyRunPayloadSchema.safeParse(rawPayload);
}

export function validateHistoryErrorPayload(rawPayload) {
  return historyErrorPayloadSchema.safeParse(rawPayload);
}

export function validateLatestHistoryPayload(rawPayload) {
  return latestHistoryPayloadSchema.safeParse(rawPayload);
}

export function validateHistoryManifestPayload(rawPayload) {
  return historyManifestPayloadSchema.safeParse(rawPayload);
}
