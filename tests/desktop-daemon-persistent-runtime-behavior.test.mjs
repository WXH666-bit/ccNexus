import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import { createPreToolUseHook, normalizePermissionMode } from '../desktop/daemon/permissionMode.js';
import { buildRuntimeSignature, hasSameContextModel } from '../server/runtimeIdentity.js';

const daemonSource = readFileSync(new URL('../desktop/daemon/ccnexus-daemon.js', import.meta.url), 'utf8')
  .replace(/\r\n/g, '\n')
  .replace(
    "import { createInterface } from 'node:readline';\nimport { createRequire } from 'node:module';\nimport { randomUUID } from 'node:crypto';\nimport {\n  createPreToolUseHook,\n  normalizePermissionMode,\n} from './permissionMode.js';\nimport {\n  buildRuntimeSignature,\n  hasSameContextModel,\n} from '../../server/runtimeIdentity.js';\n\nconst require = createRequire(import.meta.url);\nconst { query: sdkQuery } = require('@anthropic-ai/claude-agent-sdk');",
    "const { createInterface, sdkQuery, randomUUID, createPreToolUseHook, normalizePermissionMode, buildRuntimeSignature, hasSameContextModel } = globalThis.__daemonDeps;",
  )
  .replace(
    "import {\n  buildRuntimeSignature,\n  hasSameContextModel,\n} from '../../server/runtimeIdentity.js';",
    '',
  );

const testRuntimeDescriptor = {
  rawModelId: 'claude-sonnet-4-6',
  sdkModelName: 'sonnet',
  resolvedModelId: 'backend-sonnet',
  contextWindow1M: false,
  runtimeSessionEpoch: 'epoch-test',
  workspaceIdentity: 'D:/ccNexus',
  providerGeneration: '',
};

function createFakeQuery(inputStream, state, options = {}) {
  state.queryCalls += 1;
  state.hook = options.hooks?.PreToolUse?.[0]?.hooks?.[0] || state.hook;
  const input = inputStream[Symbol.asyncIterator]();
  const queue = [];
  let sessionId = '';

  return {
    async next() {
      if (queue.length === 0) {
        const nextInput = await input.next();
        if (nextInput.done) return { done: true, value: undefined };
        sessionId = sessionId || nextInput.value.session_id || 'session-1';
        if (!state.initEmitted) {
          state.initEmitted = true;
          sessionId = 'session-1';
          queue.push({ type: 'system', subtype: 'init', session_id: sessionId });
        }
        if (state.triggerPlanApproval && state.hook) {
          state.triggerPlanApproval = false;
          await state.hook({
            tool_name: 'ExitPlanMode',
            tool_input: {
              plan: '# Make the requested change',
              allowedPrompts: [{ tool: 'Edit', prompt: 'edit the requested file' }],
            },
          });
        }
        queue.push({ type: 'assistant', session_id: sessionId, message: { content: [] } });
        queue.push({ type: 'result', subtype: 'success', session_id: sessionId });
      }
      return { done: false, value: queue.shift() };
    },
    close() {
      state.closed += 1;
    },
    async setPermissionMode(mode) {
      state.permissionModes.push(mode);
    },
    async setModel(model) {
      state.models.push(model);
    },
    async setMaxThinkingTokens(tokens) {
      state.maxThinkingTokens.push(tokens);
    },
  };
}

async function waitForDone(messages, id) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < 1000) {
    const found = messages.find((message) => message.id === id && message.done);
    if (found) return found;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  assert.fail(`Timed out waiting for ${id}`);
}

async function waitForMessage(messages, predicate) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < 1000) {
    const found = messages.find(predicate);
    if (found) return found;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  assert.fail('Timed out waiting for daemon message');
}

