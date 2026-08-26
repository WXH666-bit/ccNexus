import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { encodeClaudeProjectPath } from '../server/claudeProjectPaths.js';

const root = new URL('../', import.meta.url);
const read = (filePath) => readFileSync(new URL(filePath, root), 'utf8');
const projectIndexPath = (sessionsDir, cwd) => path.join(
  sessionsDir,
  'projects',
  `${encodeClaudeProjectPath(cwd)}.json`,
);

async function writeProjectIndex(sessionsDir, cwd, sessions) {
  const filePath = projectIndexPath(sessionsDir, cwd);
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, JSON.stringify({ version: 1, projectPath: cwd, sessions }), 'utf8');
}

test('desktop main and preload expose session history IPC', () => {
  const main = read('desktop/main.js');
  const preload = read('desktop/preload.cjs');

  assert.match(main, /DesktopSessionService/);
  assert.match(main, /ipcMain\.handle\('desktop:get-sessions'/);
  assert.match(main, /ipcMain\.handle\('desktop:load-session'/);
  assert.match(main, /ipcMain\.handle\('desktop:rename-session'/);
  assert.match(main, /ipcMain\.handle\('desktop:toggle-favorite-session'/);
  assert.match(main, /ipcMain\.handle\('desktop:delete-session'/);
  assert.match(main, /async function switchWorkspace/);
  assert.match(main, /chatController\.resetForWorkspaceChange\(\)/);
  assert.match(main, /ipcMain\.handle\('desktop:get-usage-statistics',[\s\S]*args/);
  assert.match(preload, /getSessions:/);
  assert.match(preload, /loadSession:/);
  assert.match(preload, /renameSession:/);
  assert.match(preload, /deleteSession:/);
  assert.match(main, /messages:\s*visibleSessionMessages\(history\.messages\)/);
});

test('visible session projection hides internal handoffs and interruption artifacts', async () => {
  const { visibleSessionMessages } = await import('../desktop/runtime/sessionService.js');
  const visible = visibleSessionMessages([
    { id: 'visible', role: 'user', content: [{ type: 'text', text: 'keep me' }] },
    { id: 'hidden', role: 'user', uiVisibility: 'hidden', content: [{ type: 'text', text: 'private evidence' }] },
    { id: 'interrupted', role: 'user', content: [{ type: 'text', text: '[Request interrupted by user]' }] },
    { id: 'no-response', role: 'assistant', content: [{ type: 'text', text: 'No response requested.' }] },
  ]);

  assert.deepEqual(visible.map(message => message.id), ['visible']);
});

test('persisting a hidden research turn keeps the existing session title', async () => {
  const { DesktopSessionService } = await import('../desktop/runtime/sessionService.js');
  const homeDir = await mkdtemp(path.join(os.tmpdir(), 'ccnexus-hidden-session-'));
  const sessionsDir = path.join(homeDir, '.ccnexus', 'sessions');

  try {
    await mkdir(sessionsDir, { recursive: true });
    await writeProjectIndex(sessionsDir, homeDir, [{ id: 's1', title: 'Original task', updatedAt: 10 }]);
    await writeFile(path.join(sessionsDir, 's1.json'), '[]', 'utf8');
    const service = new DesktopSessionService({ homeDir, cwd: homeDir });

    await service.appendMessage('s1', {
      id: 'hidden-research',
      role: 'user',
      uiVisibility: 'hidden',
      content: [{ type: 'text', text: '<ccnexus-internal-web-research>private</ccnexus-internal-web-research>' }],
      timestamp: 20,
    });

    assert.equal((await service.getSessions()).sessions[0].title, 'Original task');
    assert.equal((await service.loadSession('s1')).messages[0].uiVisibility, 'hidden');
  } finally {
    await rm(homeDir, { recursive: true, force: true });
  }
});

test('client session api uses desktop IPC without a browser fallback', () => {
  const api = read('src/utils/sessionBridgeApi.ts');
  const chat = read('src/views/ChatView.tsx');
  const history = read('src/views/HistoryView.tsx');

  assert.match(api, /requireDesktopApi\(\)\.getSessions/);
  assert.match(api, /requireDesktopApi\(\)\.loadSession/);
  assert.match(api, /requireDesktopApi\(\)\.renameSession/);
  assert.match(api, /requireDesktopApi\(\)\.deleteSession/);
  assert.doesNotMatch(api, /fetch\(/);
  assert.match(chat, /getSessions\(\)/);
  assert.match(chat, /loadSession\(sessionId\)/);
  assert.match(history, /getSessions\(\)/);
  assert.match(history, /renameSession\(id, editValue\.trim\(\)\)/);
  assert.match(history, /toggleFavoriteSession/);
  assert.match(history, /deleteSession\(id\)/);
});

test('desktop session service lists, loads, renames and deletes persisted sessions', async () => {
  const { DesktopSessionService } = await import('../desktop/runtime/sessionService.js');
  const homeDir = await mkdtemp(path.join(os.tmpdir(), 'ccnexus-session-service-'));
  const sessionsDir = path.join(homeDir, '.ccnexus', 'sessions');

  try {
    await mkdir(sessionsDir, { recursive: true });
    await writeProjectIndex(sessionsDir, homeDir, [{ id: 's1', title: 'First', updatedAt: 20 }]);
    await writeFile(
      path.join(sessionsDir, 's1.json'),
      JSON.stringify([{ id: 'm1', role: 'user', content: [{ type: 'text', text: 'hello' }], timestamp: 10, sessionId: 's1' }]),
      'utf8',
    );

    const service = new DesktopSessionService({ homeDir, cwd: homeDir });
    assert.deepEqual(await service.getSessions(), {
      type: 'session_list',
      sessions: [{ id: 's1', title: 'First', updatedAt: 20 }],
      deletedSessionIds: [],
    });

    const history = await service.loadSession('s1');
    assert.equal(history.type, 'session_history');
    assert.equal(history.messages[0].content[0].text, 'hello');

    const renamed = await service.renameSession('s1', 'Renamed');
    assert.deepEqual(renamed, { type: 'session_renamed', session_id: 's1', title: 'Renamed' });
    assert.equal((await service.getSessions()).sessions[0].title, 'Renamed');

    const favorited = await service.toggleFavoriteSession('s1');
    assert.equal(favorited.type, 'session_favorite_changed');
    assert.equal(favorited.isFavorite, true);
    assert.equal((await service.getSessions()).sessions[0].isFavorite, true);
    await service.toggleFavoriteSession('s1');
    assert.equal((await service.getSessions()).sessions[0].isFavorite, false);

    const deleted = await service.deleteSession('s1');
    assert.deepEqual(deleted, { type: 'session_deleted', sessionId: 's1' });
    assert.deepEqual((await service.getSessions()).sessions, []);
  } finally {
    await rm(homeDir, { recursive: true, force: true });
  }
});

test('desktop session service syncs with Claude project JSONL history without touching Claude config', async () => {
  const { DesktopSessionService } = await import('../desktop/runtime/sessionService.js');
  const homeDir = await mkdtemp(path.join(os.tmpdir(), 'ccnexus-desktop-claude-history-'));
  const cwd = path.join(homeDir, 'workspace');
  const sessionsDir = path.join(homeDir, '.ccnexus', 'sessions');
  const claudeProjectDir = path.join(homeDir, '.claude', 'projects', encodeClaudeProjectPath(cwd));

  try {
    await mkdir(sessionsDir, { recursive: true });
    await mkdir(claudeProjectDir, { recursive: true });
    await writeProjectIndex(sessionsDir, cwd, [
      { id: 'kept-session', title: 'Keep', updatedAt: 20 },
      { id: 'deleted-session', title: 'Delete', updatedAt: 10 },
    ]);
    await writeFile(path.join(sessionsDir, 'kept-session.json'), '[]', 'utf8');
    await writeFile(path.join(sessionsDir, 'deleted-session.json'), '[]', 'utf8');
    await writeFile(path.join(claudeProjectDir, 'kept-session.jsonl'), '{}\n', 'utf8');
    await writeFile(
      path.join(claudeProjectDir, 'claude-only.jsonl'),
      JSON.stringify({
        type: 'user',
        uuid: 'u1',
        timestamp: '2026-07-27T01:00:00.000Z',
        sessionId: 'claude-only',
        message: { role: 'user', content: 'Imported from Claude history' },
      }),
      'utf8',
    );

    const service = new DesktopSessionService({ homeDir, cwd });
    const list = await service.getSessions();

    assert.equal(list.type, 'session_list');
    assert.deepEqual(list.deletedSessionIds, ['deleted-session']);
    assert.deepEqual(
      list.sessions.map((session) => session.id).sort(),
      ['claude-only', 'kept-session'],
    );

    const imported = await service.loadSession('claude-only');
    assert.equal(imported.type, 'session_history');
    assert.equal(imported.messages[0].content[0].text, 'Imported from Claude history');
  } finally {
    await rm(homeDir, { recursive: true, force: true });
  }
});

test('desktop session service prefers the current Claude JSONL over stale ccnexus cache', async () => {
  const { DesktopSessionService } = await import('../desktop/runtime/sessionService.js');
  const homeDir = await mkdtemp(path.join(os.tmpdir(), 'ccnexus-desktop-refresh-history-'));
  const cwd = path.join(homeDir, 'workspace');
  const sessionsDir = path.join(homeDir, '.ccnexus', 'sessions');
  const claudeProjectDir = path.join(homeDir, '.claude', 'projects', encodeClaudeProjectPath(cwd));

  try {
    await mkdir(sessionsDir, { recursive: true });
    await mkdir(claudeProjectDir, { recursive: true });
    await writeProjectIndex(sessionsDir, cwd, [{ id: 'session-1', title: 'Current', updatedAt: 20 }]);
    await writeFile(path.join(sessionsDir, 'session-1.json'), JSON.stringify([
      { id: 'cached-message', role: 'user', content: [{ type: 'text', text: 'stale cache' }], timestamp: 10, sessionId: 'session-1' },
    ]), 'utf8');
    await writeFile(path.join(claudeProjectDir, 'session-1.jsonl'), JSON.stringify({
      type: 'user',
      uuid: 'claude-message',
      timestamp: '2026-07-27T01:00:00.000Z',
      sessionId: 'session-1',
      message: { role: 'user', content: 'fresh Claude history' },
    }), 'utf8');

    const service = new DesktopSessionService({ homeDir, cwd });
    const history = await service.loadSession('session-1');

    assert.equal(history.messages.length, 1);
    assert.equal(history.messages[0].content[0].text, 'fresh Claude history');
  } finally {
    await rm(homeDir, { recursive: true, force: true });
  }
});

test('desktop session service recovers Claude JSONL history when the ccnexus index is malformed', async () => {
  const { DesktopSessionService } = await import('../desktop/runtime/sessionService.js');
  const homeDir = await mkdtemp(path.join(os.tmpdir(), 'ccnexus-desktop-bad-index-'));
  const cwd = path.join(homeDir, 'workspace');
  const sessionsDir = path.join(homeDir, '.ccnexus', 'sessions');
  const claudeProjectDir = path.join(homeDir, '.claude', 'projects', encodeClaudeProjectPath(cwd));

  try {
    await mkdir(sessionsDir, { recursive: true });
    await mkdir(claudeProjectDir, { recursive: true });
    await mkdir(path.dirname(projectIndexPath(sessionsDir, cwd)), { recursive: true });
    await writeFile(projectIndexPath(sessionsDir, cwd), '[]  {"id":"corrupt-tail"}]', 'utf8');
    await writeFile(
      path.join(claudeProjectDir, 'recovered-session.jsonl'),
      JSON.stringify({
        type: 'user',
        uuid: 'u1',
        timestamp: '2026-07-27T01:00:00.000Z',
        sessionId: 'recovered-session',
        message: { role: 'user', content: 'Recovered from Claude history' },
      }),
      'utf8',
    );

    const service = new DesktopSessionService({ homeDir, cwd });
    const list = await service.getSessions();

    assert.equal(list.type, 'session_list');
    assert.deepEqual(list.deletedSessionIds, []);
    assert.deepEqual(list.sessions.map((session) => session.id), ['recovered-session']);
    const projectIndexFile = projectIndexPath(sessionsDir, cwd);
    assert.deepEqual(
      JSON.parse(readFileSync(projectIndexFile, 'utf8')).sessions.map((session) => session.id),
      ['recovered-session'],
    );
  } finally {
    await rm(homeDir, { recursive: true, force: true });
  }
});

test('desktop session service keeps cached sessions when Claude JSONL is absent for the current workspace', async () => {
  const { DesktopSessionService } = await import('../desktop/runtime/sessionService.js');
  const homeDir = await mkdtemp(path.join(os.tmpdir(), 'ccnexus-desktop-keep-cache-'));
  const cwd = path.join(homeDir, 'workspace');
  const sessionsDir = path.join(homeDir, '.ccnexus', 'sessions');
  const claudeProjectDir = path.join(homeDir, '.claude', 'projects', encodeClaudeProjectPath(cwd));

  try {
    await mkdir(sessionsDir, { recursive: true });
    await mkdir(claudeProjectDir, { recursive: true });
    await writeProjectIndex(sessionsDir, cwd, [{ id: 'cached-only', title: 'Cached', updatedAt: 20 }]);
    await writeFile(
      path.join(sessionsDir, 'cached-only.json'),
      JSON.stringify([{ id: 'm1', role: 'user', content: [{ type: 'text', text: 'cached' }], timestamp: 10, sessionId: 'cached-only' }]),
      'utf8',
    );

    const service = new DesktopSessionService({ homeDir, cwd });
    const list = await service.getSessions();

    assert.deepEqual(list.deletedSessionIds, []);
    assert.deepEqual(list.sessions.map((session) => session.id), ['cached-only']);
    assert.equal((await service.loadSession('cached-only')).messages[0].content[0].text, 'cached');
  } finally {
    await rm(homeDir, { recursive: true, force: true });
  }
});

test('desktop session service does not load an unindexed cached session after switching workspaces', async () => {
  const { DesktopSessionService } = await import('../desktop/runtime/sessionService.js');
  const homeDir = await mkdtemp(path.join(os.tmpdir(), 'ccnexus-desktop-unindexed-session-'));
  const workspaceA = path.join(homeDir, 'workspace-a');
  const workspaceB = path.join(homeDir, 'workspace-b');
  const sessionsDir = path.join(homeDir, '.ccnexus', 'sessions');

  try {
    await mkdir(workspaceA, { recursive: true });
    await mkdir(workspaceB, { recursive: true });
    await mkdir(sessionsDir, { recursive: true });
    await writeProjectIndex(sessionsDir, workspaceA, [
      { id: 'session-a', title: 'Workspace A', updatedAt: 20 },
    ]);
    await writeFile(path.join(sessionsDir, 'session-a.json'), JSON.stringify([
      { id: 'message-a', role: 'user', content: [{ type: 'text', text: 'A' }], timestamp: 10, sessionId: 'session-a' },
    ]), 'utf8');

    const service = new DesktopSessionService({ homeDir, cwd: workspaceB });
    const history = await service.loadSession('session-a');

    assert.deepEqual(history, {
      type: 'session_history',
      sessionId: 'session-a',
      messages: [],
    });
  } finally {
    await rm(homeDir, { recursive: true, force: true });
  }
});

test('desktop session service isolates cached sessions by workspace when switching directories', async () => {
  const { DesktopSessionService } = await import('../desktop/runtime/sessionService.js');
  const homeDir = await mkdtemp(path.join(os.tmpdir(), 'ccnexus-desktop-workspace-sessions-'));
  const workspaceA = path.join(homeDir, 'workspace-a');
  const workspaceB = path.join(homeDir, 'workspace-b');
  const sessionsDir = path.join(homeDir, '.ccnexus', 'sessions');

  try {
    await mkdir(workspaceA, { recursive: true });
    await mkdir(workspaceB, { recursive: true });
    await mkdir(sessionsDir, { recursive: true });
    await writeProjectIndex(sessionsDir, workspaceA, [
      { id: 'session-a', title: 'Workspace A', updatedAt: 20 },
    ]);
    await writeProjectIndex(sessionsDir, workspaceB, [
      { id: 'session-b', title: 'Workspace B', updatedAt: 10 },
    ]);
    await writeFile(path.join(sessionsDir, 'session-a.json'), JSON.stringify([
      { id: 'message-a', role: 'user', content: [{ type: 'text', text: 'A' }], timestamp: 10, sessionId: 'session-a' },
    ]), 'utf8');
    await writeFile(path.join(sessionsDir, 'session-b.json'), JSON.stringify([
      { id: 'message-b', role: 'user', content: [{ type: 'text', text: 'B' }], timestamp: 10, sessionId: 'session-b' },
    ]), 'utf8');

    const service = new DesktopSessionService({ homeDir, cwd: workspaceA });
    assert.deepEqual((await service.getSessions()).sessions.map((session) => session.id), ['session-a']);

    service.setCwd(workspaceB);
    assert.deepEqual((await service.getSessions()).sessions.map((session) => session.id), ['session-b']);

    service.setCwd(workspaceA);
    assert.deepEqual((await service.getSessions()).sessions.map((session) => session.id), ['session-a']);
  } finally {
    await rm(homeDir, { recursive: true, force: true });
  }
});

test('desktop session deletion removes the authoritative Claude JSONL for the active workspace', async () => {
  const { DesktopSessionService } = await import('../desktop/runtime/sessionService.js');
  const homeDir = await mkdtemp(path.join(os.tmpdir(), 'ccnexus-delete-claude-history-'));
  const cwd = path.join(homeDir, 'workspace');
  const claudeProjectDir = path.join(homeDir, '.claude', 'projects', encodeClaudeProjectPath(cwd));

  try {
    await mkdir(claudeProjectDir, { recursive: true });
    await writeFile(
      path.join(claudeProjectDir, 'claude-session.jsonl'),
      JSON.stringify({
        type: 'user',
        uuid: 'u1',
        sessionId: 'claude-session',
        message: { role: 'user', content: 'Delete me' },
      }),
      'utf8',
    );

    const service = new DesktopSessionService({ homeDir, cwd });
    assert.deepEqual((await service.getSessions()).sessions.map((session) => session.id), ['claude-session']);
    await service.deleteSession('claude-session');

    assert.deepEqual((await service.getSessions()).sessions, []);
  } finally {
    await rm(homeDir, { recursive: true, force: true });
  }
});
