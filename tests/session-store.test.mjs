import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createSessionStore } from '../server/sessionStore.js';

async function withStore(run) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'ccnexus-session-store-'));
  try {
    await run(createSessionStore(directory), directory);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
}

test('saveSession creates a session and listSessions returns it newest first', async () => {
  await withStore(async (store) => {
    await store.saveSession({ id: 'older', title: 'Older', updatedAt: 10 });
    await store.saveSession({ id: 'newer', title: 'Newer', updatedAt: 20 });

    assert.deepEqual(await store.listSessions(), [
      { id: 'newer', title: 'Newer', updatedAt: 20 },
      { id: 'older', title: 'Older', updatedAt: 10 },
    ]);
  });
});

test('appendMessage persists complete messages in a per-session file', async () => {
  await withStore(async (store, directory) => {
    const message = {
      id: 'user-1',
      role: 'user',
      content: [{ type: 'text', text: 'Hello' }],
      timestamp: 100,
      sessionId: 'session-1',
    };

    await store.saveSession({ id: 'session-1', title: 'Hello', updatedAt: 99 });
    await store.appendMessage('session-1', message);

    assert.deepEqual(await store.loadSession('session-1'), [message]);
    assert.deepEqual(JSON.parse(await fs.readFile(path.join(directory, 'session-1.json'), 'utf8')), [message]);
  });
});

test('appendMessage refreshes the session timestamp without changing its title', async () => {
  await withStore(async (store) => {
    await store.saveSession({ id: 'session-1', title: 'Keep this title', updatedAt: 10 });
    await store.appendMessage('session-1', { id: 'assistant-1', role: 'assistant', content: [], timestamp: 42 });

    assert.deepEqual(await store.listSessions(), [
      { id: 'session-1', title: 'Keep this title', updatedAt: 42 },
    ]);
  });
});

test('loadSession returns an empty array when a session has no message file', async () => {
  await withStore(async (store) => {
    assert.deepEqual(await store.loadSession('missing'), []);
  });
});

test('deleteSession removes the index entry and persisted message file', async () => {
  await withStore(async (store, directory) => {
    await store.saveSession({ id: 'session-1', title: 'Delete me', updatedAt: 10 });
    await store.saveSession({ id: 'session-2', title: 'Keep me', updatedAt: 12 });
    await store.appendMessage('session-1', { id: 'user-1', role: 'user', content: [], timestamp: 11 });

    await store.deleteSession('session-1');

    assert.deepEqual(await store.listSessions(), [
      { id: 'session-2', title: 'Keep me', updatedAt: 12 },
    ]);
    await assert.rejects(fs.readFile(path.join(directory, 'session-1.json'), 'utf8'), { code: 'ENOENT' });
  });
});

test('rejects reserved and traversal-like session ids before accessing storage', async () => {
  await withStore(async (store) => {
    for (const sessionId of ['_index', '../_index', '..\\_index']) {
      await assert.rejects(store.saveSession({ id: sessionId }), /Invalid session id/);
      await assert.rejects(store.appendMessage(sessionId, { id: 'message-1' }), /Invalid session id/);
      await assert.rejects(store.loadSession(sessionId), /Invalid session id/);
      await assert.rejects(store.deleteSession(sessionId), /Invalid session id/);
    }
  });
});
