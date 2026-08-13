import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { DaemonBridge } from './daemonBridge.js';
import { createDisposableQuery } from './disposableQuery.js';
import { DesktopProcessRegistry } from './processRegistry.js';
import {
  RUNTIME_CLEANUP_INTERVAL_MS,
  decideRuntimeRetirement,
} from './runtimeLifecyclePolicy.js';
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
  const retiringBySession = new Map();
  const retiredSessions = new Map();
  const transitionTails = new Map();
  const makeUuid = typeof options.randomUUID === 'function' ? options.randomUUID : randomUUID;
  const clock = typeof options.now === 'function' ? options.now : Date.now;
  const setIntervalFn = options.setIntervalFn || setInterval;
  const clearIntervalFn = options.clearIntervalFn || clearInterval;
  const bridgeFactory = typeof options.bridgeFactory === 'function'
    ? options.bridgeFactory
    : bridgeOptions => new DaemonBridge(bridgeOptions);
  let lifecycleTimer = null;
  let shuttingDown = false;

  function startLifecycleTimer() {
    if (lifecycleTimer || bridges.size === 0 || typeof setIntervalFn !== 'function') return;
    lifecycleTimer = setIntervalFn(() => {
      void scanRuntimeLifecycle().catch((error) => {
        console.error('[desktop-runtime] lifecycle scan failed:', error.message);
      });
    }, RUNTIME_CLEANUP_INTERVAL_MS);
    lifecycleTimer?.unref?.();
  }

  function stopLifecycleTimer() {
    if (!lifecycleTimer) return;
    clearIntervalFn(lifecycleTimer);
    lifecycleTimer = null;
  }

  function clearBridgeRecord(sessionId, bridge) {
    if (!sessionId || bridges.get(sessionId) !== bridge) return false;
    bridges.delete(sessionId);
    registry.removeSessionDaemon(sessionId, bridge);
    return true;
  }

  function handleBridgeExit(bridge) {
    const sessionId = bridge.sessionId;
    clearBridgeRecord(sessionId, bridge);
    const retiring = retiringBySession.get(sessionId);
    if (retiring?.bridge === bridge) retiringBySession.delete(sessionId);
    if (bridges.size === 0) stopLifecycleTimer();
  }

  function installBridgeLifecycle(bridge, sessionId) {
    bridge.sessionId = sessionId;
    bridge.hasServedRequest = false;
    bridge.once?.('exit', () => handleBridgeExit(bridge));
    bridge.on?.('daemon_event', (event) => {
      const currentSessionId = bridge.sessionId;
      if (event?.event !== 'retiring' || bridges.get(currentSessionId) !== bridge) return;
      bridge.lifecycleState = 'retiring';
      retiredSessions.set(currentSessionId, {
        reason: event.reason || 'lifecycle',
        retiredAt: clock(),
      });
      registry.setDaemonState({ sessionId: currentSessionId, bridge, state: 'retiring' });
    });
    return bridge;
  }

  function startBridge(bridge, sessionId) {
    if (bridge.startPromise) return bridge.startPromise;
    let started;
    try {
      started = bridge.start();
    } catch (error) {
      bridge.startPromise = Promise.reject(error);
      bridge.startPromise.catch(() => {});
      return bridge.startPromise;
    }
    bridge.startPromise = Promise.resolve(started)
      .then((result) => {
        if (bridges.get(sessionId) === bridge) {
          bridge.lifecycleState = 'running';
          registry.setDaemonState({ sessionId, bridge, state: 'running' });
        }
        return result;
      })
      .catch((error) => {
        clearBridgeRecord(sessionId, bridge);
        throw error;
      });
    return bridge.startPromise;
  }

  async function withSessionTransition(sessionId, operation) {
    const previous = transitionTails.get(sessionId) || Promise.resolve();
    let release;
    const current = new Promise((resolve) => { release = resolve; });
    transitionTails.set(sessionId, current);
    await previous.catch(() => {});
    try {
      return await operation();
    } finally {
      release();
      if (transitionTails.get(sessionId) === current) transitionTails.delete(sessionId);
    }
  }

  async function waitForRetiringBridge(sessionId) {
    const retiring = retiringBySession.get(sessionId);
    if (!retiring) return;
    await retiring.promise.catch(() => {});
  }

  function createDaemonBridge(extraOptions = {}) {
    const { env: extraEnv, ...restOptions } = extraOptions;
    return bridgeFactory({
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
    if (!sessionId || shuttingDown) return null;
    const existing = bridges.get(sessionId);
    if (existing) return existing;

    const bridge = createDaemonBridge({
      env: {
        CCNEXUS_SESSION_ID: sessionId,
      },
      runtimeSessionEpoch: makeUuid(),
      bridgeIdentity: makeUuid(),
    });
    installBridgeLifecycle(bridge, sessionId);
    bridges.set(sessionId, bridge);
    startBridge(bridge, sessionId).catch((err) => {
      console.error(`[desktop-runtime] daemon start failed for ${sessionId}:`, err.message);
    });
    registry.ensureSessionDaemon({ sessionId, bridge });
    startLifecycleTimer();
    return bridge;
  }

  function ensureSessionDaemon(args = {}) {
    const bridge = args.bridge || ensureBridge(args.sessionId);
    if (!bridge) return null;
    return registry.ensureSessionDaemon({ ...args, bridge });
  }

  function buildRuntimeRequest(bridge, queryOptions, rawModelId = '') {
    return {
      options: queryOptions,
      runtimeDescriptor: createRuntimeDescriptor({
        rawModelId: rawModelId || queryOptions?.env?.ANTHROPIC_MODEL || queryOptions?.model || '',
        options: queryOptions,
        runtimeSessionEpoch: bridge.runtimeSessionEpoch,
        workspaceIdentity: queryOptions?.cwd || runtimeCwd,
      }),
    };
  }

  async function acquireSessionDaemon({ sessionId, title } = {}) {
    if (!sessionId) throw new Error('Session id is required to acquire a daemon');
    return withSessionTransition(sessionId, async () => {
      await waitForRetiringBridge(sessionId);
      let bridge = bridges.get(sessionId);
      if (bridge && ['retiring', 'stopping', 'stopped'].includes(bridge.lifecycleState)) {
        await bridge.waitForExit?.().catch?.(() => {});
        if (bridges.get(sessionId) === bridge) clearBridgeRecord(sessionId, bridge);
        bridge = null;
      }
      if (!bridge) bridge = ensureBridge(sessionId);
      if (!bridge) throw new Error('Unable to establish the Claude runtime');
      await startBridge(bridge, sessionId);
      if (['retiring', 'stopping', 'stopped'].includes(bridge.lifecycleState)) {
        await bridge.waitForExit?.().catch?.(() => {});
        if (bridges.get(sessionId) === bridge) clearBridgeRecord(sessionId, bridge);
        bridge = ensureBridge(sessionId);
        if (!bridge) throw new Error('Unable to establish the Claude runtime');
        await startBridge(bridge, sessionId);
      }
      const daemon = registry.ensureSessionDaemon({ sessionId, title, bridge });
      return {
        ...daemon,
        bridge,
        runtimeClassification: bridge.hasServedRequest ? 'warm' : 'cold',
        retirementReason: retiredSessions.get(sessionId)?.reason || null,
      };
    });
  }

  async function scheduleBridgeRetirement(sessionId, bridge, reason) {
    return withSessionTransition(sessionId, async () => {
      if (bridges.get(sessionId) !== bridge) return null;
      if (['retiring', 'stopping', 'stopped'].includes(bridge.lifecycleState)) return null;

      bridge.lifecycleState = 'retiring';
      retiredSessions.set(sessionId, { reason, retiredAt: clock() });
      registry.setDaemonState({ sessionId, bridge, state: 'retiring' });
      const exitPromise = Promise.resolve(bridge.waitForExit?.() || undefined);
      retiringBySession.set(sessionId, { bridge, promise: exitPromise });
      try {
        const result = await bridge.retire(reason);
        return result;
      } catch (error) {
        if (retiringBySession.get(sessionId)?.bridge === bridge) retiringBySession.delete(sessionId);
        if (retiredSessions.get(sessionId)?.reason === reason) retiredSessions.delete(sessionId);
        if (bridges.get(sessionId) === bridge) {
          bridge.lifecycleState = 'running';
          registry.setDaemonState({ sessionId, bridge, state: 'running' });
        }
        throw error;
      }
    });
  }

  async function scanRuntimeLifecycle(now = clock()) {
    const candidates = [...bridges.entries()]
      .filter(([, bridge]) => !['retiring', 'stopping', 'stopped'].includes(bridge.lifecycleState));
    const results = await Promise.allSettled(candidates.map(async ([sessionId, bridge]) => {
      let status;
      try {
        status = await bridge.status();
      } catch (error) {
        return { sessionId, bridge, action: 'keep', error };
      }
      if (!status || typeof status !== 'object') {
        return { sessionId, bridge, action: 'keep' };
      }
      const decision = decideRuntimeRetirement(status, now);
      if (decision.action === 'retire-now' || decision.action === 'retire-after-turn') {
        try {
          await scheduleBridgeRetirement(sessionId, bridge, decision.reason);
        } catch (error) {
          return { sessionId, bridge, action: 'keep', error };
        }
      }
      return { sessionId, bridge, ...decision };
    }));
    return results;
  }

  function adoptSessionDaemon({ fromSessionId, toSessionId, title }) {
    if (!fromSessionId || !toSessionId || fromSessionId === toSessionId) return null;
    const bridge = bridges.get(fromSessionId);
    if (bridge) {
      bridges.delete(fromSessionId);
      bridges.set(toSessionId, bridge);
      bridge.sessionId = toSessionId;
    }
    const retiring = retiringBySession.get(fromSessionId);
    if (retiring) {
      retiringBySession.delete(fromSessionId);
      retiringBySession.set(toSessionId, retiring);
    }
    const retired = retiredSessions.get(fromSessionId);
    if (retired) {
      retiredSessions.delete(fromSessionId);
      retiredSessions.set(toSessionId, retired);
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
    let stream;
    let daemon;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      daemon = await acquireSessionDaemon({ sessionId: daemonSessionId, title });
      const bridge = daemon.bridge;
      try {
        stream = await bridge.streamCommand('query', {
          prompt,
          ...buildRuntimeRequest(bridge, queryOptions, rawModelId),
        }, {
          onPermissionRequest,
          onPlanApproval,
        });
        bridge.hasServedRequest = true;
        if (daemon.runtimeClassification === 'cold') retiredSessions.delete(daemonSessionId);
        break;
      } catch (error) {
        if (error?.code !== 'DAEMON_RETIRING' || attempt > 0) throw error;
        await bridge.waitForExit?.();
      }
    }

    stream.daemonSessionId = daemonSessionId;
    stream.process = daemon.bridge.getProcessForInspection();
    stream.runtimeClassification = daemon.runtimeClassification || 'warm';
    stream.runtimeRetirementReason = daemon.retirementReason || null;
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
        rawModelId: args.rawModelId || args.options?.env?.ANTHROPIC_MODEL || args.options?.model || '',
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
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const daemon = await acquireSessionDaemon({ sessionId: daemonSessionId, title });
      try {
        const result = await daemon.bridge.getContextUsage(buildRuntimeRequest(
          daemon.bridge,
          queryOptions,
          rawModelId,
        ));
        daemon.bridge.hasServedRequest = true;
        if (daemon.runtimeClassification === 'cold') retiredSessions.delete(daemonSessionId);
        return result;
      } catch (error) {
        if (error?.code !== 'DAEMON_RETIRING' || attempt > 0) throw error;
        await daemon.bridge.waitForExit?.();
      }
    }
    throw new Error('Unable to establish the Claude runtime');
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
    if (['retiring', 'stopping', 'stopped'].includes(bridge.lifecycleState)) {
      return {
        mode,
        applied: false,
        requiresRestart: false,
      };
    }
    return bridge.setPermissionMode(mode);
  }

  function removeSessionDaemon(sessionId) {
    const bridge = bridges.get(sessionId);
    if (bridge) {
      bridge.lifecycleState = 'stopping';
      registry.setDaemonState({ sessionId, bridge, state: 'stopping' });
      void bridge.shutdown();
      bridges.delete(sessionId);
      registry.removeSessionDaemon(sessionId, bridge);
      if (bridges.size === 0) stopLifecycleTimer();
    }
    retiringBySession.delete(sessionId);
  }

  function stopProcess(args) {
    const owned = registry.findOwnedProcess(args);
    const result = registry.stopProcess(args);
    if (result.ok && owned?.kind === 'DAEMON') {
      const bridge = bridges.get(owned.sessionId);
      if (bridge) bridge.lifecycleState = 'stopping';
      bridges.delete(owned.sessionId);
      retiringBySession.delete(owned.sessionId);
      if (bridges.size === 0) stopLifecycleTimer();
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
    shuttingDown = true;
    stopLifecycleTimer();
    const shuttingDownBridges = new Map(bridges);
    await registry.shutdown();
    bridges.clear();
    retiringBySession.clear();
    retiredSessions.clear();
    transitionTails.clear();
    for (const [sessionId, bridge] of shuttingDownBridges) {
      if (bridges.get(sessionId) === bridge) bridges.delete(sessionId);
    }
    shuttingDown = false;
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
    scanRuntimeLifecycle,
    shutdown,
  };
}
