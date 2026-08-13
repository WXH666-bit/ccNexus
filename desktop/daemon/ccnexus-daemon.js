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
import {
  DEFAULT_RUNTIME_ABSOLUTE_LIFETIME_MS,
  DEFAULT_RUNTIME_IDLE_TIMEOUT_MS,
  RUNTIME_CLEANUP_INTERVAL_MS,
  getRuntimeRetirementReason,
  isRuntimeRetirementBlocked,
} from '../runtime/runtimeLifecyclePolicy.js';

const require = createRequire(import.meta.url);
const { query: sdkQuery } = require('@anthropic-ai/claude-agent-sdk');

let activeRequestId = null;
let activeRequest = null;
let activeQuery = null;
let runtime = null;
let runtimeGenerationCounter = 0;
let contextUsageRunning = false;
const dataPlaneQueue = [];
let activeDataPlaneRequest = null;
let daemonShuttingDown = false;
const daemonStartedAt = Date.now();
let daemonLastUsedAt = daemonStartedAt;
let retirementReason = null;
let retirementInProgress = false;
let retirementTimer = null;
let retireAfterTurn = false;
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

function touchDaemon() {
  daemonLastUsedAt = Date.now();
}

function isRetirementBlocked() {
  return isRuntimeRetirementBlocked({
    activeRequestId,
    activeTurnCount: runtime?.activeTurnCount || 0,
    contextUsageRunning,
    pendingContextUsage: dataPlaneQueue.length,
    pendingPermissions: pendingPermissions.size,
    pendingPlanApprovals: pendingPlanApprovals.size,
  });
}

function isIdleRetirementReason(reason) {
  return reason === 'idle' || reason === 'empty-idle';
}

function isPolicyRetirementReason(reason) {
  return isIdleRetirementReason(reason)
    || reason === 'absolute-lifetime'
    || reason === 'runtime-closed';
}

function normalizeRetirementReason(reason) {
  if (reason === 'idle_timeout') return 'idle';
  if (reason === 'absolute_lifetime') return 'absolute-lifetime';
  if (reason === 'lifecycle') return 'requested';
  if (reason === undefined) return 'requested';
  return reason;
}

function isKnownRetirementReason(reason) {
  return reason === 'requested' || isPolicyRetirementReason(reason);
}

function failRequest(id, error, code = 'DAEMON_REQUEST_FAILED') {
  writeRawLine({
    id,
    done: true,
    success: false,
    code,
    error: error instanceof Error ? error.message : String(error || 'Daemon request failed'),
  });
}

function failQueuedDataPlane(error, code) {
  while (dataPlaneQueue.length > 0) {
    const request = dataPlaneQueue.shift();
    if (!request || request.state !== 'queued') continue;
    request.state = 'cancelled';
    failRequest(request.id, error, code);
  }
}

function cancelQueuedDataPlane(requestId) {
  const index = dataPlaneQueue.findIndex(request => (
    request.state === 'queued' && request.id === requestId
  ));
  if (index < 0) return false;
  const [request] = dataPlaneQueue.splice(index, 1);
  request.state = 'cancelled';
  failRequest(request.id, new Error('Daemon request cancelled'), 'DAEMON_REQUEST_CANCELLED');
  return true;
}

function beginDaemonShutdown() {
  daemonShuttingDown = true;
  failQueuedDataPlane(new Error('Daemon shutting down'), 'DAEMON_SHUTTING_DOWN');
}

function hasOwn(object, key) {
  return Object.prototype.hasOwnProperty.call(object || {}, key);
}

function normalizeRetirementObservation(observation) {
  if (!observation || typeof observation !== 'object' || Array.isArray(observation)) return null;
  const normalized = {};
  const aliases = [
    ['runtimeGeneration', 'runtimeGeneration'],
    ['generationId', 'runtimeGeneration'],
    ['runtimeSessionEpoch', 'runtimeSessionEpoch'],
    ['runtimeCreatedAt', 'runtimeCreatedAt'],
    ['createdAt', 'runtimeCreatedAt'],
    ['runtimeLastUsedAt', 'runtimeLastUsedAt'],
    ['lastUsedAt', 'runtimeLastUsedAt'],
    ['daemonLastUsedAt', 'daemonLastUsedAt'],
  ];
  for (const [sourceKey, targetKey] of aliases) {
    if (hasOwn(observation, sourceKey) && !hasOwn(normalized, targetKey)) {
      normalized[targetKey] = observation[sourceKey];
    }
  }
  return normalized;
}

