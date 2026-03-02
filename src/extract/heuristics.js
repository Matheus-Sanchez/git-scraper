const INSTALLMENT_RE = /(parcela|parcelado|\bx\s*de\b|mensal|assinatura|sem\s+juros|juros|m\u00EAs|m\u00EAses|anual)/i;
const OLD_PRICE_RE = /(^|\s)(de\s*:?)\s*R?\$?/i;
const CURRENT_PRICE_RE = /(\bpor\b|\bagora\b|\bpre\u00E7o\s+final\b|\bpre\u00E7o\s+atual\b)/i;
const PIX_BOLETO_HINT_RE = /(pix|boleto|\u00E0\s+vista|a\s+vista)/i;

export const SOURCE_CONFIDENCE = Object.freeze({
  'json-ld': 0.92,
  meta: 0.85,
  adapter: 0.8,
  selector: 0.7,
  regex: 0.58,
});

const SOURCE_PRIORITY = Object.freeze({
  'json-ld': 5,
  meta: 4,
  adapter: 3,
  selector: 2,
  regex: 1,
});

export function isCandidatePricePlausible(price) {
  return Number.isFinite(price) && price > 0 && price < 1_000_000;
}

export function hasInstallmentContext(text) {
  if (!text) return false;
  return INSTALLMENT_RE.test(String(text));
}

export function hasOldPriceContext(text) {
  if (!text) return false;
  return OLD_PRICE_RE.test(String(text));
}

export function hasCurrentPriceContext(text) {
  if (!text) return false;
  return CURRENT_PRICE_RE.test(String(text));
}

export function hasPixBoletoHint(text) {
  if (!text) return false;
  return PIX_BOLETO_HINT_RE.test(String(text));
}

export function confidenceBaseBySource(source) {
  return SOURCE_CONFIDENCE[source] ?? 0.5;
}

export function priorityBySource(source) {
  return SOURCE_PRIORITY[source] ?? 0;
}

export function clampConfidence(value) {
  return Math.min(0.99, Math.max(0.1, value));
}

export function contextAdjustment(text) {
  const context = String(text || '');

  if (hasInstallmentContext(context)) return -0.15;

  let adjust = 0;
  if (hasCurrentPriceContext(context)) adjust += 0.05;
  if (hasOldPriceContext(context) && !hasCurrentPriceContext(context)) adjust -= 0.08;
  if (hasPixBoletoHint(context)) adjust += 0.02;

  return adjust;
}