test('desktop daemon reuses one SDK query across consecutive turns in the same session', async () => {
  const state = {
    queryCalls: 0,
    closed: 0,
    initEmitted: false,
    permissionModes: [],
    models: [],
    maxThinkingTokens: [],
    hook: null,
    triggerPlanApproval: false,
  };
  const messages = [];
  let lineHandler = null;
  const stdinHandlers = new Map();
  const processHandlers = new Map();

  const context = {
    console,
    setTimeout,
    clearTimeout,
    Promise,
    globalThis: {
      __daemonDeps: {
        randomUUID: () => 'test-plan-id',
        createPreToolUseHook,
        normalizePermissionMode,
        buildRuntimeSignature,
        hasSameContextModel,
        createInterface() {
          return {
            on(event, handler) {
              if (event === 'line') lineHandler = handler;
            },
          };
        },
        sdkQuery({ prompt, options }) {
          return createFakeQuery(prompt, state, options);
        },
      },
    },
    process: {
      pid: 1234,
      uptime: () => 1,
      stdout: {
        write(chunk) {
          for (const line of String(chunk).split('\n')) {
            if (!line.trim()) continue;
            messages.push(JSON.parse(line));
          }
          return true;
        },
      },
      stdin: {
        on(event, handler) {
          stdinHandlers.set(event, handler);
        },
      },
      on(event, handler) {
        processHandlers.set(event, handler);
      },
      exit() {
        throw new Error('process.exit should not be called in this test');
      },
    },
  };

  vm.runInNewContext(daemonSource, context, { filename: 'ccnexus-daemon.js' });
  assert.equal(typeof lineHandler, 'function');

  lineHandler(JSON.stringify({
    id: 'turn-1',
    method: 'query',
    params: {
      prompt: 'hello',
      options: { cwd: 'D:/ccNexus', model: 'deepseek-v4-pro' },
      runtimeDescriptor: testRuntimeDescriptor,
    },
  }));
  await waitForDone(messages, 'turn-1');

  state.triggerPlanApproval = true;
  lineHandler(JSON.stringify({
    id: 'turn-2',
    method: 'query',
    params: {
      prompt: 'make the change',
      options: {
        cwd: 'D:/ccNexus',
        model: 'deepseek-v4-pro',
        permissionMode: 'plan',
        resume: 'session-1',
      },
      runtimeDescriptor: testRuntimeDescriptor,
    },
  }));
  const planRequest = await waitForMessage(messages, message => (
    message.type === 'plan_approval' && message.id === 'turn-2'
  ));
  lineHandler(JSON.stringify({
    method: 'plan_approval_response',
    params: {
      requestId: planRequest.requestId,
      approved: true,
      targetMode: 'auto',
    },
  }));
  await waitForDone(messages, 'turn-2');

  lineHandler(JSON.stringify({
    id: 'mode-1',
    method: 'set_permission_mode',
    params: { mode: 'acceptEdits' },
  }));
  await waitForDone(messages, 'mode-1');

  assert.equal(state.queryCalls, 1);
  assert.equal(state.closed, 0);
  assert.deepEqual(state.permissionModes, ['plan', 'auto', 'acceptEdits']);
});

test('daemon rejects a context request from a stale runtime epoch', async () => {
  const harness = createDaemonHarness({ turnGates: [Promise.resolve()] });
  const descriptor = {
    rawModelId: 'claude-sonnet-4-6[1m]',
    sdkModelName: 'sonnet',
    resolvedModelId: 'backend-sonnet[1m]',
    contextWindow1M: true,
    runtimeSessionEpoch: 'epoch-live',
    workspaceIdentity: 'D:/ccNexus',
    providerGeneration: '',
  };

  harness.send({
    id: 'turn-live',
    method: 'query',
    params: {
      prompt: 'hello',
      options: { cwd: 'D:/ccNexus', model: 'sonnet' },
      runtimeDescriptor: descriptor,
    },
  });
  await waitForDone(harness.state.messages, 'turn-live');

  harness.send({
    id: 'context-stale',
    method: 'context_usage',
    params: {
      options: { cwd: 'D:/ccNexus', model: 'sonnet' },
      runtimeDescriptor: { ...descriptor, runtimeSessionEpoch: 'epoch-stale' },
    },
  });
  const stale = await waitForDone(harness.state.messages, 'context-stale');

  assert.equal(stale.success, false);
  assert.match(stale.error, /epoch|ownership/i);
  assert.equal(harness.state.contextCalls, 0);
});

