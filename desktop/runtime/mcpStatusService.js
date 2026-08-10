import { spawn } from 'node:child_process';

const MCP_PROTOCOL_VERSION = '2024-11-05';
const MCP_CLIENT_INFO = Object.freeze({ name: 'ccNexus', version: '1.0.0' });
const DEFAULT_STATUS_TIMEOUT_MS = 15_000;
const DEFAULT_TOOLS_TIMEOUT_MS = 45_000;
const MAX_STDIO_LINE_LENGTH = 1024 * 1024;
const MAX_SSE_BUFFER_LENGTH = 1024 * 1024;
const MAX_SSE_EVENTS = 1000;

const SHELL_METACHARACTERS = /[&|;<>=\r\n`]/;
const FORBIDDEN_HEADERS = new Set([
  'host',
  'transfer-encoding',
  'connection',
  'keep-alive',
  'upgrade',
  'proxy-authorization',
  'te',
  'trailer',
]);

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function normalizeServer(server = {}) {
  return {
    id: String(server.id || server.name || ''),
    scope: server.scope === 'project' ? 'project' : 'global',
    config: isObject(server.config) ? server.config : {},
  };
}

function transportFor(config) {
  if (typeof config.type === 'string' && config.type.trim()) return config.type.toLowerCase();
  return typeof config.url === 'string' && config.url.trim() ? 'http' : 'stdio';
}

function hasValidConfig(config) {
  if (!isObject(config)) return false;
  const hasCommand = typeof config.command === 'string' && config.command.trim().length > 0;
  const hasUrl = typeof config.url === 'string' && config.url.trim().length > 0;
  if (!hasCommand && !hasUrl) return false;
  if (config.args !== undefined && (!Array.isArray(config.args) || config.args.some(item => typeof item !== 'string'))) return false;
  if (config.env !== undefined && !isObject(config.env)) return false;
  if (config.headers !== undefined && !isObject(config.headers)) return false;
  return true;
}

function safeHeaders(rawHeaders = {}) {
  const headers = {};
  if (!isObject(rawHeaders)) return headers;
  for (const [key, value] of Object.entries(rawHeaders)) {
    if (FORBIDDEN_HEADERS.has(key.toLowerCase()) || typeof value !== 'string') continue;
    headers[key] = value;
  }
  return headers;
}

function requestContext(config) {
  const rawUrl = typeof config.url === 'string' ? config.url : '';
  const headers = safeHeaders(config.headers);
  let url = rawUrl;
  try {
    const parsed = new URL(rawUrl);
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      throw new Error(`Unsupported MCP URL protocol: ${parsed.protocol}`);
    }
    const authorization = parsed.searchParams.get('Authorization');
    if (authorization && !headers.Authorization) headers.Authorization = authorization;
    if (authorization) parsed.searchParams.delete('Authorization');
    url = parsed.toString();
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('Unsupported MCP URL protocol')) throw error;
    throw new Error('Invalid MCP server URL');
  }
  return { url, headers };
}

function safeEnvironment(config) {
  const env = { ...process.env };
  if (!isObject(config.env)) return env;
  for (const [key, value] of Object.entries(config.env)) {
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      env[key] = String(value);
    }
  }
  return env;
}

function needsShell(command) {
  if (process.platform !== 'win32') return false;
  return /\.(cmd|bat)$/i.test(command) || /^(npx|npm|pnpm|yarn)$/i.test(command);
}

function killChild(child) {
  if (!child || child.killed) return;
  try {
    child.kill('SIGTERM');
    const forceKill = setTimeout(() => {
      try {
        if (!child.killed) child.kill('SIGKILL');
      } catch {
        // The process may already have exited.
      }
    }, 500);
    forceKill.unref?.();
  } catch {
    // The process may already have exited.
  }
}

function parseSseEvents(text) {
  const events = [];
  let current = {};
  for (const rawLine of String(text || '').split(/\r?\n/)) {
    const line = rawLine.trimEnd();
    if (!line) {
      if (Object.keys(current).length) events.push(current);
      current = {};
      continue;
    }
    if (line.startsWith('event:')) current.event = line.slice(line.startsWith('event: ') ? 7 : 6);
    if (line.startsWith('id:')) current.id = line.slice(line.startsWith('id: ') ? 4 : 3);
    if (line.startsWith('data:')) {
      const value = line.slice(line.startsWith('data: ') ? 6 : 5);
      try {
        current.data = JSON.parse(value);
      } catch {
        current.data = value;
      }
    }
  }
  if (Object.keys(current).length) events.push(current);
  return events;
}

function jsonRpcDataFromText(text) {
  const trimmed = String(text || '').trim();
  if (!trimmed) return null;
  const events = parseSseEvents(trimmed);
  const candidate = events.find(event => event.data !== undefined)?.data;
  if (candidate !== undefined) {
    if (isObject(candidate)) return candidate;
    try { return JSON.parse(candidate); } catch { /* fall through */ }
  }
  try {
    return JSON.parse(trimmed);
  } catch {
    throw new Error('Invalid MCP JSON-RPC response');
  }
}

function jsonRpcError(data, operation) {
  if (!data?.error) return null;
  return new Error(`${operation} error: ${data.error.message || JSON.stringify(data.error)}`);
}

function initializeRequest(id = 1) {
  return {
    jsonrpc: '2.0',
    id,
    method: 'initialize',
    params: {
      protocolVersion: MCP_PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: MCP_CLIENT_INFO,
    },
  };
}

function validateShellInputs(command, args) {
  if (needsShell(command) && [command, ...args].some(value => SHELL_METACHARACTERS.test(value))) {
    throw new Error('Command or args contain unsafe shell metacharacters');
  }
}

function runStdio(config, { tools = false, timeoutMs }) {
  return new Promise(resolve => {
    let child = null;
    let settled = false;
    let buffer = '';
    let stderr = '';
    let serverInfo = null;
    let initialized = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutId);
      killChild(child);
      resolve(result);
    };
    const timeoutId = setTimeout(() => finish({
      status: tools ? undefined : 'pending',
      serverInfo,
      tools: [],
      error: `Connection timeout after ${timeoutMs}ms`,
    }), timeoutMs);

    const command = config.command;
    const args = Array.isArray(config.args) ? config.args : [];
    if (!command) {
      finish({ status: 'failed', serverInfo: null, tools: [], error: 'No command specified' });
      return;
    }

    try {
      validateShellInputs(command, args);
      const spawnOptions = {
        env: safeEnvironment(config),
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true,
      };
      if (needsShell(command)) spawnOptions.shell = true;
      child = spawn(command, args, spawnOptions);
    } catch (error) {
      finish({ status: 'failed', serverInfo: null, tools: [], error: error.message });
      return;
    }

    const send = message => {
      if (!child?.stdin || child.stdin.destroyed) throw new Error('MCP server stdin is unavailable');
      child.stdin.write(`${JSON.stringify(message)}\n`);
    };

    const handleMessage = message => {
      if (message.id === 1) {
        const error = jsonRpcError(message, 'initialize');
        if (error) {
          finish({ status: 'failed', serverInfo: null, tools: [], error: error.message });
          return;
        }
        if (!message.result) return;
        initialized = true;
        serverInfo = isObject(message.result.serverInfo) ? message.result.serverInfo : null;
        if (!tools) {
          finish({ status: 'connected', serverInfo, tools: [], error: null });
          return;
        }
        try {
          send({ jsonrpc: '2.0', method: 'notifications/initialized' });
          send({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} });
        } catch (error) {
          finish({ status: undefined, serverInfo, tools: [], error: error.message });
        }
        return;
      }
      if (tools && initialized && message.id === 2) {
        const error = jsonRpcError(message, 'tools/list');
        if (error) {
          finish({ status: undefined, serverInfo, tools: [], error: error.message });
          return;
        }
        const listedTools = Array.isArray(message.result?.tools) ? message.result.tools : [];
        finish({ status: undefined, serverInfo, tools: listedTools, error: null });
      }
    };

    child.stdout.on('data', chunk => {
      buffer += chunk.toString();
      if (buffer.length > MAX_STDIO_LINE_LENGTH * 2) {
        finish({ status: tools ? undefined : 'failed', serverInfo, tools: [], error: 'MCP server output exceeded the safety limit' });
        return;
      }
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';
      for (const line of lines) {
        if (!line.trim() || line.length > MAX_STDIO_LINE_LENGTH) continue;
        try {
          const message = JSON.parse(line);
          if (isObject(message)) handleMessage(message);
        } catch {
          // MCP servers may print diagnostics to stdout; ignore non-JSON lines.
        }
      }
    });
    child.stderr.on('data', chunk => {
      stderr = `${stderr}${chunk.toString()}`.slice(-500);
    });
    child.once('error', error => finish({
      status: tools ? undefined : 'failed',
      serverInfo,
      tools: [],
      error: error.message,
    }));
    child.once('close', code => {
      if (settled) return;
      finish({
        status: tools ? undefined : 'failed',
        serverInfo,
        tools: [],
        error: code === 0 ? 'MCP server closed without a response' : `MCP server exited with code ${code}${stderr ? `: ${stderr.trim().slice(0, 200)}` : ''}`,
      });
    });

    process.nextTick(() => {
      try {
        send(initializeRequest());
      } catch (error) {
        finish({ status: tools ? undefined : 'failed', serverInfo, tools: [], error: error.message });
      }
    });
  });
}

function withTimeout(promise, timeoutMs, controller) {
  const timeout = new Promise((_, reject) => {
    const timer = setTimeout(() => {
      controller?.abort();
      reject(Object.assign(new Error(`Connection timeout after ${timeoutMs}ms`), { name: 'AbortError' }));
    }, timeoutMs);
    promise.finally(() => clearTimeout(timer)).catch(() => {});
  });
  return Promise.race([promise, timeout]);
}

async function fetchJsonRpc(url, headers, payload, timeoutMs, sessionId = null) {
  const controller = new AbortController();
  const request = fetch(url, {
    method: 'POST',
    headers: {
      ...headers,
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      ...(sessionId ? { 'Mcp-Session-Id': sessionId } : {}),
    },
    body: JSON.stringify(payload),
    signal: controller.signal,
  });
  const response = await withTimeout(request, timeoutMs, controller);
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${response.statusText}`);
  const responseSessionId = response.headers.get('Mcp-Session-Id') || sessionId;
  const text = await withTimeout(response.text(), timeoutMs, controller);
  return { data: jsonRpcDataFromText(text), sessionId: responseSessionId };
}

