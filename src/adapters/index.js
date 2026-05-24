import { amazonAdapter } from './amazon.js';
import { kabumAdapter } from './kabum.js';
import { magaluAdapter } from './magalu.js';
import { mercadolivreAdapter } from './mercadolivre.js';
import { petzAdapter } from './petz.js';
import { pichauAdapter } from './pichau.js';
import { shopeeAdapter } from './shopee.js';
import { genericAdapter } from './generic.js';
import { getDomainFromUrl } from '../utils/url.js';

const ADAPTERS = [
  amazonAdapter,
  kabumAdapter,
  mercadolivreAdapter,
  magaluAdapter,
  shopeeAdapter,
  pichauAdapter,
  petzAdapter,
  genericAdapter,
];

export function getAdapterForUrl(url) {
  const domain = getDomainFromUrl(url);

  for (const adapter of ADAPTERS) {
    if (adapter.matches(domain)) {
      return adapter;
    }
  }

  return genericAdapter;
}

export function adapterNameForUrl(url) {
  return getAdapterForUrl(url).id;
}