test('daemon queues context usage behind an active turn and reuses the current runtime', async () => {
  let releaseTurn;
  const turnGate = new Promise((resolve) => { releaseTurn = resolve; });
  const harness = createDaemonHarness({ turnGates: [turnGate] });

  harness.send({
    id: 'turn-context',
    method: 'query',
    params: {
      prompt: 'working',
      options: { cwd: 'D:/ccNexus', model: 'sonnet' },
      runtimeDescriptor: testRuntimeDescriptor,
    },
  });
  await waitForCondition(() => harness.state.turnCount === 1);

  harness.send({
    id: 'context-queued',
    method: 'context_usage',
    params: {
      options: { cwd: 'D:/ccNexus', model: 'sonnet', permissionMode: 'plan' },
      runtimeDescriptor: testRuntimeDescriptor,
    },
  });
  await new Promise((resolve) => setTimeout(resolve, 20));

  assert.equal(harness.state.contextCalls, 0);
  assert.equal(harness.state.queryCalls, 1);
  assert.equal(harness.state.closeCalls, 0);
  assert.deepEqual(harness.state.models, []);
  assert.deepEqual(harness.state.maxThinkingTokens, []);

  releaseTurn();
  await waitForDone(harness.state.messages, 'turn-context');
  const contextResult = await waitForDone(harness.state.messages, 'context-queued');

  assert.equal(contextResult.success, true);
  assert.equal(harness.state.contextCalls, 1);
  assert.equal(harness.state.queryCalls, 1);
  assert.equal(harness.state.closeCalls, 0);
  assert.deepEqual(harness.state.models, []);
  assert.deepEqual(harness.state.maxThinkingTokens, []);
  assert.deepEqual(harness.state.permissionModes, []);
});

test('daemon rebuilds instead of live-setModel when the model route changes', async () => {
  const harness = createDaemonHarness({ turnGates: [Promise.resolve(), Promise.resolve()] });
  const firstOptions = { cwd: 'D:/ccNexus', model: 'sonnet', env: { ANTHROPIC_MODEL: 'backend-a' } };
  const secondOptions = { ...firstOptions, env: { ANTHROPIC_MODEL: 'backend-b' }, resume: 'session-1' };

  harness.send({
    id: 'route-a',
    method: 'query',
    params: {
      prompt: 'first',
      options: firstOptions,
      runtimeDescriptor: { ...testRuntimeDescriptor, resolvedModelId: 'backend-a' },
    },
  });
  await waitForDone(harness.state.messages, 'route-a');

  harness.send({
    id: 'route-b',
    method: 'query',
    params: {
      prompt: 'second',
      options: secondOptions,
      runtimeDescriptor: { ...testRuntimeDescriptor, resolvedModelId: 'backend-b' },
    },
  });
  await waitForDone(harness.state.messages, 'route-b');

  assert.equal(harness.state.queryCalls, 2);
  assert.equal(harness.state.closeCalls, 1);
  assert.deepEqual(harness.state.models, []);
});

test('daemon rebuilds and logs when live thinking controls are unavailable', async () => {
  const harness = createDaemonHarness({
    turnGates: [Promise.resolve(), Promise.resolve()],
    maxThinkingTokensSupported: false,
  });
  const firstOptions = { cwd: 'D:/ccNexus', model: 'sonnet', maxThinkingTokens: 4000 };
  const secondOptions = { ...firstOptions, maxThinkingTokens: 8000, resume: 'session-1' };

  harness.send({
    id: 'thinking-a',
    method: 'query',
    params: { prompt: 'first', options: firstOptions },
  });
  await waitForDone(harness.state.messages, 'thinking-a');

  harness.send({
    id: 'thinking-b',
    method: 'query',
    params: { prompt: 'second', options: secondOptions },
  });
  await waitForDone(harness.state.messages, 'thinking-b');

  assert.equal(harness.state.queryCalls, 2);
  assert.equal(harness.state.closeCalls, 1);
  assert.equal(harness.state.maxThinkingTokens.length, 0);
  assert.equal(harness.state.consoleErrors.length, 1);
  assert.match(harness.state.consoleErrors[0], /maxThinkingTokens/i);
});

test('daemon rebuilds and logs when live thinking controls throw', async () => {
  const harness = createDaemonHarness({
    turnGates: [Promise.resolve(), Promise.resolve()],
    maxThinkingTokensThrows: true,
  });
  const firstOptions = { cwd: 'D:/ccNexus', model: 'sonnet', maxThinkingTokens: 4000 };
  const secondOptions = { ...firstOptions, maxThinkingTokens: 8000, resume: 'session-1' };

  harness.send({
    id: 'throw-a',
    method: 'query',
    params: { prompt: 'first', options: firstOptions },
  });
  await waitForDone(harness.state.messages, 'throw-a');
  harness.send({
    id: 'throw-b',
    method: 'query',
    params: { prompt: 'second', options: secondOptions },
  });
  await waitForDone(harness.state.messages, 'throw-b');

  assert.equal(harness.state.queryCalls, 2);
  assert.equal(harness.state.closeCalls, 1);
  assert.equal(harness.state.consoleErrors.length, 1);
  assert.match(harness.state.consoleErrors[0], /rejected|maxThinkingTokens/i);
});

