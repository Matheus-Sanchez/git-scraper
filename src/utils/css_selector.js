import { load } from 'cheerio';

const selectorProbe = load('<div></div>');

export function isValidCssSelector(value) {
  if (typeof value !== 'string') return false;

  const selector = value.trim();
  if (!selector) return false;

  try {
    selectorProbe(selector);
    return true;
  } catch {
    return false;
  }
}

export function normalizeCssSelectors(values) {
  if (!Array.isArray(values)) return [];

  const normalized = [];
  for (const value of values) {
    const selector = typeof value === 'string' ? value.trim() : '';
    if (!isValidCssSelector(selector)) continue;
    if (normalized.includes(selector)) continue;
    normalized.push(selector);
  }

  return normalized;
}
