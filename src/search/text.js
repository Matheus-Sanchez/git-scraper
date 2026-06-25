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

export function normalizeSearchText(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function tokenizeSearchText(value) {
  const normalized = normalizeSearchText(value);
  if (!normalized) return [];
  return [...new Set(normalized.split(' ')
    .filter((term) => term.length >= 2)
    .filter((term) => !STOPWORDS.has(term)))];
}

export function buildSearchQuery(intent) {
  return [intent?.name, intent?.characteristics]
    .map((item) => String(item || '').trim())
    .filter(Boolean)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function slugifyQuery(value) {
  return normalizeSearchText(value).replace(/\s+/g, '-');
}

export function includesNormalized(text, term) {
  const haystack = normalizeSearchText(text);
  const needle = normalizeSearchText(term);
  return Boolean(needle) && haystack.includes(needle);
}