async function runHttp(config, { tools = false, timeoutMs }) {
  const { url, headers } = requestContext(config);
  let sessionId = null;
  const initialized = await fetchJsonRpc(url, headers, initializeRequest(), timeoutMs);
  sessionId = initialized.sessionId;
  const initializeError = jsonRpcError(initialized.data, 'initialize');
  if (initializeError) throw initializeError;
  if (!initialized.data?.result) throw new Error('Invalid initialize response');
  const serverInfo = isObject(initialized.data.result.serverInfo) ? initialized.data.result.serverInfo : null;
  if (!tools) return { status: 'connected', serverInfo, tools: [], error: null };

  try {
    await fetchJsonRpc(url, headers, { jsonrpc: '2.0', method: 'notifications/initialized' }, timeoutMs, sessionId);
  } catch {
    // The notification is not required by some stateless HTTP servers.
  }
  const listed = await fetchJsonRpc(url, headers, { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} }, timeoutMs, sessionId);
  const toolsError = jsonRpcError(listed.data, 'tools/list');
  if (toolsError) throw toolsError;
  return {
    status: undefined,
    serverInfo,
    tools: Array.isArray(listed.data?.result?.tools) ? listed.data.result.tools : [],
    error: null,
  };
}

async function readSseEvent(reader, decoder, bufferRef, signal) {
  let event = {};
  let eventsSeen = 0;
  while (!signal.aborted) {
    let newlineIndex;
    while ((newlineIndex = bufferRef.value.indexOf('\n')) !== -1) {
      const line = bufferRef.value.slice(0, newlineIndex).replace(/\r$/, '');
      bufferRef.value = bufferRef.value.slice(newlineIndex + 1);
      if (!line) {
        if (Object.keys(event).length) {
          const next = event;
          event = {};
          if (next.data !== undefined) return next;
          eventsSeen += 1;
          if (eventsSeen >= MAX_SSE_EVENTS) throw new Error('SSE stream did not produce an MCP response');
        }
        continue;
      }
      if (line.startsWith('event:')) event.event = line.slice(line.startsWith('event: ') ? 7 : 6);
      if (line.startsWith('data:')) {
        const value = line.slice(line.startsWith('data: ') ? 6 : 5);
        try { event.data = JSON.parse(value); } catch { event.data = value; }
      }
    }
    const { done, value } = await reader.read();
    if (done) break;
    bufferRef.value += decoder.decode(value, { stream: true });
    if (bufferRef.value.length > MAX_SSE_BUFFER_LENGTH) throw new Error('SSE stream exceeded the safety limit');
  }
  throw new Error('SSE stream ended without an MCP response');
}

