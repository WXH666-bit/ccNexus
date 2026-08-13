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

function buildRetirementObservation(status = {}) {
  const runtime = status.runtime || null;
  return {
    runtimeGeneration: runtime?.runtimeGeneration ?? null,
    runtimeSessionEpoch: runtime?.runtimeSessionEpoch ?? null,
    runtimeCreatedAt: runtime?.createdAt ?? null,
    runtimeLastUsedAt: runtime?.lastUsedAt ?? null,
    daemonLastUsedAt: status.daemonLastUsedAt ?? null,
  };
}

function createLazyRetriableStream({ stream, iterator, onRetiring, getRuntimeMetadata }) {
  let started = false;
  let deliveredEvent = false;
  let retryUsed = false;
  let currentStream = stream;
  let currentIterator = iterator;
  let nextTail = Promise.resolve();
  let cancelled = false;
  let closed = false;
  let terminationMode = null;
  let terminationArgs = [];
  let terminationPromise = null;
  let iteratorReturnPromise = null;
  let resolveCancellation;
  const cancellationPromise = new Promise((resolve) => {
    resolveCancellation = resolve;
  });
  const terminatedStreams = new Set();

  const readRuntimeMetadata = () => {
    const metadata = typeof getRuntimeMetadata === 'function'
      ? getRuntimeMetadata(currentStream)
      : currentStream?.runtimeMetadata;
    return metadata || undefined;
  };

  const terminateStream = (targetStream, mode = terminationMode, args = terminationArgs) => {
    if (!targetStream || !mode || terminatedStreams.has(targetStream)) return Promise.resolve();
    terminatedStreams.add(targetStream);
    const control = targetStream[mode];
    if (typeof control !== 'function') return Promise.resolve();
    try {
      return Promise.resolve(control.apply(targetStream, args)).catch(() => {});
    } catch {
      return Promise.resolve();
    }
  };

  const terminate = (mode, args = []) => {
    if (terminationPromise) return terminationPromise;
    cancelled = true;
    closed = mode === 'close';
    terminationMode = mode;
    terminationArgs = args;
    resolveCancellation?.();
    terminationPromise = terminateStream(currentStream, mode, args);
    return terminationPromise;
  };

  const readNext = async () => {
    while (true) {
      if (cancelled) return { done: true, value: undefined };
      try {
        const result = await currentIterator.next();
        if (cancelled) return { done: true, value: undefined };
        if (!result.done) deliveredEvent = true;
        return result;
      } catch (error) {
        if (cancelled) return { done: true, value: undefined };
        if (deliveredEvent || retryUsed || error?.code !== 'DAEMON_RETIRING') throw error;
        retryUsed = true;
        let replacement;
        try {
          replacement = await onRetiring({
            currentStream,
            cancellationPromise,
            isCancelled: () => cancelled,
            terminationMode,
            terminationArgs,
            terminateStream: (targetStream) => terminateStream(targetStream),
          });
        } catch (retryError) {
          if (cancelled) return { done: true, value: undefined };
          throw retryError;
        }
        if (!replacement) return { done: true, value: undefined };
        currentStream = replacement.stream;
        currentIterator = replacement.iterator || replacement.stream[Symbol.asyncIterator]();
        if (cancelled) {
          await terminateStream(currentStream);
          return { done: true, value: undefined };
        }
      }
    }
  };

  const enqueue = (operation) => {
    const result = nextTail.then(operation, operation);
    nextTail = result.catch(() => {});
    return result;
  };

  return {
    ...stream,
    get runtimeMetadata() {
      return readRuntimeMetadata();
    },
    get runtimeLifecycle() {
      return readRuntimeMetadata();
    },
    get runtimeClassification() {
      return readRuntimeMetadata()?.classification;
    },
    get runtimeGenerationId() {
      return readRuntimeMetadata()?.generationId;
    },
    get runtimeGeneration() {
      return readRuntimeMetadata()?.generationId;
    },
    get runtimeCreationReason() {
      return readRuntimeMetadata()?.creationReason;
    },
    get runtimeRetirementReason() {
      const metadata = readRuntimeMetadata();
      return metadata ? (metadata.runtimeRetirementReason || null) : undefined;
    },
    get cancelled() {
      return cancelled;
    },
    get closed() {
      return closed;
    },
    [Symbol.asyncIterator]() {
      if (started) throw new Error('Stream can only be iterated once');
      started = true;
      return {
        next() {
          return enqueue(readNext);
        },
        return(value) {
          if (iteratorReturnPromise) return iteratorReturnPromise;
          const iteratorAtReturn = currentIterator;
          const termination = terminate('close');
          iteratorReturnPromise = Promise.resolve(termination).then(() => {
            try {
              const returned = iteratorAtReturn.return?.(value);
              Promise.resolve(returned).catch(() => {});
            } catch {
              // The stream has already been terminated through its control surface.
            }
            return { done: true, value };
          });
          return iteratorReturnPromise;
        },
        throw(error) {
          return enqueue(async () => {
            if (typeof currentIterator.throw === 'function') return currentIterator.throw(error);
            throw error;
          });
        },
      };
    },
    interrupt(...args) {
      return terminate('interrupt', args);
    },
    close(...args) {
      return terminate('close', args);
    },
  };
}

