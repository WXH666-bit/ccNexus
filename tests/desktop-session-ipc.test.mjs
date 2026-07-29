import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const root = new URL('../', import.meta.url);
const read = (filePath) => readFileSync(new URL(filePath, root), 'utf8');

test('desktop main and preload expose session history IPC', () => {
  const main = read('desktop/main.js');
  const preload = read('desktop/preload.cjs');

  assert.match(main, /DesktopSessionService/);
  assert.match(main, /ipcMain\.handle\('desktop:get-sessions'/);
  assert.match(main, /ipcMain\.handle\('desktop:load-session'/);
  assert.match(main, /ipcMain\.handle\('desktop:rename-session'/);
  assert.match(main, /ipcMain\.handle\('desktop:delete-session'/);
  assert.match(preload, /getSessions:/);
  assert.match(preload, /loadSession:/);
  assert.match(preload, /renameSession:/);
  assert.match(preload, /deleteSession:/);
});

test('client session api uses desktop IPC first and keeps HTTP fallback where available', () => {
  const api = read('src/utils/sessionBridgeApi.ts');
  const chat = read('src/views/ChatView.tsx');
  const history = read('src/views/HistoryView.tsx');

  assert.match(api, /window\.ccNexusDesktop\?\.getSessions/);
  assert.match(api, /window\.ccNexusDesktop\?\.loadSession/);
  assert.match(api, /window\.ccNexusDesktop\?\.renameSession/);
  assert.match(api, /window\.ccNexusDesktop\?\.deleteSession/);
  assert.match(api, /fetch\('\/api\/sessions'/);
  assert.match(chat, /getSessions\(\)/);
  assert.match(chat, /loadSession\(sessionId\)/);
  assert.match(history, /getSessions\(\)/);
  assert.match(history, /renameSession\(id, editValue\.trim\(\)\)/);
  assert.match(history, /deleteSession\(id\)/);
});

test('desktop session service lists, loads, renames and deletes persisted sessions', async () => {
  const { DesktopSessionService } = await import('../desktop/runtime/sessionService.js');
  const homeDir = await mkdtemp(path.join(os.tmpdir(), 'ccnexus-session-service-'));
  const sessionsDir = path.join(homeDir, '.ccnexus', 'sessions');

  try {
    await mkdir(sessionsDir, { recursive: true });
    await writeFile(
      path.join(sessionsDir, '_index.json'),
      JSON.stringify([{ id: 's1', title: 'First', updatedAt: 20 }]),
      'utf8',
    );
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

    const deleted = await service.deleteSession('s1');
    assert.deepEqual(deleted, { type: 'session_deleted', sessionId: 's1' });
    assert.deepEqual((await service.getSessions()).sessions, []);
  } finally {
    await rm(homeDir, { recursive: true, force: true });
  }
});

test('desktop session service syncs with Claude project JSONL history without touching Claude config', async () => {
  const { DesktopSessionService } = await import('../desktop/runtime/sessionService.js');
  const { encodeClaudeProjectPath } = await import('../server/sessionSync.js');
  const homeDir = await mkdtemp(path.join(os.tmpdir(), 'ccnexus-desktop-claude-history-'));
  const cwd = path.join(homeDir, 'workspace');
  const sessionsDir = path.join(homeDir, '.ccnexus', 'sessions');
  const claudeProjectDir = path.join(homeDir, '.claude', 'projects', encodeClaudeProjectPath(cwd));

  try {
    await mkdir(sessionsDir, { recursive: true });
    await mkdir(claudeProjectDir, { recursive: true });
    await writeFile(
      path.join(sessionsDir, '_index.json'),
      JSON.stringify([
        { id: 'kept-session', title: 'Keep', updatedAt: 20 },
        { id: 'deleted-session', title: 'Delete', updatedAt: 10 },
      ]),
      'utf8',
    );
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

test('desktop session service recovers Claude JSONL history when the ccnexus index is malformed', async () => {
  const { DesktopSessionService } = await import('../desktop/runtime/sessionService.js');
  const { encodeClaudeProjectPath } = await import('../server/sessionSync.js');
  const homeDir = await mkdtemp(path.join(os.tmpdir(), 'ccnexus-desktop-bad-index-'));
  const cwd = path.join(homeDir, 'workspace');
  const sessionsDir = path.join(homeDir, '.ccnexus', 'sessions');
  const claudeProjectDir = path.join(homeDir, '.claude', 'projects', encodeClaudeProjectPath(cwd));

  try {
    await mkdir(sessionsDir, { recursive: true });
    await mkdir(claudeProjectDir, { recursive: true });
    await writeFile(
      path.join(sessionsDir, '_index.json'),
      '[]  {"id":"corrupt-tail"}]',
      'utf8',
    );
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
    assert.deepEqual(
      JSON.parse(readFileSync(path.join(sessionsDir, '_index.json'), 'utf8')).map((session) => session.id),
      ['recovered-session'],
    );
  } finally {
    await rm(homeDir, { recursive: true, force: true });
  }
});

test('desktop session service keeps cached sessions when Claude JSONL is absent for the current workspace', async () => {
  const { DesktopSessionService } = await import('../desktop/runtime/sessionService.js');
  const { encodeClaudeProjectPath } = await import('../server/sessionSync.js');
  const homeDir = await mkdtemp(path.join(os.tmpdir(), 'ccnexus-desktop-keep-cache-'));
  const cwd = path.join(homeDir, 'workspace');
  const sessionsDir = path.join(homeDir, '.ccnexus', 'sessions');
  const claudeProjectDir = path.join(homeDir, '.claude', 'projects', encodeClaudeProjectPath(cwd));

  try {
    await mkdir(sessionsDir, { recursive: true });
    await mkdir(claudeProjectDir, { recursive: true });
    await writeFile(
      path.join(sessionsDir, '_index.json'),
      JSON.stringify([{ id: 'cached-only', title: 'Cached', updatedAt: 20 }]),
      'utf8',
    );
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