function resolveSseEndpoint(rawEndpoint, sourceUrl) {
  const base = new URL(sourceUrl);
  const endpoint = new URL(String(rawEndpoint), sourceUrl);
  if (!['http:', 'https:'].includes(endpoint.protocol) || endpoint.origin !== base.origin) {
    throw new Error('SSE message endpoint must use the same HTTP origin');
  }
  return endpoint.toString();
}

async function runSse(config, { tools = false, timeoutMs }) {
  const { url, headers } = requestContext(config);
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  let reader = null;
  try {
    const stream = await fetch(url, { method: 'GET', headers: { ...headers, Accept: 'text/event-stream' }, signal: controller.signal });
    if (!stream.ok || !stream.body) throw new Error(`SSE connection failed: HTTP ${stream.status}`);
    reader = stream.body.getReader();
    const decoder = new TextDecoder();
    const bufferRef = { value: '' };
    const endpointEvent = await readSseEvent(reader, decoder, bufferRef, controller.signal);
    if (endpointEvent.event !== 'endpoint') throw new Error('SSE stream did not provide a message endpoint');
    const endpoint = resolveSseEndpoint(endpointEvent.data, url);
    const send = async message => {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify(message),
        signal: controller.signal,
      });
      if (!response.ok) throw new Error(`${message.method} failed: HTTP ${response.status}`);
      const contentType = response.headers.get('content-type') || '';
      if (contentType.includes('application/json')) return response.json();
      const event = await readSseEvent(reader, decoder, bufferRef, controller.signal);
      return isObject(event.data) ? event.data : JSON.parse(event.data);
    };

    const initialized = await send(initializeRequest());
    const initializeError = jsonRpcError(initialized, 'initialize');
    if (initializeError) throw initializeError;
    if (!initialized?.result) throw new Error('Invalid initialize response');
    const serverInfo = isObject(initialized.result.serverInfo) ? initialized.result.serverInfo : null;
    if (!tools) return { status: 'connected', serverInfo, tools: [], error: null };
    try {
      await fetch(endpoint, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }),
        signal: controller.signal,
      });
    } catch {
      // Notification failure is non-critical for the status panel.
    }
    const listed = await send({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} });
    const toolsError = jsonRpcError(listed, 'tools/list');
    if (toolsError) throw toolsError;
    return { status: undefined, serverInfo, tools: Array.isArray(listed?.result?.tools) ? listed.result.tools : [], error: null };
  } finally {
    clearTimeout(timeoutId);
    controller.abort();
    try { reader?.releaseLock(); } catch { /* stream already closed */ }
  }
}

