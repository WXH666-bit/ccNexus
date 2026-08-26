import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import { createPostToolUseHook, createPreToolUseHook, normalizePermissionMode } from '../desktop/daemon/permissionMode.js';
import { buildRuntimeSignature, hasSameContextModel } from '../server/runtimeIdentity.js';
import {
  DEFAULT_RUNTIME_ABSOLUTE_LIFETIME_MS,
  DEFAULT_RUNTIME_IDLE_TIMEOUT_MS,
  RUNTIME_CLEANUP_INTERVAL_MS,
  getRuntimeRetirementReason,
  isRuntimeRetirementBlocked,
} from '../desktop/runtime/runtimeLifecyclePolicy.js';

const daemonSource = readFileSync(new URL('../desktop/daemon/ccnexus-daemon.js', import.meta.url), 'utf8')
  .replace(/\r\n/g, '\n')
  .replace(
    "import {\n  DEFAULT_RUNTIME_ABSOLUTE_LIFETIME_MS,\n  DEFAULT_RUNTIME_IDLE_TIMEOUT_MS,\n  RUNTIME_CLEANUP_INTERVAL_MS,\n  getRuntimeRetirementReason,\n  isRuntimeRetirementBlocked,\n} from '../runtime/runtimeLifecyclePolicy.js';\n",
    '',
  )
  .replace(
    "import { createInterface } from 'node:readline';\nimport { createRequire } from 'node:module';\nimport { randomUUID } from 'node:crypto';\nimport {\n  createPostToolUseHook,\n  createPreToolUseHook,\n  normalizePermissionMode,\n} from './permissionMode.js';\nimport {\n  buildRuntimeSignature,\n  hasSameContextModel,\n} from '../../server/runtimeIdentity.js';\n\nconst require = createRequire(import.meta.url);\nconst { query: sdkQuery } = require('@anthropic-ai/claude-agent-sdk');",
    "const { createInterface, sdkQuery, randomUUID, createPostToolUseHook, createPreToolUseHook, normalizePermissionMode, DEFAULT_RUNTIME_ABSOLUTE_LIFETIME_MS, DEFAULT_RUNTIME_IDLE_TIMEOUT_MS, buildRuntimeSignature, hasSameContextModel, RUNTIME_CLEANUP_INTERVAL_MS, getRuntimeRetirementReason, isRuntimeRetirementBlocked } = globalThis.__daemonDeps;",
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

function retirementObservationFromStatus(status) {
  return {
    runtimeGeneration: status.result.runtime?.runtimeGeneration ?? null,
    runtimeSessionEpoch: status.result.runtime?.runtimeSessionEpoch ?? null,
    runtimeCreatedAt: status.result.runtime?.createdAt ?? null,
    runtimeLastUsedAt: status.result.runtime?.lastUsedAt ?? null,
    daemonLastUsedAt: status.result.daemonLastUsedAt ?? null,
  };
}

function runtimeMetadataFor(messages, id) {
  const message = messages.find(candidate => candidate.id === id && candidate.type === 'runtime_metadata');
  if (message) return message;
  return messages.find(candidate => candidate.id === id && candidate.done)?.runtimeMetadata;
}

test('daemon reports cold and warm from actual SDK query acquisition', async () => {
  const harness = createDaemonHarness({
    turnGates: [Promise.resolve(), Promise.resolve(), Promise.resolve(), Promise.resolve()],
  });
  const options = { cwd: 'D:/ccNexus', model: 'sonnet' };

  harness.send({
    id: 'classification-first',
    method: 'query',
    params: { prompt: 'first', options, runtimeDescriptor: testRuntimeDescriptor },
  });
  await waitForDone(harness.state.messages, 'classification-first');
  const first = runtimeMetadataFor(harness.state.messages, 'classification-first');
  assert.equal(first.classification, 'cold');
  assert.equal(first.creationReason, 'initial');
  assert.equal(typeof first.generationId, 'number');
  assert.equal(first.runtimeRetirementReason, undefined);

  harness.send({
    id: 'classification-second',
    method: 'query',
    params: {
      prompt: 'second',
      options: { ...options, resume: 'session-1' },
      runtimeDescriptor: testRuntimeDescriptor,
    },
  });
  await waitForDone(harness.state.messages, 'classification-second');
  const second = runtimeMetadataFor(harness.state.messages, 'classification-second');
  assert.equal(second.classification, 'warm');
  assert.equal(second.generationId, first.generationId);
  assert.equal(harness.state.queryCalls, 1);

  harness.send({
    id: 'classification-route-change',
    method: 'query',
    params: {
      prompt: 'route change',
      options: { ...options, resume: 'session-1', env: { ANTHROPIC_MODEL: 'backend-b' } },
      runtimeDescriptor: { ...testRuntimeDescriptor, resolvedModelId: 'backend-b' },
    },
  });
  await waitForDone(harness.state.messages, 'classification-route-change');
  const routeChange = runtimeMetadataFor(harness.state.messages, 'classification-route-change');
  assert.equal(routeChange.classification, 'cold');
  assert.equal(routeChange.creationReason, 'identity-change');
  assert.notEqual(routeChange.generationId, first.generationId);
  assert.equal(harness.state.queryCalls, 2);

  harness.send({
    id: 'classification-route-warm',
    method: 'query',
    params: {
      prompt: 'route warm',
      options: { ...options, resume: 'session-1', env: { ANTHROPIC_MODEL: 'backend-b' } },
      runtimeDescriptor: { ...testRuntimeDescriptor, resolvedModelId: 'backend-b' },
    },
  });
  await waitForDone(harness.state.messages, 'classification-route-warm');
  const routeWarm = runtimeMetadataFor(harness.state.messages, 'classification-route-warm');
  assert.equal(routeWarm.classification, 'warm');
  assert.equal(routeWarm.generationId, routeChange.generationId);
  assert.equal(harness.state.queryCalls, 2);
});

test('daemon reports cold and warm for raw 1M identity changes in both directions', async () => {
  const harness = createDaemonHarness({
    turnGates: [
      Promise.resolve(),
      Promise.resolve(),
      Promise.resolve(),
      Promise.resolve(),
      Promise.resolve(),
    ],
  });
  const options = { cwd: 'D:/ccNexus', model: 'sonnet' };

  harness.send({
    id: 'one-million-first',
    method: 'query',
    params: { prompt: 'standard', options, runtimeDescriptor: testRuntimeDescriptor },
  });
  await waitForDone(harness.state.messages, 'one-million-first');
  const first = runtimeMetadataFor(harness.state.messages, 'one-million-first');
  assert.equal(first.classification, 'cold');
  assert.equal(harness.state.queryCalls, 1);

  const oneMillionDescriptor = {
    ...testRuntimeDescriptor,
    rawModelId: 'claude-sonnet-4-6[1m]',
    contextWindow1M: true,
  };
  harness.send({
    id: 'one-million-change',
    method: 'query',
    params: {
      prompt: 'one million',
      options: { ...options, resume: 'session-1' },
      runtimeDescriptor: oneMillionDescriptor,
    },
  });
  await waitForDone(harness.state.messages, 'one-million-change');
  const changed = runtimeMetadataFor(harness.state.messages, 'one-million-change');
  assert.equal(changed.classification, 'cold');
  assert.equal(changed.creationReason, 'identity-change');
  assert.notEqual(changed.generationId, first.generationId);
  assert.equal(harness.state.queryCalls, 2);

  harness.send({
    id: 'one-million-warm',
    method: 'query',
    params: {
      prompt: 'one million again',
      options: { ...options, resume: 'session-1' },
      runtimeDescriptor: oneMillionDescriptor,
    },
  });
  await waitForDone(harness.state.messages, 'one-million-warm');
  const warm = runtimeMetadataFor(harness.state.messages, 'one-million-warm');
  assert.equal(warm.classification, 'warm');
  assert.equal(warm.generationId, changed.generationId);
  assert.equal(harness.state.queryCalls, 2);

  harness.send({
    id: 'one-million-standard-change',
    method: 'query',
    params: {
      prompt: 'standard again',
      options: { ...options, resume: 'session-1' },
      runtimeDescriptor: testRuntimeDescriptor,
    },
  });
  await waitForDone(harness.state.messages, 'one-million-standard-change');
  const standardChange = runtimeMetadataFor(harness.state.messages, 'one-million-standard-change');
  assert.equal(standardChange.classification, 'cold');
  assert.equal(standardChange.creationReason, 'identity-change');
  assert.notEqual(standardChange.generationId, changed.generationId);
  assert.equal(harness.state.queryCalls, 3);

  harness.send({
    id: 'one-million-standard-warm',
    method: 'query',
    params: {
      prompt: 'standard again warm',
      options: { ...options, resume: 'session-1' },
      runtimeDescriptor: testRuntimeDescriptor,
    },
  });
  await waitForDone(harness.state.messages, 'one-million-standard-warm');
  const standardWarm = runtimeMetadataFor(harness.state.messages, 'one-million-standard-warm');
  assert.equal(standardWarm.classification, 'warm');
  assert.equal(standardWarm.generationId, standardChange.generationId);
  assert.equal(harness.state.queryCalls, 3);
});

test('daemon reports cold for an MCP snapshot change and warm afterward', async () => {
  const harness = createDaemonHarness({ turnGates: [Promise.resolve(), Promise.resolve(), Promise.resolve()] });
  const baseOptions = { cwd: 'D:/ccNexus', model: 'sonnet', mcpServers: {} };
  const changedOptions = {
    ...baseOptions,
    resume: 'session-1',
    mcpServers: { docs: { command: 'node', args: ['docs-server.mjs'] } },
  };

  harness.send({
    id: 'mcp-first',
    method: 'query',
    params: { prompt: 'without MCP', options: baseOptions, runtimeDescriptor: testRuntimeDescriptor },
  });
  await waitForDone(harness.state.messages, 'mcp-first');
  const first = runtimeMetadataFor(harness.state.messages, 'mcp-first');

  harness.send({
    id: 'mcp-change',
    method: 'query',
    params: { prompt: 'with MCP', options: changedOptions, runtimeDescriptor: testRuntimeDescriptor },
  });
  await waitForDone(harness.state.messages, 'mcp-change');
  const changed = runtimeMetadataFor(harness.state.messages, 'mcp-change');
  assert.equal(changed.classification, 'cold');
  assert.equal(changed.creationReason, 'identity-change');
  assert.notEqual(changed.generationId, first.generationId);

  harness.send({
    id: 'mcp-warm',
    method: 'query',
    params: { prompt: 'MCP again', options: changedOptions, runtimeDescriptor: testRuntimeDescriptor },
  });
  await waitForDone(harness.state.messages, 'mcp-warm');
  const warm = runtimeMetadataFor(harness.state.messages, 'mcp-warm');
  assert.equal(warm.classification, 'warm');
  assert.equal(warm.generationId, changed.generationId);
  assert.equal(harness.state.queryCalls, 2);
});

test('daemon reports context reuse warm without rebuilding and context creation cold before chat warm', async () => {
  const existingHarness = createDaemonHarness();
  const options = { cwd: 'D:/ccNexus', model: 'sonnet' };
  existingHarness.send({
    id: 'context-existing-query',
    method: 'query',
    params: { prompt: 'create runtime', options, runtimeDescriptor: testRuntimeDescriptor },
  });
  await waitForDone(existingHarness.state.messages, 'context-existing-query');
  existingHarness.send({
    id: 'context-existing',
    method: 'context_usage',
    params: { options: { ...options, permissionMode: 'plan' }, runtimeDescriptor: testRuntimeDescriptor },
  });
  await waitForDone(existingHarness.state.messages, 'context-existing');
  const existingMetadata = runtimeMetadataFor(existingHarness.state.messages, 'context-existing');
  assert.equal(existingMetadata.classification, 'warm');
  assert.equal(existingHarness.state.queryCalls, 1);

  const contextFirstHarness = createDaemonHarness({ turnGates: [Promise.resolve()] });
  contextFirstHarness.send({
    id: 'context-first',
    method: 'context_usage',
    params: { options, runtimeDescriptor: testRuntimeDescriptor },
  });
  await waitForDone(contextFirstHarness.state.messages, 'context-first');
  const contextFirstMetadata = runtimeMetadataFor(contextFirstHarness.state.messages, 'context-first');
  assert.equal(contextFirstMetadata.classification, 'cold');
  assert.equal(contextFirstMetadata.creationReason, 'initial');

  contextFirstHarness.send({
    id: 'context-following-chat',
    method: 'query',
    params: { prompt: 'reuse context runtime', options: { ...options, resume: 'session-1' }, runtimeDescriptor: testRuntimeDescriptor },
  });
  await waitForDone(contextFirstHarness.state.messages, 'context-following-chat');
  const chatMetadata = runtimeMetadataFor(contextFirstHarness.state.messages, 'context-following-chat');
  assert.equal(chatMetadata.classification, 'warm');
  assert.equal(chatMetadata.generationId, contextFirstMetadata.generationId);
  assert.equal(contextFirstHarness.state.queryCalls, 1);
});

test('daemon reports session conflicts and dynamic control rebuilds with distinct creation reasons', async () => {
  const sessionHarness = createDaemonHarness({ turnGates: [Promise.resolve(), Promise.resolve()] });
  const options = { cwd: 'D:/ccNexus', model: 'sonnet' };
  sessionHarness.send({
    id: 'session-conflict-first',
    method: 'query',
    params: { prompt: 'session one', options, runtimeDescriptor: testRuntimeDescriptor },
  });
  await waitForDone(sessionHarness.state.messages, 'session-conflict-first');
  sessionHarness.send({
    id: 'session-conflict-second',
    method: 'query',
    params: { prompt: 'session two', options: { ...options, resume: 'other-session' }, runtimeDescriptor: testRuntimeDescriptor },
  });
  await waitForDone(sessionHarness.state.messages, 'session-conflict-second');
  const conflict = runtimeMetadataFor(sessionHarness.state.messages, 'session-conflict-second');
  assert.equal(conflict.classification, 'cold');
  assert.equal(conflict.creationReason, 'session-conflict');

  const controlHarness = createDaemonHarness({
    turnGates: [Promise.resolve(), Promise.resolve()],
    maxThinkingTokensSupported: false,
  });
  controlHarness.send({
    id: 'control-rebuild-first',
    method: 'query',
    params: {
      prompt: 'thinking four thousand',
      options: { ...options, maxThinkingTokens: 4000 },
      runtimeDescriptor: testRuntimeDescriptor,
    },
  });
  await waitForDone(controlHarness.state.messages, 'control-rebuild-first');
  controlHarness.send({
    id: 'control-rebuild-second',
    method: 'query',
    params: {
      prompt: 'thinking eight thousand',
      options: { ...options, resume: 'session-1', maxThinkingTokens: 8000 },
      runtimeDescriptor: testRuntimeDescriptor,
    },
  });
  await waitForDone(controlHarness.state.messages, 'control-rebuild-second');
  const controlRebuild = runtimeMetadataFor(controlHarness.state.messages, 'control-rebuild-second');
  assert.equal(controlRebuild.classification, 'cold');
  assert.equal(controlRebuild.creationReason, 'dynamic-control-rebuild');
  assert.equal(controlHarness.state.queryCalls, 2);
});

test('daemon emits no lifecycle metadata when SDK query acquisition fails', async () => {
  const harness = createDaemonHarness({ sdkQueryError: new Error('SDK query unavailable') });
  harness.send({
    id: 'acquisition-failure',
    method: 'query',
    params: {
      prompt: 'fail before acquisition',
      options: { cwd: 'D:/ccNexus', model: 'sonnet' },
      runtimeDescriptor: testRuntimeDescriptor,
    },
  });
  const response = await waitForDone(harness.state.messages, 'acquisition-failure');

  assert.equal(response.success, false);
  assert.equal(harness.state.queryCalls, 1);
  assert.equal(runtimeMetadataFor(harness.state.messages, 'acquisition-failure'), undefined);
});

function createControlledClock(initialNow = 0) {
  let now = initialNow;
  class ControlledDate extends Date {
    constructor(...args) {
      super(...(args.length > 0 ? args : [now]));
    }

    static now() {
      return now;
    }
  }

  return {
    Date: ControlledDate,
    now: () => now,
    setNow(value) {
      now = value;
    },
  };
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
        createPostToolUseHook,
        createPreToolUseHook,
        normalizePermissionMode,
        DEFAULT_RUNTIME_ABSOLUTE_LIFETIME_MS,
        DEFAULT_RUNTIME_IDLE_TIMEOUT_MS,
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

test('FIFO: queued query behind blocked context_usage stays pending, completes second, and is warm', async () => {
  let releaseContext;
  const contextGate = new Promise(resolve => { releaseContext = resolve; });
  const harness = createDaemonHarness({
    contextGates: [contextGate],
    turnGates: [Promise.resolve()],
  });
  const options = { cwd: 'D:/ccNexus', model: 'sonnet' };

  harness.send({
    id: 'fifo-context-first',
    method: 'context_usage',
    params: { options, runtimeDescriptor: testRuntimeDescriptor },
  });
  await waitForCondition(() => harness.state.contextCalls === 1);

  harness.send({
    id: 'fifo-query-second',
    method: 'query',
    params: {
      prompt: 'after context',
      options: { ...options, resume: 'session-1' },
      runtimeDescriptor: testRuntimeDescriptor,
    },
  });
  await new Promise(resolve => setTimeout(resolve, 20));

  assert.equal(
    harness.state.messages.some(message => message.id === 'fifo-query-second' && message.done),
    false,
  );
  assert.equal(harness.state.queryCalls, 1);
  assert.deepEqual(harness.state.dataPlaneStarts, ['context_usage']);

  releaseContext();
  const contextResult = await waitForDone(harness.state.messages, 'fifo-context-first');
  const queryResult = await waitForDone(harness.state.messages, 'fifo-query-second');

  assert.equal(contextResult.success, true);
  assert.equal(queryResult.success, true);
  assert.equal(runtimeMetadataFor(harness.state.messages, 'fifo-query-second').classification, 'warm');
  assert.equal(harness.state.queryCalls, 1);
  assert.deepEqual(harness.state.dataPlaneStarts, ['context_usage', 'query']);
  assert.deepEqual(
    harness.state.messages.filter(message => message.done).map(message => message.id),
    ['fifo-context-first', 'fifo-query-second'],
  );
});

test('FIFO: interleaved context_usage and query requests complete in arrival order', async () => {
  const harness = createDaemonHarness({
    contextGates: [Promise.resolve(), Promise.resolve()],
    turnGates: [Promise.resolve(), Promise.resolve()],
  });
  const options = { cwd: 'D:/ccNexus', model: 'sonnet' };
  const commands = [
    {
      id: 'fifo-interleaved-context-1',
      method: 'context_usage',
      params: { options, runtimeDescriptor: testRuntimeDescriptor },
    },
    {
      id: 'fifo-interleaved-query-1',
      method: 'query',
      params: {
        prompt: 'first turn',
        options: { ...options, resume: 'session-1' },
        runtimeDescriptor: testRuntimeDescriptor,
      },
    },
    {
      id: 'fifo-interleaved-context-2',
      method: 'context_usage',
      params: { options, runtimeDescriptor: testRuntimeDescriptor },
    },
    {
      id: 'fifo-interleaved-query-2',
      method: 'query',
      params: {
        prompt: 'second turn',
        options: { ...options, resume: 'session-1' },
        runtimeDescriptor: testRuntimeDescriptor,
      },
    },
  ];

  for (const command of commands) harness.send(command);
  const results = await Promise.all(commands.map(command => waitForDone(harness.state.messages, command.id)));

  assert.ok(results.every(result => result.success === true));
  assert.deepEqual(
    harness.state.dataPlaneStarts,
    ['context_usage', 'query', 'context_usage', 'query'],
  );
  assert.equal(harness.state.queryCalls, 1);
  assert.deepEqual(
    harness.state.messages.filter(message => message.done).map(message => message.id),
    commands.map(command => command.id),
  );
});

test('queued query abort cancels only the queued request and drains later data-plane work', async () => {
  let releaseContext;
  const contextGate = new Promise(resolve => { releaseContext = resolve; });
  const harness = createDaemonHarness({
    contextGates: [contextGate, Promise.resolve()],
  });

  harness.send({
    id: 'abort-queued-context',
    method: 'context_usage',
    params: { options: { cwd: 'D:/ccNexus', model: 'sonnet' } },
  });
  await waitForCondition(() => harness.state.contextCalls === 1);
  harness.send({
    id: 'abort-queued-query',
    method: 'query',
    params: {
      prompt: 'must not start',
      options: { cwd: 'D:/ccNexus', model: 'sonnet', resume: 'session-1' },
    },
  });
  harness.send({
    id: 'abort-queued-following-context',
    method: 'context_usage',
    params: { options: { cwd: 'D:/ccNexus', model: 'sonnet' } },
  });

  harness.send({
    id: 'abort-queued-command',
    method: 'abort',
    params: { requestId: 'abort-queued-query' },
  });
  const abortResult = await waitForDone(harness.state.messages, 'abort-queued-command');
  assert.deepEqual(abortResult.result, { abortedRequestId: 'abort-queued-query' });

  const cancelled = harness.state.messages.filter(
    message => message.id === 'abort-queued-query' && message.done,
  );
  assert.equal(cancelled.length, 1);
  assert.equal(cancelled[0].success, false);
  assert.equal(cancelled[0].code, 'DAEMON_REQUEST_CANCELLED');
  assert.match(cancelled[0].error, /cancel/i);
  assert.equal(harness.state.turnCount, 0);
  assert.equal(harness.state.interruptCalls, 0);
  assert.equal(harness.state.closeCalls, 0);

  releaseContext();
  await waitForDone(harness.state.messages, 'abort-queued-context');
  const followingContext = await waitForDone(
    harness.state.messages,
    'abort-queued-following-context',
  );
  assert.equal(followingContext.success, true);
  assert.equal(harness.state.contextCalls, 2);
  assert.deepEqual(harness.state.dataPlaneStarts, ['context_usage', 'context_usage']);
});

test('data-plane queue retirement fails queued requests and counts them as a blocker', async () => {
  let releaseContext;
  const contextGate = new Promise(resolve => { releaseContext = resolve; });
  const harness = createDaemonHarness({ contextGates: [contextGate] });

  harness.send({
    id: 'retire-queued-context',
    method: 'context_usage',
    params: { options: { cwd: 'D:/ccNexus', model: 'sonnet' } },
  });
  await waitForCondition(() => harness.state.contextCalls === 1);
  harness.send({
    id: 'retire-queued-query',
    method: 'query',
    params: {
      prompt: 'must not start during retirement',
      options: { cwd: 'D:/ccNexus', model: 'sonnet', resume: 'session-1' },
    },
  });

  harness.send({ id: 'retire-queued-status', method: 'status' });
  const status = await waitForDone(harness.state.messages, 'retire-queued-status');
  assert.equal(status.result.contextUsageRunning, true);
  assert.equal(status.result.pendingControlCount, 2);

  harness.send({ id: 'retire-queued-command', method: 'retire', params: { reason: 'requested' } });
  const retirement = await waitForDone(harness.state.messages, 'retire-queued-command');
  assert.deepEqual(retirement.result, {
    accepted: true,
    retiring: true,
    deferred: true,
    reason: 'requested',
  });

  const rejectedQuery = await waitForDone(harness.state.messages, 'retire-queued-query');
  assert.equal(rejectedQuery.success, false);
  assert.equal(rejectedQuery.code, 'DAEMON_RETIRING');
  assert.equal(harness.state.turnCount, 0);

  releaseContext();
  const contextResult = await waitForDone(harness.state.messages, 'retire-queued-context');
  assert.equal(contextResult.success, true);
  await waitForCondition(() => harness.state.exitCalls === 1);
  assert.equal(harness.state.closeCalls, 1);
});

test('data-plane queue shutdown settles queued requests', async () => {
  let releaseContext;
  const contextGate = new Promise(resolve => { releaseContext = resolve; });
  const harness = createDaemonHarness({ contextGates: [contextGate] });

  harness.send({
    id: 'shutdown-queued-context',
    method: 'context_usage',
    params: { options: { cwd: 'D:/ccNexus', model: 'sonnet' } },
  });
  await waitForCondition(() => harness.state.contextCalls === 1);
  harness.send({
    id: 'shutdown-queued-query',
    method: 'query',
    params: {
      prompt: 'must settle on shutdown',
      options: { cwd: 'D:/ccNexus', model: 'sonnet', resume: 'session-1' },
    },
  });
  harness.send({ id: 'shutdown-queued-command', method: 'shutdown' });

  const rejectedQuery = await waitForDone(harness.state.messages, 'shutdown-queued-query');
  assert.equal(rejectedQuery.success, false);
  assert.equal(rejectedQuery.code, 'DAEMON_SHUTTING_DOWN');
  assert.equal(harness.state.turnCount, 0);
  assert.equal(
    harness.state.messages.filter(message => message.id === 'shutdown-queued-query' && message.done).length,
    1,
  );

  const shutdown = await waitForDone(harness.state.messages, 'shutdown-queued-command');
  assert.deepEqual(shutdown.result, 'bye');
  assert.equal(harness.state.exitCalls, 1);

  releaseContext();
  await waitForDone(harness.state.messages, 'shutdown-queued-context');
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

test('daemon retires immediately when an explicit requested retirement is made', async () => {
  const harness = createDaemonHarness();

  harness.send({ id: 'retire-requested', method: 'retire', params: { reason: 'requested' } });
  const response = await waitForDone(harness.state.messages, 'retire-requested');

  assert.equal(response.success, true);
  assert.deepEqual(response.result, {
    accepted: true,
    retiring: true,
    deferred: false,
    reason: 'requested',
  });
  await waitForCondition(() => harness.state.exitCalls === 1);
  assert.equal(harness.state.closeCalls, 0);
});

test('daemon normalizes legacy manual retirement reasons to requested', async () => {
  const harness = createDaemonHarness();

  harness.send({ id: 'retire-legacy-manual', method: 'retire', params: { reason: 'lifecycle' } });
  const response = await waitForDone(harness.state.messages, 'retire-legacy-manual');

  assert.deepEqual(response.result, {
    accepted: true,
    retiring: true,
    deferred: false,
    reason: 'requested',
  });
  await waitForCondition(() => harness.state.exitCalls === 1);
});

test('daemon status exposes lifecycle timestamps, epoch, and control blockers', async () => {
  const harness = createDaemonHarness({ turnGates: [Promise.resolve()] });
  harness.send({
    id: 'status-turn',
    method: 'query',
    params: { prompt: 'status', options: { cwd: 'D:/ccNexus', model: 'sonnet' } },
  });
  await waitForDone(harness.state.messages, 'status-turn');

  harness.send({ id: 'status-1', method: 'status' });
  const status = await waitForDone(harness.state.messages, 'status-1');
  assert.equal(typeof status.result.daemonStartedAt, 'number');
  assert.equal(typeof status.result.daemonLastUsedAt, 'number');
  assert.equal(status.result.runtime.closed, false);
  assert.equal(typeof status.result.runtime.createdAt, 'number');
  assert.equal(typeof status.result.runtime.lastUsedAt, 'number');
  assert.equal(typeof status.result.runtime.runtimeGeneration, 'number');
  assert.equal(typeof status.result.runtime.generationId, 'number');
  assert.equal(status.result.runtime.generationId, status.result.runtime.runtimeGeneration);
  assert.deepEqual(status.result.lifecycleTarget, {
    kind: 'runtime',
    generationId: status.result.runtime.generationId,
    startedAt: status.result.runtime.createdAt,
    lastUsedAt: status.result.runtime.lastUsedAt,
  });
  assert.equal(status.result.runtime.activeTurnCount, 0);
  assert.equal(status.result.runtime.runtimeSessionEpoch, 'epoch-test');
  assert.equal(status.result.pendingControlCount, 0);
});

test('daemon uses daemon time for empty-process idle cleanup without an SDK runtime', async () => {
  const clock = createControlledClock(0);
  const harness = createDaemonHarness({ clock });

  clock.setNow(DEFAULT_RUNTIME_IDLE_TIMEOUT_MS - 1);
  harness.runLifecycleCheck();
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(harness.state.exitCalls, 0);

  clock.setNow(DEFAULT_RUNTIME_IDLE_TIMEOUT_MS);
  harness.runLifecycleCheck();
  await waitForCondition(() => harness.state.exitCalls === 1);
  assert.equal(harness.state.closeCalls, 0);
  assert.ok(harness.state.messages.some(message => (
    message.type === 'daemon'
      && message.event === 'retiring'
      && message.reason === 'idle'
  )));
});

test('daemon accepts a host-style empty-idle observation when daemon idle age is eligible', async () => {
  const clock = createControlledClock(0);
  const harness = createDaemonHarness({ clock });
  clock.setNow(DEFAULT_RUNTIME_IDLE_TIMEOUT_MS);

  harness.send({
    id: 'host-empty-idle-retire',
    method: 'retire',
    params: {
      reason: 'empty-idle',
      observation: {
        runtimeGeneration: null,
        runtimeSessionEpoch: null,
        runtimeCreatedAt: null,
        runtimeLastUsedAt: null,
        daemonLastUsedAt: 0,
      },
    },
  });
  const retirement = await waitForDone(harness.state.messages, 'host-empty-idle-retire');

  assert.deepEqual(retirement.result, {
    accepted: true,
    retiring: true,
    deferred: false,
    reason: 'empty-idle',
  });
  await waitForCondition(() => harness.state.exitCalls === 1);
});

test('daemon rejects a host-style empty-idle observation with a stale daemon timestamp', async () => {
  const clock = createControlledClock(0);
  const harness = createDaemonHarness({ clock });
  clock.setNow(DEFAULT_RUNTIME_IDLE_TIMEOUT_MS);

  harness.send({
    id: 'stale-host-empty-idle-retire',
    method: 'retire',
    params: {
      reason: 'empty-idle',
      observation: {
        runtimeGeneration: null,
        runtimeSessionEpoch: null,
        runtimeCreatedAt: null,
        runtimeLastUsedAt: null,
        daemonLastUsedAt: -1,
      },
    },
  });
  const retirement = await waitForDone(
    harness.state.messages,
    'stale-host-empty-idle-retire',
  );

  assert.deepEqual(retirement.result, {
    accepted: false,
    retiring: false,
    deferred: false,
    reason: 'empty-idle',
    refusalReason: 'stale-status',
  });
  assert.equal(harness.state.exitCalls, 0);
});

test('daemon heartbeat and status do not touch runtime lastUsedAt', async () => {
  const clock = createControlledClock(0);
  const harness = createDaemonHarness({ clock, turnGates: [Promise.resolve()] });

  harness.send({
    id: 'observation-query',
    method: 'query',
    params: { prompt: 'observe', options: { cwd: 'D:/ccNexus', model: 'sonnet' } },
  });
  await waitForDone(harness.state.messages, 'observation-query');
  harness.send({ id: 'observation-before', method: 'status' });
  const before = await waitForDone(harness.state.messages, 'observation-before');
  const lastUsedAt = before.result.runtime.lastUsedAt;

  clock.setNow(1234);
  harness.send({ id: 'observation-heartbeat', method: 'heartbeat' });
  await waitForDone(harness.state.messages, 'observation-heartbeat');
  harness.send({ id: 'observation-after', method: 'status' });
  const after = await waitForDone(harness.state.messages, 'observation-after');

  assert.equal(after.result.runtime.lastUsedAt, lastUsedAt);
});

test('daemon keeps a freshly rebuilt runtime when the daemon is older than eight hours', async () => {
  const clock = createControlledClock(0);
  const harness = createDaemonHarness({
    clock,
    turnGates: [Promise.resolve(), Promise.resolve()],
  });
  const eightHours = DEFAULT_RUNTIME_ABSOLUTE_LIFETIME_MS;

  harness.send({
    id: 'fresh-runtime-first',
    method: 'query',
    params: { prompt: 'first', options: { cwd: 'D:/ccNexus', model: 'sonnet' } },
  });
  await waitForDone(harness.state.messages, 'fresh-runtime-first');

  clock.setNow(eightHours + 1);
  harness.send({
    id: 'fresh-runtime-rebuild',
    method: 'query',
    params: {
      prompt: 'rebuild after an old daemon age',
      options: { cwd: 'D:/ccNexus', model: 'opus', resume: 'session-1' },
      runtimeDescriptor: { ...testRuntimeDescriptor, sdkModelName: 'opus' },
    },
  });
  await waitForDone(harness.state.messages, 'fresh-runtime-rebuild');

  harness.runLifecycleCheck();
  await new Promise(resolve => setTimeout(resolve, 5));

  assert.equal(harness.state.exitCalls, 0);
  harness.send({ id: 'fresh-runtime-status', method: 'status' });
  const status = await waitForDone(harness.state.messages, 'fresh-runtime-status');
  assert.equal(status.result.retireAfterTurn, false);
  assert.equal(status.result.runtime.closed, false);
  assert.equal(status.result.runtime.createdAt, eightHours + 1);
});

test('daemon retires a current runtime at eight hours when no blocker is active', async () => {
  const clock = createControlledClock(0);
  const harness = createDaemonHarness({ clock, turnGates: [Promise.resolve()] });

  harness.send({
    id: 'absolute-boundary-query',
    method: 'query',
    params: { prompt: 'age the runtime', options: { cwd: 'D:/ccNexus', model: 'sonnet' } },
  });
  await waitForDone(harness.state.messages, 'absolute-boundary-query');

  clock.setNow(DEFAULT_RUNTIME_ABSOLUTE_LIFETIME_MS);
  harness.runLifecycleCheck();
  await waitForCondition(() => harness.state.exitCalls === 1);

  assert.equal(harness.state.closeCalls, 1);
  assert.ok(harness.state.messages.some(message => (
    message.type === 'daemon'
      && message.event === 'retiring'
      && message.reason === 'absolute-lifetime'
  )));
});

test('daemon defers current-runtime eight-hour retirement until the active turn finishes', async () => {
  let releaseTurn;
  const turnGate = new Promise(resolve => { releaseTurn = resolve; });
  const clock = createControlledClock(0);
  const harness = createDaemonHarness({
    clock,
    turnGates: [Promise.resolve(), turnGate],
  });

  harness.send({
    id: 'absolute-deferred-first',
    method: 'query',
    params: { prompt: 'first', options: { cwd: 'D:/ccNexus', model: 'sonnet' } },
  });
  await waitForDone(harness.state.messages, 'absolute-deferred-first');

  clock.setNow(DEFAULT_RUNTIME_ABSOLUTE_LIFETIME_MS);
  harness.send({
    id: 'absolute-deferred-active',
    method: 'query',
    params: { prompt: 'active at the boundary', options: { cwd: 'D:/ccNexus', model: 'sonnet' } },
  });
  await waitForCondition(() => harness.state.turnCount === 2);

  harness.runLifecycleCheck();
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(harness.state.exitCalls, 0);
  harness.send({ id: 'absolute-deferred-status', method: 'status' });
  const status = await waitForDone(harness.state.messages, 'absolute-deferred-status');
  assert.equal(status.result.retireAfterTurn, true);

  releaseTurn();
  await waitForDone(harness.state.messages, 'absolute-deferred-active');
  await waitForCondition(() => harness.state.exitCalls === 1);
  assert.equal(harness.state.closeCalls, 1);
});

test('daemon refuses an absolute retirement RPC before the current lifecycle target reaches eight hours', async () => {
  const clock = createControlledClock(0);
  const harness = createDaemonHarness({ clock, turnGates: [Promise.resolve()] });

  harness.send({
    id: 'absolute-too-young-query',
    method: 'query',
    params: { prompt: 'fresh runtime', options: { cwd: 'D:/ccNexus', model: 'sonnet' } },
  });
  await waitForDone(harness.state.messages, 'absolute-too-young-query');
  harness.send({ id: 'absolute-too-young-status', method: 'status' });
  const status = await waitForDone(harness.state.messages, 'absolute-too-young-status');

  harness.send({
    id: 'absolute-too-young-retire',
    method: 'retire',
    params: {
      reason: 'absolute-lifetime',
      observation: retirementObservationFromStatus(status),
    },
  });
  const retirement = await waitForDone(harness.state.messages, 'absolute-too-young-retire');

  assert.deepEqual(retirement.result, {
    accepted: false,
    retiring: false,
    deferred: false,
    reason: 'absolute-lifetime',
    refusalReason: 'not-eligible',
  });
  assert.equal(harness.state.closeCalls, 0);
  assert.equal(harness.state.exitCalls, 0);
});

test('daemon refuses every policy retirement that lacks an observation', async () => {
  const cases = [
    ['idle', 'idle'],
    ['empty-idle', 'empty-idle'],
    ['absolute_lifetime', 'absolute-lifetime'],
    ['runtime-closed', 'runtime-closed'],
  ];

  for (const [requestedReason, reason] of cases) {
    const harness = createDaemonHarness();
    harness.send({
      id: `missing-observation-${reason}`,
      method: 'retire',
      params: { reason: requestedReason },
    });
    const response = await waitForDone(harness.state.messages, `missing-observation-${reason}`);
    assert.deepEqual(response.result, {
      accepted: false,
      retiring: false,
      deferred: false,
      reason,
      refusalReason: 'not-eligible',
    });
    assert.equal(harness.state.closeCalls, 0);
    assert.equal(harness.state.exitCalls, 0);
  }
});

test('daemon preserves runtime-closed and refuses its stale observation after a runtime rebuild', async () => {
  const harness = createDaemonHarness({ turnGates: [Promise.resolve(), Promise.resolve()] });

  harness.send({
    id: 'runtime-closed-first',
    method: 'query',
    params: { prompt: 'first', options: { cwd: 'D:/ccNexus', model: 'sonnet' } },
  });
  await waitForDone(harness.state.messages, 'runtime-closed-first');
  harness.send({ id: 'runtime-closed-status', method: 'status' });
  const oldStatus = await waitForDone(harness.state.messages, 'runtime-closed-status');
  const oldObservation = retirementObservationFromStatus(oldStatus);

  harness.send({
    id: 'runtime-closed-rebuild',
    method: 'query',
    params: {
      prompt: 'rebuild',
      options: { cwd: 'D:/ccNexus', model: 'opus', resume: 'session-1' },
      runtimeDescriptor: { ...testRuntimeDescriptor, sdkModelName: 'opus' },
    },
  });
  await waitForDone(harness.state.messages, 'runtime-closed-rebuild');
  const closeCallsBeforeRetire = harness.state.closeCalls;

  harness.send({
    id: 'runtime-closed-retire',
    method: 'retire',
    params: { reason: 'runtime-closed', observation: oldObservation },
  });
  const retirement = await waitForDone(harness.state.messages, 'runtime-closed-retire');
  assert.deepEqual(retirement.result, {
    accepted: false,
    retiring: false,
    deferred: false,
    reason: 'runtime-closed',
    refusalReason: 'stale-status',
  });
  assert.equal(harness.state.closeCalls, closeCallsBeforeRetire);
  assert.equal(harness.state.exitCalls, 0);

  harness.send({ id: 'runtime-closed-final-status', method: 'status' });
  const status = await waitForDone(harness.state.messages, 'runtime-closed-final-status');
  assert.equal(status.result.retireAfterTurn, false);
  assert.equal(status.result.retirementReason, null);
  assert.notEqual(status.result.runtime.runtimeGeneration, oldObservation.runtimeGeneration);
});

test('daemon safely refuses an unknown retirement reason instead of treating it as requested', async () => {
  const harness = createDaemonHarness();

  harness.send({
    id: 'unknown-retirement-reason',
    method: 'retire',
    params: { reason: 'vendor-specific-reason' },
  });
  const response = await waitForDone(harness.state.messages, 'unknown-retirement-reason');

  assert.deepEqual(response.result, {
    accepted: false,
    retiring: false,
    deferred: false,
    reason: 'vendor-specific-reason',
    refusalReason: 'not-eligible',
  });
  assert.equal(harness.state.closeCalls, 0);
  assert.equal(harness.state.exitCalls, 0);
});

test('daemon defers retirement until the active turn and fails queued context', async () => {
  let releaseTurn;
  const turnGate = new Promise((resolve) => { releaseTurn = resolve; });
  const clock = createControlledClock(0);
  const harness = createDaemonHarness({ turnGates: [turnGate], clock });

  harness.send({
    id: 'retire-turn',
    method: 'query',
    params: { prompt: 'work', options: { cwd: 'D:/ccNexus', model: 'sonnet' } },
  });
  await waitForCondition(() => harness.state.turnCount === 1);
  harness.send({
    id: 'retire-context',
    method: 'context_usage',
    params: { options: { cwd: 'D:/ccNexus', model: 'sonnet' } },
  });
  harness.send({ id: 'retire-status', method: 'status' });
  const status = await waitForDone(harness.state.messages, 'retire-status');
  clock.setNow(DEFAULT_RUNTIME_ABSOLUTE_LIFETIME_MS);
  harness.send({
    id: 'retire-request',
    method: 'retire',
    params: {
      reason: 'absolute_lifetime',
      observation: retirementObservationFromStatus(status),
    },
  });

  const retirement = await waitForDone(harness.state.messages, 'retire-request');
  assert.deepEqual(retirement.result, {
    accepted: true,
    retiring: true,
    deferred: true,
    reason: 'absolute-lifetime',
  });
  assert.equal(harness.state.exitCalls, 0);
  assert.equal(harness.state.contextCalls, 0);

  releaseTurn();
  await waitForDone(harness.state.messages, 'retire-turn');
  const queuedContext = await waitForDone(harness.state.messages, 'retire-context');
  assert.equal(queuedContext.success, false);
  assert.equal(queuedContext.code, 'DAEMON_RETIRING');
  await waitForCondition(() => harness.state.exitCalls === 1);
  assert.equal(harness.state.contextCalls, 0);
  assert.equal(harness.state.closeCalls, 1);
});

test('daemon refuses idle retirement while the active turn is still running', async () => {
  let releaseTurn;
  const turnGate = new Promise((resolve) => { releaseTurn = resolve; });
  const harness = createDaemonHarness({ turnGates: [turnGate, Promise.resolve()] });

  harness.send({
    id: 'idle-active-turn',
    method: 'query',
    params: { prompt: 'active', options: { cwd: 'D:/ccNexus', model: 'sonnet' } },
  });
  await waitForCondition(() => harness.state.turnCount === 1);

  harness.send({ id: 'idle-active-status', method: 'status' });
  const activeStatus = await waitForDone(harness.state.messages, 'idle-active-status');
  harness.send({
    id: 'idle-retire',
    method: 'retire',
    params: { reason: 'idle', observation: retirementObservationFromStatus(activeStatus) },
  });
  const retirement = await waitForDone(harness.state.messages, 'idle-retire');
  assert.deepEqual(retirement.result, {
    accepted: false,
    retiring: false,
    deferred: false,
    reason: 'idle',
    refusalReason: 'active',
  });

  harness.send({ id: 'idle-retire-status', method: 'status' });
  const status = await waitForDone(harness.state.messages, 'idle-retire-status');
  assert.equal(status.result.retireAfterTurn, false);
  assert.equal(status.result.retirementReason, null);

  releaseTurn();
  await waitForDone(harness.state.messages, 'idle-active-turn');
  harness.send({
    id: 'idle-after-refusal',
    method: 'query',
    params: { prompt: 'still running', options: { cwd: 'D:/ccNexus', model: 'sonnet' } },
  });
  const afterRefusal = await waitForDone(harness.state.messages, 'idle-after-refusal');

  assert.equal(afterRefusal.success, true);
  assert.equal(harness.state.closeCalls, 0);
  assert.equal(harness.state.exitCalls, 0);
});

test('daemon refuses an old idle observation after rebuilding the SDK runtime', async () => {
  const harness = createDaemonHarness({ turnGates: [Promise.resolve(), Promise.resolve()] });

  harness.send({
    id: 'stale-observation-first',
    method: 'query',
    params: { prompt: 'first', options: { cwd: 'D:/ccNexus', model: 'sonnet' } },
  });
  await waitForDone(harness.state.messages, 'stale-observation-first');

  harness.send({ id: 'stale-observation-status', method: 'status' });
  const oldStatus = await waitForDone(harness.state.messages, 'stale-observation-status');
  const oldObservation = {
    runtimeGeneration: oldStatus.result.runtime.runtimeGeneration,
    runtimeSessionEpoch: oldStatus.result.runtime.runtimeSessionEpoch,
    runtimeCreatedAt: oldStatus.result.runtime.createdAt,
    runtimeLastUsedAt: oldStatus.result.runtime.lastUsedAt,
    daemonLastUsedAt: oldStatus.result.daemonLastUsedAt,
  };

  harness.send({
    id: 'stale-observation-rebuild',
    method: 'query',
    params: {
      prompt: 'rebuild',
      options: { cwd: 'D:/ccNexus', model: 'opus', resume: 'session-1' },
      runtimeDescriptor: { ...testRuntimeDescriptor, sdkModelName: 'opus' },
    },
  });
  await waitForDone(harness.state.messages, 'stale-observation-rebuild');
  const closeCallsBeforeRetire = harness.state.closeCalls;

  harness.send({
    id: 'stale-observation-retire',
    method: 'retire',
    params: { reason: 'idle', observation: oldObservation },
  });
  const retirement = await waitForDone(harness.state.messages, 'stale-observation-retire');

  assert.deepEqual(retirement.result, {
    accepted: false,
    retiring: false,
    deferred: false,
    reason: 'idle',
    refusalReason: 'stale-status',
  });
  assert.equal(harness.state.closeCalls, closeCallsBeforeRetire);
  assert.equal(harness.state.exitCalls, 0);

  harness.send({ id: 'stale-observation-after', method: 'status' });
  const currentStatus = await waitForDone(harness.state.messages, 'stale-observation-after');
  assert.equal(currentStatus.result.retireAfterTurn, false);
  assert.equal(currentStatus.result.retirementReason, null);
  assert.notEqual(currentStatus.result.runtime.runtimeGeneration, oldObservation.runtimeGeneration);
});

test('daemon refuses an idle retirement when the current runtime is not idle yet', async () => {
  const harness = createDaemonHarness({ turnGates: [Promise.resolve()] });

  harness.send({
    id: 'not-idle-query',
    method: 'query',
    params: { prompt: 'recent work', options: { cwd: 'D:/ccNexus', model: 'sonnet' } },
  });
  await waitForDone(harness.state.messages, 'not-idle-query');

  harness.send({ id: 'not-idle-status', method: 'status' });
  const status = await waitForDone(harness.state.messages, 'not-idle-status');
  harness.send({
    id: 'not-idle-retire',
    method: 'retire',
    params: {
      reason: 'idle',
      observation: {
        runtimeGeneration: status.result.runtime.runtimeGeneration,
        runtimeSessionEpoch: status.result.runtime.runtimeSessionEpoch,
        runtimeCreatedAt: status.result.runtime.createdAt,
        runtimeLastUsedAt: status.result.runtime.lastUsedAt,
        daemonLastUsedAt: status.result.daemonLastUsedAt,
      },
    },
  });
  const retirement = await waitForDone(harness.state.messages, 'not-idle-retire');

  assert.deepEqual(retirement.result, {
    accepted: false,
    retiring: false,
    deferred: false,
    reason: 'idle',
    refusalReason: 'not-eligible',
  });
  assert.equal(harness.state.closeCalls, 0);
  assert.equal(harness.state.exitCalls, 0);
});

test('daemon refuses stale absolute observations and observations without generation identity', async () => {
  const harness = createDaemonHarness({ turnGates: [Promise.resolve(), Promise.resolve()] });

  harness.send({
    id: 'stale-absolute-first',
    method: 'query',
    params: { prompt: 'first', options: { cwd: 'D:/ccNexus', model: 'sonnet' } },
  });
  await waitForDone(harness.state.messages, 'stale-absolute-first');
  harness.send({ id: 'stale-absolute-status', method: 'status' });
  const oldStatus = await waitForDone(harness.state.messages, 'stale-absolute-status');
  const oldObservation = retirementObservationFromStatus(oldStatus);

  harness.send({
    id: 'stale-absolute-rebuild',
    method: 'query',
    params: {
      prompt: 'rebuild',
      options: { cwd: 'D:/ccNexus', model: 'opus', resume: 'session-1' },
      runtimeDescriptor: { ...testRuntimeDescriptor, sdkModelName: 'opus' },
    },
  });
  await waitForDone(harness.state.messages, 'stale-absolute-rebuild');

  harness.send({
    id: 'stale-absolute-retire',
    method: 'retire',
    params: { reason: 'absolute_lifetime', observation: oldObservation },
  });
  const staleRetirement = await waitForDone(harness.state.messages, 'stale-absolute-retire');
  assert.deepEqual(staleRetirement.result, {
    accepted: false,
    retiring: false,
    deferred: false,
    reason: 'absolute-lifetime',
    refusalReason: 'stale-status',
  });

  harness.send({
    id: 'incomplete-absolute-retire',
    method: 'retire',
    params: {
      reason: 'absolute-lifetime',
      observation: { runtimeLastUsedAt: oldObservation.runtimeLastUsedAt },
    },
  });
  const incompleteRetirement = await waitForDone(
    harness.state.messages,
    'incomplete-absolute-retire',
  );
  assert.deepEqual(incompleteRetirement.result, {
    accepted: false,
    retiring: false,
    deferred: false,
    reason: 'absolute-lifetime',
    refusalReason: 'not-eligible',
  });
  harness.send({ id: 'stale-absolute-final-status', method: 'status' });
  const status = await waitForDone(harness.state.messages, 'stale-absolute-final-status');
  assert.equal(status.result.retireAfterTurn, false);
  assert.equal(status.result.retirementReason, null);
  assert.equal(harness.state.closeCalls, 1);
  assert.equal(harness.state.exitCalls, 0);
});

test('daemon accepts an absolute retirement for the current generation while work is active', async () => {
  let releaseTurn;
  const turnGate = new Promise((resolve) => { releaseTurn = resolve; });
  const clock = createControlledClock(0);
  const harness = createDaemonHarness({ turnGates: [Promise.resolve(), turnGate], clock });

  harness.send({
    id: 'absolute-observation-first',
    method: 'query',
    params: { prompt: 'first', options: { cwd: 'D:/ccNexus', model: 'sonnet' } },
  });
  await waitForDone(harness.state.messages, 'absolute-observation-first');
  harness.send({ id: 'absolute-observation-status', method: 'status' });
  const status = await waitForDone(harness.state.messages, 'absolute-observation-status');
  const observation = {
    runtimeGeneration: status.result.runtime.runtimeGeneration,
    runtimeSessionEpoch: status.result.runtime.runtimeSessionEpoch,
    runtimeCreatedAt: status.result.runtime.createdAt,
    runtimeLastUsedAt: status.result.runtime.lastUsedAt,
  };

  clock.setNow(DEFAULT_RUNTIME_ABSOLUTE_LIFETIME_MS);
  harness.send({
    id: 'absolute-observation-active',
    method: 'query',
    params: { prompt: 'active', options: { cwd: 'D:/ccNexus', model: 'sonnet' } },
  });
  await waitForCondition(() => harness.state.turnCount === 2);
  harness.send({
    id: 'absolute-observation-retire',
    method: 'retire',
    params: { reason: 'absolute-lifetime', observation },
  });
  const retirement = await waitForDone(harness.state.messages, 'absolute-observation-retire');

  assert.deepEqual(retirement.result, {
    accepted: true,
    retiring: true,
    deferred: true,
    reason: 'absolute-lifetime',
  });
  harness.send({
    id: 'absolute-observation-query-after',
    method: 'query',
    params: { prompt: 'must be rejected', options: { cwd: 'D:/ccNexus', model: 'sonnet' } },
  });
  const rejectedQuery = await waitForDone(harness.state.messages, 'absolute-observation-query-after');
  assert.equal(rejectedQuery.success, false);
  assert.equal(rejectedQuery.code, 'DAEMON_RETIRING');

  harness.send({
    id: 'absolute-observation-context-after',
    method: 'context_usage',
    params: { options: { cwd: 'D:/ccNexus', model: 'sonnet' } },
  });
  const rejectedContext = await waitForDone(harness.state.messages, 'absolute-observation-context-after');
  assert.equal(rejectedContext.success, false);
  assert.equal(rejectedContext.code, 'DAEMON_RETIRING');

  harness.send({
    id: 'absolute-observation-retire-again',
    method: 'retire',
    params: { reason: 'absolute_lifetime', observation },
  });
  const repeatedRetirement = await waitForDone(
    harness.state.messages,
    'absolute-observation-retire-again',
  );
  assert.deepEqual(repeatedRetirement.result, {
    accepted: true,
    retiring: true,
    deferred: true,
    reason: 'absolute-lifetime',
  });
  releaseTurn();
  await waitForDone(harness.state.messages, 'absolute-observation-active');
  await waitForCondition(() => harness.state.exitCalls === 1);
  assert.equal(harness.state.closeCalls, 1);
});

test('daemon rejects new context usage after retirement has been scheduled', async () => {
  let releaseTurn;
  const turnGate = new Promise((resolve) => { releaseTurn = resolve; });
  const clock = createControlledClock(0);
  const harness = createDaemonHarness({ turnGates: [turnGate], clock });

  harness.send({
    id: 'context-retiring-turn',
    method: 'query',
    params: { prompt: 'active', options: { cwd: 'D:/ccNexus', model: 'sonnet' } },
  });
  await waitForCondition(() => harness.state.turnCount === 1);

  harness.send({ id: 'context-retire-status', method: 'status' });
  const status = await waitForDone(harness.state.messages, 'context-retire-status');
  clock.setNow(DEFAULT_RUNTIME_ABSOLUTE_LIFETIME_MS);
  harness.send({
    id: 'context-retire',
    method: 'retire',
    params: {
      reason: 'absolute_lifetime',
      observation: retirementObservationFromStatus(status),
    },
  });
  await waitForDone(harness.state.messages, 'context-retire');

  harness.send({
    id: 'query-after-retire',
    method: 'query',
    params: { prompt: 'must be rejected', options: { cwd: 'D:/ccNexus', model: 'sonnet' } },
  });
  const queryRejected = await waitForDone(harness.state.messages, 'query-after-retire');
  assert.equal(queryRejected.success, false);
  assert.equal(queryRejected.code, 'DAEMON_RETIRING');

  harness.send({
    id: 'context-after-retire',
    method: 'context_usage',
    params: { options: { cwd: 'D:/ccNexus', model: 'sonnet' } },
  });
  const rejected = await waitForDone(harness.state.messages, 'context-after-retire');
  assert.equal(rejected.success, false);
  assert.equal(rejected.code, 'DAEMON_RETIRING');
  assert.equal(harness.state.contextCalls, 0);

  releaseTurn();
  await waitForDone(harness.state.messages, 'context-retiring-turn');
});

test('daemon reuses a bypassPermissions runtime for a second turn with the same launch options', async () => {
  const harness = createDaemonHarness({ turnGates: [Promise.resolve(), Promise.resolve()] });
  const options = {
    cwd: 'D:/ccNexus',
    model: 'sonnet',
    permissionMode: 'bypassPermissions',
  };

  harness.send({
    id: 'bypass-first',
    method: 'query',
    params: { prompt: 'first', options },
  });
  await waitForDone(harness.state.messages, 'bypass-first');

  harness.send({
    id: 'bypass-second',
    method: 'query',
    params: { prompt: 'second', options: { ...options, resume: 'session-1' } },
  });
  const second = await waitForDone(harness.state.messages, 'bypass-second');

  assert.equal(second.success, true);
  assert.equal(harness.state.queryCalls, 1);
  assert.equal(harness.state.closeCalls, 0);
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

test('daemon does not start queued context while active abort cleanup is still pending', async () => {
  let releaseTurn;
  let releaseInterrupt;
  const turnGate = new Promise(resolve => { releaseTurn = resolve; });
  const interruptGate = new Promise(resolve => { releaseInterrupt = resolve; });
  const harness = createDaemonHarness({ turnGates: [turnGate], interruptGate });
  let contextEnqueued = false;

  harness.observeMessages(message => {
    if (message.id !== 'abort-context-turn' || !message.done || !message.success || contextEnqueued) return;
    contextEnqueued = true;
    harness.send({
      id: 'abort-context-queued',
      method: 'context_usage',
      params: { options: { cwd: 'D:/ccNexus', model: 'sonnet' } },
    });
  });

  harness.send({
    id: 'abort-context-turn',
    method: 'query',
    params: { prompt: 'abort context race', options: { cwd: 'D:/ccNexus', model: 'sonnet' } },
  });
  await waitForCondition(() => harness.state.turnCount === 1);

  harness.send({ id: 'abort-context-command', method: 'abort', params: { requestId: 'abort-context-turn' } });
  await waitForCondition(() => harness.state.interruptCalls === 1);

  releaseTurn();
  await waitForDone(harness.state.messages, 'abort-context-turn');
  assert.equal(contextEnqueued, true);
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(harness.state.contextCalls, 0);
  assert.deepEqual(harness.state.dataPlaneStarts, ['query']);

  releaseInterrupt();
  await waitForDone(harness.state.messages, 'abort-context-command');
  const contextResult = await waitForDone(harness.state.messages, 'abort-context-queued');
  assert.equal(contextResult.success, true);
  assert.equal(harness.state.contextCalls, 1);
  assert.deepEqual(harness.state.dataPlaneStarts, ['query', 'context_usage']);
});

test('daemon queues a query received during abort cleanup and starts it after cleanup', async () => {
  let releaseTurn;
  let releaseInterrupt;
  const turnGate = new Promise(resolve => { releaseTurn = resolve; });
  const interruptGate = new Promise(resolve => { releaseInterrupt = resolve; });
  const harness = createDaemonHarness({
    turnGates: [turnGate, Promise.resolve()],
    interruptGate,
  });

  harness.send({
    id: 'abort-window-turn',
    method: 'query',
    params: { prompt: 'abort me', options: { cwd: 'D:/ccNexus', model: 'sonnet' } },
  });
  await waitForCondition(() => harness.state.turnCount === 1);
  harness.send({
    id: 'abort-window-command',
    method: 'abort',
    params: { requestId: 'abort-window-turn' },
  });
  await waitForCondition(() => harness.state.interruptCalls === 1);

  releaseTurn();
  await waitForDone(harness.state.messages, 'abort-window-turn');
  harness.send({
    id: 'abort-window-next-query',
    method: 'query',
    params: {
      prompt: 'run after cleanup',
      options: { cwd: 'D:/ccNexus', model: 'sonnet', resume: 'session-1' },
    },
  });
  await new Promise(resolve => setTimeout(resolve, 20));

  assert.equal(
    harness.state.messages.some(message => message.id === 'abort-window-next-query' && message.done),
    false,
  );
  assert.equal(harness.state.turnCount, 1);

  releaseInterrupt();
  await waitForDone(harness.state.messages, 'abort-window-command');
  const nextQuery = await waitForDone(harness.state.messages, 'abort-window-next-query');
  assert.equal(nextQuery.success, true);
  assert.equal(harness.state.turnCount, 2);
  assert.deepEqual(harness.state.dataPlaneStarts, ['query', 'query']);
});

test('daemon rejects a query with a structured shutdown error while cleanup overlaps completion', async () => {
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
  const rejected = await waitForDone(harness.state.messages, 'turn-after-shutdown');
  assert.equal(rejected.success, false);
  assert.equal(rejected.code, 'DAEMON_SHUTTING_DOWN');
  assert.match(rejected.error, /shutting down/i);

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
  contextGates = [],
  interruptGate = null,
  invokeTool = false,
  maxThinkingTokensSupported = true,
  maxThinkingTokensThrows = false,
  sdkQueryError = null,
  clock = null,
  onMessage = null,
} = {}) {
  const state = {
    messages: [],
    queryCalls: 0,
    turnCount: 0,
    interruptCalls: 0,
    closeCalls: 0,
    exitCalls: 0,
    contextCalls: 0,
    dataPlaneStarts: [],
    permissionModes: [],
    models: [],
    maxThinkingTokens: [],
    consoleErrors: [],
    toolDecision: undefined,
  };
  let lineHandler = null;
  const lifecycleTimers = [];
  const setIntervalFn = clock
    ? (callback, delay) => {
      const timer = { callback, delay, cleared: false };
      lifecycleTimers.push(timer);
      return timer;
    }
    : setInterval;
  const clearIntervalFn = clock
    ? (timer) => {
      if (timer) timer.cleared = true;
    }
    : clearInterval;
  const getRetirementReason = clock
    ? (options = {}) => getRuntimeRetirementReason({ ...options, now: clock.now() })
    : getRuntimeRetirementReason;

  const context = {
    console: {
      error(...args) { state.consoleErrors.push(args.map(String).join(' ')); },
    },
    ...(clock ? { Date: clock.Date } : {}),
    setTimeout,
    clearTimeout,
    setInterval: setIntervalFn,
    clearInterval: clearIntervalFn,
    Promise,
    globalThis: {
      __daemonDeps: {
        randomUUID: () => 'test-plan-id',
        createPostToolUseHook,
        createPreToolUseHook,
        normalizePermissionMode,
        DEFAULT_RUNTIME_ABSOLUTE_LIFETIME_MS,
        DEFAULT_RUNTIME_IDLE_TIMEOUT_MS,
        buildRuntimeSignature,
        hasSameContextModel,
        RUNTIME_CLEANUP_INTERVAL_MS,
        getRuntimeRetirementReason: getRetirementReason,
        isRuntimeRetirementBlocked,
        createInterface() {
          return {
            on(event, handler) {
              if (event === 'line') lineHandler = handler;
            },
          };
        },
        sdkQuery({ prompt, options }) {
          state.queryCalls += 1;
          if (sdkQueryError) throw sdkQueryError;
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
              state.dataPlaneStarts.push('query');
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
              const contextIndex = state.contextCalls;
              state.contextCalls += 1;
              state.dataPlaneStarts.push('context_usage');
              const gate = contextGates[contextIndex];
              if (gate) await gate;
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
            const message = JSON.parse(line);
            state.messages.push(message);
            onMessage?.(message);
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
    observeMessages(callback) {
      onMessage = callback;
    },
    runLifecycleCheck() {
      const timer = lifecycleTimers.find(candidate => !candidate.cleared);
      assert.ok(timer, 'daemon lifecycle timer was not installed');
      return timer.callback();
    },
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