function setStreamMetadata(stream, daemonSessionId, daemon) {
  stream.daemonSessionId = daemonSessionId;
  stream.process = daemon.bridge.getProcessForInspection();
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
  let shutdownPromise = null;

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

  function findBridgeOwner(bridge) {
    for (const [sessionId, candidate] of bridges.entries()) {
      if (candidate === bridge) return sessionId;
    }
    return null;
  }

  function rememberBridgeOwner(bridge, sessionId) {
    if (bridge && sessionId) {
      bridge.sessionId = sessionId;
      bridge.lastOwnerSessionId = sessionId;
    }
  }

  function clearRetiringEntryForBridge(bridge) {
    for (const [sessionId, entry] of retiringBySession.entries()) {
      if (entry?.bridge === bridge) retiringBySession.delete(sessionId);
    }
  }

  function clearRetirementStateForBridge(bridge) {
    clearRetiringEntryForBridge(bridge);
    for (const [sessionId, entry] of retiredSessions.entries()) {
      if (entry?.bridge === bridge) retiredSessions.delete(sessionId);
    }
  }

  function rememberRetirementReason(sessionId, bridge, reason) {
    if (!sessionId || !bridge) return;
    const currentBridge = bridges.get(sessionId);
    const currentEntry = retiredSessions.get(sessionId);
    if ((currentBridge && currentBridge !== bridge)
      || (currentEntry && currentEntry.bridge !== bridge)) return;
    retiredSessions.set(sessionId, { bridge, reason, retiredAt: clock() });
  }

  function consumeRetirementReason(entry, sessionId) {
    if (entry && retiredSessions.get(sessionId) === entry) retiredSessions.delete(sessionId);
  }

  function clearBridgeRecord(sessionId, bridge) {
    if (!sessionId || bridges.get(sessionId) !== bridge) return false;
    bridges.delete(sessionId);
    registry.removeSessionDaemon(sessionId, bridge);
    return true;
  }

  function handleBridgeExit(bridge) {
    const sessionId = findBridgeOwner(bridge) || bridge.sessionId || bridge.lastOwnerSessionId;
    rememberBridgeOwner(bridge, sessionId);
    clearBridgeRecord(sessionId, bridge);
    clearRetiringEntryForBridge(bridge);
    if (bridges.size === 0) stopLifecycleTimer();
  }

  function installBridgeLifecycle(bridge, sessionId) {
    rememberBridgeOwner(bridge, sessionId);
    bridge.once?.('exit', () => handleBridgeExit(bridge));
    bridge.on?.('daemon_event', (event) => {
      const currentSessionId = bridge.sessionId;
      if (event?.event !== 'retiring' || bridges.get(currentSessionId) !== bridge) return;
      bridge.lifecycleState = 'retiring';
      rememberRetirementReason(currentSessionId, bridge, event.reason || 'lifecycle');
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
        if (bridges.get(sessionId) === bridge) {
          clearBridgeRecord(sessionId, bridge);
          clearRetiringEntryForBridge(bridge);
        }
        bridge = null;
      }
      if (!bridge) bridge = ensureBridge(sessionId);
      if (!bridge) throw new Error('Unable to establish the Claude runtime');
      await startBridge(bridge, sessionId);
      if (['retiring', 'stopping', 'stopped'].includes(bridge.lifecycleState)) {
        await bridge.waitForExit?.().catch?.(() => {});
        if (bridges.get(sessionId) === bridge) {
          clearBridgeRecord(sessionId, bridge);
          clearRetiringEntryForBridge(bridge);
        }
        bridge = ensureBridge(sessionId);
        if (!bridge) throw new Error('Unable to establish the Claude runtime');
        await startBridge(bridge, sessionId);
      }
      const daemon = registry.ensureSessionDaemon({ sessionId, title, bridge });
      const retirementEntry = retiredSessions.get(sessionId) || null;
      return {
        ...daemon,
        bridge,
        retirementEntry,
      };
    });
  }

  async function scheduleBridgeRetirement(sessionId, bridge, reason, observation) {
    return withSessionTransition(sessionId, async () => {
      if (bridges.get(sessionId) !== bridge) return null;
      if (['retiring', 'stopping', 'stopped'].includes(bridge.lifecycleState)) return null;

      let result;
      try {
        result = await bridge.retire(reason, observation);
      } catch (error) {
        const ownerSessionId = findBridgeOwner(bridge);
        clearRetirementStateForBridge(bridge);
        if (ownerSessionId === sessionId) {
          bridge.lifecycleState = 'running';
          registry.setDaemonState({ sessionId: ownerSessionId, bridge, state: 'running' });
        }
        throw error;
      }

      if (result?.accepted !== true) {
        const ownerSessionId = findBridgeOwner(bridge);
        clearRetirementStateForBridge(bridge);
        if (ownerSessionId === sessionId) {
          bridge.lifecycleState = 'running';
          registry.setDaemonState({ sessionId: ownerSessionId, bridge, state: 'running' });
        }
        return result;
      }

      const ownerSessionId = findBridgeOwner(bridge);
      if (ownerSessionId === null || bridge.lifecycleState === 'stopped') {
        rememberRetirementReason(
          bridge.lastOwnerSessionId || sessionId,
          bridge,
          result.reason || reason,
        );
        return result;
      }
      const retirementReason = result.reason || reason;
      bridge.lifecycleState = 'retiring';
      rememberRetirementReason(ownerSessionId, bridge, retirementReason);
      registry.setDaemonState({ sessionId: ownerSessionId, bridge, state: 'retiring' });
      const exitPromise = Promise.resolve(bridge.waitForExit?.() || undefined);
      retiringBySession.set(ownerSessionId, { bridge, promise: exitPromise });
      return result;
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
          const retirement = await scheduleBridgeRetirement(
            sessionId,
            bridge,
            decision.reason,
            buildRetirementObservation(status),
          );
          if (retirement?.accepted !== true) {
            return {
              sessionId,
              bridge,
              action: 'keep',
              reason: decision.reason,
              refusalReason: retirement?.refusalReason || 'not-eligible',
              retirement,
            };
          }
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
      rememberBridgeOwner(bridge, toSessionId);
    }
    const retiring = retiringBySession.get(fromSessionId);
    if (retiring?.bridge === bridge) {
      retiringBySession.delete(fromSessionId);
      retiringBySession.delete(toSessionId);
      retiringBySession.set(toSessionId, retiring);
    }
    const retired = retiredSessions.get(fromSessionId);
    if (retired?.bridge === bridge) {
      retiredSessions.delete(fromSessionId);
      retiredSessions.delete(toSessionId);
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
    let daemon = await acquireSessionDaemon({ sessionId: daemonSessionId, title });
    let bridge = daemon.bridge;
    const candidateStream = await bridge.streamCommand('query', {
      prompt,
      ...buildRuntimeRequest(bridge, queryOptions, rawModelId),
    }, {
      onPermissionRequest,
      onPlanApproval,
    });
    let retirementReasonConsumed = false;
    let confirmedRetirementReason;
    const getRuntimeMetadata = (candidate) => {
      const metadata = candidate?.runtimeMetadata;
      if (!metadata) return undefined;
      if (metadata.classification === 'cold' && !retirementReasonConsumed) {
        retirementReasonConsumed = true;
        if (daemon.retirementEntry) {
          confirmedRetirementReason = daemon.retirementEntry.reason;
          consumeRetirementReason(daemon.retirementEntry, daemonSessionId);
        }
      }
      return confirmedRetirementReason
        ? { ...metadata, runtimeRetirementReason: confirmedRetirementReason }
        : metadata;
    };

    const stream = createLazyRetriableStream({
      stream: candidateStream,
      iterator: candidateStream[Symbol.asyncIterator](),
      getRuntimeMetadata,
      onRetiring: async ({
        cancellationPromise,
        isCancelled,
        terminationMode,
        terminationArgs,
        terminateStream,
      }) => {
        try {
          await Promise.race([
            Promise.resolve(bridge.waitForExit?.()),
            cancellationPromise,
          ]);
        } catch (error) {
          if (isCancelled()) return null;
          throw error;
        }
        if (isCancelled()) return null;

        const acquisition = acquireSessionDaemon({ sessionId: daemonSessionId, title });
        daemon = await Promise.race([
          acquisition,
          cancellationPromise.then(() => null),
        ]);
        if (!daemon || isCancelled()) {
          return null;
        }
        bridge = daemon.bridge;

        const replacementAcquisition = bridge.streamCommand('query', {
          prompt,
          ...buildRuntimeRequest(bridge, queryOptions, rawModelId),
        }, {
          onPermissionRequest,
          onPlanApproval,
        });
        const replacementStream = await Promise.race([
          replacementAcquisition,
          cancellationPromise.then(() => null),
        ]);
        if (!replacementStream || isCancelled()) {
          replacementAcquisition.then((candidateStream) => {
            if (isCancelled()) void terminateStream(candidateStream);
          }).catch(() => {});
          return null;
        }
        setStreamMetadata(stream, daemonSessionId, daemon);
        if (isCancelled()) {
          await terminateStream(replacementStream);
          return null;
        }
        return {
          stream: replacementStream,
          iterator: replacementStream[Symbol.asyncIterator](),
        };
      },
    });
    setStreamMetadata(stream, daemonSessionId, daemon);
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
        if (!result || typeof result !== 'object' || Array.isArray(result)) return result;
        const { runtimeMetadata, ...contextResult } = result;
        if (!runtimeMetadata) return contextResult;
        let runtimeRetirementReason;
        if (runtimeMetadata.classification === 'cold' && daemon.retirementEntry) {
          runtimeRetirementReason = daemon.retirementEntry.reason;
          consumeRetirementReason(daemon.retirementEntry, daemonSessionId);
        }
        return {
          ...contextResult,
          runtimeClassification: runtimeMetadata.classification,
          runtimeGenerationId: runtimeMetadata.generationId,
          ...(runtimeMetadata.creationReason
            ? { runtimeCreationReason: runtimeMetadata.creationReason }
            : {}),
          ...(runtimeRetirementReason ? { runtimeRetirementReason } : {}),
        };
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
      clearRetirementStateForBridge(bridge);
    }
  }

  function stopProcess(args) {
    const owned = registry.findOwnedProcess(args);
    const result = registry.stopProcess(args);
    if (result.ok && owned?.kind === 'DAEMON') {
      const bridge = bridges.get(owned.sessionId);
      if (bridge) bridge.lifecycleState = 'stopping';
      bridges.delete(owned.sessionId);
      if (bridge) clearRetirementStateForBridge(bridge);
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
    if (shutdownPromise) return shutdownPromise;
    shutdownPromise = (async () => {
      shuttingDown = true;
      try {
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
      } finally {
        shuttingDown = false;
      }
    })();
    try {
      return await shutdownPromise;
    } finally {
      shutdownPromise = null;
    }
  }

  async function setCwd(nextCwd) {
    if (!nextCwd || nextCwd === runtimeCwd) return runtimeCwd;
    await shutdown();
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
