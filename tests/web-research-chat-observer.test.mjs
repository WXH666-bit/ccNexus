import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createDesktopChatController,
  WEB_RESEARCH_AUTO_ALLOW_TIMEOUT_MS,
} from '../desktop/runtime/chatController.js';
import { permissionRequestEvent, webResearchEvent } from '../server/protocol.js';

function createController(runtime, emitted, options = {}) {
  return createDesktopChatController({
    runtime,
    sessions: {
      loadSession: async () => ({ messages: [] }),
      saveSession: async session => session,
      appendMessage: async () => {},
      deleteSession: async () => {},
    },
    localConfig: {
      getProviders: async () => ({ currentEnv: {} }),
    },
    workspaceFiles: {
      getWorkspace: () => ({ cwd: 'D:/repo' }),
      safePath: () => null,
    },
    ...options,
  });
}

function decorateStream(stream, id) {
  stream.daemonSessionId = id;
  stream.close = () => {};
  return stream;
}

function waitFor(predicate) {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + 1000;
    const check = () => {
      if (predicate()) {
        resolve();
        return;
      }
      if (Date.now() >= deadline) {
        reject(new Error('Timed out waiting for test state'));
        return;
      }
      setTimeout(check, 5);
    };
    check();
  });
}

test('protocol events preserve web tool identity and permission display metadata', () => {
  assert.deepEqual(permissionRequestEvent({
    requestId: 'perm-1',
    toolName: 'WebSearch',
    input: { query: 'ccNexus' },
    toolUseId: 'web-1',
    description: 'Search the web',
    sessionId: 'session-1',
  }), {
    type: 'permission_request',
    requestId: 'perm-1',
    toolName: 'WebSearch',
    input: { query: 'ccNexus' },
    toolUseId: 'web-1',
    description: 'Search the web',
    sessionId: 'session-1',
  });

  assert.deepEqual(webResearchEvent({
    phase: 'started',
    sessionId: 'session-1',
    toolUseId: 'web-1',
    toolName: 'WebSearch',
    input: { query: 'ccNexus' },
    query: 'ccNexus',
  }), {
    type: 'web_research',
    phase: 'started',
    sessionId: 'session-1',
    toolUseId: 'web-1',
    toolName: 'WebSearch',
    input: { query: 'ccNexus' },
    query: 'ccNexus',
  });

  assert.deepEqual(permissionRequestEvent({
    requestId: 'perm-auto',
    toolName: 'WebFetch',
    input: { url: 'https://example.com' },
    autoAllowAt: 123_456,
  }), {
    type: 'permission_request',
    requestId: 'perm-auto',
    toolName: 'WebFetch',
    input: { url: 'https://example.com' },
    autoAllowAt: 123_456,
  });

  assert.equal(webResearchEvent({
    phase: 'approved',
    toolUseId: 'web-auto',
    toolName: 'WebSearch',
    input: { query: 'ccNexus' },
    approval: 'timeout',
  }).approval, 'timeout');
});

