export function parseBRLValue(value) {
  if (value === null || value === undefined) return null;

  if (typeof value === 'number') {
    if (!Number.isFinite(value) || value <= 0) return null;
    return roundTo2(value);
  }

  const raw = String(value).trim();
  if (!raw) return null;

  const cleaned = raw
    .replace(/\s+/g, '')
    .replace(/R\$/gi, '')
    .replace(/[^\d,.-]/g, '');

  if (!cleaned || !/[\d]/.test(cleaned)) return null;

  let normalized = cleaned;

  const commaCount = (normalized.match(/,/g) || []).length;
  const dotCount = (normalized.match(/\./g) || []).length;

  if (commaCount > 0) {
    normalized = normalized.replace(/\./g, '');
    const lastComma = normalized.lastIndexOf(',');
    normalized = `${normalized.slice(0, lastComma)}.${normalized.slice(lastComma + 1)}`;
    normalized = normalized.replace(/,/g, '');
  } else if (dotCount > 1) {
    const lastDot = normalized.lastIndexOf('.');
    normalized = `${normalized.slice(0, lastDot).replace(/\./g, '')}.${normalized.slice(lastDot + 1)}`;
  }

  const parsed = Number.parseFloat(normalized);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;

  return roundTo2(parsed);
}

export function extractNumericTokens(text) {
  if (!text) return [];
  const input = String(text);

  const pattern = /R\$\s*\d{1,3}(?:\.\d{3})*,\d{2}|\d{1,3}(?:\.\d{3})*,\d{2}|\d+\.\d{2}/g;
  const matches = input.match(pattern) || [];

  return matches;
}

export function roundTo2(value) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}