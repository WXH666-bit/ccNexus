import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DaemonBridge } from './daemonBridge.js';
import { DesktopProcessRegistry } from './processRegistry.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const defaultDaemonScript = path.resolve(__dirname, '../daemon/ccnexus-daemon.js');

export function createDesktopRuntime(options = {}) {
  let runtimeCwd = options.cwd || process.cwd();
  const registry = new DesktopProcessRegistry(options);
  const bridges = new Map();

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

  function adoptSessionDaemon({ fromSessionId, toSessionId, title }) {
    if (!fromSessionId || !toSessionId || fromSessionId === toSessionId) return null;
    const bridge = bridges.get(fromSessionId);
    if (bridge) {
      bridges.delete(fromSessionId);
      bridges.set(toSessionId, bridge);
    }
    return registry.adoptSessionDaemon({ fromSessionId, toSessionId, title });
  }

  async function queryClaude({ sessionId, title, prompt, options: queryOptions = {}, onPermissionRequest }) {
    const daemonSessionId = sessionId || `pending-${Date.now()}`;
    const daemon = ensureSessionDaemon({ sessionId: daemonSessionId, title });
    const bridge = daemon.bridge;
    const stream = await bridge.streamCommand('query', {
      prompt,
      options: queryOptions,
    }, {
      onPermissionRequest,
    });

    stream.daemonSessionId = daemonSessionId;
    stream.process = bridge.getProcessForInspection();
    return stream;
  }

  async function getContextUsage({ sessionId, title = 'Context usage', options: queryOptions = {} } = {}) {
    const daemonSessionId = sessionId || `context-${Date.now()}`;
    const daemon = ensureSessionDaemon({ sessionId: daemonSessionId, title });
    if (!daemon?.bridge) throw new Error('Unable to establish the Claude runtime');
    return daemon.bridge.getContextUsage(queryOptions);
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
    getContextUsage,
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
