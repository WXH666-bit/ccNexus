/** True only when Claude Code says a previously persisted session no longer exists. */
export function isMissingClaudeConversationError(message) {
  return typeof message === 'string'
    && /no conversation found with session id/i.test(message);
}

/** Keeps invalidation data and the visible error in one WebSocket message. */
export function staleSessionErrorEvent(message, invalidSessionId) {
  return { type: 'error', message, invalidSessionId };
}
