/**
 * Requests displayable summaries from models that emit thinking blocks. This
 * form stays compatible with the current Claude Code provider, unlike a fixed
 * budget which the provider rejects.
 */
export function buildThinkingOptions(requestedEffort) {
  const validEfforts = new Set(['low', 'medium', 'high', 'xhigh', 'max']);
  return {
    thinking: { type: 'adaptive', display: 'summarized' },
    effort: validEfforts.has(requestedEffort) ? requestedEffort : 'high',
  };
}
