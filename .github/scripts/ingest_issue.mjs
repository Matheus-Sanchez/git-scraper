import { appendFile, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { readProducts, writeProducts } from '../../src/io/products.js';
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

  const pattern = /^###\s+(.+?)\r?\n([\s\S]*?)(?=^###\s+|\Z)/gim;
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

  const embeddedJson = fields['json do produto (opcional)'] || fields['json do produto'];
  if (embeddedJson) {
    try {
      const parsed = JSON.parse(embeddedJson);
      return { ok: true, payload: parsed, source: 'issue_form_json' };
    } catch {
      return { ok: false, error: 'Invalid JSON in issue form field: JSON do produto' };
    }
  }

  const payload = {
    name: fields['nome do produto'] || fields.nome,
    url: fields['url do produto'] || fields.url,
    category: fields.categoria,
    units_per_package: fields['unidades por pacote'],
    is_active: fields['ativo para scraping?'],
    notes: fields.observacoes || fields['observações'] || fields.notas,
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

  const category = String(rawPayload.category || '').trim() || undefined;
  const notes = String(rawPayload.notes || '').trim() || undefined;

  const active = parseBoolean(rawPayload.is_active, true);
  const idBase = slugify(name) || 'produto';
  const id = `${idBase}-${shortHash(normalizedUrl)}`;

  const product = {
    id,
    url: normalizedUrl,
    name,
    ...(category ? { category } : {}),
    ...(units ? { units_per_package: units } : {}),
    is_active: active,
    ...(Object.keys(compactSelectors).length > 0 ? { selectors: compactSelectors } : {}),
    ...(notes ? { notes } : {}),
  };

  return { ok: true, product };
}

function decodeTitleFallback(title) {
  const raw = String(title || '').trim();
  const withoutPrefix = raw.replace(/^\[ADD PRODUCT\]\s*/i, '').trim();
  return withoutPrefix;
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

  if (!parse.payload?.name) {
    const fallbackName = decodeTitleFallback(issue.title);
    if (fallbackName) {
      parse.payload.name = fallbackName;
    }
  }

  const validated = validateAndBuildProduct(parse.payload);
  if (!validated.ok) {
    return { status: 'invalid', message: validated.error, product_id: '' };
  }

  const product = setDefaultSelectorsIfMissing(validated.product);
  const currentProducts = await readProducts();

  const duplicate = detectDuplicate(currentProducts, product);
  if (duplicate) {
    return {
      status: 'duplicate',
      message: `Produto ja existente para a URL informada (id: ${duplicate.id}).`,
      product_id: duplicate.id,
    };
  }

  const nextProducts = [...currentProducts, product].sort((a, b) => a.name.localeCompare(b.name));
  await writeProducts(nextProducts);

  return {
    status: 'success',
    message: `Produto adicionado com sucesso: ${product.name} (${product.id}).`,
    product_id: product.id,
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
