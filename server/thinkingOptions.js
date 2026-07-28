const SUPPORTED_EFFORT_LEVELS = new Set(['low', 'medium', 'high', 'xhigh', 'max']);

export function normalizeReasoningEffort(requestedEffort) {
  const effort = typeof requestedEffort === 'string' ? requestedEffort.trim() : '';
  return SUPPORTED_EFFORT_LEVELS.has(effort) ? effort : undefined;
}

function resolveConfiguredMaxThinkingTokens(configuredMaxThinkingTokens) {
  return configuredMaxThinkingTokens
    || parseInt(process.env.MAX_THINKING_TOKENS || '0', 10)
    || 10000;
}

export function buildThinkingOptions(requestedEffort, options = {}) {
  const reasoningEffort = normalizeReasoningEffort(requestedEffort);
  if (reasoningEffort) return { effort: reasoningEffort };

  if (options.disableThinking === true) return { maxThinkingTokens: 0 };

  const alwaysThinkingEnabled = options.alwaysThinkingEnabled ?? false;
  if (!alwaysThinkingEnabled) return {};

  return {
    maxThinkingTokens: resolveConfiguredMaxThinkingTokens(options.maxThinkingTokens),
  };
}
