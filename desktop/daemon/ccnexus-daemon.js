import { createInterface } from 'node:readline';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import {
  createPreToolUseHook,
  normalizePermissionMode,
} from './permissionMode.js';
import {
  buildRuntimeSignature,
  hasSameContextModel,
} from '../../server/runtimeIdentity.js';

const require = createRequire(import.meta.url);
const { query: sdkQuery } = require('@anthropic-ai/claude-agent-sdk');

let activeRequestId = null;
let activeRequest = null;
let activeQuery = null;
let runtime = null;
let contextUsageRunning = false;
const pendingContextUsage = [];
let permissionRequestCounter = 0;
const pendingPermissions = new Map();
const pendingPlanApprovals = new Map();
const modeState = { current: 'default' };

class AsyncStream {
  constructor() {
    this.queue = [];
    this.readResolve = null;
    this.isDone = false;
    this.started = false;
  }

  [Symbol.asyncIterator]() {
    if (this.started) throw new Error('Stream can only be iterated once');
    this.started = true;
    return this;
  }

  next() {
    if (this.queue.length > 0) {
      return Promise.resolve({ done: false, value: this.queue.shift() });
    }
    if (this.isDone) {
      return Promise.resolve({ done: true, value: undefined });
    }
    return new Promise((resolve) => {
      this.readResolve = resolve;
    });
  }

  enqueue(value) {
    if (this.readResolve) {
      const resolve = this.readResolve;
      this.readResolve = null;
      resolve({ done: false, value });
      return;
    }
    this.queue.push(value);
  }

  done() {
    this.isDone = true;
    if (this.readResolve) {
      const resolve = this.readResolve;
      this.readResolve = null;
      resolve({ done: true, value: undefined });
    }
  }

  async return() {
    this.isDone = true;
    return { done: true, value: undefined };
  }
}

function createTurnSink() {
  const queue = [];
  const waiters = [];
  let failed = false;
  let failureError = null;

  return {
    push(msg) {
      if (failed) return;
      const waiter = waiters.shift();
      if (waiter) {
        waiter.resolve({ value: msg, done: false });
      } else {
        queue.push(msg);
      }
    },

    async take() {
      if (failed) throw failureError;
      if (queue.length > 0) {
        return { value: queue.shift(), done: false };
      }
      return new Promise((resolve, reject) => {
        waiters.push({ resolve, reject });
      });
    },

    fail(error) {
      if (failed) return;
      failed = true;
      failureError = error;
      while (waiters.length > 0) {
        waiters.shift().reject(error);
      }
    },
  };
}

function writeRawLine(payload) {
  process.stdout.write(`${JSON.stringify(payload)}\n`);
}

function sendDaemonEvent(event, data = {}) {
  writeRawLine({
    type: 'daemon',
    event,
    pid: process.pid,
    timestamp: Date.now(),
    ...data,
  });
}

function reply(id, payload) {
  writeRawLine({
    id,
    done: true,
    success: true,
    ...payload,
  });
}

async function canUseTool(toolName, input, options) {
  const requestId = `perm-${activeRequestId}-${++permissionRequestCounter}`;
  writeRawLine({
    id: activeRequestId,
    type: 'permission_request',
    requestId,
    toolName,
    input,
    options,
  });

  return new Promise((resolve) => {
    pendingPermissions.set(requestId, resolve);
  });
}

async function denyIsolatedToolUse() {
  return {
    behavior: 'deny',
    message: 'Prompt enhancement cannot use tools',
  };
}

function settlePlanApproval(requestId, decision) {
  const pending = pendingPlanApprovals.get(requestId);
  if (!pending) return false;
  pendingPlanApprovals.delete(requestId);
  clearTimeout(pending.timer);
  pending.resolve(decision);
  return true;
}

function settleAllPlanApprovals(message = 'Request aborted') {
  for (const requestId of pendingPlanApprovals.keys()) {
    settlePlanApproval(requestId, { approved: false, feedback: message });
  }
}

