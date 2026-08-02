import { roundTo2 } from '../utils/price_parse.js';

function roundTo(value, precision) {
  const factor = 10 ** precision;
  return Math.round((Number(value) + Number.EPSILON) * factor) / factor;
}

function roundUnitPrice(value, basis) {
  return roundTo(value, ['g', 'ml'].includes(basis) ? 4 : 2);
}

function parseDecimal(rawValue) {
  const normalized = String(rawValue || '').replace(',', '.');
  const value = Number(normalized);
  return Number.isFinite(value) ? value : null;
}

function firstMatch(text, pattern) {
  const match = String(text || '').match(pattern);
  return match || null;
}

function positiveFiniteNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? numeric : null;
}

function extractRamAttributes(text) {
  const out = {};
  const kit = firstMatch(text, /(\d+)\s*x\s*(\d+(?:[,.]\d+)?)\s*gb\b/i);
  const capacity = firstMatch(text, /(\d+(?:[,.]\d+)?)\s*gb\b/i);
  const speed = firstMatch(text, /(\d{3,5})\s*(?:mhz|mt\/s)\b/i);
  const memoryType = firstMatch(text, /\bddr\s*([345])\b/i);

  if (kit) {
    const moduleCount = Number(kit[1]);
    const moduleGb = parseDecimal(kit[2]);
    if (Number.isFinite(moduleCount) && Number.isFinite(moduleGb)) {
      out.module_count = moduleCount;
      out.module_gb = moduleGb;
      out.capacity_total_gb = roundTo2(moduleCount * moduleGb);
    }
  } else if (capacity) {
    const totalGb = parseDecimal(capacity[1]);
    if (Number.isFinite(totalGb)) {
      out.capacity_total_gb = totalGb;
      out.module_count = 1;
      out.module_gb = totalGb;
    }
  }

  if (speed) {
    out.speed_mhz = Number(speed[1]);
  }
  if (memoryType) {
    out.memory_type = `ddr${memoryType[1]}`;
  }

  return out;
}

