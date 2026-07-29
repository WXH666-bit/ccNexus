import { createInterface } from 'node:readline';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { query: sdkQuery } = require('@anthropic-ai/claude-agent-sdk');

let activeRequestId = null;
let activeQuery = null;
let runtime = null;
let permissionRequestCounter = 0;
const pendingPermissions = new Map();

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

function runtimeSignature(options = {}) {
  return JSON.stringify({
    cwd: options.cwd || '',
    model: options.model || '',
    effort: options.effort || '',
    includePartialMessages: options.includePartialMessages !== false,
    contextWindow1M: (options.model || '').includes('[1m]'),
    bypassPermissions: options.permissionMode === 'bypassPermissions',
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

function disposeRuntime(targetRuntime = runtime) {
  if (!targetRuntime || targetRuntime.closed) return;
  targetRuntime.closed = true;
  targetRuntime.activeTurnCount = 0;
  try { targetRuntime.turnSink?.fail?.(new Error('Runtime closed')); } catch { /* ignore */ }
  targetRuntime.turnSink = null;
  try { targetRuntime.inputStream?.done?.(); } catch { /* ignore */ }
  try { targetRuntime.query?.close?.(); } catch { /* ignore */ }
  if (runtime === targetRuntime) runtime = null;
  if (activeQuery === targetRuntime.query) activeQuery = null;
}

function closeRuntime() {
  disposeRuntime(runtime);
}

async function applyDynamicControls(currentRuntime, options = {}) {
  if (!currentRuntime || currentRuntime.closed) return;

  const targetPermissionMode = options.permissionMode || 'default';
  if (currentRuntime.currentPermissionMode !== targetPermissionMode
      && typeof currentRuntime.query?.setPermissionMode === 'function') {
    await currentRuntime.query.setPermissionMode(targetPermissionMode);
    currentRuntime.currentPermissionMode = targetPermissionMode;
  }

  const targetModel = options.model || null;
  if (currentRuntime.currentModel !== targetModel
      && typeof currentRuntime.query?.setModel === 'function') {
    await currentRuntime.query.setModel(targetModel || undefined);
    currentRuntime.currentModel = targetModel;
  }

  const targetMaxThinkingTokens = options.maxThinkingTokens ?? null;
  if (currentRuntime.currentMaxThinkingTokens !== targetMaxThinkingTokens
      && typeof currentRuntime.query?.setMaxThinkingTokens === 'function') {
    await currentRuntime.query.setMaxThinkingTokens(targetMaxThinkingTokens);
    currentRuntime.currentMaxThinkingTokens = targetMaxThinkingTokens;
  }
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
        disposeRuntime(currentRuntime);
      }
    }
  })();
}

async function ensureRuntime(options = {}) {
  const signature = runtimeSignature(options);
  const requestedSessionId = options.resume || '';
  const sessionConflict = runtime
    && requestedSessionId
    && runtime.sessionId
    && runtime.sessionId !== requestedSessionId;
  if (runtime && (runtime.signature !== signature || sessionConflict)) {
    closeRuntime();
  }
  if (runtime) {
    await applyDynamicControls(runtime, options);
    touchRuntime(runtime);
    return runtime;
  }

  const inputStream = new AsyncStream();
  const query = sdkQuery({
    prompt: inputStream,
    options: {
      ...options,
      canUseTool,
    },
  });
  runtime = {
    closed: false,
    inputStream,
    query,
    signature,
    sessionId: options.resume || '',
    currentPermissionMode: options.permissionMode || 'default',
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
  if (activeRequestId) {
    writeRawLine({
      id,
      done: true,
      success: false,
      error: `Daemon is busy with ${activeRequestId}`,
    });
    return;
  }

  activeRequestId = id;
  let currentRuntime = null;
  try {
    const { prompt, options = {} } = params;
    currentRuntime = await ensureRuntime(options);
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
    activeRequestId = null;
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
    const abortedRequestId = activeRequestId;
    for (const [requestId, resolve] of pendingPermissions.entries()) {
      pendingPermissions.delete(requestId);
      resolve({ behavior: 'deny', message: 'Request aborted' });
    }
    try { activeQuery?.interrupt?.(); } catch { /* ignore */ }
    closeRuntime();
    activeRequestId = null;
    reply(id, { result: { abortedRequestId } });
    return;
  }

  if (method === 'shutdown') {
    try { activeQuery?.interrupt?.(); } catch { /* ignore */ }
    closeRuntime();
    reply(id, { result: 'bye' });
    process.exit(0);
    return;
  }

  if (method === 'query') {
    runQuery(id, command.params);
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
  closeRuntime();
  process.exit(0);
});
process.stdin.on('end', () => {
  closeRuntime();
  process.exit(0);
});
process.on('SIGTERM', () => {
  closeRuntime();
  process.exit(0);
});
process.on('SIGINT', () => {
  closeRuntime();
  process.exit(0);
});
