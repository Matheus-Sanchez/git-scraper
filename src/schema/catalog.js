import { z } from 'zod';
import { isValidHttpUrl, normalizeUrl } from '../utils/url.js';

function cleanObject(value) {
  return Object.fromEntries(
    Object.entries(value).filter(([, item]) => {
      if (item === undefined || item === null) return false;
      if (typeof item === 'string' && item.trim() === '') return false;
      if (Array.isArray(item) && item.length === 0) return false;
      if (typeof item === 'object' && !Array.isArray(item) && Object.keys(item).length === 0) return false;
      return true;
    }),
  );
}

function stringArrayField(fieldName) {
  return z.array(z.string().trim().min(1, `${fieldName} entries must be non-empty strings`));
}

export const productSelectorsSchema = z.object({
  price_css: stringArrayField('price_css').optional(),
  jsonld_paths: stringArrayField('jsonld_paths').optional(),
  regex_hints: stringArrayField('regex_hints').optional(),
}).strict();

const positiveNumberLike = z.union([z.number(), z.string()])
  .transform((value) => Number(value))
  .pipe(z.number().positive('units_per_package must be > 0'));

export const storedProductSchema = z.object({
  id: z.string().trim().min(1, 'id is required'),
  name: z.string().trim().min(1, 'name is required'),
  url: z.string().trim()
    .refine((value) => isValidHttpUrl(value), 'url must be a valid HTTP/HTTPS URL')
    .transform((value) => normalizeUrl(value)),
  category: z.string().trim().optional(),
  comparison_key: z.string().trim().min(1).optional(),
  units_per_package: positiveNumberLike.optional(),
  is_active: z.boolean(),
  selectors: productSelectorsSchema.optional(),
  notes: z.string().trim().optional(),
}).strict()
  .transform((product) => {
    const selectors = product.selectors ? cleanObject(product.selectors) : undefined;
    return cleanObject({
      ...product,
      selectors,
    });
  });

export const normalizedMutationSchema = z.object({
  action: z.enum(['add', 'edit', 'remove', 'batch']).optional(),
  id: z.string().trim().min(1).optional(),
  product_id: z.string().trim().min(1).optional(),
  name: z.string().trim().min(1).optional(),
  url: z.string().trim()
    .refine((value) => isValidHttpUrl(value), 'url must be a valid HTTP/HTTPS URL')
    .transform((value) => normalizeUrl(value))
    .optional(),
  category: z.string().trim().optional(),
  comparison_key: z.string().trim().optional(),
  units_per_package: positiveNumberLike.optional(),
  is_active: z.boolean().optional(),
  notes: z.string().trim().optional(),
  selectors: productSelectorsSchema.optional(),
  default_action: z.enum(['add', 'edit', 'remove']).optional(),
}).strict()
  .transform((payload) => cleanObject({
    ...payload,
    selectors: payload.selectors ? cleanObject(payload.selectors) : undefined,
  }));

export function parseStoredProduct(rawProduct) {
  return storedProductSchema.parse(rawProduct);
}

export function parseStoredProducts(rawProducts) {
  return z.array(storedProductSchema).parse(rawProducts);
}

export function validateNormalizedMutation(rawPayload) {
  return normalizedMutationSchema.parse(rawPayload);
}
