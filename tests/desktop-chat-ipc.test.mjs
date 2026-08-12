import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const mainSource = await readFile(new URL('../desktop/main.js', import.meta.url), 'utf8');
const preloadSource = await readFile(new URL('../desktop/preload.cjs', import.meta.url), 'utf8');
const hookSource = await readFile(new URL('../src/hooks/useDesktopChat.ts', import.meta.url), 'utf8');
const typingsSource = await readFile(new URL('../src/vite-env.d.ts', import.meta.url), 'utf8');
const chatInputSource = await readFile(new URL('../src/components/ChatInputBox/index.tsx', import.meta.url), 'utf8');
const chatViewSource = await readFile(new URL('../src/views/ChatView.tsx', import.meta.url), 'utf8');

test('desktop preload exposes chat command and event stream APIs', () => {
  assert.match(preloadSource, /sendChatCommand:\s*\(message\)\s*=>\s*ipcRenderer\.send\('desktop:chat-command'/);
  assert.match(preloadSource, /onChatMessage:\s*\(callback\)\s*=>/);
  assert.match(preloadSource, /ipcRenderer\.on\('desktop:chat-message'/);
  assert.match(preloadSource, /removeListener\('desktop:chat-message'/);
  assert.match(preloadSource, /getContextUsage:/);
  assert.match(mainSource, /ipcMain\.handle\('desktop:get-context-usage'/);
});

test('main process routes chat commands through the desktop chat controller', () => {
  assert.match(mainSource, /createDesktopChatController/);
  assert.match(mainSource, /ipcMain\.on\('desktop:chat-command'/);
  assert.match(mainSource, /chatController\.handle/);
  assert.match(mainSource, /desktop:chat-message/);
});

test('renderer chat hook uses desktop IPC without a browser transport fallback', () => {
  assert.match(hookSource, /window\.ccNexusDesktop\?\.sendChatCommand/);
  assert.match(hookSource, /onChatMessage/);
  assert.match(hookSource, /useDesktopChat/);
  assert.doesNotMatch(hookSource, /WebSocket/);
  assert.doesNotMatch(hookSource, /location\.host/);
});

test('renderer coalesces non-priority stream events at a modest refresh cadence', () => {
  assert.match(hookSource, /const INBOUND_STREAM_FLUSH_INTERVAL_MS = 50;/);
  assert.match(hookSource, /window\.setTimeout\([\s\S]*INBOUND_STREAM_FLUSH_INTERVAL_MS/);
  assert.match(hookSource, /if \(isPriorityDesktopMessage\(nextMessage\)\)/);
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
  assert.match(controllerSource, /onPlanApproval/);
  assert.match(controllerSource, /requestPlanApprovalFromRenderer/);
  assert.match(controllerSource, /message\.requestId/);
  assert.match(controllerSource, /requestUserQuestionFromRenderer/);
  assert.match(controllerSource, /questionQueue/);
  assert.match(controllerSource, /set_permission_mode/);
  assert.match(controllerSource, /sessions\.appendMessage/);
  assert.match(controllerSource, /type:\s*'status',\s*status:\s*'thinking'/);
  assert.match(controllerSource, /runtime\.getContextUsage/);
});

test('desktop context usage follows ccgui persistent runtime control request', async () => {
  const { createDesktopChatController } = await import('../desktop/runtime/chatController.js');
  let captured = null;
  const runtime = {
    getContextUsage: async args => {
      captured = args;
      return { totalTokens: 1200, maxTokens: 1000000, percentage: 0.12, categories: [], gridRows: [] };
    },
  };
  const controller = createDesktopChatController({
    runtime,
    sessions: {},
    localConfig: { getProviders: async () => ({ currentEnv: {} }) },
    workspaceFiles: { getWorkspace: () => ({ cwd: 'D:/repo' }) },
  });

  const result = await controller.getContextUsage({ sessionId: 'session-1', model: 'claude-sonnet-4-6[1m]' });

  assert.equal(result.totalTokens, 1200);
  assert.equal(captured.sessionId, 'session-1');
  assert.equal(captured.options.resume, 'session-1');
  assert.equal(captured.options.settings.env.CLAUDE_CODE_DISABLE_1M_CONTEXT, '');
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

test('chat input keeps ccgui local command handling in the session view', () => {
  assert.match(chatInputSource, /onContextUsage/);
  assert.match(chatViewSource, /NEW_SESSION_COMMANDS/);
  assert.match(chatViewSource, /RESUME_COMMANDS/);
  assert.match(chatViewSource, /command === '\/plan'/);
  assert.match(chatViewSource, /handleNewSession/);
  assert.match(chatViewSource, /handleOpenHistory/);
});

test('desktop chat persists one user and one assistant message per turn', async () => {
  const { DesktopSessionService } = await import('../desktop/runtime/sessionService.js');
  const { createDesktopChatController } = await import('../desktop/runtime/chatController.js');
  const homeDir = await mkdtemp(path.join(os.tmpdir(), 'ccnexus-chat-persistence-'));
  const cwd = path.join(homeDir, 'workspace');

  try {
    const sessions = new DesktopSessionService({ homeDir, cwd });
    async function* successfulQuery() {
      yield { type: 'system', subtype: 'init', session_id: 'session-1' };
      yield {
        type: 'assistant',
        uuid: 'assistant-1',
        session_id: 'session-1',
        message: {
          role: 'assistant',
          content: [{ type: 'text', text: '收到' }],
        },
      };
      yield {
        type: 'result',
        session_id: 'session-1',
        subtype: 'success',
        is_error: false,
        duration_ms: 1,
        total_cost_usd: 0,
        num_turns: 1,
      };
    }

    const runtime = {
      queryClaude: async () => {
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
    const controller = createDesktopChatController({
      runtime,
      sessions,
      localConfig: { getProviders: async () => ({ currentEnv: {} }) },
      workspaceFiles: {
        getWorkspace: () => ({ cwd }),
        safePath: () => null,
      },
    });

    await controller.handle({ type: 'chat', text: '你好', options: { model: 'default' } }, () => {});

    const history = await sessions.loadSession('session-1');
    assert.equal(history.messages.length, 2);
    assert.deepEqual(history.messages.map(message => message.role), ['user', 'assistant']);
  } finally {
    await rm(homeDir, { recursive: true, force: true });
  }
});

test('desktop chat serializes AskUserQuestion requests and returns keyed answers', async () => {
  const { createDesktopChatController } = await import('../desktop/runtime/chatController.js');
  let permissionHandler = null;
  const emitted = [];

  async function* successfulQuery() {
    yield { type: 'system', subtype: 'init', session_id: 'question-session' };
    yield {
      type: 'result',
      session_id: 'question-session',
      subtype: 'success',
      is_error: false,
      duration_ms: 1,
      total_cost_usd: 0,
      num_turns: 1,
    };
  }

  const runtime = {
    queryClaude: async ({ onPermissionRequest }) => {
      permissionHandler = onPermissionRequest;
      const stream = successfulQuery();
      stream.daemonSessionId = 'pending-question';
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
    localConfig: { getProviders: async () => ({ currentEnv: {} }) },
    workspaceFiles: { getWorkspace: () => ({ cwd: 'D:/repo' }), safePath: () => null },
  });

  const chatPromise = controller.handle({ type: 'chat', text: 'question', options: { model: 'default' } }, event => emitted.push(event));
  const startedAt = Date.now();
  while (!permissionHandler && Date.now() - startedAt < 1000) {
    await new Promise(resolve => setTimeout(resolve, 5));
  }
  assert.equal(typeof permissionHandler, 'function');

  const first = permissionHandler({
    toolName: 'AskUserQuestion',
    input: { questions: [{ question: 'First?', options: [{ label: 'A' }, { label: 'B' }] }] },
    options: {},
  });
  const second = permissionHandler({
    toolName: 'AskUserQuestion',
    input: { questions: [{ question: 'Second?', options: [{ label: 'C' }, { label: 'D' }] }] },
    options: {},
  });

  const waitForQuestion = async (questionText) => {
    const started = Date.now();
    while (Date.now() - started < 1000) {
      const found = emitted.find(event => event.type === 'ask_user_question' && event.question === questionText);
      if (found) return found;
      await new Promise(resolve => setTimeout(resolve, 5));
    }
    assert.fail(`Timed out waiting for ${questionText}`);
  };

  const firstEvent = await waitForQuestion('First?');
  assert.equal(emitted.filter(event => event.type === 'ask_user_question').length, 1);
  await controller.handle({ type: 'ask_user_question_response', questionId: firstEvent.questionId, answer: 'A' }, () => {});
  const secondEvent = await waitForQuestion('Second?');
  await controller.handle({ type: 'ask_user_question_response', questionId: secondEvent.questionId, answer: 'C' }, () => {});

  assert.deepEqual(await first, { behavior: 'allow', updatedInput: {
    questions: [{ question: 'First?', options: [{ label: 'A' }, { label: 'B' }] }],
    answers: { 'First?': 'A' },
  } });
  assert.deepEqual(await second, { behavior: 'allow', updatedInput: {
    questions: [{ question: 'Second?', options: [{ label: 'C' }, { label: 'D' }] }],
    answers: { 'Second?': 'C' },
  } });
  await chatPromise;
  controller.dispose();
});
