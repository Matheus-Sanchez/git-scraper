function freezeEntry(entry) {
  return Object.freeze({
    ...entry,
    domains: Object.freeze([...(entry.domains || [])]),
  });
}

const fallbackStore = freezeEntry({
  store: 'Loja desconhecida',
  domains: [],
  adapter: 'unsupported',
  support_level: 'unsupported',
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
    adapter: 'mercadolivre',
    support_level: 'dedicated_validated',
    ci_regression: true,
    smoke_real: true,
  }),
  freezeEntry({
    store: 'Magalu',
    domains: ['magazineluiza.com.br', 'magalu.com'],
    adapter: 'magalu',
    support_level: 'dedicated_validated',
    ci_regression: true,
    smoke_real: true,
  }),
  freezeEntry({
    store: 'Shopee',
    domains: ['shopee.com.br'],
    adapter: 'shopee',
    support_level: 'dedicated_validated',
    ci_regression: true,
    smoke_real: true,
  }),
  freezeEntry({
    store: 'Pichau',
    domains: ['pichau.com.br'],
    adapter: 'pichau',
    support_level: 'dedicated_validated',
    ci_regression: true,
    smoke_real: true,
  }),
  freezeEntry({
    store: 'Petz',
    domains: ['petz.com.br'],
    adapter: 'petz',
    support_level: 'dedicated_validated',
    ci_regression: true,
    smoke_real: true,
  }),
  fallbackStore,
]);

export function listSmokeEnabledStores() {
  return supportMatrix.filter((entry) => entry.smoke_real);
}

export function listSearchEnabledStores() {
  return supportMatrix.filter((entry) => entry.support_level === 'dedicated_validated');
}

export function listSearchEnabledStoreIds() {
  return listSearchEnabledStores().map((entry) => entry.adapter);
}

export function getStoreSupportById(storeId) {
  const normalized = String(storeId || '').trim().toLowerCase();
  return supportMatrix.find((entry) => entry.adapter === normalized) || fallbackStore;
}

export function isSearchEnabledStoreId(storeId) {
  return listSearchEnabledStoreIds().includes(String(storeId || '').trim().toLowerCase());
}