test('daemon ignores a stale abort requestId and leaves the newer query untouched', async () => {
  let releaseSecondTurn;
  const secondTurn = new Promise((resolve) => { releaseSecondTurn = resolve; });
  const harness = createDaemonHarness({ turnGates: [Promise.resolve(), secondTurn] });

  harness.send({
    id: 'turn-a',
    method: 'query',
    params: { prompt: 'first', options: { cwd: 'D:/ccNexus', model: 'sonnet' } },
  });
  await waitForCondition(() => harness.state.turnCount === 1);
  await waitForDone(harness.state.messages, 'turn-a');

  harness.send({
    id: 'turn-b',
    method: 'query',
    params: { prompt: 'second', options: { cwd: 'D:/ccNexus', model: 'sonnet', resume: 'session-1' } },
  });
  await waitForCondition(() => harness.state.turnCount === 2);
  harness.send({ id: 'abort-stale', method: 'abort', params: { requestId: 'turn-a' } });
  await waitForDone(harness.state.messages, 'abort-stale');

  assert.equal(harness.state.interruptCalls, 0);
  releaseSecondTurn();
  const secondDone = await waitForDone(harness.state.messages, 'turn-b');
  assert.equal(secondDone.success, true);
});

test('daemon keeps the active busy guard while matching abort cleanup overlaps query completion', async () => {
  let releaseTurn;
  let releaseInterrupt;
  const turnGate = new Promise((resolve) => { releaseTurn = resolve; });
  const interruptGate = new Promise((resolve) => { releaseInterrupt = resolve; });
  const harness = createDaemonHarness({ turnGates: [turnGate], interruptGate });

  harness.send({
    id: 'turn-abort',
    method: 'query',
    params: { prompt: 'abort', options: { cwd: 'D:/ccNexus', model: 'sonnet' } },
  });
  await waitForCondition(() => harness.state.turnCount === 1);
  harness.send({ id: 'abort-active', method: 'abort', params: { requestId: 'turn-abort' } });
  await waitForCondition(() => harness.state.interruptCalls === 1);

  releaseTurn();
  await waitForDone(harness.state.messages, 'turn-abort');
  harness.send({
    id: 'turn-after-abort',
    method: 'query',
    params: { prompt: 'must stay busy', options: { cwd: 'D:/ccNexus', model: 'sonnet' } },
  });
  const busy = await waitForDone(harness.state.messages, 'turn-after-abort');
  assert.equal(busy.success, false);
  assert.match(busy.error, /busy/i);

  releaseInterrupt();
  await waitForDone(harness.state.messages, 'abort-active');
});

test('daemon keeps the active busy guard while shutdown cleanup overlaps query completion', async () => {
  let releaseTurn;
  let releaseInterrupt;
  const turnGate = new Promise((resolve) => { releaseTurn = resolve; });
  const interruptGate = new Promise((resolve) => { releaseInterrupt = resolve; });
  const harness = createDaemonHarness({ turnGates: [turnGate], interruptGate });

  harness.send({
    id: 'turn-shutdown',
    method: 'query',
    params: { prompt: 'shutdown', options: { cwd: 'D:/ccNexus', model: 'sonnet' } },
  });
  await waitForCondition(() => harness.state.turnCount === 1);
  harness.send({ id: 'shutdown-1', method: 'shutdown' });
  await waitForCondition(() => harness.state.interruptCalls === 1);

  releaseTurn();
  await waitForDone(harness.state.messages, 'turn-shutdown');
  harness.send({
    id: 'turn-after-shutdown',
    method: 'query',
    params: { prompt: 'must stay busy', options: { cwd: 'D:/ccNexus', model: 'sonnet' } },
  });
  const busy = await waitForDone(harness.state.messages, 'turn-after-shutdown');
  assert.equal(busy.success, false);
  assert.match(busy.error, /busy/i);

  releaseInterrupt();
  await waitForDone(harness.state.messages, 'shutdown-1');
  assert.equal(harness.state.exitCalls, 1);
});

