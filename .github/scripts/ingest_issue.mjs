import { appendFile, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { ZodError } from 'zod';
import { readProducts, writeProducts } from '../../src/io/products.js';
import {
  normalizeCatalogKey,
  parseStoredProduct,
  validateNormalizedMutation,
} from '../../src/schema/catalog.js';

const LEGACY_FIELDS = ['url', 'selectors', 'units_per_package', 'mode'];

function normalizeHeading(text) {
  return String(text || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

function splitLines(value) {
  return String(value || '')
    .split(/\r?\n|,/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function schemaErrorToMessage(error) {
  if (!(error instanceof ZodError)) {
    return error instanceof Error ? error.message : String(error);
  }

  return error.issues
    .map((issue) => {
      const location = issue.path.length > 0 ? issue.path.join('.') : 'root';
      return `${location}: ${issue.message}`;
    })
    .join('; ');
}

function parseBoolean(value, fallback = true) {
  if (value === undefined || value === null || value === '') return fallback;
  const normalized = String(value).trim().toLowerCase();
  if (['true', '1', 'sim', 'yes', 'y'].includes(normalized)) return true;
  if (['false', '0', 'nao', 'não', 'no', 'n'].includes(normalized)) return false;
  return fallback;
}

function parseIssueFormFields(body) {
  const text = String(body || '');
  const out = {};

  const pattern = /###\s+(.+?)\r?\n([\s\S]*?)(?=\r?\n###\s+|$)/g;
  let match;

  while ((match = pattern.exec(text)) !== null) {
    const heading = normalizeHeading(match[1]);
    const rawValue = (match[2] || '')
      .replace(/_No response_/gi, '')
      .trim();

    if (!rawValue) continue;
    out[heading] = rawValue;
  }

  return out;
}

function parseJsonObject(value, fallback = undefined) {
  if (value === undefined || value === null || String(value).trim() === '') return fallback;
  try {
    const parsed = JSON.parse(String(value));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : fallback;
  } catch {
    return fallback;
  }
}

function parseUnitRule(value) {
  if (!value) return undefined;
  if (typeof value === 'object' && !Array.isArray(value)) return value;
  const trimmed = String(value).trim();
  if (!trimmed) return undefined;
  const parsed = parseJsonObject(trimmed);
  if (parsed) return parsed;
  return { basis: trimmed.toLowerCase() };
}

export function parseIssuePayload(body) {
  const text = String(body || '').trim();
  if (!text) {
    return { ok: false, error: 'Issue body is empty' };
  }

  const jsonBlockMatch = text.match(/```json\s*([\s\S]*?)```/i);
  if (jsonBlockMatch) {
    try {
      const parsed = JSON.parse(jsonBlockMatch[1]);
      return { ok: true, payload: parsed, source: 'json_block' };
    } catch {
      return { ok: false, error: 'Invalid JSON block in issue body' };
    }
  }

  const fields = parseIssueFormFields(text);
  const embeddedJson = fields['json do produto (opcional)'] || fields['json da acao (opcional)'];

  if (embeddedJson) {
    try {
      const parsed = JSON.parse(embeddedJson);
      return { ok: true, payload: parsed, source: 'issue_form_json' };
    } catch {
      return { ok: false, error: 'Invalid JSON in issue form field' };
    }
  }

  const payload = {
    action: fields['acao'] || fields['acao desejada'] || fields.action,
    product_id: fields['id do produto'] || fields['product id'] || fields.product_id,
    name: fields['nome do produto'] || fields.nome || fields.name,
    characteristics: fields.caracteristicas || fields['características'] || fields.characteristics,
    category: fields.categoria || fields.category,
    stores: splitLines(fields.lojas || fields.stores),
    required_terms: splitLines(fields['termos obrigatorios'] || fields['termos obrigatórios'] || fields.required_terms),
    preferred_terms: splitLines(fields['termos preferenciais'] || fields.preferred_terms),
    excluded_terms: splitLines(fields['termos banidos'] || fields.excluded_terms),
    required_attributes: parseJsonObject(fields['atributos obrigatorios'] || fields['atributos obrigatórios']),
    preferred_attributes: parseJsonObject(fields['atributos preferenciais']),
    unit_rule: parseUnitRule(fields['unidade base'] || fields.unit_rule),
    is_active: fields['ativo para scraping?'] || fields.is_active,
    notes: fields.observacoes || fields.notas || fields.notes,
  };

  return { ok: true, payload, source: 'issue_form_fields' };
}

function normalizeLooseKey(value) {
  return normalizeCatalogKey(value);
}

function slugify(text) {
  return normalizeCatalogKey(text).slice(0, 36);
}

function shortHash(text) {
  return createHash('sha1').update(text).digest('hex').slice(0, 8);
}

function intentKey(payload) {
  return [
    normalizeLooseKey(payload.name),
    normalizeLooseKey(payload.characteristics),
    normalizeLooseKey(payload.category),
  ].filter(Boolean).join('|');
}

export function normalizeAction(value) {
  const raw = String(value || '').trim().toLowerCase();
  if (!raw) return 'add';
  if (['add', 'novo', 'adicionar'].includes(raw)) return 'add';
  if (['batch', 'lote', 'bulk'].includes(raw)) return 'batch';
  if (['edit', 'editar', 'update', 'atualizar'].includes(raw)) return 'edit';
  if (['remove', 'remover', 'delete', 'excluir'].includes(raw)) return 'remove';
  return 'invalid';
}

function normalizeMutationPayload(rawPayload, action) {
  try {
    return {
      ok: true,
      payload: validateNormalizedMutation({
        action,
        id: rawPayload.id,
        product_id: rawPayload.product_id,
        name: rawPayload.name !== undefined ? String(rawPayload.name).trim() : undefined,
        characteristics: rawPayload.characteristics !== undefined
          ? String(rawPayload.characteristics || '').trim()
          : undefined,
        category: rawPayload.category !== undefined ? normalizeLooseKey(rawPayload.category) : undefined,
        stores: rawPayload.stores,
        required_terms: rawPayload.required_terms,
        preferred_terms: rawPayload.preferred_terms,
        excluded_terms: rawPayload.excluded_terms,
        required_attributes: rawPayload.required_attributes,
        preferred_attributes: rawPayload.preferred_attributes,
        unit_rule: parseUnitRule(rawPayload.unit_rule),
        is_active: rawPayload.is_active !== undefined
          ? parseBoolean(rawPayload.is_active, true)
          : undefined,
        notes: rawPayload.notes !== undefined ? String(rawPayload.notes || '').trim() : undefined,
        default_action: rawPayload.default_action,
      }),
    };
  } catch (error) {
    return {
      ok: false,
      error: schemaErrorToMessage(error),
    };
  }
}

export function validateAndBuildProduct(rawPayload) {
  if (!rawPayload || typeof rawPayload !== 'object') {
    return { ok: false, error: 'Payload must be an object' };
  }
  for (const legacyField of LEGACY_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(rawPayload, legacyField)) {
      return { ok: false, error: `Field "${legacyField}" is not supported by search intents` };
    }
  }

  const name = String(rawPayload.name || '').trim();
  if (!name) {
    return { ok: false, error: 'Field "name" is required' };
  }

  const characteristics = String(rawPayload.characteristics || '').trim();
  const category = normalizeLooseKey(rawPayload.category) || undefined;
  const notes = String(rawPayload.notes || '').trim() || undefined;
  const active = parseBoolean(rawPayload.is_active, true);
  const idBase = slugify(`${name} ${characteristics}`) || 'produto';
  const id = rawPayload.id || `${idBase}-${shortHash(intentKey({ name, characteristics, category }))}`;

  try {
    const product = parseStoredProduct({
      id,
      name,
      characteristics,
      ...(category ? { category } : {}),
      ...(rawPayload.stores !== undefined ? { stores: rawPayload.stores } : {}),
      ...(rawPayload.required_terms !== undefined ? { required_terms: rawPayload.required_terms } : {}),
      ...(rawPayload.preferred_terms !== undefined ? { preferred_terms: rawPayload.preferred_terms } : {}),
      ...(rawPayload.excluded_terms !== undefined ? { excluded_terms: rawPayload.excluded_terms } : {}),
      ...(rawPayload.required_attributes !== undefined ? { required_attributes: rawPayload.required_attributes } : {}),
      ...(rawPayload.preferred_attributes !== undefined ? { preferred_attributes: rawPayload.preferred_attributes } : {}),
      ...(rawPayload.unit_rule !== undefined ? { unit_rule: parseUnitRule(rawPayload.unit_rule) } : {}),
      is_active: active,
      ...(notes ? { notes } : {}),
    });

    return { ok: true, product };
  } catch (error) {
    return { ok: false, error: schemaErrorToMessage(error) };
  }
}

export function detectDuplicate(products, productToInsert) {
  const candidateKey = intentKey(productToInsert);
  return products.find((existing) => intentKey(existing) === candidateKey);
}

function decodeTitleFallback(title) {
  const raw = String(title || '').trim();
  return raw
    .replace(/^\[(ADD PRODUCT|MANAGE PRODUCT)\]\s*/i, '')
    .trim();
}

function findProductIndex(products, payload) {
  if (payload.product_id) {
    return products.findIndex((item) => item.id === String(payload.product_id).trim());
  }

  if (payload.id) {
    return products.findIndex((item) => item.id === String(payload.id).trim());
  }

  if (payload.name) {
    const targetKey = intentKey(payload);
    return products.findIndex((item) => intentKey(item) === targetKey);
  }

  return -1;
}

function applyEdit(existing, payload) {
  const draft = { ...existing };

  for (const field of [
    'name',
    'characteristics',
    'category',
    'stores',
    'required_terms',
    'preferred_terms',
    'excluded_terms',
    'required_attributes',
    'preferred_attributes',
    'unit_rule',
    'is_active',
    'notes',
  ]) {
    if (payload[field] !== undefined) {
      draft[field] = payload[field];
    }
  }

  if (draft.category !== undefined) draft.category = normalizeLooseKey(draft.category);
  if (draft.notes !== undefined && String(draft.notes || '').trim() === '') delete draft.notes;
  if (draft.unit_rule !== undefined) draft.unit_rule = parseUnitRule(draft.unit_rule);

  try {
    return {
      ok: true,
      product: parseStoredProduct({ ...draft, id: existing.id }),
    };
  } catch (error) {
    return { ok: false, error: schemaErrorToMessage(error) };
  }
}

function mutateSingleProductAction(products, rawPayload, issueTitle = '') {
  const payload = { ...(rawPayload || {}) };
  const action = normalizeAction(payload.action);

  for (const legacyField of LEGACY_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(payload, legacyField)) {
      return {
        ok: false,
        status: 'invalid',
        message: `Field "${legacyField}" is not supported by search intents`,
      };
    }
  }

  if (action === 'invalid' || action === 'batch') {
    return { ok: false, status: 'invalid', message: 'Field "action" must be add, edit or remove' };
  }

  if (action === 'add' && !payload.name) {
    const fallbackName = decodeTitleFallback(issueTitle);
    if (fallbackName) payload.name = fallbackName;
  }

  const normalizedPayload = normalizeMutationPayload(payload, action);
  if (!normalizedPayload.ok) {
    return { ok: false, status: 'invalid', message: normalizedPayload.error };
  }
  const parsedPayload = normalizedPayload.payload;

  if (action === 'add') {
    const validated = validateAndBuildProduct(parsedPayload);
    if (!validated.ok) {
      return { ok: false, status: 'invalid', message: validated.error };
    }

    const duplicate = detectDuplicate(products, validated.product);
    if (duplicate) {
      return {
        ok: false,
        status: 'duplicate',
        message: `Intencao ja existente para o produto informado (id: ${duplicate.id}).`,
        product_id: duplicate.id,
      };
    }

    const nextProducts = [...products, validated.product].sort((a, b) => a.name.localeCompare(b.name));
    return {
      ok: true,
      status: 'success',
      message: `Intencao adicionada com sucesso: ${validated.product.name} (${validated.product.id}).`,
      product_id: validated.product.id,
      products: nextProducts,
    };
  }

  const index = findProductIndex(products, parsedPayload);
  if (index < 0) {
    return {
      ok: false,
      status: 'invalid',
      message: 'Intencao alvo nao encontrada. Informe product_id ou os mesmos dados de nome/caracteristicas/categoria.',
    };
  }

  const target = products[index];

  if (action === 'remove') {
    const nextProducts = products.filter((item) => item.id !== target.id);
    return {
      ok: true,
      status: 'success',
      message: `Intencao removida com sucesso: ${target.name} (${target.id}).`,
      product_id: target.id,
      products: nextProducts,
    };
  }

  const edited = applyEdit(target, parsedPayload);
  if (!edited.ok) {
    return { ok: false, status: 'invalid', message: edited.error };
  }

  const duplicate = products.find((item) => item.id !== target.id && intentKey(item) === intentKey(edited.product));
  if (duplicate) {
    return {
      ok: false,
      status: 'duplicate',
      message: `Ja existe outra intencao equivalente (id: ${duplicate.id}).`,
      product_id: duplicate.id,
    };
  }

  const nextProducts = [...products];
  nextProducts[index] = edited.product;
  nextProducts.sort((a, b) => a.name.localeCompare(b.name));

  return {
    ok: true,
    status: 'success',
    message: `Intencao atualizada com sucesso: ${edited.product.name} (${edited.product.id}).`,
    product_id: edited.product.id,
    products: nextProducts,
  };
}

function collectBatchOperations(rawPayload) {
  if (Array.isArray(rawPayload)) {
    return rawPayload;
  }

  if (!rawPayload || typeof rawPayload !== 'object') {
    return [];
  }

  const candidates = [rawPayload.operations, rawPayload.items, rawPayload.products];
  for (const candidate of candidates) {
    if (Array.isArray(candidate)) {
      return candidate;
    }
  }

  return [];
}

export function mutateProducts(products, rawPayload, issueTitle = '') {
  const payload = Array.isArray(rawPayload) ? { action: 'batch', operations: rawPayload } : { ...(rawPayload || {}) };
  const action = normalizeAction(payload.action);

  if (action === 'batch') {
    const operations = collectBatchOperations(rawPayload)
      .map((item) => (item && typeof item === 'object' ? item : null))
      .filter(Boolean);

    if (operations.length === 0) {
      return {
        ok: false,
        status: 'invalid',
        message: 'Batch payload must include a non-empty operations array.',
      };
    }

    let nextProducts = [...products];
    const changedIds = [];

    for (let index = 0; index < operations.length; index += 1) {
      const operation = operations[index];
      const normalizedOperation = operation.action
        ? operation
        : { ...operation, action: payload.default_action || 'add' };

      const mutation = mutateSingleProductAction(nextProducts, normalizedOperation, issueTitle);
      if (!mutation.ok) {
        return {
          ok: false,
          status: mutation.status || 'invalid',
          message: `Operacao ${index + 1}/${operations.length} falhou: ${mutation.message}`,
          product_id: mutation.product_id || '',
        };
      }

      nextProducts = mutation.products;
      if (mutation.product_id) {
        changedIds.push(mutation.product_id);
      }
    }

    return {
      ok: true,
      status: 'success',
      message: `Lote aplicado com sucesso: ${operations.length} operacao(oes), ${changedIds.length} intencao(oes) afetada(s).`,
      product_id: changedIds.join(', '),
      products: nextProducts,
    };
  }

  return mutateSingleProductAction(products, payload, issueTitle);
}

async function writeOutput(key, value) {
  const outputPath = process.env.GITHUB_OUTPUT;
  if (!outputPath) return;

  const safe = String(value ?? '');
  await appendFile(outputPath, `${key}<<__EOF__\n${safe}\n__EOF__\n`);
}

async function finish(status, message, productId = '') {
  await writeOutput('status', status);
  await writeOutput('message', message);
  await writeOutput('product_id', productId);
}

export async function ingestIssueEvent(eventPayload) {
  const issue = eventPayload?.issue;
  if (!issue) {
    return { status: 'error', message: 'Missing issue payload in event', product_id: '' };
  }

  const parse = parseIssuePayload(issue.body || '');
  if (!parse.ok) {
    return { status: 'invalid', message: parse.error, product_id: '' };
  }

  const currentProducts = await readProducts();
  const mutation = mutateProducts(currentProducts, parse.payload, issue.title || '');

  if (!mutation.ok) {
    return {
      status: mutation.status || 'invalid',
      message: mutation.message || 'Could not process issue payload',
      product_id: mutation.product_id || '',
    };
  }

  await writeProducts(mutation.products);
  return {
    status: mutation.status,
    message: mutation.message,
    product_id: mutation.product_id || '',
  };
}

async function main() {
  try {
    const eventPath = process.env.GITHUB_EVENT_PATH;
    if (!eventPath) {
      await finish('error', 'GITHUB_EVENT_PATH is not available');
      return;
    }

    const raw = await readFile(eventPath, 'utf8');
    const eventPayload = JSON.parse(raw);
    const result = await ingestIssueEvent(eventPayload);
    await finish(result.status, result.message, result.product_id || '');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await finish('error', message);
  }
}

const isDirectRun = process.argv[1]
  ? import.meta.url === pathToFileURL(process.argv[1]).href
  : false;

if (isDirectRun) {
  main();
}
