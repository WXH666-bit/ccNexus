import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const mainSource = await readFile(new URL('../desktop/main.js', import.meta.url), 'utf8');
const preloadSource = await readFile(new URL('../desktop/preload.cjs', import.meta.url), 'utf8');
const hookSource = await readFile(new URL('../src/hooks/useWebSocket.ts', import.meta.url), 'utf8');
const typingsSource = await readFile(new URL('../src/vite-env.d.ts', import.meta.url), 'utf8');

test('desktop preload exposes chat command and event stream APIs', () => {
  assert.match(preloadSource, /sendChatCommand:\s*\(message\)\s*=>\s*ipcRenderer\.send\('desktop:chat-command'/);
  assert.match(preloadSource, /onChatMessage:\s*\(callback\)\s*=>/);
  assert.match(preloadSource, /ipcRenderer\.on\('desktop:chat-message'/);
  assert.match(preloadSource, /removeListener\('desktop:chat-message'/);
});

test('main process routes chat commands through the desktop chat controller', () => {
  assert.match(mainSource, /createDesktopChatController/);
  assert.match(mainSource, /ipcMain\.on\('desktop:chat-command'/);
  assert.match(mainSource, /chatController\.handle/);
  assert.match(mainSource, /desktop:chat-message/);
});

test('renderer websocket hook prefers desktop IPC before local broker websocket', () => {
  assert.match(hookSource, /window\.ccNexusDesktop\?\.sendChatCommand/);
  assert.match(hookSource, /window\.ccNexusDesktop\?\.onChatMessage/);
  assert.match(hookSource, /new WebSocket/);
});

test('desktop API typings include chat command and event stream', () => {
  assert.match(typingsSource, /sendChatCommand/);
  assert.match(typingsSource, /onChatMessage/);
});

test('desktop chat controller owns permission, session, and process registration flow', async () => {
  const controllerSource = await readFile(new URL('../desktop/runtime/chatController.js', import.meta.url), 'utf8');
  assert.match(controllerSource, /runtime\.queryClaude/);
  assert.match(controllerSource, /runtime\.registerChannel/);
  assert.match(controllerSource, /runtime\.unregisterChannel/);
  assert.match(controllerSource, /createPermissionPolicy/);
  assert.match(controllerSource, /permission_response/);
  assert.match(controllerSource, /sessions\.appendMessage/);
  assert.match(controllerSource, /type:\s*'status',\s*status:\s*'thinking'/);
});

test('desktop chat controller sends ccgui-style current provider env to the daemon query', async () => {
  const { createDesktopChatController } = await import('../desktop/runtime/chatController.js');
  let capturedEnv = null;

  async function* successfulQuery() {
    yield { type: 'system', subtype: 'init', session_id: 'session-from-daemon' };
    yield {
      type: 'result',
      session_id: 'session-from-daemon',
      subtype: 'success',
      is_error: false,
      duration_ms: 1,
      total_cost_usd: 0,
      num_turns: 1,
    };
  }

  const runtime = {
    queryClaude: async ({ options }) => {
      capturedEnv = options.env;
      const stream = successfulQuery();
      stream.daemonSessionId = 'pending-1';
      stream.close = () => {};
      return stream;
    },
    adoptSessionDaemon: () => {},
    ensureSessionDaemon: () => {},
    registerChannel: () => {},
    unregisterChannel: () => {},
    removeSessionDaemon: () => {},
  };

  const sessions = {
    loadSession: async () => ({ messages: [] }),
    saveSession: async () => {},
    appendMessage: async () => {},
    deleteSession: async () => {},
  };

  const controller = createDesktopChatController({
    runtime,
    sessions,
    localConfig: {
      readClaudeSettings: async () => ({ env: { ANTHROPIC_MODEL: 'stale-settings-model' } }),
      getProviders: async () => ({
        currentEnv: {
          ANTHROPIC_MODEL: 'deepseek-v4-pro[1M]',
          ANTHROPIC_BASE_URL: 'https://api.deepseek.com/anthropic',
        },
      }),
    },
    workspaceFiles: {
      getWorkspace: () => ({ cwd: 'D:/repo' }),
      safePath: () => null,
    },
  });

  await controller.handle({
    type: 'chat',
    text: '你好',
    options: { model: 'default' },
  }, () => {});

  assert.equal(capturedEnv.ANTHROPIC_MODEL, 'deepseek-v4-pro[1M]');
  assert.equal(capturedEnv.ANTHROPIC_BASE_URL, 'https://api.deepseek.com/anthropic');
});