function requestPlanApproval(request = {}) {
  const requestId = `plan-${activeRequestId || 'idle'}-${randomUUID()}`;
  const payload = {
    requestId,
    toolName: request.toolName || 'ExitPlanMode',
    plan: typeof request.plan === 'string' ? request.plan : '',
    allowedPrompts: Array.isArray(request.allowedPrompts) ? request.allowedPrompts : [],
  };

  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      settlePlanApproval(requestId, {
        approved: false,
        feedback: 'Plan approval timed out',
      });
    }, 300000);
    timer.unref?.();
    pendingPlanApprovals.set(requestId, { resolve, timer });
    writeRawLine({
      id: activeRequestId,
      type: 'plan_approval',
      ...payload,
    });
  });
}

function buildUserMessage(prompt, sessionId) {
  return {
    type: 'user',
    session_id: sessionId || '',
    parent_tool_use_id: null,
    message: {
      role: 'user',
      content: [{ type: 'text', text: (prompt || '').trim() || '[Empty message]' }],
    },
  };
}

function beginRuntimeTurn(currentRuntime) {
  if (!currentRuntime) return;
  currentRuntime.activeTurnCount = (currentRuntime.activeTurnCount || 0) + 1;
}

function endRuntimeTurn(currentRuntime) {
  if (!currentRuntime) return;
  currentRuntime.activeTurnCount = Math.max((currentRuntime.activeTurnCount || 0) - 1, 0);
}

function touchRuntime(currentRuntime) {
  if (!currentRuntime || currentRuntime.closed) return;
  currentRuntime.lastUsedAt = Date.now();
}

async function disposeRuntime(targetRuntime = runtime) {
  if (!targetRuntime || targetRuntime.closed) return;
  settleAllPlanApprovals('Runtime closed');
  targetRuntime.closed = true;
  targetRuntime.activeTurnCount = 0;
  try { targetRuntime.turnSink?.fail?.(new Error('Runtime closed')); } catch { /* ignore */ }
  targetRuntime.turnSink = null;
  try { await targetRuntime.inputStream?.done?.(); } catch { /* ignore */ }
  try { await targetRuntime.query?.close?.(); } catch { /* ignore */ }
  if (runtime === targetRuntime) runtime = null;
  if (activeQuery === targetRuntime.query) activeQuery = null;
}

async function closeRuntime() {
  await disposeRuntime(runtime);
}

async function applyDynamicControls(currentRuntime, options = {}) {
  if (!currentRuntime || currentRuntime.closed) return { requiresRebuild: false };

  const targetPermissionMode = normalizePermissionMode(options.permissionMode || 'default');
  await setRuntimePermissionMode(currentRuntime, targetPermissionMode);

  const targetMaxThinkingTokens = options.maxThinkingTokens ?? null;
  if (currentRuntime.currentMaxThinkingTokens === targetMaxThinkingTokens) {
    return { requiresRebuild: false };
  }

  if (typeof currentRuntime.query?.setMaxThinkingTokens !== 'function') {
    console.error('[ccnexus-daemon] maxThinkingTokens cannot be changed live; rebuilding runtime');
    return { requiresRebuild: true };
  }

  try {
    await currentRuntime.query.setMaxThinkingTokens(targetMaxThinkingTokens);
    currentRuntime.currentMaxThinkingTokens = targetMaxThinkingTokens;
  } catch (error) {
    console.error(
      '[ccnexus-daemon] maxThinkingTokens live update failed; rebuilding runtime:',
      error instanceof Error ? error.message : String(error),
    );
    return { requiresRebuild: true };
  }

  return { requiresRebuild: false };
}

async function setRuntimePermissionMode(targetRuntime, mode) {
  const targetPermissionMode = normalizePermissionMode(mode);
  if (targetPermissionMode === 'bypassPermissions') {
    throw new Error('Full access mode requires a runtime restart');
  }

  if (!targetRuntime || targetRuntime.closed) {
    modeState.current = targetPermissionMode;
    return targetPermissionMode;
  }

  if (targetRuntime.currentPermissionMode !== targetPermissionMode) {
    if (typeof targetRuntime.query?.setPermissionMode !== 'function') {
      throw new Error('Claude runtime does not support live permission mode changes');
    }
    await targetRuntime.query.setPermissionMode(targetPermissionMode);
  }
  targetRuntime.currentPermissionMode = targetPermissionMode;
  modeState.current = targetPermissionMode;
  return targetPermissionMode;
}

