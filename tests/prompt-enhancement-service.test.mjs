import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createPromptEnhancementService,
  extractPromptEnhancementText,
} from '../desktop/runtime/promptEnhancementService.js';

test('extracts only text blocks from assistant events', () => {
  const text = extractPromptEnhancementText([
    { type: 'system', subtype: 'init' },
    {
      type: 'assistant',
      message: {
        content: [
          { type: 'text', text: 'Goal: clarify the request.' },
          { type: 'tool_use', name: 'Read' },
          { type: 'text', text: 'Constraint: preserve the original intent.' },
        ],
      },
    },
    { type: 'result', subtype: 'success' },
  ]);

  assert.equal(text, 'Goal: clarify the request.\n\nConstraint: preserve the original intent.');
});

test('returns enhanced prompt text and latest usage from a short-lived query', async () => {
  const calls = [];
  const appended = [];
  const workspace = { cwd: 'D:/repo' };
  const localResult = { summary: 'Keep error handling and examples.' };
  const query = createMockQuery([
    { type: 'system', subtype: 'init', session_id: 'sdk-session' },
    {
      type: 'assistant',
      message: {
        content: [{ type: 'text', text: 'Rewrite the request with the same intent.' }],
        usage: { input_tokens: 10, output_tokens: 4 },
      },
    },
    {
      type: 'assistant',
      message: {
        content: [{ type: 'text', text: 'Keep error handling and examples.' }],
        usage: { input_tokens: 12, output_tokens: 7 },
      },
    },
    { type: 'result', subtype: 'success', session_id: 'sdk-session' },
  ]);

  const service = createPromptEnhancementService({
    query: async (args) => {
      calls.push(args);
      return query;
    },
    localConfig: {
      getProviders: async () => ({
        currentEnv: { ANTHROPIC_API_KEY: 'live-key', PROJECT_PATH: 'D:/other-project' },
        providerMode: '__cli_login__',
      }),
    },
    workspaceFiles: {
      getWorkspace: () => workspace,
    },
    usageStore: {
      async append(record) {
        appended.push(record);
      },
    },
  });

  const result = await service.enhance({
    requestId: 'req-1',
    text: 'make this prompt better',
    localResult,
    model: 'claude-sonnet-4-6',
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].sessionId, 'prompt-enhancement:req-1');
  assert.equal(calls[0].title, 'Prompt enhancement');
  assert.match(calls[0].prompt, /make this prompt better/);
  assert.match(calls[0].prompt, /Keep error handling and examples/);
  assert.equal(calls[0].options.cwd, workspace.cwd);
  assert.deepEqual(calls[0].options.settingSources, []);
  assert.deepEqual(calls[0].options.additionalDirectories, []);
  assert.deepEqual(calls[0].options.tools, []);
  assert.equal(calls[0].options.maxTurns, 1);
  assert.equal(calls[0].options.enableFileCheckpointing, false);
  assert.equal(calls[0].options.includePartialMessages, false);
  assert.equal(calls[0].options.permissionMode, 'default');
  assert.equal(calls[0].options.persistSession, false);
  assert.equal(calls[0].options.strictMcpConfig, true);
  assert.deepEqual(calls[0].options.mcpServers, {});
  assert.equal(calls[0].options.isolatedDenyAllTools, true);
  assert.equal(calls[0].signal?.aborted, false);
  assert.equal(result.requestId, 'req-1');
  assert.equal(result.model, 'claude-sonnet-4-6');
  assert.equal(result.text, 'Rewrite the request with the same intent.\n\nKeep error handling and examples.');
  assert.deepEqual(result.usage, { input_tokens: 12, output_tokens: 7 });
  assert.equal(result.sessionId, undefined);
  assert.equal(appended.length, 1);
  assert.deepEqual(appended, [{
    id: 'req-1',
    timestamp: appended.at(0)?.timestamp,
    cwd: workspace.cwd,
    model: 'claude-sonnet-4-6',
    usage: { input_tokens: 12, output_tokens: 7 },
  }]);
  assert.equal(typeof appended.at(0)?.timestamp, 'number');
  assert.equal(query.interruptCalls, 0);
  assert.equal(query.closeCalls, 1);
});

