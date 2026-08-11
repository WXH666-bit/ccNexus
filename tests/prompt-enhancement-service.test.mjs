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
    usageStore: {},
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
  assert.equal(calls[0].options.mcpServers, undefined);
  assert.equal(result.requestId, 'req-1');
  assert.equal(result.model, 'claude-sonnet-4-6');
  assert.equal(result.text, 'Rewrite the request with the same intent.\n\nKeep error handling and examples.');
  assert.deepEqual(result.usage, { input_tokens: 12, output_tokens: 7 });
  assert.equal(result.sessionId, undefined);
  assert.equal(query.interruptCalls, 0);
  assert.equal(query.closeCalls, 1);
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
    usageStore: {},
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
  assert.equal(query.closeCalls, 1);
});

test('propagates query failures without mutating the local result', async () => {
  const localResult = { draft: 'Keep me untouched' };
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
    usageStore: {},
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
});

test('cancel interrupts and closes the active short-lived query', async () => {
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
    usageStore: {},
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
  service.dispose();
  releaseA();
  releaseB();

  await assert.rejects(pendingA, /cancelled|aborted/i);
  await assert.rejects(pendingB, /cancelled|aborted/i);
  assert.equal(queryA.closeCalls, 1);
  assert.equal(queryB.closeCalls, 1);
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
