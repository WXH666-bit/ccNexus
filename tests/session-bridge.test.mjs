import test from 'node:test';
import assert from 'node:assert/strict';
import { dispatchSessionCommand } from '../server/sessionBridge.js';

test('get_sessions returns the persisted session list', async () => {
  const sessions = [{ id: 's1', title: 'First', updatedAt: 10 }];
  const event = await dispatchSessionCommand({ type: 'get_sessions' }, {
    listSessions: async () => sessions,
  });

  assert.deepEqual(event, { type: 'session_list', sessions });
});

test('get_sessions can include sessions removed by external Claude Code cleanup', async () => {
  const sessions = [{ id: 's1', title: 'First', updatedAt: 10 }];
  const event = await dispatchSessionCommand({ type: 'get_sessions' }, {}, {
    syncSessions: async () => ({ sessions, deletedSessionIds: ['stale-session'] }),
  });

  assert.deepEqual(event, { type: 'session_list', sessions, deletedSessionIds: ['stale-session'] });
});

test('load_session returns the requested persisted messages', async () => {
  const messages = [{ id: 'm1', role: 'user', content: [], timestamp: 10, sessionId: 's1' }];
  const event = await dispatchSessionCommand({ type: 'load_session', sessionId: 's1' }, {
    loadSession: async (sessionId) => {
      assert.equal(sessionId, 's1');
      return messages;
    },
  });

  assert.deepEqual(event, { type: 'session_history', sessionId: 's1', messages });
});

test('load_session falls back to Claude JSONL history when ccnexus has no cached messages', async () => {
  const claudeMessages = [{ id: 'm1', role: 'user', content: [{ type: 'text', text: 'from jsonl' }], timestamp: 10, sessionId: 's1' }];
  const event = await dispatchSessionCommand({ type: 'load_session', sessionId: 's1' }, {
    loadSession: async () => [],
  }, {
    loadClaudeSessionMessages: async (sessionId) => {
      assert.equal(sessionId, 's1');
      return claudeMessages;
    },
  });

  assert.deepEqual(event, { type: 'session_history', sessionId: 's1', messages: claudeMessages });
});

test('load_session returns a cleaned session list when the requested session was externally deleted', async () => {
  const event = await dispatchSessionCommand({ type: 'load_session', sessionId: 'stale-session' }, {}, {
    syncSessions: async () => ({
      sessions: [{ id: 'fresh-session', title: 'Fresh', updatedAt: 20 }],
      deletedSessionIds: ['stale-session'],
    }),
  });

  assert.deepEqual(event, {
    type: 'session_list',
    sessions: [{ id: 'fresh-session', title: 'Fresh', updatedAt: 20 }],
    deletedSessionIds: ['stale-session'],
  });
});

test('delete_session removes the persisted session and confirms its id', async () => {
  let deletedId;
  const event = await dispatchSessionCommand({ type: 'delete_session', sessionId: 's1' }, {
    deleteSession: async (sessionId) => { deletedId = sessionId; },
  });

  assert.equal(deletedId, 's1');
  assert.deepEqual(event, { type: 'session_deleted', sessionId: 's1' });
});

test('unrelated commands are not handled by the session bridge', async () => {
  assert.equal(await dispatchSessionCommand({ type: 'chat' }, {}), null);
});
