/** Translates persisted-session WebSocket commands into response events. */
import { sessionListEventFromSync } from './sessionSync.js';

export async function dispatchSessionCommand(message, store, options = {}) {
  switch (message.type) {
    case 'get_sessions':
      return sessionListEventFromSync(options.syncSessions
        ? await options.syncSessions()
        : { sessions: await store.listSessions(), deletedSessionIds: [] });
    case 'load_session': {
      if (options.syncSessions) {
        const result = await options.syncSessions();
        if (result.deletedSessionIds.includes(message.sessionId)) {
          return sessionListEventFromSync(result);
        }
      }
      let messages = await store.loadSession(message.sessionId);
      if (messages.length === 0 && options.loadClaudeSessionMessages) {
        messages = await options.loadClaudeSessionMessages(message.sessionId);
      }
      return {
        type: 'session_history',
        sessionId: message.sessionId,
        messages,
      };
    }
    case 'delete_session':
      await store.deleteSession(message.sessionId);
      return { type: 'session_deleted', sessionId: message.sessionId };
    default:
      return null;
  }
}
