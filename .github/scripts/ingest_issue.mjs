import { appendFile, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { ZodError } from 'zod';
import { readProducts, writeProducts } from '../../src/io/products.js';
import {
  parseStoredProduct,
  validateNormalizedMutation,
} from '../../src/schema/catalog.js';
import { isValidHttpUrl, normalizeUrl, urlsEqualNormalized } from '../../src/utils/url.js';

function normalizeHeading(text) {
  return String(text || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

function splitLines(value) {
  return String(value || '')
    .split(/\r?\n/)
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
    url: fields['url do produto'] || fields.url,
    category: fields.categoria || fields.category,
    comparison_key: fields['grupo de comparacao'] || fields['comparison key'] || fields.comparison_key,
    units_per_package: fields['unidades por pacote'] || fields['units per package'],
    is_active: fields['ativo para scraping?'] || fields.is_active,
    notes: fields.observacoes || fields.notas || fields.notes,
    selectors: {
      price_css: splitLines(fields['seletores css (um por linha)'] || fields['seletores css']),
      jsonld_paths: splitLines(fields['json-ld paths (um por linha)'] || fields['json-ld paths']),
      regex_hints: splitLines(fields['regex hints (um por linha)'] || fields['regex hints']),
    },
  };

  return { ok: true, payload, source: 'issue_form_fields' };
}

function cleanArray(value) {
  if (!value) return [];
  if (Array.isArray(value)) {
    return value.map((item) => String(item).trim()).filter(Boolean);
  }
  return splitLines(value);
}

function normalizeLooseKey(value) {
  return String(value || '')
    .trim()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function slugify(text) {
  return String(text || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 28);
}

function shortHash(text) {
  return createHash('sha1').update(text).digest('hex').slice(0, 8);
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

export function validateAndBuildProduct(rawPayload) {
  if (!rawPayload || typeof rawPayload !== 'object') {
    return { ok: false, error: 'Payload must be an object' };
  }

  const name = String(rawPayload.name || '').trim();
  const url = String(rawPayload.url || '').trim();

  if (!name) {
    return { ok: false, error: 'Field "name" is required' };
  }
  if (!url || !isValidHttpUrl(url)) {
    return { ok: false, error: 'Field "url" must be a valid HTTP/HTTPS URL' };
  }

  const normalizedUrl = normalizeUrl(url);
  const unitsRaw = rawPayload.units_per_package;
  let units;

  if (unitsRaw !== undefined && unitsRaw !== null && String(unitsRaw).trim() !== '') {
    units = Number(unitsRaw);
    if (!Number.isFinite(units) || units <= 0) {
      return { ok: false, error: 'Field "units_per_package" must be a number > 0 when provided' };
    }
  }

  const selectorsInput = rawPayload.selectors && typeof rawPayload.selectors === 'object'
    ? rawPayload.selectors
    : {};

  const selectors = {
    price_css: cleanArray(selectorsInput.price_css),
    jsonld_paths: cleanArray(selectorsInput.jsonld_paths),
    regex_hints: cleanArray(selectorsInput.regex_hints),
  };

  const compactSelectors = {};
  if (selectors.price_css.length > 0) compactSelectors.price_css = selectors.price_css;
  if (selectors.jsonld_paths.length > 0) compactSelectors.jsonld_paths = selectors.jsonld_paths;
  if (selectors.regex_hints.length > 0) compactSelectors.regex_hints = selectors.regex_hints;

  const category = normalizeLooseKey(rawPayload.category) || undefined;
  const comparisonKey = normalizeLooseKey(rawPayload.comparison_key) || undefined;
  const notes = String(rawPayload.notes || '').trim() || undefined;
  const active = parseBoolean(rawPayload.is_active, true);

  const idBase = slugify(name) || 'produto';
  const id = rawPayload.id || `${idBase}-${shortHash(normalizedUrl)}`;

  try {
    const product = parseStoredProduct({
      id,
      url: normalizedUrl,
      name,
      ...(category ? { category } : {}),
      ...(comparisonKey ? { comparison_key: comparisonKey } : {}),
      ...(units ? { units_per_package: units } : {}),
      is_active: active,
      ...(Object.keys(compactSelectors).length > 0 ? { selectors: compactSelectors } : {}),
      ...(notes ? { notes } : {}),
    });

    return { ok: true, product };
  } catch (error) {
    return { ok: false, error: schemaErrorToMessage(error) };
  }
}

function setDefaultSelectorsIfMissing(product) {
  if (!product.selectors) {
    product.selectors = {
      jsonld_paths: ['offers.price', 'offers[0].price', 'price'],
      price_css: ['[itemprop="price"]', '.price', '.preco'],
    };
    return product;
  }

  if (!Array.isArray(product.selectors.jsonld_paths) || product.selectors.jsonld_paths.length === 0) {
    product.selectors.jsonld_paths = ['offers.price', 'offers[0].price', 'price'];
  }
  if (!Array.isArray(product.selectors.price_css) || product.selectors.price_css.length === 0) {
    product.selectors.price_css = ['[itemprop="price"]', '.price', '.preco'];
  }

  return product;
}

export function detectDuplicate(products, productToInsert) {
  return products.find((existing) => urlsEqualNormalized(existing.url, productToInsert.url));
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

  if (payload.url && isValidHttpUrl(payload.url)) {
    const normalized = normalizeUrl(payload.url);
    return products.findIndex((item) => urlsEqualNormalized(item.url, normalized));
  }

  return -1;
}

function sanitizeSelectors(selectors, fallbackSelectors) {
  if (!selectors || typeof selectors !== 'object') return fallbackSelectors;

  const priceCss = cleanArray(selectors.price_css);
  const jsonldPaths = cleanArray(selectors.jsonld_paths);
  const regexHints = cleanArray(selectors.regex_hints);

  const out = {};
  if (priceCss.length > 0) out.price_css = priceCss;
  if (jsonldPaths.length > 0) out.jsonld_paths = jsonldPaths;
  if (regexHints.length > 0) out.regex_hints = regexHints;

  if (Object.keys(out).length === 0) return fallbackSelectors;
  return out;
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
        url: rawPayload.url !== undefined ? String(rawPayload.url).trim() : undefined,
        category: rawPayload.category !== undefined ? normalizeLooseKey(rawPayload.category) : undefined,
        comparison_key: rawPayload.comparison_key !== undefined
          ? normalizeLooseKey(rawPayload.comparison_key)
          : undefined,
        units_per_package: rawPayload.units_per_package,
        is_active: rawPayload.is_active !== undefined
          ? parseBoolean(rawPayload.is_active, true)
          : undefined,
        notes: rawPayload.notes !== undefined ? String(rawPayload.notes || '').trim() : undefined,
        selectors: rawPayload.selectors !== undefined
          ? sanitizeSelectors(rawPayload.selectors, undefined)
          : undefined,
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

function applyEdit(existing, payload) {
  const draft = { ...existing };

  if (payload.name !== undefined) {
    const name = String(payload.name).trim();
    if (!name) return { ok: false, error: 'Field "name" cannot be empty for edit' };
    draft.name = name;
  }

  if (payload.url !== undefined) {
    const url = String(payload.url).trim();
    if (!isValidHttpUrl(url)) return { ok: false, error: 'Field "url" must be valid for edit' };
    draft.url = normalizeUrl(url);
  }

  if (payload.category !== undefined) {
    const category = normalizeLooseKey(payload.category);
    if (category) draft.category = category;
    else delete draft.category;
  }

  if (payload.comparison_key !== undefined) {
    const comparisonKey = normalizeLooseKey(payload.comparison_key);
    if (comparisonKey) draft.comparison_key = comparisonKey;
    else delete draft.comparison_key;
  }

  if (payload.units_per_package !== undefined) {
    if (payload.units_per_package === null || String(payload.units_per_package).trim() === '') {
      delete draft.units_per_package;
    } else {
      const units = Number(payload.units_per_package);
      if (!Number.isFinite(units) || units <= 0) {
        return { ok: false, error: 'Field "units_per_package" must be > 0 for edit' };
      }
      draft.units_per_package = units;
    }
  }

  if (payload.is_active !== undefined) {
    draft.is_active = parseBoolean(payload.is_active, draft.is_active);
  }

  if (payload.notes !== undefined) {
    const notes = String(payload.notes || '').trim();
    if (notes) draft.notes = notes;
    else delete draft.notes;
  }

  if (payload.selectors !== undefined) {
    draft.selectors = sanitizeSelectors(payload.selectors, draft.selectors);
  }

  try {
    return {
      ok: true,
      product: setDefaultSelectorsIfMissing(parseStoredProduct({ ...draft, id: existing.id })),
    };
  } catch (error) {
    return { ok: false, error: schemaErrorToMessage(error) };
  }
}

function mutateSingleProductAction(products, rawPayload, issueTitle = '') {
  const payload = { ...(rawPayload || {}) };
  const action = normalizeAction(payload.action);

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

    const product = setDefaultSelectorsIfMissing(validated.product);
    const duplicate = detectDuplicate(products, product);
    if (duplicate) {
      return {
        ok: false,
        status: 'duplicate',
        message: `Produto ja existente para a URL informada (id: ${duplicate.id}).`,
        product_id: duplicate.id,
      };
    }

    const nextProducts = [...products, product].sort((a, b) => a.name.localeCompare(b.name));
    return {
      ok: true,
      status: 'success',
      message: `Produto adicionado com sucesso: ${product.name} (${product.id}).`,
      product_id: product.id,
      products: nextProducts,
    };
  }

  const index = findProductIndex(products, parsedPayload);
  if (index < 0) {
    return {
      ok: false,
      status: 'invalid',
      message: 'Produto alvo nao encontrado. Informe product_id ou URL existente.',
    };
  }

  const target = products[index];

  if (action === 'remove') {
    const nextProducts = products.filter((item) => item.id !== target.id);
    return {
      ok: true,
      status: 'success',
      message: `Produto removido com sucesso: ${target.name} (${target.id}).`,
      product_id: target.id,
      products: nextProducts,
    };
  }

  const edited = applyEdit(target, parsedPayload);
  if (!edited.ok) {
    return { ok: false, status: 'invalid', message: edited.error };
  }

  const duplicate = products.find((item) => item.id !== target.id && urlsEqualNormalized(item.url, edited.product.url));
  if (duplicate) {
    return {
      ok: false,
      status: 'duplicate',
      message: `Ja existe outro produto com a mesma URL (id: ${duplicate.id}).`,
      product_id: duplicate.id,
    };
  }

  const nextProducts = [...products];
  nextProducts[index] = edited.product;
  nextProducts.sort((a, b) => a.name.localeCompare(b.name));

  return {
    ok: true,
    status: 'success',
    message: `Produto atualizado com sucesso: ${edited.product.name} (${edited.product.id}).`,
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
      message: `Lote aplicado com sucesso: ${operations.length} operacao(oes), ${changedIds.length} produto(s) afetado(s).`,
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