test('enhancement still succeeds when no usage store is injected', async () => {
  const query = createMockQuery([
    {
      type: 'assistant',
      message: {
        content: [{ type: 'text', text: 'Use clearer wording.' }],
        usage: { input_tokens: 9, output_tokens: 3 },
      },
    },
    { type: 'result', subtype: 'success' },
  ]);

  const service = createPromptEnhancementService({
    query: async () => query,
    localConfig: {
      getProviders: async () => ({ currentEnv: {}, providerMode: '' }),
    },
    workspaceFiles: {
      getWorkspace: () => ({ cwd: 'D:/repo' }),
    },
  });

  const result = await service.enhance({
    requestId: 'req-no-store',
    text: 'improve this',
    localResult: {},
    model: 'claude-sonnet-4-6',
  });

  assert.equal(result.text, 'Use clearer wording.');
  assert.deepEqual(result.usage, { input_tokens: 9, output_tokens: 3 });
});

test('rejects empty input before spawning a query', async () => {
  let called = false;
  const service = createPromptEnhancementService({
    query: async () => {
      called = true;
      return createMockQuery([]);
    },
    localConfig: {
      getProviders: async () => ({ currentEnv: {}, providerMode: '' }),
    },
    workspaceFiles: {
      getWorkspace: () => ({ cwd: 'D:/repo' }),
    },
    usageStore: {},
  });

  await assert.rejects(
    service.enhance({
      requestId: 'req-empty',
      text: '   ',
      localResult: {},
      model: 'claude-sonnet-4-6',
    }),
    /Prompt enhancement requires non-empty text/i,
  );
  assert.equal(called, false);
});

test('rejects empty assistant output with a readable error and no local-result mutation', async () => {
  const localResult = { draft: 'Original renderer-local state' };
  let appendCalls = 0;
  const query = createMockQuery([
    {
      type: 'assistant',
      message: {
        content: [{ type: 'tool_use', name: 'Read' }],
        usage: { input_tokens: 6, output_tokens: 0 },
      },
    },
    { type: 'result', subtype: 'success' },
  ]);

  const service = createPromptEnhancementService({
    query: async () => query,
    localConfig: {
      getProviders: async () => ({ currentEnv: {}, providerMode: '' }),
    },
    workspaceFiles: {
      getWorkspace: () => ({ cwd: 'D:/repo' }),
    },
    usageStore: {
      async append() {
        appendCalls += 1;
      },
    },
  });

  await assert.rejects(
    service.enhance({
      requestId: 'req-empty-output',
      text: 'improve this',
      localResult,
      model: 'claude-sonnet-4-6',
    }),
    /Prompt enhancement returned empty text/i,
  );
  assert.deepEqual(localResult, { draft: 'Original renderer-local state' });
  assert.equal(appendCalls, 0);
  assert.equal(query.closeCalls, 1);
});

test('propagates query failures without mutating the local result', async () => {
  const localResult = { draft: 'Keep me untouched' };
  let appendCalls = 0;
  const service = createPromptEnhancementService({
    query: async () => {
      throw new Error('Claude query failed');
    },
    localConfig: {
      getProviders: async () => ({ currentEnv: {}, providerMode: '' }),
    },
    workspaceFiles: {
      getWorkspace: () => ({ cwd: 'D:/repo' }),
    },
    usageStore: {
      async append() {
        appendCalls += 1;
      },
    },
  });

  await assert.rejects(
    service.enhance({
      requestId: 'req-failure',
      text: 'improve this',
      localResult,
      model: 'claude-sonnet-4-6',
    }),
    /Claude query failed/,
  );
  assert.deepEqual(localResult, { draft: 'Keep me untouched' });
  assert.equal(appendCalls, 0);
});

