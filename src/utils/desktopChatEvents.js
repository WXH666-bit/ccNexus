function nonEmptyString(value) {
  return typeof value === 'string' && value.trim() ? value : undefined;
}

/**
 * Normalize the small amount of naming drift between Claude SDK events and
 * the renderer protocol. ccgui keeps the session identity on every callback;
 * the desktop renderer needs the same invariant before it mutates state.
 */
export function normalizeDesktopChatEvent(input) {
  if (!input || typeof input !== 'object') return input;

  const event = { ...input };
  const nestedMessage = event.message && typeof event.message === 'object'
    ? { ...event.message }
    : null;

  if (event.sessionId === undefined) {
    event.sessionId = nonEmptyString(event.session_id);
  }

  if (event.type === 'assistant' && nestedMessage) {
    if (nestedMessage.sessionId === undefined) {
      nestedMessage.sessionId = nonEmptyString(nestedMessage.session_id) || event.sessionId;
    }
    if (event.sessionId === undefined) {
      event.sessionId = nestedMessage.sessionId;
    }
    event.message = nestedMessage;
  }

  if (event.type === 'tool_progress') {
    event.toolName = event.toolName ?? event.tool_name;
    event.toolUseId = event.toolUseId ?? event.tool_use_id;
    event.elapsed = event.elapsed ?? event.elapsed_time_seconds;
  }

  if (event.type === 'tool_result') {
    event.toolUseId = event.toolUseId ?? event.tool_use_id;
  }

  return event;
}

export function getDesktopEventSessionId(event) {
  if (!event || typeof event !== 'object') return undefined;

  const direct = nonEmptyString(event.sessionId)
    || nonEmptyString(event.session_id)
    || nonEmptyString(event.session?.id);
  if (direct) return direct;

  const message = event.message;
  if (message && typeof message === 'object') {
    return nonEmptyString(message.sessionId) || nonEmptyString(message.session_id);
  }

  return undefined;
}

/**
 * Events without a session id are global notifications. A session-scoped
 * event is accepted only by its owning chat, matching ccgui's callback guards.
 */
export function isDesktopEventForSession(event, sessionId) {
  const eventSessionId = getDesktopEventSessionId(event);
  if (!eventSessionId || !sessionId) return true;
  return eventSessionId === sessionId;
}