function startPerpetualReader(currentRuntime) {
  return (async () => {
    try {
      while (!currentRuntime.closed) {
        let next;
        try {
          next = await currentRuntime.query.next();
        } catch (error) {
          currentRuntime.turnSink?.fail?.(error);
          break;
        }

        if (next.done) {
          currentRuntime.turnSink?.fail?.(new Error('stream ended'));
          break;
        }

        touchRuntime(currentRuntime);
        const msg = next.value;
        if (currentRuntime.turnSink) {
          currentRuntime.turnSink.push(msg);
        } else if (msg?.type === 'result' && currentRuntime.sessionId) {
          sendDaemonEvent('session_updated', { sessionId: currentRuntime.sessionId });
        }
      }
    } finally {
      if (!currentRuntime.closed) {
        await disposeRuntime(currentRuntime);
      }
    }
  })();
}

function assertRuntimeDescriptor(runtimeDescriptor = {}) {
  if (!runtimeDescriptor || typeof runtimeDescriptor !== 'object') {
    throw new Error('Runtime descriptor is required');
  }
  if (typeof runtimeDescriptor.runtimeSessionEpoch !== 'string'
      || !runtimeDescriptor.runtimeSessionEpoch.trim()) {
    throw new Error('Runtime session epoch is required');
  }
}

function failContextUsageRequest(id, error) {
  writeRawLine({
    id,
    done: true,
    success: false,
    error: error instanceof Error ? error.message : String(error || 'Context usage request failed'),
  });
}

function failPendingContextUsage(error) {
  while (pendingContextUsage.length > 0) {
    const request = pendingContextUsage.shift();
    if (request) failContextUsageRequest(request.id, error);
  }
}

function assertRuntimeOwnership(currentRuntime, runtimeDescriptor) {
  assertRuntimeDescriptor(runtimeDescriptor);
  if (currentRuntime
      && currentRuntime.descriptor?.runtimeSessionEpoch !== runtimeDescriptor.runtimeSessionEpoch) {
    throw new Error('Runtime ownership mismatch for session epoch');
  }
}

async function ensureRuntime(options = {}, runtimeDescriptor = {}) {
  assertRuntimeOwnership(runtime, runtimeDescriptor);
  const signature = buildRuntimeSignature(options, runtimeDescriptor);
  const requestedSessionId = options.resume || '';
  const sessionConflict = runtime
    && requestedSessionId
    && runtime.sessionId
    && runtime.sessionId !== requestedSessionId;
  if (runtime && (runtime.signature !== signature || sessionConflict)) {
    await closeRuntime();
  }
  if (runtime) {
    const controlResult = await applyDynamicControls(runtime, options);
    if (!controlResult.requiresRebuild) {
      touchRuntime(runtime);
      return runtime;
    }
    await closeRuntime();
  }

  const inputStream = new AsyncStream();
  const initialPermissionMode = normalizePermissionMode(options.permissionMode || 'default');
  modeState.current = initialPermissionMode;
  const planHook = createPreToolUseHook({
    modeState,
    requestPlanApproval,
    applyMode: async (mode, source) => {
      await setRuntimePermissionMode(runtime, mode);
      writeRawLine({
        id: activeRequestId,
        type: 'mode_changed',
        mode: normalizePermissionMode(mode),
        source,
      });
    },
  });
  const query = sdkQuery({
    prompt: inputStream,
    options: {
      ...options,
      hooks: {
        ...(options.hooks || {}),
        PreToolUse: [
          ...(Array.isArray(options.hooks?.PreToolUse) ? options.hooks.PreToolUse : []),
          { hooks: [planHook] },
        ],
      },
      canUseTool: options.isolatedDenyAllTools === true ? denyIsolatedToolUse : canUseTool,
    },
  });
  runtime = {
    closed: false,
    inputStream,
    query,
      signature,
    descriptor: { ...runtimeDescriptor },
    sessionId: options.resume || '',
    currentPermissionMode: initialPermissionMode,
    currentModel: options.model || null,
    currentMaxThinkingTokens: options.maxThinkingTokens ?? null,
    createdAt: Date.now(),
    lastUsedAt: Date.now(),
    activeTurnCount: 0,
    turnSink: null,
    reader: null,
  };
  runtime.reader = startPerpetualReader(runtime);
  activeQuery = query;
  return runtime;
}

