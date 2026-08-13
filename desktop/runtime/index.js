import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { DaemonBridge } from './daemonBridge.js';
import { createDisposableQuery } from './disposableQuery.js';
import { DesktopProcessRegistry } from './processRegistry.js';
import { createRuntimeDescriptor } from '../../server/runtimeIdentity.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const defaultDaemonScript = path.resolve(__dirname, '../daemon/ccnexus-daemon.js');

function createAbortError() {
  const error = new Error('Prompt enhancement was cancelled');
  error.name = 'AbortError';
  return error;
}

function awaitWithAbort(promise, signal) {
  if (!signal) return promise;
  if (signal.aborted) return Promise.reject(createAbortError());

  return new Promise((resolve, reject) => {
    const onAbort = () => {
      signal.removeEventListener('abort', onAbort);
      reject(createAbortError());
    };
    signal.addEventListener('abort', onAbort, { once: true });
    Promise.resolve(promise).then((value) => {
      signal.removeEventListener('abort', onAbort);
      resolve(value);
    }, (error) => {
      signal.removeEventListener('abort', onAbort);
      reject(error);
    });
  });
}

export function createDesktopRuntime(options = {}) {
  let runtimeCwd = options.cwd || process.cwd();
  const registry = new DesktopProcessRegistry(options);
  const bridges = new Map();
  const makeUuid = typeof options.randomUUID === 'function' ? options.randomUUID : randomUUID;

  function createDaemonBridge(extraOptions = {}) {
    const { env: extraEnv, ...restOptions } = extraOptions;
    return new DaemonBridge({
      cwd: runtimeCwd,
      provider: options.provider,
      daemonScript: options.daemonScript || defaultDaemonScript,
      electronRunAsNode: options.electronRunAsNode ?? Boolean(process.versions?.electron),
      env: {
        ELECTRON_RUN_AS_NODE: '1',
        ...(extraEnv || {}),
      },
      ...restOptions,
    });
  }

  function ensureBridge(sessionId) {
    if (!sessionId) return null;
    const existing = bridges.get(sessionId);
    if (existing) return existing;

    const bridge = createDaemonBridge({
      env: {
        CCNEXUS_SESSION_ID: sessionId,
      },
      runtimeSessionEpoch: makeUuid(),
      bridgeIdentity: makeUuid(),
    });
    bridges.set(sessionId, bridge);
    bridge.start().catch((err) => {
      bridges.delete(sessionId);
      console.error(`[desktop-runtime] daemon start failed for ${sessionId}:`, err.message);
    });
    return bridge;
  }

  function ensureSessionDaemon(args = {}) {
    const bridge = args.bridge || ensureBridge(args.sessionId);
    return registry.ensureSessionDaemon({ ...args, bridge });
  }

  function buildRuntimeRequest(bridge, queryOptions, rawModelId = '') {
    return {
      options: queryOptions,
      runtimeDescriptor: createRuntimeDescriptor({
        rawModelId: rawModelId || queryOptions?.model || queryOptions?.env?.ANTHROPIC_MODEL || '',
        options: queryOptions,
        runtimeSessionEpoch: bridge.runtimeSessionEpoch,
        workspaceIdentity: queryOptions?.cwd || runtimeCwd,
      }),
    };
  }

  function adoptSessionDaemon({ fromSessionId, toSessionId, title }) {
    if (!fromSessionId || !toSessionId || fromSessionId === toSessionId) return null;
    const bridge = bridges.get(fromSessionId);
    if (bridge) {
      bridges.delete(fromSessionId);
      bridges.set(toSessionId, bridge);
    }
    return registry.adoptSessionDaemon({ fromSessionId, toSessionId, title });
  }

  async function queryClaude({
    sessionId,
    title,
    prompt,
    options: queryOptions = {},
    rawModelId = '',
    onPermissionRequest,
    onPlanApproval,
  }) {
    const daemonSessionId = sessionId || `pending-${Date.now()}`;
    const daemon = ensureSessionDaemon({ sessionId: daemonSessionId, title });
    const bridge = daemon.bridge;
    const stream = await bridge.streamCommand('query', {
      prompt,
      ...buildRuntimeRequest(bridge, queryOptions, rawModelId),
    }, {
      onPermissionRequest,
      onPlanApproval,
    });

    stream.daemonSessionId = daemonSessionId;
    stream.process = bridge.getProcessForInspection();
    return stream;
  }

  async function queryClaudeDisposable(args = {}) {
    const signal = args.signal;
    const disposableRuntime = createDesktopRuntime({
      cwd: args.options?.cwd || runtimeCwd,
      provider: options.provider,
      daemonScript: options.daemonScript || defaultDaemonScript,
      electronRunAsNode: options.electronRunAsNode ?? Boolean(process.versions?.electron),
    });

    let acquisition = null;
    let cleanupPromise = null;
    const cleanupAcquisition = () => {
      if (!cleanupPromise) {
        const shutdownPromise = disposableRuntime.shutdown().catch(() => {});
        cleanupPromise = Promise.resolve(acquisition)
          .then(query => query?.close?.(), () => {})
          .catch(() => {})
          .then(() => shutdownPromise);
      }
      return cleanupPromise;
    };

    try {
      acquisition = disposableRuntime.queryClaude({
        ...args,
        rawModelId: args.rawModelId || args.options?.model || '',
        options: {
          ...(args.options || {}),
          persistSession: false,
          strictMcpConfig: true,
          mcpServers: {},
          isolatedDenyAllTools: true,
        },
      });
      const query = await awaitWithAbort(acquisition, signal);
      return createDisposableQuery({
        query,
        dispose: () => disposableRuntime.shutdown(),
        signal,
      });
    } catch (error) {
      if (signal?.aborted) {
        void cleanupAcquisition();
        throw createAbortError();
      }
      await disposableRuntime.shutdown();
      throw error;
    }
  }

  async function getContextUsage({
    sessionId,
    title = 'Context usage',
    options: queryOptions = {},
    rawModelId = '',
  } = {}) {
    const daemonSessionId = sessionId || `context-${Date.now()}`;
    const daemon = ensureSessionDaemon({ sessionId: daemonSessionId, title });
    if (!daemon?.bridge) throw new Error('Unable to establish the Claude runtime');
    return daemon.bridge.getContextUsage(buildRuntimeRequest(daemon.bridge, queryOptions, rawModelId));
  }

  async function setPermissionMode({ sessionId, mode } = {}) {
    const bridge = sessionId ? bridges.get(sessionId) : null;
    if (!bridge) {
      return {
        mode,
        applied: false,
        requiresRestart: mode === 'bypassPermissions',
      };
    }
    return bridge.setPermissionMode(mode);
  }

  function removeSessionDaemon(sessionId) {
    const bridge = bridges.get(sessionId);
    if (bridge) {
      bridge.shutdown();
      bridges.delete(sessionId);
    }
    registry.removeSessionDaemon(sessionId);
  }

  function stopProcess(args) {
    const owned = registry.findOwnedProcess(args);
    const result = registry.stopProcess(args);
    if (result.ok && owned?.kind === 'DAEMON') {
      bridges.delete(owned.sessionId);
    }
    return result;
  }

  function restartDaemon(args) {
    const owned = registry.findOwnedProcess(args);
    if (!owned || owned.kind !== 'DAEMON') {
      return { ok: false, status: 404, error: 'Daemon process not found' };
    }

    stopProcess(args);
    const daemon = ensureSessionDaemon({
      sessionId: owned.sessionId,
      title: owned.title || 'Restarted daemon',
    });
    return { ok: true, success: true, restart: true, pid: daemon?.pid, id: daemon?.id };
  }

  async function shutdown() {
    const shuttingDownBridges = new Map(bridges);
    bridges.clear();
    await registry.shutdown();
    for (const [sessionId, bridge] of shuttingDownBridges) {
      if (bridges.get(sessionId) === bridge) bridges.delete(sessionId);
    }
  }

  function setCwd(nextCwd) {
    if (!nextCwd || nextCwd === runtimeCwd) return runtimeCwd;
    void shutdown();
    runtimeCwd = nextCwd;
    registry.setCwd(nextCwd);
    return runtimeCwd;
  }

  return {
    createDaemonBridge,
    ensureSessionDaemon,
    adoptSessionDaemon,
    queryClaude,
    queryClaudeDisposable,
    getContextUsage,
    setPermissionMode,
    removeSessionDaemon,
    registerChannel: (args) => registry.registerChannel(args),
    unregisterChannel: (args) => registry.unregisterChannel(args),
    buildProcessSnapshot: () => registry.buildProcessSnapshot(),
    setCwd,
    stopProcess,
    restartDaemon,
    shutdown,
  };
}
