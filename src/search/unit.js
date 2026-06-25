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

function extractPackageAttributes(text) {
  const out = {};
  const count = firstMatch(text, /(\d+)\s*(?:un|unid|unidade|unidades|fralda|fraldas|pe[cç]a|pe[cç]as|pcs?)\b/i);
  const diaperSize = firstMatch(text, /\b(rn|xxgg|xxg|xg|g|m|p)\b/i);

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
    ...extractPackageAttributes(text),
    ...extractWeightAttributes(text),
    ...extractVolumeAttributes(text),
  };
}

export function quantityForUnitRule(attributes, unitRule) {
  const basis = unitRule?.basis;
  if (!basis || !attributes) return null;

  if (basis === 'gb') return attributes.capacity_total_gb || null;
  if (basis === 'unit') return attributes.package_count || null;
  if (basis === 'g') return attributes.weight_g || null;
  if (basis === 'kg') return attributes.weight_kg || null;
  if (basis === 'ml') return attributes.volume_ml || null;
  if (basis === 'l') return attributes.volume_l || null;

  return null;
}

export function computeUnitPrice(price, attributes, unitRule) {
  const numericPrice = Number(price);
  const quantity = quantityForUnitRule(attributes, unitRule);
  if (!Number.isFinite(numericPrice) || numericPrice <= 0) return null;
  if (!Number.isFinite(Number(quantity)) || Number(quantity) <= 0) return null;
  return roundUnitPrice(numericPrice / Number(quantity), unitRule?.basis);
}
