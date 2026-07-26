import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createSessionStore } from '../server/sessionStore.js';
import { encodeClaudeProjectPath, syncSessionStoreWithClaude } from '../server/sessionSync.js';

async function withTempDir(run) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'ccnexus-session-sync-'));
  try {
    await run(directory);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
}

test('encodes the current cwd the same way Claude Code names project session folders', () => {
  assert.equal(encodeClaudeProjectPath('D:\\ccNexus'), 'D--ccNexus');
  assert.equal(encodeClaudeProjectPath('C:\\Users\\18246'), 'C--Users-18246');
});

test('removes local sessions whose Claude Code jsonl file was externally deleted', async () => {
  await withTempDir(async (directory) => {
    const store = createSessionStore(path.join(directory, 'ccnexus'));
    const claudeProjectDir = path.join(directory, 'claude-project');
    await fs.mkdir(claudeProjectDir, { recursive: true });

    await store.saveSession({ id: 'existing-session', title: 'Keep', updatedAt: 20 });
    await store.saveSession({ id: 'deleted-session', title: 'Remove', updatedAt: 10 });
    await fs.writeFile(path.join(claudeProjectDir, 'existing-session.jsonl'), '{}\n', 'utf8');

    const result = await syncSessionStoreWithClaude(store, { claudeProjectDir });

    assert.deepEqual(result, {
      sessions: [{ id: 'existing-session', title: 'Keep', updatedAt: 20 }],
      deletedSessionIds: ['deleted-session'],
    });
    assert.deepEqual(await store.listSessions(), [
      { id: 'existing-session', title: 'Keep', updatedAt: 20 },
    ]);
  });
});

test('does not delete local history when the Claude project directory is unavailable', async () => {
  await withTempDir(async (directory) => {
    const store = createSessionStore(path.join(directory, 'ccnexus'));
    await store.saveSession({ id: 'session-1', title: 'Keep', updatedAt: 10 });

    const result = await syncSessionStoreWithClaude(store, {
      claudeProjectDir: path.join(directory, 'missing-claude-project'),
    });

    assert.deepEqual(result, {
      sessions: [{ id: 'session-1', title: 'Keep', updatedAt: 10 }],
      deletedSessionIds: [],
    });
  });
});

test('keeps active sessions even if their jsonl file is not visible yet', async () => {
  await withTempDir(async (directory) => {
    const store = createSessionStore(path.join(directory, 'ccnexus'));
    const claudeProjectDir = path.join(directory, 'claude-project');
    await fs.mkdir(claudeProjectDir, { recursive: true });
    await store.saveSession({ id: 'active-session', title: 'Active', updatedAt: 10 });

    const result = await syncSessionStoreWithClaude(store, {
      claudeProjectDir,
      protectedSessionIds: ['active-session'],
    });

    assert.deepEqual(result, {
      sessions: [{ id: 'active-session', title: 'Active', updatedAt: 10 }],
      deletedSessionIds: [],
    });
  });
});