test('chat controller observes exact WebSearch/WebFetch tool results without changing tool_result', async () => {
  const emitted = [];
  async function* queryEvents() {
    yield { type: 'system', subtype: 'init', session_id: 'web-session' };
    yield {
      type: 'assistant',
      uuid: 'assistant-web',
      session_id: 'web-session',
      message: {
        role: 'assistant',
        content: [
          {
            type: 'tool_use',
            id: 'web-search-1',
            name: 'WebSearch',
            input: { query: 'ccNexus', allowed_domains: ['example.com'] },
          },
          {
            type: 'tool_use',
            id: 'web-fetch-1',
            name: 'WebFetch',
            input: { url: 'https://example.com/docs', prompt: 'Summarize it' },
          },
          {
            type: 'tool_use',
            id: 'code-search-1',
            name: 'Grep',
            input: { pattern: 'WebSearch' },
          },
        ],
      },
    };
    yield {
      type: 'user',
      uuid: 'user-web-results',
      session_id: 'web-session',
      message: {
        role: 'user',
        content: [
          {
            type: 'tool_result',
            tool_use_id: 'web-search-1',
            content: {
              query: 'ccNexus',
              results: [{
                tool_use_id: 'native-search',
                content: [{
                  title: 'ccNexus',
                  url: 'https://example.com/ccnexus',
                  snippet: 'Desktop research panel',
                }],
              }],
            },
            is_error: false,
          },
          {
            type: 'tool_result',
            tool_use_id: 'web-fetch-1',
            content: 'fetch failed',
            is_error: true,
          },
          {
            type: 'tool_result',
            tool_use_id: 'code-search-1',
            content: 'src/example.ts:1',
            is_error: false,
          },
        ],
      },
    };
    yield {
      type: 'result',
      session_id: 'web-session',
      subtype: 'success',
      is_error: false,
      duration_ms: 1,
      total_cost_usd: 0,
      num_turns: 1,
    };
  }

  const runtime = {
    queryClaude: async () => decorateStream(queryEvents(), 'web-session'),
    adoptSessionDaemon: () => {},
    ensureSessionDaemon: () => {},
    registerChannel: () => {},
    unregisterChannel: () => {},
    removeSessionDaemon: () => {},
  };
  const controller = createController(runtime, emitted);

  await controller.handle({ type: 'chat', text: 'search', options: { model: 'default' } }, event => {
    emitted.push(event);
  });

  const webEvents = emitted.filter(event => event.type === 'web_research');
  assert.deepEqual(webEvents.map(event => [event.phase, event.toolUseId, event.toolName]), [
    ['started', 'web-search-1', 'WebSearch'],
    ['started', 'web-fetch-1', 'WebFetch'],
    ['completed', 'web-search-1', 'WebSearch'],
    ['error', 'web-fetch-1', 'WebFetch'],
  ]);

  const completed = webEvents.find(event => event.phase === 'completed');
  assert.equal(completed.sessionId, 'web-session');
  assert.deepEqual(completed.input, {
    query: 'ccNexus',
    allowed_domains: ['example.com'],
  });
  assert.equal(completed.query, 'ccNexus');
  assert.match(completed.content, /ccNexus/);
  assert.deepEqual(completed.results, [{
    title: 'ccNexus',
    url: 'https://example.com/ccnexus',
    snippet: 'Desktop research panel',
  }]);

  const failed = webEvents.find(event => event.phase === 'error');
  assert.equal(failed.error, 'fetch failed');
  assert.deepEqual(failed.results, [{
    title: 'example.com',
    url: 'https://example.com/docs',
    snippet: 'fetch failed',
  }]);

  const toolResults = emitted.filter(event => event.type === 'tool_result');
  assert.equal(toolResults.length, 3);
  assert.equal(toolResults.find(event => event.tool_use_id === 'web-search-1').content.includes('ccNexus'), true);
  assert.equal(webEvents.some(event => event.toolUseId === 'code-search-1'), false);

  controller.dispose();
});

test('WebSearch permission carries toolUseId and description through existing response path', async () => {
  const emitted = [];
  let permissionHandler;
  let releaseQuery;
  const queryGate = new Promise(resolve => { releaseQuery = resolve; });

  async function* queryEvents() {
    yield { type: 'system', subtype: 'init', session_id: 'permission-session' };
    await queryGate;
    yield {
      type: 'result',
      session_id: 'permission-session',
      subtype: 'success',
      is_error: false,
    };
  }

  const runtime = {
    queryClaude: async ({ onPermissionRequest }) => {
      permissionHandler = onPermissionRequest;
      return decorateStream(queryEvents(), 'permission-session');
    },
    adoptSessionDaemon: () => {},
    ensureSessionDaemon: () => {},
    registerChannel: () => {},
    unregisterChannel: () => {},
    removeSessionDaemon: () => {},
  };
  const controller = createController(runtime, emitted);
  const chatPromise = controller.handle({
    type: 'chat',
    text: 'search the web',
    options: { model: 'default' },
  }, event => emitted.push(event));

  await waitFor(() => typeof permissionHandler === 'function');
  const permissionPromise = permissionHandler({
    toolName: 'WebSearch',
    input: { query: 'ccNexus' },
    options: {
      toolUseID: 'permission-web-1',
      description: 'Search the web for current information',
    },
  });
  await waitFor(() => emitted.some(event => event.type === 'permission_request'));

  const request = emitted.find(event => event.type === 'permission_request');
  assert.equal(request.toolName, 'WebSearch');
  assert.equal(request.toolUseId, 'permission-web-1');
  assert.equal(request.description, 'Search the web for current information');
  assert.equal(request.sessionId, 'permission-session');

  let permissionSettled = false;
  void permissionPromise.then(() => { permissionSettled = true; });
  await controller.handle({
    type: 'permission_response',
    requestId: request.requestId,
    sessionId: 'different-session',
    behavior: 'allow',
  }, event => emitted.push(event));
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(permissionSettled, false);

  await controller.handle({
    type: 'permission_response',
    requestId: request.requestId,
    sessionId: 'permission-session',
    behavior: 'allow',
  }, event => emitted.push(event));
  assert.deepEqual(await permissionPromise, { behavior: 'allow' });

  releaseQuery();
  await chatPromise;
  controller.dispose();
});

