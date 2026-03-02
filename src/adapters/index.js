import { amazonAdapter } from './amazon.js';
import { genericAdapter } from './generic.js';
import { getDomainFromUrl } from '../utils/url.js';

const ADAPTERS = [amazonAdapter, genericAdapter];

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