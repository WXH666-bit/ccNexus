export const MODEL_CONTEXT_LIMITS = {
  'claude-sonnet-5': 200_000,
  'claude-sonnet-4-6': 200_000,
  'claude-fable-5': 200_000,
  'claude-opus-4-8': 200_000,
  'claude-opus-4-6': 200_000,
  'claude-sonnet-5[1m]': 1_000_000,
  'claude-sonnet-4-6[1m]': 1_000_000,
  'claude-fable-5[1m]': 1_000_000,
  'claude-opus-4-8[1m]': 1_000_000,
  'claude-opus-4-6[1m]': 1_000_000,
  'claude-haiku-4-5': 200_000,
  'gpt-5.6-sol': 1_050_000,
  'gpt-5.6-terra': 1_050_000,
  'gpt-5.6-luna': 1_050_000,
  'gpt-5.4': 1_000_000,
  'gpt-5.4-mini': 400_000,
  'gpt-5.3-codex': 258_000,
  'gpt-5.2-codex': 258_000,
  'gpt-5.2': 258_000,
  'gpt-5.1': 128_000,
  'gpt-5.1-codex': 128_000,
  'gpt-4o': 128_000,
  'gpt-4o-mini': 128_000,
  'gpt-4-turbo': 128_000,
  'gpt-4': 8_192,
  o3: 200_000,
  'o3-mini': 200_000,
  o1: 200_000,
  'o1-mini': 128_000,
  'o1-preview': 128_000,
};

function finiteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

export function getModelContextLimit(model) {
  if (typeof model !== 'string' || model.trim() === '') return 200_000;
  const normalized = model.trim();
  const capacityMatch = normalized.match(/\s*\[([0-9.]+)([kKmM])\]\s*$/);

  if (capacityMatch) {
    const value = Number.parseFloat(capacityMatch[1]);
    const unit = capacityMatch[2].toLowerCase();
    if (Number.isFinite(value)) {
      return Math.round(value * (unit === 'm' ? 1_000_000 : 1_000));
    }
  }

  return MODEL_CONTEXT_LIMITS[normalized] ?? 200_000;
}

export function calculateContextPercentage(usedTokens, maxTokens) {
  const used = finiteNumber(usedTokens);
  const max = finiteNumber(maxTokens);
  if (used <= 0 || max <= 0) return 0;
  return Math.min(100, (used * 100) / max);
}

export function extractUsedTokens(usage, provider = 'claude') {
  if (!usage || typeof usage !== 'object') return 0;
  const input = finiteNumber(usage.input_tokens);
  const output = finiteNumber(usage.output_tokens);
  if (provider === 'codex') return input + output;
  return input
    + output
    + finiteNumber(usage.cache_creation_input_tokens)
    + finiteNumber(usage.cache_read_input_tokens);
}

function isCompleteUsage(usage) {
  if (!usage || typeof usage !== 'object') return false;
  return [
    'input_tokens',
    'cache_creation_input_tokens',
    'cache_read_input_tokens',
  ].some(key => typeof usage[key] === 'number');
}

export function extractUsageFromSdkEvent(event) {
  const candidates = [
    event?.message?.usage,
    event?.usage,
    event?.event?.message?.usage,
    event?.event?.usage,
  ];
  return candidates.find(isCompleteUsage) ?? null;
}

export function createUsageUpdate({ usage, provider = 'claude', model }) {
  const usedTokens = extractUsedTokens(usage, provider);
  const maxTokens = getModelContextLimit(model);
  return {
    type: 'usage_update',
    percentage: calculateContextPercentage(usedTokens, maxTokens),
    totalTokens: usedTokens,
    limit: maxTokens,
    usedTokens,
    maxTokens,
  };
}
