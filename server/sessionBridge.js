/** Translates persisted-session WebSocket commands into response events. */
export async function dispatchSessionCommand(message, store) {
  switch (message.type) {
    case 'get_sessions':
      return { type: 'session_list', sessions: await store.listSessions() };
    case 'load_session':
      return {
        type: 'session_history',
        sessionId: message.sessionId,
        messages: await store.loadSession(message.sessionId),
      };
    case 'delete_session':
      await store.deleteSession(message.sessionId);
      return { type: 'session_deleted', sessionId: message.sessionId };
    default:
      return null;
  }
}
