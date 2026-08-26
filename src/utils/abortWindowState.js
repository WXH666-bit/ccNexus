export function beginAbortWindow(sessionId) {
  return { sessionId: sessionId || null };
}

export function completeAbortWindow(stopping, event) {
  if (!stopping
      || event?.type !== 'status'
      || event.status !== 'idle'
      || event.reason !== 'abort-complete') return stopping;
  if (stopping.sessionId && event.sessionId && event.sessionId !== stopping.sessionId) return stopping;
  return null;
}

export function shouldQueueChatMessage({ isStreaming, stopping }) {
  return isStreaming === true || stopping !== null;
}

export function createQueuedChatMessage(message) {
  return {
    id: message.id,
    text: message.text,
    timestamp: message.timestamp,
    attachments: message.attachments || [],
    reasoningEffort: message.reasoningEffort,
    agent: message.agent,
    streaming: message.streaming,
    alwaysThinking: message.alwaysThinking,
    modelOverride: message.modelOverride,
    displayText: message.displayText,
    uiVisibility: message.uiVisibility,
  };
}

export function queuedChatMessageToSendArgs(message) {
  return [
    message.text,
    message.attachments || [],
    false,
    message.reasoningEffort,
    message.agent,
    message.streaming,
    message.alwaysThinking,
    message.modelOverride,
    message.displayText,
    message.uiVisibility,
  ];
}