async function runTransport(config, options) {
  const transport = transportFor(config);
  if (transport === 'sse') return runSse(config, options);
  if (transport === 'http' || transport === 'streamable-http') return runHttp(config, options);
  return runStdio(config, options);
}

function baseResult(server, { status = 'pending', error = null, serverInfo = null } = {}) {
  return { id: server.id, scope: server.scope, status, serverInfo, error };
}

export class McpStatusService {
  constructor({ statusTimeoutMs = DEFAULT_STATUS_TIMEOUT_MS, toolsTimeoutMs = DEFAULT_TOOLS_TIMEOUT_MS } = {}) {
    this.statusTimeoutMs = statusTimeoutMs;
    this.toolsTimeoutMs = toolsTimeoutMs;
  }

  async verifyServer(input) {
    const server = normalizeServer(input);
    if (!hasValidConfig(server.config)) return baseResult(server, { status: 'failed', error: 'Invalid MCP server config' });
    try {
      const result = await runTransport(server.config, { timeoutMs: this.statusTimeoutMs });
      return baseResult(server, result);
    } catch (error) {
      return baseResult(server, {
        status: error?.name === 'AbortError' ? 'pending' : 'failed',
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  async getTools(input) {
    const server = normalizeServer(input);
    const result = { id: server.id, scope: server.scope, serverType: transportFor(server.config), tools: [], error: null };
    if (!hasValidConfig(server.config)) {
      result.error = 'Invalid MCP server config';
      return result;
    }
    try {
      const response = await runTransport(server.config, { tools: true, timeoutMs: this.toolsTimeoutMs });
      result.tools = response.tools || [];
      result.error = response.error || null;
      return result;
    } catch (error) {
      result.error = error instanceof Error ? error.message : String(error);
      return result;
    }
  }

  async getStatuses({ servers = [], disabled = [], invalid = [] } = {}) {
    const enabledResults = await Promise.all(servers.map(server => this.verifyServer(server)));
    const disabledResults = disabled.map(item => ({
      id: item.id,
      scope: item.scope === 'project' ? 'project' : 'global',
      status: 'failed',
      serverInfo: null,
      error: item.reason || 'Server is disabled',
    }));
    const invalidResults = invalid.map(item => ({
      id: item.id,
      scope: item.scope === 'project' ? 'project' : 'global',
      status: 'failed',
      serverInfo: null,
      error: `Invalid config: ${item.reason || 'Invalid MCP server config'}`,
    }));
    return [...enabledResults, ...disabledResults, ...invalidResults];
  }
}

export { hasValidConfig as isValidMcpServerConfig, transportFor as getMcpTransport };
