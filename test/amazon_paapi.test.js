import assert from 'node:assert/strict';
import test from 'node:test';
import {
  extractAsinFromAmazonUrl,
  extractPriceFromPaapiResponse,
  getAmazonApiConfigForUrl,
} from '../src/providers.amazon_paapi.js';

test('extractAsinFromAmazonUrl supports canonical and twister Amazon URLs', () => {
  assert.equal(extractAsinFromAmazonUrl('https://www.amazon.com.br/dp/B09WXVH7WK?th=1'), 'B09WXVH7WK');
  assert.equal(
    extractAsinFromAmazonUrl('https://www.amazon.com.br/dp/B0DK6ZC5ZC/ref=twister_B0DNWSNRCJ?_encoding=UTF8&th=1'),
    'B0DK6ZC5ZC',
  );
});

test('getAmazonApiConfigForUrl maps amazon.com.br marketplace to PA-API host', () => {
  assert.deepEqual(getAmazonApiConfigForUrl('https://www.amazon.com.br/dp/B09WXVH7WK?th=1'), {
    host: 'webservices.amazon.com.br',
    region: 'us-east-1',
    marketplace: 'www.amazon.com.br',
    currency: 'BRL',
  });
});

test('extractPriceFromPaapiResponse prefers OffersV2 and returns normalized price data', () => {
  const extracted = extractPriceFromPaapiResponse({
    ItemsResult: {
      Items: [{
        DetailPageURL: 'https://www.amazon.com.br/dp/B09WXVH7WK',
        ItemInfo: {
          Title: {
            DisplayValue: 'Echo Pop',
          },
        },
        OffersV2: {
          Listings: [{
            Price: {
              Amount: 379,
              Currency: 'BRL',
            },
          }],
        },
      }],
    },
  });

  assert.deepEqual(extracted, {
    price: 379,
    currency: 'BRL',
    title: 'Echo Pop',
    detailPageUrl: 'https://www.amazon.com.br/dp/B09WXVH7WK',
  });
});