function extractVariantAttributes(text) {
  const normalized = String(text || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const out = {};
  const cpuTier = firstMatch(normalized, /\b(?:intel\s+)?core\s+(i[3579])\b|\b(i[3579])(?:[-\s]\d{4,5}[a-z]{0,2})?\b/i);
  const storage = firstMatch(normalized, /\b(?:ssd|nvme)\s*(\d+(?:[,.]\d+)?)\s*(tb|gb)\b|\b(\d+(?:[,.]\d+)?)\s*(tb|gb)\s*(?:ssd|nvme)\b/i);
  const ram = firstMatch(normalized, /\b(?:ram|memoria)\s*(?:de\s*)?(\d+(?:[,.]\d+)?)\s*gb\b|\b(\d+(?:[,.]\d+)?)\s*gb\s*(?:de\s*)?(?:ram|memoria)\b/i);
  const chipset = firstMatch(normalized, /\bchipset\s*:?-?\s*([abhxz]\d{3}[a-z]?)\b/i)
    || firstMatch(normalized, /\b([abhxz]\d{3}[a-z]?)\b/i);

  if (cpuTier) out.cpu_tier = String(cpuTier[1] || cpuTier[2]).toLowerCase();
  if (storage) {
    const amount = parseDecimal(storage[1] || storage[3]);
    const unit = String(storage[2] || storage[4]).toLowerCase();
    if (Number.isFinite(amount)) out.storage_gb = unit === 'tb' ? roundTo2(amount * 1024) : amount;
  }
  if (ram) {
    const amount = parseDecimal(ram[1] || ram[2]);
    if (Number.isFinite(amount)) out.ram_gb = amount;
  }
  if (chipset) {
    // Motherboard model suffixes such as B760M/B760I describe the board form
    // factor, not a different Intel chipset. Keep real chipset suffixes such as
    // X670E intact.
    out.chipset = chipset[1].toLowerCase().replace(/^([abhxz]\d{3})[mi]$/, '$1');
  }

  if (/\b(?:preto|preta|black)\b/i.test(normalized)) out.color = 'preto';
  if (/\b(?:branco|branca|white)\b/i.test(normalized)) out.color = 'branco';
  const platformFamilies = [
    /\b(?:pc|windows)\b/i.test(normalized) ? 'pc' : null,
    /\b(?:playstation|ps[345])\b/i.test(normalized) ? 'playstation' : null,
    /\bxbox\b/i.test(normalized) ? 'xbox' : null,
    /\b(?:nintendo|switch)\b/i.test(normalized) ? 'nintendo' : null,
  ].filter(Boolean);
  const explicitlyMultiplatform = /\b(?:multiplataforma|multi plataforma|multi-platform|pc\s*\/\s*ps|pc\s+ps)\b/i.test(normalized);

  if (explicitlyMultiplatform || new Set(platformFamilies).size >= 2) {
    out.platform = 'multiplataforma';
  } else if (platformFamilies[0] === 'xbox') {
    out.platform = 'xbox';
  } else if (platformFamilies[0] === 'playstation') {
    out.platform = 'playstation';
  } else if (platformFamilies[0] === 'pc') {
    out.platform = 'pc';
  } else if (platformFamilies[0] === 'nintendo') {
    out.platform = 'nintendo';
  }

  const accessoryPattern = /\b(?:suporte|base de mesa|pedestal|capa|case|pelicula|carregador|cabo|adaptador|acessorio)\b/i;
  out.is_accessory = accessoryPattern.test(normalized);

  return out;
}

function extractPackageAttributes(text) {
  const out = {};
  const count = firstMatch(text, /(\d+)\s*(?:un|unid|unidade|unidades|fralda|fraldas|pe[cç]a|pe[cç]as|pcs?)\b/i);
  const explicitSize = firstMatch(text, /\b(?:tamanho|tam\.?|size)\s*:?-?\s*(rn|xxgg|xxg|xg|gg|g|m|p)\b/i);
  const diaperSize = explicitSize || (/\bfrald(?:a|as)\b/i.test(text)
    ? firstMatch(text, /\b(rn|xxgg|xxg|xg|gg|g|m|p)\b/i)
    : null);

  if (count) {
    out.package_count = Number(count[1]);
  }
  if (diaperSize) {
    out.size = diaperSize[1].toUpperCase();
  }

  return out;
}

function extractWeightAttributes(text) {
  const out = {};
  const weight = firstMatch(text, /(\d+(?:[,.]\d+)?)\s*(kg|g)\b/i);
  if (!weight) return out;

  const amount = parseDecimal(weight[1]);
  const unit = weight[2].toLowerCase();
  if (!Number.isFinite(amount)) return out;

  out.weight_g = unit === 'kg' ? roundTo2(amount * 1000) : amount;
  out.weight_kg = unit === 'kg' ? amount : roundTo2(amount / 1000);
  return out;
}

function extractVolumeAttributes(text) {
  const out = {};
  const volume = firstMatch(text, /(\d+(?:[,.]\d+)?)\s*(ml|l)\b/i);
  if (!volume) return out;

  const amount = parseDecimal(volume[1]);
  const unit = volume[2].toLowerCase();
  if (!Number.isFinite(amount)) return out;

  out.volume_ml = unit === 'l' ? roundTo2(amount * 1000) : amount;
  out.volume_l = unit === 'l' ? amount : roundTo2(amount / 1000);
  return out;
}

export function extractOfferAttributes(title) {
  const text = String(title || '');
  return {
    ...extractRamAttributes(text),
    ...extractVariantAttributes(text),
    ...extractPackageAttributes(text),
    ...extractWeightAttributes(text),
    ...extractVolumeAttributes(text),
  };
}

export function quantityForUnitRule(attributes, unitRule) {
  const basis = unitRule?.basis;
  if (!basis || !attributes) return null;

  if (basis === 'gb') return positiveFiniteNumber(attributes.capacity_total_gb);
  if (basis === 'unit') return positiveFiniteNumber(attributes.package_count);
  if (basis === 'g') return positiveFiniteNumber(attributes.weight_g);
  if (basis === 'kg') return positiveFiniteNumber(attributes.weight_kg);
  if (basis === 'ml') return positiveFiniteNumber(attributes.volume_ml);
  if (basis === 'l') return positiveFiniteNumber(attributes.volume_l);

  return null;
}

export function computeUnitPrice(price, attributes, unitRule) {
  const numericPrice = positiveFiniteNumber(price);
  const quantity = quantityForUnitRule(attributes, unitRule);
  if (numericPrice === null || quantity === null) return null;
  return roundUnitPrice(numericPrice / quantity, unitRule?.basis);
}