function hasCompleteRetirementObservation(observation) {
  if (!observation) return false;
  const lifecycleTarget = getCurrentLifecycleTarget();
  if (lifecycleTarget.kind === 'runtime') {
    return [
      'runtimeGeneration',
      'runtimeCreatedAt',
      'runtimeLastUsedAt',
    ].every(key => hasOwn(observation, key));
  }
  return hasOwn(observation, 'daemonLastUsedAt');
}

function currentRuntimeForRetirement() {
  return runtime && !runtime.closed ? runtime : null;
}

function getCurrentLifecycleTarget() {
  const currentRuntime = currentRuntimeForRetirement();
  if (currentRuntime) {
    return {
      kind: 'runtime',
      generationId: currentRuntime.generationId ?? currentRuntime.runtimeGeneration ?? null,
      startedAt: currentRuntime.createdAt,
      lastUsedAt: currentRuntime.lastUsedAt,
    };
  }
  return {
    kind: 'daemon',
    generationId: null,
    startedAt: daemonStartedAt,
    lastUsedAt: daemonLastUsedAt,
  };
}

function matchesRetirementObservation(observation, { checkTimestamps = true } = {}) {
  if (!observation) return true;
  const lifecycleTarget = getCurrentLifecycleTarget();
  if (lifecycleTarget.kind === 'runtime') {
    const currentRuntime = currentRuntimeForRetirement();
    const currentEpoch = currentRuntime?.descriptor?.runtimeSessionEpoch ?? null;
    if (hasOwn(observation, 'runtimeGeneration')
        && observation.runtimeGeneration !== lifecycleTarget.generationId) return false;
    if (hasOwn(observation, 'runtimeSessionEpoch')
        && observation.runtimeSessionEpoch !== currentEpoch) return false;
    if (checkTimestamps && hasOwn(observation, 'runtimeCreatedAt')
        && observation.runtimeCreatedAt !== lifecycleTarget.startedAt) return false;
    if (checkTimestamps && hasOwn(observation, 'runtimeLastUsedAt')
        && observation.runtimeLastUsedAt !== lifecycleTarget.lastUsedAt) return false;
    return true;
  }

  if (checkTimestamps && hasOwn(observation, 'daemonLastUsedAt')
      && observation.daemonLastUsedAt !== lifecycleTarget.lastUsedAt) return false;
  return true;
}

function isCurrentIdleEligible(reason) {
  const lifecycleTarget = getCurrentLifecycleTarget();
  if (reason === 'idle' && lifecycleTarget.kind !== 'runtime') return false;
  if (reason === 'empty-idle' && lifecycleTarget.kind !== 'daemon') return false;
  return Number.isFinite(lifecycleTarget.lastUsedAt)
    && Date.now() - lifecycleTarget.lastUsedAt >= DEFAULT_RUNTIME_IDLE_TIMEOUT_MS;
}

function isCurrentAbsoluteLifetimeEligible() {
  const lifecycleTarget = getCurrentLifecycleTarget();
  return Number.isFinite(lifecycleTarget.startedAt)
    && Date.now() - lifecycleTarget.startedAt >= DEFAULT_RUNTIME_ABSOLUTE_LIFETIME_MS;
}

function retirementResult({ accepted, deferred, reason, refusalReason } = {}) {
  const result = {
    accepted: accepted === true,
    retiring: accepted === true,
    deferred: deferred === true,
    reason: normalizeRetirementReason(reason),
  };
  if (refusalReason) result.refusalReason = refusalReason;
  return result;
}

