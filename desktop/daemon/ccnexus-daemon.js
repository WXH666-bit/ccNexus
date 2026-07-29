import { createInterface } from 'node:readline';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { query: sdkQuery } = require('@anthropic-ai/claude-agent-sdk');

let activeRequestId = null;
let activeQuery = null;
let permissionRequestCounter = 0;
const pendingPermissions = new Map();

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
  try {
    const { prompt, options = {} } = params;
    activeQuery = sdkQuery({
      prompt,
      options: {
        ...options,
        canUseTool,
      },
    });

    for await (const event of activeQuery) {
      writeRawLine({
        id,
        type: 'sdk_event',
        event,
      });
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
    activeQuery = null;
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
    try { activeQuery?.close?.(); } catch { /* ignore */ }
    activeRequestId = null;
    reply(id, { result: { abortedRequestId } });
    return;
  }

  if (method === 'shutdown') {
    try { activeQuery?.interrupt?.(); } catch { /* ignore */ }
    try { activeQuery?.close?.(); } catch { /* ignore */ }
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

rl.on('close', () => process.exit(0));
process.stdin.on('end', () => process.exit(0));
process.on('SIGTERM', () => process.exit(0));
process.on('SIGINT', () => process.exit(0));
