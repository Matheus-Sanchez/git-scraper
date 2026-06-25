import { z } from 'zod';
import {
  isSearchEnabledStoreId,
  listSearchEnabledStoreIds,
} from '../config/support_matrix.js';

const STOPWORDS = new Set([
  'a',
  'ao',
  'aos',
  'as',
  'com',
  'da',
  'das',
  'de',
  'do',
  'dos',
  'e',
  'em',
  'na',
  'nas',
  'no',
  'nos',
  'o',
  'os',
  'ou',
  'para',
  'por',
  'um',
  'uma',
]);

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

function stripDiacritics(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

export function normalizeCatalogKey(value) {
  return stripDiacritics(value)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function normalizeTerm(value) {
  return stripDiacritics(value)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function generateRequiredTerms(...parts) {
  const text = normalizeTerm(parts.filter(Boolean).join(' '));
  if (!text) return [];

  return [...new Set(text.split(' ')
    .map((term) => term.trim())
    .filter((term) => term.length >= 2)
    .filter((term) => !STOPWORDS.has(term)))]
    .slice(0, 12);
}

function normalizeTerms(value) {
  if (!value) return [];
  const raw = Array.isArray(value) ? value : String(value).split(/\r?\n|,/);
  return [...new Set(raw
    .map((item) => normalizeTerm(item))
    .filter(Boolean))];
}

function normalizeStores(value) {
  const defaultStores = listSearchEnabledStoreIds();
  if (!value) return defaultStores;

  const raw = Array.isArray(value) ? value : String(value).split(/\r?\n|,/);
  const stores = [...new Set(raw
    .map((item) => String(item || '').trim().toLowerCase())
    .filter(Boolean))];

  return stores.length > 0 ? stores : defaultStores;
}

const stringArrayField = (fieldName) => z.union([
  z.array(z.string()),
  z.string(),
])
  .optional()
  .transform((value) => normalizeTerms(value))
  .pipe(z.array(z.string().trim().min(1, `${fieldName} entries must be non-empty strings`)));

const storedStoresField = z.union([
  z.array(z.string()),
  z.string(),
])
  .optional()
  .transform((value) => normalizeStores(value))
  .pipe(z.array(z.string().refine((storeId) => isSearchEnabledStoreId(storeId), 'store is not search-enabled')));

const mutationStoresField = z.union([
  z.array(z.string()),
  z.string(),
])
  .optional()
  .transform((value) => {
    if (value === undefined || value === null || String(value).trim() === '') return undefined;
    return normalizeStores(value);
  })
  .pipe(z.array(z.string().refine((storeId) => isSearchEnabledStoreId(storeId), 'store is not search-enabled')).optional());

const unitRuleSchema = z.object({
  basis: z.enum(['unit', 'gb', 'g', 'kg', 'ml', 'l']),
  label: z.string().trim().optional(),
}).strict()
  .transform((value) => cleanObject({
    ...value,
    label: value.label || value.basis,
  }));

const attributeRulesSchema = z.record(z.union([
  z.string().trim().min(1),
  z.number(),
  z.boolean(),
])).optional();

function normalizeIntent(intent) {
  const characteristics = String(intent.characteristics || '').trim();
  const requiredTerms = intent.required_terms && intent.required_terms.length > 0
    ? intent.required_terms
    : generateRequiredTerms(intent.name);

  const normalized = cleanObject({
    ...intent,
    characteristics,
    category: normalizeCatalogKey(intent.category) || undefined,
    required_attributes: intent.required_attributes,
    preferred_attributes: intent.preferred_attributes,
    unit_rule: intent.unit_rule,
    notes: intent.notes ? String(intent.notes).trim() : undefined,
  });

  return {
    ...normalized,
    stores: intent.stores && intent.stores.length > 0 ? intent.stores : listSearchEnabledStoreIds(),
    required_terms: requiredTerms,
    preferred_terms: intent.preferred_terms || [],
    excluded_terms: intent.excluded_terms || [],
  };
}

export const storedProductSchema = z.object({
  id: z.string().trim().min(1, 'id is required'),
  name: z.string().trim().min(1, 'name is required'),
  characteristics: z.string().trim().optional().default(''),
  category: z.string().trim().optional(),
  stores: storedStoresField,
  required_terms: stringArrayField('required_terms'),
  preferred_terms: stringArrayField('preferred_terms'),
  excluded_terms: stringArrayField('excluded_terms'),
  required_attributes: attributeRulesSchema,
  preferred_attributes: attributeRulesSchema,
  unit_rule: unitRuleSchema.optional(),
  is_active: z.boolean(),
  notes: z.string().trim().optional(),
}).strict()
  .transform(normalizeIntent);

export const normalizedMutationSchema = z.object({
  action: z.enum(['add', 'edit', 'remove', 'batch']).optional(),
  id: z.string().trim().min(1).optional(),
  product_id: z.string().trim().min(1).optional(),
  name: z.string().trim().min(1).optional(),
  characteristics: z.string().trim().optional(),
  category: z.string().trim().optional(),
  stores: mutationStoresField,
  required_terms: stringArrayField('required_terms'),
  preferred_terms: stringArrayField('preferred_terms'),
  excluded_terms: stringArrayField('excluded_terms'),
  required_attributes: attributeRulesSchema,
  preferred_attributes: attributeRulesSchema,
  unit_rule: unitRuleSchema.optional(),
  is_active: z.boolean().optional(),
  notes: z.string().trim().optional(),
  default_action: z.enum(['add', 'edit', 'remove']).optional(),
}).strict()
  .transform((payload) => cleanObject({
    ...payload,
    category: payload.category !== undefined ? normalizeCatalogKey(payload.category) : undefined,
    stores: payload.stores,
    required_terms: payload.required_terms,
    preferred_terms: payload.preferred_terms,
    excluded_terms: payload.excluded_terms,
    required_attributes: payload.required_attributes,
    preferred_attributes: payload.preferred_attributes,
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
