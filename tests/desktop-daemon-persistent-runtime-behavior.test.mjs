import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import { createPreToolUseHook, normalizePermissionMode } from '../desktop/daemon/permissionMode.js';

const daemonSource = readFileSync(new URL('../desktop/daemon/ccnexus-daemon.js', import.meta.url), 'utf8')
  .replace(/\r\n/g, '\n')
  .replace(
    "import { createInterface } from 'node:readline';\nimport { createRequire } from 'node:module';\nimport { randomUUID } from 'node:crypto';\nimport {\n  createPreToolUseHook,\n  normalizePermissionMode,\n} from './permissionMode.js';\n\nconst require = createRequire(import.meta.url);\nconst { query: sdkQuery } = require('@anthropic-ai/claude-agent-sdk');",
    "const { createInterface, sdkQuery, randomUUID, createPreToolUseHook, normalizePermissionMode } = globalThis.__daemonDeps;",
  );

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
    params: { prompt: 'hello', options: { cwd: 'D:/ccNexus', model: 'deepseek-v4-pro' } },
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

function createDaemonHarness({ turnGates = [], interruptGate = null, invokeTool = false } = {}) {
  const state = {
    messages: [],
    queryCalls: 0,
    turnCount: 0,
    interruptCalls: 0,
    closeCalls: 0,
    exitCalls: 0,
    toolDecision: undefined,
  };
  let lineHandler = null;

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
            async setPermissionMode() {},
            async setModel() {},
            async setMaxThinkingTokens() {},
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
      lineHandler(JSON.stringify(command));
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
