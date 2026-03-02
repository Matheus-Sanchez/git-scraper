const TRACKING_PARAMS = new Set([
  'fbclid',
  'gclid',
  'igshid',
  'mc_cid',
  'mc_eid',
  'mkt_tok',
  'ref',
  'ref_',
  'source',
]);

export function isValidHttpUrl(value) {
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

export function normalizeUrl(value) {
  if (!isValidHttpUrl(value)) {
    throw new Error(`Invalid URL: ${value}`);
  }

  const parsed = new URL(value);

  parsed.hash = '';

  const keysToDelete = [];
  for (const [key] of parsed.searchParams.entries()) {
    const lower = key.toLowerCase();
    if (lower.startsWith('utm_') || TRACKING_PARAMS.has(lower)) {
      keysToDelete.push(key);
    }
  }

  for (const key of keysToDelete) {
    parsed.searchParams.delete(key);
  }

  const orderedParams = [...parsed.searchParams.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  parsed.search = '';
  for (const [key, val] of orderedParams) {
    parsed.searchParams.append(key, val);
  }

  if (parsed.pathname !== '/') {
    parsed.pathname = parsed.pathname.replace(/\/+$/, '');
  }

  return parsed.toString();
}

export function getDomainFromUrl(value) {
  try {
    const parsed = new URL(value);
    return parsed.hostname.replace(/^www\./i, '').toLowerCase();
  } catch {
    return '';
  }
}

export function urlsEqualNormalized(a, b) {
  try {
    return normalizeUrl(a) === normalizeUrl(b);
  } catch {
    return false;
  }
}