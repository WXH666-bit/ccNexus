export function sessionEvent(sessionId) {
  return { type: 'session', sessionId };
}

export function streamEvent(event, sessionId, uuid) {
  return { type: 'stream_event', event, sessionId, uuid };
}

export function assistantEvent(message) {
  return {
    type: 'assistant',
    message: {
      id: message.id,
      content: message.content,
      sessionId: message.sessionId,
    },
  };
}

export function permissionRequestEvent({ requestId, toolName, input }) {
  return { type: 'permission_request', requestId, toolName, input };
}