test('cancel interrupts and closes the active short-lived query', async () => {
  let appendCalls = 0;
  let release;
  const blocked = new Promise((resolve) => {
    release = resolve;
  });
  const query = createMockQuery(async function* iterator() {
    yield { type: 'system', subtype: 'init', session_id: 'sdk-session' };
    await blocked;
    yield {
      type: 'assistant',
      message: {
        content: [{ type: 'text', text: 'Cancelled after this point' }],
        usage: { input_tokens: 5, output_tokens: 3 },
      },
    };
  }());

  const service = createPromptEnhancementService({
    query: async () => query,
    localConfig: {
      getProviders: async () => ({ currentEnv: {}, providerMode: '' }),
    },
    workspaceFiles: {
      getWorkspace: () => ({ cwd: 'D:/repo' }),
    },
    usageStore: {
      async append() {
        appendCalls += 1;
      },
    },
  });

  const pending = service.enhance({
    requestId: 'req-cancel',
    text: 'cancel me',
    localResult: {},
    model: 'claude-sonnet-4-6',
  });

  await waitFor(() => query.closeCalls === 0);
  const cancelled = await service.cancel('req-cancel');
  release();

  assert.equal(cancelled, true);
  await assert.rejects(pending, /cancelled|aborted/i);
  assert.equal(appendCalls, 0);
  assert.equal(query.interruptCalls, 1);
  assert.equal(query.closeCalls, 1);
});

test('dispose closes every in-flight prompt enhancement query', async () => {
  let releaseA;
  let releaseB;
  const queryA = createMockQuery(async function* iterator() {
    yield { type: 'system', subtype: 'init' };
    await new Promise((resolve) => { releaseA = resolve; });
  }());
  const queryB = createMockQuery(async function* iterator() {
    yield { type: 'system', subtype: 'init' };
    await new Promise((resolve) => { releaseB = resolve; });
  }());
  const queue = [queryA, queryB];

  const service = createPromptEnhancementService({
    query: async () => queue.shift(),
    localConfig: {
      getProviders: async () => ({ currentEnv: {}, providerMode: '' }),
    },
    workspaceFiles: {
      getWorkspace: () => ({ cwd: 'D:/repo' }),
    },
    usageStore: {},
  });

  const pendingA = service.enhance({
    requestId: 'req-a',
    text: 'first',
    localResult: {},
    model: 'claude-sonnet-4-6',
  });
  const pendingB = service.enhance({
    requestId: 'req-b',
    text: 'second',
    localResult: {},
    model: 'claude-sonnet-4-6',
  });

  await waitFor(() => typeof releaseA === 'function' && typeof releaseB === 'function');
  await service.dispose();
  releaseA();
  releaseB();

  await assert.rejects(pendingA, /cancelled|aborted/i);
  await assert.rejects(pendingB, /cancelled|aborted/i);
  assert.equal(queryA.closeCalls, 1);
  assert.equal(queryB.closeCalls, 1);
});

test('rejects a duplicate active requestId before provider lookup completes', async () => {
  let releaseProviders;
  const providersReady = new Promise((resolve) => { releaseProviders = resolve; });
  let providerCalls = 0;
  const query = createMockQuery([
    { type: 'assistant', message: { content: [{ type: 'text', text: 'Done.' }] } },
    { type: 'result', subtype: 'success' },
  ]);
  const service = createPromptEnhancementService({
    query: async () => query,
    localConfig: {
      getProviders: async () => {
        providerCalls += 1;
        await providersReady;
        return { currentEnv: {}, providerMode: '' };
      },
    },
    workspaceFiles: { getWorkspace: () => ({ cwd: 'D:/repo' }) },
  });

  const first = service.enhance({ requestId: 'req-duplicate', text: 'first', localResult: {} });
  await waitFor(() => providerCalls === 1);
  await assert.rejects(
    service.enhance({ requestId: 'req-duplicate', text: 'second', localResult: {} }),
    /already active/i,
  );
  releaseProviders();
  await first;
  await service.dispose();
});

test('awaits asynchronous query close before enhancement resolves', async () => {
  let releaseClose;
  let closeStarted = false;
  const closeReady = new Promise((resolve) => { releaseClose = resolve; });
  const query = {
    async close() {
      closeStarted = true;
      await closeReady;
    },
    async *[Symbol.asyncIterator]() {
      yield { type: 'assistant', message: { content: [{ type: 'text', text: 'Closed after success.' }] } };
      yield { type: 'result', subtype: 'success' };
    },
  };
  const service = createPromptEnhancementService({
    query: async () => query,
    localConfig: { getProviders: async () => ({ currentEnv: {}, providerMode: '' }) },
    workspaceFiles: { getWorkspace: () => ({ cwd: 'D:/repo' }) },
  });

  let settled = false;
  const pending = service.enhance({ requestId: 'req-async-close', text: 'close me', localResult: {} })
    .finally(() => { settled = true; });
  await waitFor(() => closeStarted);
  await Promise.resolve();
  assert.equal(settled, false);
  releaseClose();
  await pending;
  assert.equal(settled, true);
});