async function runQuery(id, params = {}) {
  if (activeRequestId || contextUsageRunning) {
    const busyRequestId = activeRequestId || 'context_usage';
    writeRawLine({
      id,
      done: true,
      success: false,
      error: `Daemon is busy with ${busyRequestId}`,
    });
    return;
  }

  const request = { id, state: 'running' };
  activeRequest = request;
  activeRequestId = id;
  let currentRuntime = null;
  try {
    const { prompt, options = {}, runtimeDescriptor = {} } = params;
    currentRuntime = await ensureRuntime(options, runtimeDescriptor);
    activeQuery = currentRuntime.query;
    beginRuntimeTurn(currentRuntime);
    currentRuntime.turnSink = createTurnSink();
    currentRuntime.inputStream.enqueue(buildUserMessage(prompt, currentRuntime.sessionId || options.resume));

    while (true) {
      const next = await currentRuntime.turnSink.take();
      if (next.done) {
        const error = new Error('Claude session stream ended unexpectedly');
        error.runtimeTerminated = true;
        throw error;
      }
      const event = next.value;
      writeRawLine({
        id,
        type: 'sdk_event',
        event,
      });
      if (event?.type === 'system' && event.session_id) {
        currentRuntime.sessionId = event.session_id;
      }
      if (event?.type === 'result') {
        if (event.is_error) {
          throw new Error(event.result || event.message || 'API request failed');
        }
        break;
      }
    }

    reply(id, { result: 'complete' });
  } catch (err) {
    writeRawLine({
      id,
      done: true,
      success: false,
      error: err.message,
    });
  } finally {
    if (currentRuntime && !currentRuntime.closed) {
      endRuntimeTurn(currentRuntime);
      currentRuntime.turnSink = null;
    }
    if (activeRequest === request && request.state === 'running' && activeRequestId === request.id) {
      activeRequest = null;
      activeRequestId = null;
    }
    void drainContextUsageQueue();
  }
}

async function runAbort(id, params = {}) {
  const targetRequestId = params.requestId;
  const request = activeRequest;
  if (!request || request.state !== 'running' || activeRequestId !== targetRequestId || request.id !== targetRequestId) {
    reply(id, { result: { abortedRequestId: null, ignored: true } });
    return;
  }

  request.state = 'aborting';
  for (const [requestId, resolve] of pendingPermissions.entries()) {
    pendingPermissions.delete(requestId);
    resolve({ behavior: 'deny', message: 'Request aborted' });
  }
  settleAllPlanApprovals('Request aborted');
  try { await activeQuery?.interrupt?.(); } catch { /* ignore */ }
  await closeRuntime();
  if (activeRequest === request && activeRequestId === targetRequestId) {
    activeRequest = null;
    activeRequestId = null;
  }
  reply(id, { result: { abortedRequestId: targetRequestId } });
  void drainContextUsageQueue();
}

async function runShutdown(id) {
  const request = activeRequest;
  const targetRequestId = activeRequestId;
  if (request) request.state = 'shutting-down';
  settleAllPlanApprovals('Daemon shutting down');
  failPendingContextUsage(new Error('Daemon shutting down'));
  try { await activeQuery?.interrupt?.(); } catch { /* ignore */ }
  await closeRuntime();
  if (request && activeRequest === request && activeRequestId === targetRequestId) {
    activeRequest = null;
    activeRequestId = null;
  } else if (!request && activeRequestId === targetRequestId) {
    activeRequestId = null;
  }
  reply(id, { result: 'bye' });
  process.exit(0);
}