async function finishRetirement() {
  if (!retireAfterTurn || retirementInProgress || isRetirementBlocked()) return;
  retirementInProgress = true;
  stopRetirementMonitor();
  await closeRuntime();
  sendDaemonEvent('retiring', { reason: retirementReason || 'requested' });
  process.exit(0);
}

function scheduleRetirement(reason) {
  if (retirementInProgress) return;
  retireAfterTurn = true;
  retirementReason = normalizeRetirementReason(reason || retirementReason || 'requested');
  failQueuedDataPlane(new Error('Daemon is retiring'), 'DAEMON_RETIRING');
  void drainDataPlaneQueue();
  void finishRetirement();
}

function checkRetirementEligibility() {
  const policyReason = getRuntimeRetirementReason(getCurrentLifecycleTarget());
  if (!policyReason) return;
  const reason = normalizeRetirementReason(policyReason);
  if (isIdleRetirementReason(reason) && isRetirementBlocked()) return;
  scheduleRetirement(reason);
}

function startRetirementMonitor() {
  if (typeof setInterval !== 'function') return;
  retirementTimer = setInterval(checkRetirementEligibility, RUNTIME_CLEANUP_INTERVAL_MS);
  retirementTimer.unref?.();
}

function stopRetirementMonitor() {
  if (!retirementTimer) return;
  clearInterval(retirementTimer);
  retirementTimer = null;
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
  touchDaemon();
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
    if (targetRuntime?.currentPermissionMode === targetPermissionMode) {
      modeState.current = targetPermissionMode;
      return targetPermissionMode;
    }
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

function failContextUsageRequest(id, error, code = 'CONTEXT_USAGE_FAILED') {
  failRequest(id, error, code);
}

function writeRuntimeMetadata(id, lifecycle = {}) {
  if (!lifecycle || (lifecycle.classification !== 'cold' && lifecycle.classification !== 'warm')) return;
  writeRawLine({
    id,
    type: 'runtime_metadata',
    classification: lifecycle.classification,
    generationId: lifecycle.generationId,
    ...(lifecycle.creationReason ? { creationReason: lifecycle.creationReason } : {}),
  });
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
  let creationReason = 'initial';
  if (runtime && (runtime.signature !== signature || sessionConflict)) {
    creationReason = sessionConflict ? 'session-conflict' : 'identity-change';
    await closeRuntime();
  }
  if (runtime) {
    const controlResult = await applyDynamicControls(runtime, options);
    if (!controlResult.requiresRebuild) {
      touchRuntime(runtime);
      return {
        runtime,
        lifecycle: {
          classification: 'warm',
          generationId: runtime.generationId,
        },
      };
    }
    await closeRuntime();
    creationReason = 'dynamic-control-rebuild';
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
  const generationId = ++runtimeGenerationCounter;
  runtime = {
    closed: false,
    generationId,
    runtimeGeneration: generationId,
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
  return {
    runtime,
    lifecycle: {
      classification: 'cold',
      generationId,
      creationReason,
    },
  };
}

async function runQueryNow(id, params = {}) {
  if (retireAfterTurn || retirementInProgress) {
    failRequest(id, new Error('Daemon is retiring'), 'DAEMON_RETIRING');
    return;
  }

  const request = { id, state: 'running' };
  activeRequest = request;
  activeRequestId = id;
  touchDaemon();
  let currentRuntime = null;
  try {
    const { prompt, options = {}, runtimeDescriptor = {} } = params;
    const acquisition = await ensureRuntime(options, runtimeDescriptor);
    currentRuntime = acquisition.runtime;
    writeRuntimeMetadata(id, acquisition.lifecycle);
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
    touchDaemon();
  }
}

function enqueueDataPlaneRequest(method, id, params = {}) {
  if (daemonShuttingDown) {
    failRequest(id, new Error('Daemon shutting down'), 'DAEMON_SHUTTING_DOWN');
    return;
  }
  if (retireAfterTurn || retirementInProgress) {
    failRequest(id, new Error('Daemon is retiring'), 'DAEMON_RETIRING');
    return;
  }

  touchDaemon();
  dataPlaneQueue.push({ id, method, params, state: 'queued' });
  void drainDataPlaneQueue();
}

function runQuery(id, params = {}) {
  enqueueDataPlaneRequest('query', id, params);
}

async function runAbort(id, params = {}) {
  const targetRequestId = params.requestId;
  if (cancelQueuedDataPlane(targetRequestId)) {
    touchDaemon();
    reply(id, { result: { abortedRequestId: targetRequestId } });
    void drainDataPlaneQueue();
    return;
  }
  const request = activeRequest;
  if (!request || request.state !== 'running' || activeRequestId !== targetRequestId || request.id !== targetRequestId) {
    reply(id, { result: { abortedRequestId: null, ignored: true } });
    return;
  }

  request.state = 'aborting';
  touchDaemon();
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
  void drainDataPlaneQueue();
}

async function runShutdown(id) {
  beginDaemonShutdown();
  const request = activeRequest;
  const targetRequestId = activeRequestId;
  if (request) request.state = 'shutting-down';
  stopRetirementMonitor();
  settleAllPlanApprovals('Daemon shutting down');
  failQueuedDataPlane(new Error('Daemon shutting down'), 'DAEMON_SHUTTING_DOWN');
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
    let acquisition;
    if (!currentRuntime || currentRuntime.closed
      || !hasSameContextModel(currentRuntime.descriptor, runtimeDescriptor)) {
      acquisition = await ensureRuntime(options, runtimeDescriptor);
      currentRuntime = acquisition.runtime;
    } else {
      acquisition = {
        runtime: currentRuntime,
        lifecycle: {
          classification: 'warm',
          generationId: currentRuntime.generationId,
        },
      };
    }
    if (!currentRuntime || currentRuntime.closed || typeof currentRuntime.query?.getContextUsage !== 'function') {
      throw new Error('getContextUsage is not available on the current runtime');
    }
    touchRuntime(currentRuntime);
    const result = await currentRuntime.query.getContextUsage();
    reply(id, { result, runtimeMetadata: acquisition.lifecycle });
  } catch (err) {
    writeRawLine({
      id,
      done: true,
      success: false,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

async function drainDataPlaneQueue() {
  if (activeDataPlaneRequest
      || activeRequest?.state === 'aborting'
      || activeRequest?.state === 'shutting-down') return;
  if (daemonShuttingDown || retirementInProgress || retireAfterTurn) {
    failQueuedDataPlane(
      new Error(daemonShuttingDown ? 'Daemon shutting down' : 'Daemon is retiring'),
      daemonShuttingDown ? 'DAEMON_SHUTTING_DOWN' : 'DAEMON_RETIRING',
    );
    void finishRetirement();
    return;
  }

  const request = dataPlaneQueue.shift();
  if (!request) {
    void finishRetirement();
    return;
  }
  if (request.state !== 'queued') {
    void drainDataPlaneQueue();
    return;
  }

  request.state = 'running';
  activeDataPlaneRequest = request;
  contextUsageRunning = request.method === 'context_usage';
  try {
    if (request.method === 'query') {
      await runQueryNow(request.id, request.params);
    } else {
      await runContextUsageNow(request.id, request.params);
    }
  } finally {
    contextUsageRunning = false;
    if (activeDataPlaneRequest === request) activeDataPlaneRequest = null;
    request.state = 'completed';
    void drainDataPlaneQueue();
  }
}

function runContextUsage(id, params = {}) {
  enqueueDataPlaneRequest('context_usage', id, params);
}

async function runRetire(id, params = {}) {
  const reason = normalizeRetirementReason(params.reason);
  const observation = normalizeRetirementObservation(params.observation);
  if (!isKnownRetirementReason(reason)) {
    reply(id, {
      result: retirementResult({
        accepted: false,
        deferred: false,
        reason,
        refusalReason: 'not-eligible',
      }),
    });
    return;
  }
  if (isPolicyRetirementReason(reason) && !hasCompleteRetirementObservation(observation)) {
    reply(id, {
      result: retirementResult({
        accepted: false,
        deferred: false,
        reason,
        refusalReason: 'not-eligible',
      }),
    });
    return;
  }
  if (retirementInProgress || retireAfterTurn) {
    reply(id, {
      result: retirementResult({
        accepted: true,
        deferred: isRetirementBlocked(),
        reason: retirementReason || reason,
      }),
    });
    return;
  }

  if (isIdleRetirementReason(reason)) {
    if (isRetirementBlocked()) {
      reply(id, {
        result: retirementResult({
          accepted: false,
          deferred: false,
          reason,
          refusalReason: 'active',
        }),
      });
      return;
    }
    if (observation && !matchesRetirementObservation(observation)) {
      reply(id, {
        result: retirementResult({
          accepted: false,
          deferred: false,
          reason,
          refusalReason: 'stale-status',
        }),
      });
      return;
    }
    if (observation && !isCurrentIdleEligible(reason)) {
      reply(id, {
        result: retirementResult({
          accepted: false,
          deferred: false,
          reason,
          refusalReason: 'not-eligible',
        }),
      });
      return;
    }
  } else if (observation && !matchesRetirementObservation(observation, { checkTimestamps: false })) {
    reply(id, {
      result: retirementResult({
        accepted: false,
        deferred: false,
        reason,
        refusalReason: 'stale-status',
      }),
    });
    return;
  }

  if (reason === 'absolute-lifetime' && !isCurrentAbsoluteLifetimeEligible()) {
    reply(id, {
      result: retirementResult({
        accepted: false,
        deferred: false,
        reason,
        refusalReason: 'not-eligible',
      }),
    });
    return;
  }

  const deferred = isRetirementBlocked();
  scheduleRetirement(reason);
  reply(id, {
    result: retirementResult({ accepted: true, deferred, reason: retirementReason }),
  });
  if (!deferred) void finishRetirement();
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
      touchDaemon();
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
startRetirementMonitor();

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
      touchDaemon();
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
    touchDaemon();
    return;
  }

  if (method === 'heartbeat') {
    reply(id, { result: 'alive', activeRequestId });
    return;
  }

  if (method === 'status') {
    const pendingControlCount = dataPlaneQueue.length
      + (contextUsageRunning ? 1 : 0)
      + pendingPermissions.size
      + pendingPlanApprovals.size;
    const pendingContextUsage = dataPlaneQueue.filter(request => request.method === 'context_usage').length;
    const lifecycleTarget = getCurrentLifecycleTarget();
    reply(id, {
      result: {
        pid: process.pid,
        activeRequestId,
        uptimeMs: Math.floor(process.uptime() * 1000),
        daemonStartedAt,
        daemonLastUsedAt,
        generationId: lifecycleTarget.generationId,
        lifecycleTarget,
        runtime: runtime ? {
          closed: runtime.closed,
          generationId: runtime.generationId ?? runtime.runtimeGeneration,
          runtimeGeneration: runtime.runtimeGeneration,
          createdAt: runtime.createdAt,
          lastUsedAt: runtime.lastUsedAt,
          activeTurnCount: runtime.activeTurnCount || 0,
          runtimeSessionEpoch: runtime.descriptor?.runtimeSessionEpoch || '',
        } : null,
        pendingControlCount,
        pendingContextUsage,
        contextUsageRunning,
        retireAfterTurn,
        retirementInProgress,
        retirementReason,
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

  if (method === 'retire') {
    void runRetire(id, command.params);
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
  beginDaemonShutdown();
  stopRetirementMonitor();
  void closeRuntime().finally(() => process.exit(0));
});
process.stdin.on('end', () => {
  beginDaemonShutdown();
  stopRetirementMonitor();
  void closeRuntime().finally(() => process.exit(0));
});
process.on('SIGTERM', () => {
  beginDaemonShutdown();
  stopRetirementMonitor();
  void closeRuntime().finally(() => process.exit(0));
});
process.on('SIGINT', () => {
  beginDaemonShutdown();
  stopRetirementMonitor();
  void closeRuntime().finally(() => process.exit(0));
});
