import crypto from 'node:crypto';
import axios from 'axios';
import { roundTo2 } from './utils/price_parse.js';

const AMAZON_HOST_CONFIG = {
  'amazon.com.br': {
    host: 'webservices.amazon.com.br',
    region: 'us-east-1',
    marketplace: 'www.amazon.com.br',
    currency: 'BRL',
  },
  'amazon.com': {
    host: 'webservices.amazon.com',
    region: 'us-east-1',
    marketplace: 'www.amazon.com',
    currency: 'USD',
  },
};

const DEFAULT_RESOURCES = [
  'ItemInfo.Title',
  'Offers.Listings.Price',
  'OffersV2.Listings.Price',
];

function hmac(key, value, encoding) {
  return crypto.createHmac('sha256', key).update(value, 'utf8').digest(encoding);
}

function sha256(value) {
  return crypto.createHash('sha256').update(value, 'utf8').digest('hex');
}

function toAmzDate(now = new Date()) {
  const iso = now.toISOString().replace(/[:-]|\.\d{3}/g, '');
  return {
    amzDate: iso,
    dateStamp: iso.slice(0, 8),
  };
}

export function extractAsinFromAmazonUrl(url) {
  const normalized = String(url || '');
  const match = normalized.match(/\/(?:dp|gp\/product|product)\/([A-Z0-9]{10})(?:[/?]|$)/i)
    || normalized.match(/[?&]asin=([A-Z0-9]{10})(?:&|$)/i);
  return match ? match[1].toUpperCase() : null;
}

export function getAmazonApiConfigForUrl(url) {
  try {
    const hostname = new URL(url).hostname.replace(/^www\./, '').toLowerCase();
    return AMAZON_HOST_CONFIG[hostname] || null;
  } catch {
    return null;
  }
}

function buildCanonicalHeaders({ host, amzDate, target, contentEncoding = 'amz-1.0' }) {
  return {
    'content-encoding': contentEncoding,
    'content-type': 'application/json; charset=utf-8',
    host,
    'x-amz-date': amzDate,
    'x-amz-target': target,
  };
}

function serializeCanonicalHeaders(headers) {
  return Object.entries(headers)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}:${String(value).trim()}\n`)
    .join('');
}

function signedHeadersList(headers) {
  return Object.keys(headers)
    .sort((left, right) => left.localeCompare(right))
    .join(';');
}

function buildAuthorizationHeader({ env, config, amzDate, dateStamp, canonicalRequest }) {
  const credentialScope = `${dateStamp}/${config.region}/ProductAdvertisingAPI/aws4_request`;
  const stringToSign = [
    'AWS4-HMAC-SHA256',
    amzDate,
    credentialScope,
    sha256(canonicalRequest),
  ].join('\n');

  const kDate = hmac(`AWS4${env.AMAZON_PAAPI_SECRET_KEY}`, dateStamp);
  const kRegion = hmac(kDate, config.region);
  const kService = hmac(kRegion, 'ProductAdvertisingAPI');
  const kSigning = hmac(kService, 'aws4_request');
  const signature = hmac(kSigning, stringToSign, 'hex');

  return `AWS4-HMAC-SHA256 Credential=${env.AMAZON_PAAPI_ACCESS_KEY}/${credentialScope}, SignedHeaders=content-encoding;content-type;host;x-amz-date;x-amz-target, Signature=${signature}`;
}

export function extractPriceFromPaapiResponse(payload) {
  const item = payload?.ItemsResult?.Items?.[0];
  const v2Price = item?.OffersV2?.Listings?.[0]?.Price;
  const v1Price = item?.Offers?.Listings?.[0]?.Price;
  const title = item?.ItemInfo?.Title?.DisplayValue || null;
  const detailPageUrl = item?.DetailPageURL || null;
  const amount = Number(
    v2Price?.Amount
      ?? v1Price?.Amount
      ?? v2Price?.SavingBasis?.Amount
      ?? v1Price?.SavingBasis?.Amount,
  );
  const currency = v2Price?.Currency ?? v1Price?.Currency ?? null;

  if (!Number.isFinite(amount) || amount <= 0) {
    return null;
  }

  return {
    price: roundTo2(amount),
    currency,
    title,
    detailPageUrl,
  };
}

export async function fetchAmazonPriceViaPaapi({ product, env, logger }) {
  if (!env.AMAZON_PAAPI_ACCESS_KEY || !env.AMAZON_PAAPI_SECRET_KEY || !env.AMAZON_PAAPI_PARTNER_TAG) {
    return { ok: false, skipped: true, reason: 'missing_credentials' };
  }

  const config = getAmazonApiConfigForUrl(product?.url);
  if (!config) {
    return { ok: false, skipped: true, reason: 'unsupported_marketplace' };
  }

  const asin = extractAsinFromAmazonUrl(product?.url);
  if (!asin) {
    return { ok: false, skipped: true, reason: 'asin_not_found' };
  }

  const target = 'com.amazon.paapi5.v1.ProductAdvertisingAPIv1.GetItems';
  const requestBody = JSON.stringify({
    ItemIds: [asin],
    ItemIdType: 'ASIN',
    PartnerTag: env.AMAZON_PAAPI_PARTNER_TAG,
    PartnerType: 'Associates',
    Marketplace: config.marketplace,
    Resources: DEFAULT_RESOURCES,
  });

  const { amzDate, dateStamp } = toAmzDate();
  const canonicalHeaders = buildCanonicalHeaders({ host: config.host, amzDate, target });
  const canonicalRequest = [
    'POST',
    '/paapi5/getitems',
    '',
    serializeCanonicalHeaders(canonicalHeaders),
    signedHeadersList(canonicalHeaders),
    sha256(requestBody),
  ].join('\n');

  const authorization = buildAuthorizationHeader({
    env,
    config,
    amzDate,
    dateStamp,
    canonicalRequest,
  });

  try {
    const response = await axios.post(`https://${config.host}/paapi5/getitems`, requestBody, {
      timeout: env.HTTP_TIMEOUT_MS,
      headers: {
        Authorization: authorization,
        'Content-Encoding': 'amz-1.0',
        'Content-Type': 'application/json; charset=utf-8',
        Host: config.host,
        'X-Amz-Date': amzDate,
        'X-Amz-Target': target,
      },
      validateStatus: (status) => status >= 200 && status < 500,
    });

    const extracted = extractPriceFromPaapiResponse(response.data);
    if (!extracted) {
      const apiError = response.data?.Errors?.[0];
      return {
        ok: false,
        skipped: false,
        error_code: 'amazon_api_no_price',
        error_detail: apiError?.Message || 'Amazon PA-API did not return a price',
        http_status: response.status,
        final_url: product.url,
        asin,
      };
    }

    return {
      ok: true,
      skipped: false,
      asin,
      price: extracted.price,
      currency: extracted.currency || config.currency,
      title: extracted.title,
      final_url: extracted.detailPageUrl || product.url,
      source: 'amazon-paapi',
      confidence: 0.99,
      engine_metadata: {
        http_status: response.status,
        asin,
      },
    };
  } catch (error) {
    logger?.debug?.('Amazon PA-API request failed', {
      product_id: product?.id,
      error: error instanceof Error ? error.message : String(error),
      asin,
    });

    return {
      ok: false,
      skipped: false,
      error_code: 'amazon_api_error',
      error_detail: error instanceof Error ? error.message : String(error),
      final_url: product?.url,
      asin,
    };
  }
}