test('cancel returns before unresolved query acquisition and closes the query after it arrives', async () => {
  let resolveAcquisition;
  let queryCalled = false;
  let acquisitionSignal;
  const acquisition = new Promise((resolve) => { resolveAcquisition = resolve; });
  const acquiredQuery = {
    interruptCalls: 0,
    closeCalls: 0,
    async interrupt() {
      this.interruptCalls += 1;
    },
    async close() {
      this.closeCalls += 1;
    },
    async *[Symbol.asyncIterator]() {},
  };
  const service = createPromptEnhancementService({
    query: async ({ signal }) => {
      queryCalled = true;
      acquisitionSignal = signal;
      return acquisition;
    },
    localConfig: { getProviders: async () => ({ currentEnv: {}, providerMode: '' }) },
    workspaceFiles: { getWorkspace: () => ({ cwd: 'D:/repo' }) },
  });

  const pending = service.enhance({ requestId: 'req-unresolved-acquisition', text: 'cancel now', localResult: {} });
  await waitFor(() => queryCalled);
  const cancelPromise = service.cancel('req-unresolved-acquisition');
  const cancelResult = await Promise.race([
    cancelPromise.then(() => 'cancelled'),
    new Promise((resolve) => setTimeout(() => resolve('timed-out'), 50)),
  ]);
  resolveAcquisition(acquiredQuery);
  await cancelPromise;
  await assert.rejects(pending, /cancelled|aborted/i);
  assert.equal(cancelResult, 'cancelled');
  assert.equal(acquisitionSignal.aborted, true);
  assert.equal(acquiredQuery.interruptCalls, 1);
  assert.equal(acquiredQuery.closeCalls, 1);
  await service.dispose();
});

test('dispose closes admission before a concurrent enhance can reserve a new request', async () => {
  let releaseProviders;
  let providerStarted = false;
  const providersReady = new Promise((resolve) => { releaseProviders = resolve; });
  const query = createMockQuery([
    { type: 'assistant', message: { content: [{ type: 'text', text: 'Done.' }] } },
    { type: 'result', subtype: 'success' },
  ]);
  const service = createPromptEnhancementService({
    query: async () => query,
    localConfig: {
      getProviders: async () => {
        providerStarted = true;
        await providersReady;
        return { currentEnv: {}, providerMode: '' };
      },
    },
    workspaceFiles: { getWorkspace: () => ({ cwd: 'D:/repo' }) },
  });

  const first = service.enhance({ requestId: 'req-dispose-race-a', text: 'first', localResult: {} });
  await waitFor(() => providerStarted);
  const disposing = service.dispose();
  const second = service.enhance({ requestId: 'req-dispose-race-b', text: 'second', localResult: {} });
  const secondOutcome = await Promise.race([
    second.then(() => 'resolved', () => 'rejected'),
    new Promise((resolve) => setTimeout(() => resolve('timed-out'), 50)),
  ]);
  releaseProviders();
  await assert.rejects(first, /cancelled|aborted/i);
  await second.catch(() => {});
  await disposing;
  assert.equal(secondOutcome, 'rejected');
});

function createMockQuery(source) {
  const iterable = Symbol.asyncIterator in Object(source)
    ? source
    : (async function* events() {
      for (const event of source) yield event;
    }());

  return {
    interruptCalls: 0,
    closeCalls: 0,
    async interrupt() {
      this.interruptCalls += 1;
    },
    close() {
      this.closeCalls += 1;
    },
    [Symbol.asyncIterator]() {
      return iterable[Symbol.asyncIterator]();
    },
  };
}

async function waitFor(predicate, { attempts = 20 } = {}) {
  for (let index = 0; index < attempts; index += 1) {
    if (predicate()) return;
    await Promise.resolve();
  }
  throw new Error('Condition was not met in time');
}
