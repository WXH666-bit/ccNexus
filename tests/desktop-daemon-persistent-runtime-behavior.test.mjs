import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import { createPreToolUseHook, normalizePermissionMode } from '../desktop/daemon/permissionMode.js';

const daemonSource = readFileSync(new URL('../desktop/daemon/ccnexus-daemon.js', import.meta.url), 'utf8')
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
