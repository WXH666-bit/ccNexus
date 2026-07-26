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
