export function sessionEvent(sessionId) {
  return { type: 'session', sessionId };
}

export function streamEvent(event, sessionId, uuid) {
  return { type: 'stream_event', event, sessionId, uuid };
}

export function assistantEvent({ id, content, sessionId, model, usage, cost, duration, turns }) {
  const message = {
    id,
    content,
    sessionId,
  };

  for (const [key, value] of Object.entries({ model, usage, cost, duration, turns })) {
    if (value !== undefined) message[key] = value;
  }

  return {
    type: 'assistant',
    sessionId,
    message,
  };
}

export function permissionRequestEvent({ requestId, toolName, input, title, displayName, sessionId }) {
  const event = { type: 'permission_request', requestId, toolName, input };
  if (title !== undefined) event.title = title;
  if (displayName !== undefined) event.displayName = displayName;
  if (sessionId !== undefined) event.sessionId = sessionId;
  return event;
}
