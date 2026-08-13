export function sessionEvent(sessionId, metadata = {}) {
  const event = { type: 'session', sessionId };
  if (metadata.title !== undefined) event.title = metadata.title;
  if (Number.isFinite(metadata.updatedAt)) event.updatedAt = metadata.updatedAt;
  return event;
}

export function streamEvent(event, sessionId, uuid) {
  return { type: 'stream_event', event, sessionId, uuid };
}

export function assistantEvent({
  id,
  content,
  sessionId,
  model,
  usage,
  cost,
  duration,
  turns,
  runtimeClassification,
  runtimeRetirementReason,
}) {
  const message = {
    id,
    content,
    sessionId,
  };

  for (const [key, value] of Object.entries({
    model,
    usage,
    cost,
    duration,
    turns,
    runtimeClassification,
    runtimeRetirementReason,
  })) {
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

export function planApprovalEvent(sessionId, request = {}) {
  return {
    type: 'plan_approval',
    sessionId,
    ...request,
  };
}

export function askUserQuestionEvent(sessionId, request = {}) {
  return {
    type: 'ask_user_question',
    sessionId,
    ...request,
  };
}

export function modeChangedEvent(sessionId, mode, source) {
  return {
    type: 'mode_changed',
    sessionId,
    mode,
    source,
  };
}
