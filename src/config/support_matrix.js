import { getDomainFromUrl } from '../utils/url.js';

function freezeEntry(entry) {
  return Object.freeze({
    ...entry,
    domains: Object.freeze([...(entry.domains || [])]),
  });
}

const fallbackStore = freezeEntry({
  store: 'Outros dominios',
  domains: [],
  adapter: 'generic',
  support_level: 'generic_unvalidated',
  ci_regression: false,
  smoke_real: false,
});

export const supportMatrix = Object.freeze([
  freezeEntry({
    store: 'Amazon',
    domains: ['amazon.com.br', 'amazon.com'],
    adapter: 'amazon',
    support_level: 'dedicated_validated',
    ci_regression: true,
    smoke_real: true,
  }),
  freezeEntry({
    store: 'KaBuM',
    domains: ['kabum.com.br'],
    adapter: 'kabum',
    support_level: 'dedicated_validated',
    ci_regression: true,
    smoke_real: true,
  }),
  freezeEntry({
    store: 'Mercado Livre',
    domains: ['mercadolivre.com.br'],
    adapter: 'generic',
    support_level: 'backlog',
    ci_regression: false,
    smoke_real: false,
  }),
  freezeEntry({
    store: 'Magalu',
    domains: ['magazineluiza.com.br', 'magalu.com'],
    adapter: 'generic',
    support_level: 'backlog',
    ci_regression: false,
    smoke_real: false,
  }),
  freezeEntry({
    store: 'Shopee',
    domains: ['shopee.com.br'],
    adapter: 'generic',
    support_level: 'backlog',
    ci_regression: false,
    smoke_real: false,
  }),
  freezeEntry({
    store: 'Pichau',
    domains: ['pichau.com.br'],
    adapter: 'generic',
    support_level: 'backlog',
    ci_regression: false,
    smoke_real: false,
  }),
  freezeEntry({
    store: 'Petz',
    domains: ['petz.com.br'],
    adapter: 'generic',
    support_level: 'backlog',
    ci_regression: false,
    smoke_real: false,
  }),
  fallbackStore,
]);

export function getStoreSupportByDomain(domain) {
  const normalized = String(domain || '')
    .trim()
    .replace(/^www\./i, '')
    .toLowerCase();

  return supportMatrix.find((entry) => entry.domains.includes(normalized)) || fallbackStore;
}

export function getStoreSupportByUrl(url) {
  return getStoreSupportByDomain(getDomainFromUrl(url));
}

export function listSmokeEnabledStores() {
  return supportMatrix.filter((entry) => entry.smoke_real);
}