test('WebSearch waits two minutes in production and auto-allows only the pending request', async () => {
  assert.equal(WEB_RESEARCH_AUTO_ALLOW_TIMEOUT_MS, 120_000);
  const emitted = [];
  let permissionHandler;
  let releaseQuery;
  const queryGate = new Promise(resolve => { releaseQuery = resolve; });

  async function* queryEvents() {
    yield { type: 'system', subtype: 'init', session_id: 'auto-web-session' };
    await queryGate;
    yield { type: 'result', session_id: 'auto-web-session', subtype: 'success', is_error: false };
  }

  const runtime = {
    queryClaude: async ({ onPermissionRequest }) => {
      permissionHandler = onPermissionRequest;
      return decorateStream(queryEvents(), 'auto-web-session');
    },
    adoptSessionDaemon: () => {},
    ensureSessionDaemon: () => {},
    registerChannel: () => {},
    unregisterChannel: () => {},
    removeSessionDaemon: () => {},
  };
  const controller = createController(runtime, emitted, { webPermissionTimeoutMs: 20 });
  const chatPromise = controller.handle({
    type: 'chat',
    text: 'search after approval timeout',
    options: { model: 'default' },
  }, event => emitted.push(event));

  await waitFor(() => typeof permissionHandler === 'function');
  const startedAt = Date.now();
  const permissionPromise = permissionHandler({
    toolName: 'WebSearch',
    input: { query: 'current ccNexus news' },
    options: { toolUseID: 'auto-web-1' },
  });
  await waitFor(() => emitted.some(event => event.type === 'permission_request'));

  const request = emitted.find(event => event.type === 'permission_request');
  assert.ok(request.autoAllowAt >= startedAt + 15);
  assert.deepEqual(await permissionPromise, { behavior: 'allow' });
  await waitFor(() => emitted.some(event => event.type === 'web_research' && event.phase === 'approved'));
  const approved = emitted.find(event => event.type === 'web_research' && event.phase === 'approved');
  assert.equal(approved.toolUseId, 'auto-web-1');
  assert.equal(approved.approval, 'timeout');

  releaseQuery();
  await chatPromise;
  controller.dispose();
});

test('aborting a session cancels its pending web approval and prevents a late auto-allow', async () => {
  const emitted = [];
  let permissionHandler;
  let releaseQuery;
  const queryGate = new Promise(resolve => { releaseQuery = resolve; });

  async function* queryEvents() {
    yield { type: 'system', subtype: 'init', session_id: 'cancel-web-session' };
    await queryGate;
    yield { type: 'result', session_id: 'cancel-web-session', subtype: 'success', is_error: false };
  }

  const runtime = {
    queryClaude: async ({ onPermissionRequest }) => {
      permissionHandler = onPermissionRequest;
      const stream = decorateStream(queryEvents(), 'cancel-web-session');
      stream.interrupt = async () => { releaseQuery(); };
      return stream;
    },
    adoptSessionDaemon: () => {},
    ensureSessionDaemon: () => {},
    registerChannel: () => {},
    unregisterChannel: () => {},
    removeSessionDaemon: () => {},
  };
  const controller = createController(runtime, emitted, { webPermissionTimeoutMs: 30 });
  const chatPromise = controller.handle({
    type: 'chat',
    text: 'cancel this search',
    options: { model: 'default' },
  }, event => emitted.push(event));

  await waitFor(() => typeof permissionHandler === 'function');
  await waitFor(() => emitted.some(event => event.type === 'session'));
  const permissionPromise = permissionHandler({
    toolName: 'WebSearch',
    input: { query: 'stale request' },
    options: { toolUseID: 'cancel-web-1' },
  });
  await waitFor(() => emitted.some(event => event.type === 'permission_request'));

  await controller.handle({
    type: 'abort',
    sessionId: 'cancel-web-session',
  }, event => emitted.push(event));

  assert.deepEqual(await permissionPromise, {
    behavior: 'deny',
    message: 'Permission request cancelled',
  });
  await new Promise(resolve => setTimeout(resolve, 50));
  assert.equal(emitted.some(event => event.type === 'web_research' && event.phase === 'approved'), false);
  assert.equal(emitted.some(event => (
    event.type === 'web_research'
    && event.phase === 'error'
    && event.toolUseId === 'cancel-web-1'
  )), true);

  await chatPromise;
  controller.dispose();
});

