import { config as dotenvConfig } from 'dotenv';

dotenvConfig();

function parseBool(value, fallback = false) {
  if (value === undefined || value === null || value === '') return fallback;
  return ['1', 'true', 'yes', 'y', 'on'].includes(String(value).trim().toLowerCase());
}

function parseIntSafe(value, fallback) {
  const parsed = Number.parseInt(String(value), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function optionalString(value) {
  if (value === undefined || value === null) return null;
  const trimmed = String(value).trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeProxyUrl(value) {
  const raw = optionalString(value);
  if (!raw) return null;
  try {
    const parsed = new URL(raw);
    if (!['http:', 'https:', 'socks5:'].includes(parsed.protocol)) {
      return null;
    }
    return parsed.toString();
  } catch {
    return null;
  }
}

const defaultUserAgent =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 '
  + '(KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36';

const concurrency = clamp(parseIntSafe(process.env.CONCURRENCY, 4), 1, 5);
const httpTimeoutMs = Math.max(3000, parseIntSafe(process.env.HTTP_TIMEOUT_MS, 15000));

export const env = Object.freeze({
  DEBUG: parseBool(process.env.DEBUG, false),
  SCRAPING_API_KEY: optionalString(process.env.SCRAPING_API_KEY),
  AMAZON_PAAPI_ACCESS_KEY: optionalString(process.env.AMAZON_PAAPI_ACCESS_KEY),
  AMAZON_PAAPI_SECRET_KEY: optionalString(process.env.AMAZON_PAAPI_SECRET_KEY),
  AMAZON_PAAPI_PARTNER_TAG: optionalString(process.env.AMAZON_PAAPI_PARTNER_TAG),
  HTTP_TIMEOUT_MS: httpTimeoutMs,
  CONCURRENCY: concurrency,
  USER_AGENT: optionalString(process.env.USER_AGENT) || defaultUserAgent,
  PROXY_URL: normalizeProxyUrl(process.env.PROXY_URL),
});