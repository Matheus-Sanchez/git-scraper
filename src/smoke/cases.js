import { getStoreSupportById } from '../config/support_matrix.js';

function freezeCase(entry) {
  return Object.freeze({
    ...entry,
    required_terms: Object.freeze([...(entry.required_terms || [])]),
    excluded_terms: Object.freeze([...(entry.excluded_terms || [])]),
    required_attributes: Object.freeze({ ...(entry.required_attributes || {}) }),
  });
}

export const smokeCases = Object.freeze([
  freezeCase({
    id: 'amazon-echo-pop',
    store_id: 'amazon',
    product_id: 'echo-pop-5f33e662',
    required_terms: ['echo', 'pop'],
    excluded_terms: ['suporte', 'base de mesa', 'pedestal', 'capa'],
    required_attributes: { is_accessory: false },
  }),
  freezeCase({
    id: 'kabum-asus-tuf-b760-ddr5',
    store_id: 'kabum',
    product_id: 'placa-mae-asus-tuf-gaming-b760-ddr5-1525c3b8',
    required_terms: ['asus', 'tuf', 'b760'],
    excluded_terms: ['ddr4'],
    required_attributes: { chipset: 'b760', memory_type: 'ddr5' },
  }),
  freezeCase({
    id: 'mercadolivre-logitech-k835',
    store_id: 'mercadolivre',
    product_id: 'teclado-logitech-k835',
    required_terms: ['logitech', 'k835'],
    required_attributes: { is_accessory: false },
  }),
  freezeCase({
    id: 'magalu-acer-aspire-go-15-i7-512gb',
    store_id: 'magalu',
    product_id: 'notebook-acer-aspire-go-15-f27ed9a1',
    required_terms: ['notebook', 'acer', 'aspire', 'go'],
    excluded_terms: ['core i3', '256gb'],
    required_attributes: { cpu_tier: 'i7', storage_gb: 512 },
  }),
  freezeCase({
    id: 'shopee-hyperx-cloud-stinger-2-preto',
    store_id: 'shopee',
    product_id: 'headset-hyperx-cloud-stinger-2',
    required_terms: ['hyperx', 'cloud', 'stinger 2'],
    excluded_terms: ['xbox', 'branco', 'white'],
    required_attributes: { color: 'preto', platform: 'multiplataforma' },
  }),
  freezeCase({
    id: 'pichau-asus-tuf-b760-ddr5',
    store_id: 'pichau',
    product_id: 'placa-mae-asus-tuf-gaming-b760-ddr5-1525c3b8',
    required_terms: ['asus', 'tuf', 'b760'],
    excluded_terms: ['ddr4'],
    required_attributes: { chipset: 'b760', memory_type: 'ddr5' },
  }),
  freezeCase({
    id: 'petz-pampers-confort-sec-g',
    store_id: 'petz',
    product_id: 'fralda-pampers-confort-sec-g-5c5a56c0',
    required_terms: ['fralda', 'pampers', 'confort', 'sec'],
    required_attributes: { size: 'G' },
  }),
]);

export function listRegisteredSmokeCases({ enabledOnly = false } = {}) {
  if (!enabledOnly) return [...smokeCases];
  return smokeCases.filter((entry) => getStoreSupportById(entry.store_id).smoke_real);
}