test('an unbound abort cancels only its current request owner', async () => {
  const emitted = [];
  const permissionHandlers = [];
  const initResolvers = [];
  const finishResolvers = [];
  const initGates = [0, 1].map(index => new Promise(resolve => { initResolvers[index] = resolve; }));
  const finishGates = [0, 1].map(index => new Promise(resolve => { finishResolvers[index] = resolve; }));
  let queryIndex = 0;

  async function* queryEvents(index) {
    await initGates[index];
    yield { type: 'system', subtype: 'init', session_id: `owner-session-${index}` };
    await finishGates[index];
    yield { type: 'result', session_id: `owner-session-${index}`, subtype: 'success', is_error: false };
  }

  const runtime = {
    queryClaude: async ({ onPermissionRequest }) => {
      const index = queryIndex++;
      permissionHandlers[index] = onPermissionRequest;
      return decorateStream(queryEvents(index), `pending-owner-${index}`);
    },
    adoptSessionDaemon: () => {},
    ensureSessionDaemon: () => {},
    registerChannel: () => {},
    unregisterChannel: () => {},
    removeSessionDaemon: () => {},
  };
  const controller = createController(runtime, emitted, { webPermissionTimeoutMs: 500 });

  const firstChat = controller.handle({
    type: 'chat',
    text: 'first unbound request',
    options: { model: 'default' },
  }, event => emitted.push(event));
  await waitFor(() => typeof permissionHandlers[0] === 'function');
  const firstPermission = permissionHandlers[0]({
    toolName: 'WebSearch',
    input: { query: 'first request' },
    options: { toolUseID: 'owner-web-0' },
  });
  await waitFor(() => emitted.some(event => event.toolUseId === 'owner-web-0'));

  const secondChat = controller.handle({
    type: 'chat',
    text: 'second unbound request',
    options: { model: 'default' },
  }, event => emitted.push(event));
  await waitFor(() => typeof permissionHandlers[1] === 'function');
  const secondPermission = permissionHandlers[1]({
    toolName: 'WebSearch',
    input: { query: 'second request' },
    options: { toolUseID: 'owner-web-1' },
  });
  await waitFor(() => emitted.some(event => event.toolUseId === 'owner-web-1'));

  let firstSettled = false;
  void firstPermission.then(() => { firstSettled = true; });
  await controller.handle({ type: 'abort', sessionId: null }, event => emitted.push(event));
  assert.deepEqual(await secondPermission, {
    behavior: 'deny',
    message: 'Permission request cancelled',
  });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(firstSettled, false);

  initResolvers[0]();
  initResolvers[1]();
  await waitFor(() => emitted.some(event => event.type === 'session' && event.sessionId === 'owner-session-0'));
  const firstRequest = emitted.find(event => event.type === 'permission_request' && event.toolUseId === 'owner-web-0');
  await controller.handle({
    type: 'permission_response',
    requestId: firstRequest.requestId,
    sessionId: 'owner-session-0',
    behavior: 'allow',
  }, event => emitted.push(event));
  assert.deepEqual(await firstPermission, { behavior: 'allow' });

  finishResolvers[0]();
  finishResolvers[1]();
  await Promise.all([firstChat, secondChat]);
  controller.dispose();
});