test('daemon enforces serialized deny-all-tools policy for isolated prompt enhancement', async () => {
  const harness = createDaemonHarness({ turnGates: [Promise.resolve()], invokeTool: true });
  harness.send({
    id: 'isolated-query',
    method: 'query',
    params: {
      prompt: 'rewrite',
      options: {
        cwd: 'D:/ccNexus',
        model: 'sonnet',
        tools: [],
        strictMcpConfig: true,
        isolatedDenyAllTools: true,
      },
    },
  });

  await waitForDone(harness.state.messages, 'isolated-query');
  assert.equal(harness.state.toolDecision?.behavior, 'deny');
  assert.equal(harness.state.toolDecision?.message, 'Prompt enhancement cannot use tools');
});

function createDaemonHarness({
  turnGates = [],
  interruptGate = null,
  invokeTool = false,
  maxThinkingTokensSupported = true,
  maxThinkingTokensThrows = false,
} = {}) {
  const state = {
    messages: [],
    queryCalls: 0,
    turnCount: 0,
    interruptCalls: 0,
    closeCalls: 0,
    exitCalls: 0,
    contextCalls: 0,
    permissionModes: [],
    models: [],
    maxThinkingTokens: [],
    consoleErrors: [],
    toolDecision: undefined,
  };
  let lineHandler = null;

  const context = {
    console: {
      error(...args) { state.consoleErrors.push(args.map(String).join(' ')); },
    },
    setTimeout,
    clearTimeout,
    Promise,
    globalThis: {
      __daemonDeps: {
        randomUUID: () => 'test-plan-id',
        createPreToolUseHook,
        normalizePermissionMode,
        buildRuntimeSignature,
        hasSameContextModel,
        createInterface() {
          return {
            on(event, handler) {
              if (event === 'line') lineHandler = handler;
            },
          };
        },
        sdkQuery({ prompt, options }) {
          state.queryCalls += 1;
          const input = prompt[Symbol.asyncIterator]();
          const queue = [];
          let sessionId = '';
          return {
            async next() {
              if (queue.length) return { done: false, value: queue.shift() };
              const nextInput = await input.next();
              if (nextInput.done) return { done: true, value: undefined };
              const turnIndex = state.turnCount;
              state.turnCount += 1;
              sessionId = sessionId || nextInput.value.session_id || 'session-1';
              queue.push({ type: 'system', subtype: 'init', session_id: sessionId });
              const gate = turnGates[turnIndex];
              if (gate) await gate;
              if (invokeTool && turnIndex === 0) {
                state.toolDecision = await Promise.race([
                  options.canUseTool('Read', { file_path: 'D:/ccNexus/file.txt' }),
                  new Promise((resolve) => setTimeout(() => resolve('timed-out'), 50)),
                ]);
              }
              queue.push({ type: 'result', subtype: 'success', session_id: sessionId });
              return { done: false, value: queue.shift() };
            },
            async interrupt() {
              state.interruptCalls += 1;
              if (interruptGate) await interruptGate;
            },
            async close() {
              state.closeCalls += 1;
            },
            async getContextUsage() {
              state.contextCalls += 1;
              return { used: 10, size: 100 };
            },
            async setPermissionMode(mode) { state.permissionModes.push(mode); },
            async setModel(model) { state.models.push(model); },
            ...(maxThinkingTokensSupported ? {
              async setMaxThinkingTokens(tokens) {
                if (maxThinkingTokensThrows) throw new Error('thinking control rejected');
                state.maxThinkingTokens.push(tokens);
              },
            } : {}),
          };
        },
      },
    },
    process: {
      pid: 1234,
      uptime: () => 1,
      stdout: {
        write(chunk) {
          for (const line of String(chunk).split('\n')) {
            if (!line.trim()) continue;
            state.messages.push(JSON.parse(line));
          }
          return true;
        },
      },
      stdin: { on() {} },
      on() {},
      exit() { state.exitCalls += 1; },
    },
  };

  vm.runInNewContext(daemonSource, context, { filename: 'ccnexus-daemon.js' });
  return {
    state,
    send(command) {
      const params = command.params || {};
      const needsDescriptor = command.method === 'query' || command.method === 'context_usage';
      lineHandler(JSON.stringify(needsDescriptor && !params.runtimeDescriptor
        ? { ...command, params: { ...params, runtimeDescriptor: testRuntimeDescriptor } }
        : command));
    },
  };
}

async function waitForCondition(predicate, { attempts = 200 } = {}) {
  for (let index = 0; index < attempts; index += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 1));
  }
  assert.fail('Condition was not met in time');
}