async function runContextUsageNow(id, params = {}) {
  try {
    const options = params.options || {};
    const runtimeDescriptor = params.runtimeDescriptor || {};
    let currentRuntime = runtime;
    if (!currentRuntime || currentRuntime.closed
      || !hasSameContextModel(currentRuntime.descriptor, runtimeDescriptor)) {
      currentRuntime = await ensureRuntime(options, runtimeDescriptor);
    }
    if (!currentRuntime || currentRuntime.closed || typeof currentRuntime.query?.getContextUsage !== 'function') {
      throw new Error('getContextUsage is not available on the current runtime');
    }
    touchRuntime(currentRuntime);
    const result = await currentRuntime.query.getContextUsage();
    reply(id, { result });
  } catch (err) {
    writeRawLine({
      id,
      done: true,
      success: false,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

async function drainContextUsageQueue() {
  if (contextUsageRunning || activeRequestId) return;
  const request = pendingContextUsage.shift();
  if (!request) return;

  contextUsageRunning = true;
  try {
    await runContextUsageNow(request.id, request.params);
  } finally {
    contextUsageRunning = false;
    void drainContextUsageQueue();
  }
}

function runContextUsage(id, params = {}) {
  pendingContextUsage.push({ id, params });
  void drainContextUsageQueue();
}

async function runSetPermissionMode(id, params = {}) {
  const mode = normalizePermissionMode(params.mode);
  if (mode === 'bypassPermissions') {
    reply(id, {
      result: {
        mode,
        applied: false,
        requiresRestart: true,
      },
    });
    return;
  }

  try {
    const applied = Boolean(runtime && !runtime.closed);
    if (applied) {
      await setRuntimePermissionMode(runtime, mode);
    } else {
      modeState.current = mode;
    }
    reply(id, {
      result: {
        mode,
        applied,
        requiresRestart: false,
      },
    });
  } catch (err) {
    writeRawLine({
      id,
      done: true,
      success: false,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

sendDaemonEvent('starting');
sendDaemonEvent('ready');

const rl = createInterface({ input: process.stdin });
rl.on('line', (line) => {
  let command;
  try {
    command = JSON.parse(line);
  } catch {
    writeRawLine({ done: true, success: false, error: 'Invalid JSON command' });
    return;
  }

  const { id, method } = command;
  if (method === 'permission_response') {
    const { requestId, decision } = command.params || {};
    const resolve = pendingPermissions.get(requestId);
    if (resolve) {
      pendingPermissions.delete(requestId);
      resolve(decision || { behavior: 'deny', message: 'No permission decision received' });
    }
    return;
  }

  if (method === 'plan_approval_response') {
    const { requestId, approved, targetMode, feedback } = command.params || {};
    settlePlanApproval(requestId, {
      approved: approved === true,
      targetMode,
      feedback,
    });
    return;
  }

  if (method === 'heartbeat') {
    reply(id, { result: 'alive', activeRequestId });
    return;
  }

  if (method === 'status') {
    reply(id, {
      result: {
        pid: process.pid,
        activeRequestId,
        uptimeMs: Math.floor(process.uptime() * 1000),
      },
    });
    return;
  }

  if (method === 'abort') {
    void runAbort(id, command.params);
    return;
  }

  if (method === 'shutdown') {
    void runShutdown(id);
    return;
  }

  if (method === 'query') {
    runQuery(id, command.params);
    return;
  }

  if (method === 'set_permission_mode') {
    runSetPermissionMode(id, command.params);
    return;
  }

  if (method === 'context_usage') {
    runContextUsage(id, command.params);
    return;
  }

  activeRequestId = id;
  writeRawLine({
    id,
    done: true,
    success: false,
    error: `Unsupported daemon method: ${method}`,
  });
  activeRequestId = null;
});

rl.on('close', () => {
  void closeRuntime().finally(() => process.exit(0));
});
process.stdin.on('end', () => {
  void closeRuntime().finally(() => process.exit(0));
});
process.on('SIGTERM', () => {
  void closeRuntime().finally(() => process.exit(0));
});
process.on('SIGINT', () => {
  void closeRuntime().finally(() => process.exit(0));
});
