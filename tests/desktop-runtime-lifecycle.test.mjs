import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';
import { createDesktopRuntime } from '../desktop/runtime/index.js';

class FakeBridge extends EventEmitter {
  static instances = [];
  static streamBehavior = null;
  static startBehavior = null;
  static contextBehavior = null;
  static retireBehavior = null;

  constructor(options = {}) {
    super();
    this.runtimeSessionEpoch = options.runtimeSessionEpoch || `epoch-${FakeBridge.instances.length + 1}`;
    this.bridgeIdentity = options.bridgeIdentity || `bridge-${FakeBridge.instances.length + 1}`;
    this.statusValue = options.statusValue || {
      daemonStartedAt: 0,
      daemonLastUsedAt: 0,
      activeRequestId: null,
      pendingControlCount: 0,
      runtime: { createdAt: 0, lastUsedAt: 0, activeTurnCount: 0, closed: false },
    };
    this.retireCalls = [];
    this.retireObservations = [];
    this.statusCalls = 0;
    this.closeCalls = 0;
    this.interruptCalls = 0;
    this.shutdownCalls = 0;
    this.startCalls = 0;
    this.streamCalls = 0;
    this.contextCalls = 0;
    this.process = { pid: 1000 + FakeBridge.instances.length, killed: false, spawnargs: [] };
    this.exitPromise = new Promise((resolve) => { this.resolveExit = resolve; });
    FakeBridge.instances.push(this);
  }

  start() {
    this.startCalls += 1;
    if (typeof FakeBridge.startBehavior === 'function') {
      return FakeBridge.startBehavior(this);
    }
    return Promise.resolve();
  }

  status() {
    this.statusCalls += 1;
    return Promise.resolve(this.statusValue);
  }

  retire(reason, observation) {
    this.retireCalls.push(reason);
    this.retireObservations.push({ reason, observation });
    if (typeof FakeBridge.retireBehavior === 'function') {
      return FakeBridge.retireBehavior(this, reason, observation);
    }
    return Promise.resolve({ accepted: true, retiring: true, deferred: false, reason });
  }

  waitForExit() {
    return this.exitPromise;
  }

  finishExit() {
    this.emit('exit', { code: 0, signal: null });
    this.resolveExit();
  }

  emitExit() {
    this.emit('exit', { code: 0, signal: null });
  }

  getProcessForInspection() {
    return this.process;
  }

  async streamCommand() {
    this.streamCalls += 1;
    let stream;
    if (typeof FakeBridge.streamBehavior === 'function') {
      stream = await FakeBridge.streamBehavior(this);
    } else {
      stream = {
      daemonSessionId: 'session-1',
      async *[Symbol.asyncIterator]() {},
      close: () => { this.closeCalls += 1; },
      interrupt: () => { this.interruptCalls += 1; },
      };
    }
    if (stream && !stream.__skipRuntimeMetadata && stream.runtimeMetadata === undefined) {
      stream.runtimeMetadata = {
        classification: this.streamCalls === 1 ? 'cold' : 'warm',
        generationId: FakeBridge.instances.indexOf(this) + 1,
        ...(this.streamCalls === 1 ? { creationReason: 'initial' } : {}),
      };
    }
    return stream;
  }

  async getContextUsage() {
    this.contextCalls += 1;
    let result;
    if (typeof FakeBridge.contextBehavior === 'function') {
      result = await FakeBridge.contextBehavior(this);
    } else {
      result = { used: 10, size: 100 };
    }
    if (result && typeof result === 'object' && !Array.isArray(result) && result.runtimeMetadata === undefined) {
      result = {
        ...result,
        runtimeMetadata: {
          classification: this.streamCalls > 0 ? 'warm' : 'cold',
          generationId: FakeBridge.instances.indexOf(this) + 1,
          ...(this.streamCalls === 0 ? { creationReason: 'initial' } : {}),
        },
      };
    }
    return result;
  }

  shutdown() {
    this.shutdownCalls += 1;
    this.finishExit();
    return Promise.resolve();
  }
}

function resetFakes() {
  FakeBridge.instances = [];
  FakeBridge.streamBehavior = null;
  FakeBridge.startBehavior = null;
  FakeBridge.contextBehavior = null;
  FakeBridge.retireBehavior = null;
}

async function waitForCondition(predicate, { attempts = 200 } = {}) {
  for (let index = 0; index < attempts; index += 1) {
    if (predicate()) return;
    await new Promise(resolve => setTimeout(resolve, 1));
  }
  assert.fail('Condition was not met in time');
}

function withTimeout(promise, label, timeoutMs = 500) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out`)), timeoutMs);
  });
  return Promise.race([Promise.resolve(promise), timeout]).finally(() => clearTimeout(timer));
}

async function exerciseSharedAcquisitionCancellation(mode) {
  resetFakes();
  let firstBridge;
  let sharedReplacementBridge;
  let secondRequestBridge;
  let replacementStreamCalls = 0;
  let releaseReplacementStart;
  let resolveSecondStreamCreated;
  const replacementStart = new Promise(resolve => { releaseReplacementStart = resolve; });
  const secondStreamCreated = new Promise(resolve => { resolveSecondStreamCreated = resolve; });
  const replacementBridges = [];

  FakeBridge.startBehavior = (bridge) => {
    if (!firstBridge) return Promise.resolve();
    replacementBridges.push(bridge);
    if (replacementBridges.length === 1) {
      sharedReplacementBridge = bridge;
      return replacementStart;
    }
    return Promise.resolve();
  };
  FakeBridge.streamBehavior = (bridge) => {
    if (!firstBridge) {
      firstBridge = bridge;
      let failed = false;
      const iterator = {
        async next() {
          if (failed) return { done: true, value: undefined };
          failed = true;
          firstBridge.finishExit();
          throw Object.assign(new Error('Daemon is retiring'), { code: 'DAEMON_RETIRING' });
        },
      };
      return {
        daemonSessionId: 'shared-acquisition-session',
        [Symbol.asyncIterator]() { return iterator; },
        close() { bridge.closeCalls += 1; },
        interrupt() { bridge.interruptCalls += 1; },
      };
    }

    secondRequestBridge = bridge;
    replacementStreamCalls += 1;
    resolveSecondStreamCreated();
    const events = [
      { type: 'system', subtype: 'init', session_id: 'shared-acquisition-session' },
      { type: 'result', subtype: 'success', session_id: 'shared-acquisition-session' },
    ];
    const iterator = {
      async next() {
        if (bridge.shutdownCalls > 0) {
          throw new Error('The shared replacement bridge was shut down');
        }
        if (events.length === 0) return { done: true, value: undefined };
        return { done: false, value: events.shift() };
      },
    };
    return {
      daemonSessionId: 'shared-acquisition-session',
      [Symbol.asyncIterator]() { return iterator; },
      close() { bridge.closeCalls += 1; },
      interrupt() { bridge.interruptCalls += 1; },
    };
  };

  const runtime = createDesktopRuntime({
    bridgeFactory: options => new FakeBridge(options),
  });

  try {
    const wrapper = await runtime.queryClaude({
      sessionId: 'shared-acquisition-session',
      title: 'Cancelled retry owner',
      prompt: 'retiring request',
      options: { cwd: 'D:/ccNexus', model: 'sonnet' },
    });
    const retryRead = wrapper[Symbol.asyncIterator]().next();
    await waitForCondition(() => sharedReplacementBridge?.startCalls === 1);

    let otherStream = null;
    const otherQuery = runtime.queryClaude({
      sessionId: 'shared-acquisition-session',
      title: 'Shared request',
      prompt: 'continue on shared replacement',
      options: { cwd: 'D:/ccNexus', model: 'sonnet' },
    }).then((stream) => {
      otherStream = stream;
      return stream;
    });
    await Promise.resolve();
    assert.equal(otherStream, null, 'other request must wait for the shared acquisition');

    await wrapper[mode]();
    assert.deepEqual(await retryRead, { done: true, value: undefined });
    assert.equal(sharedReplacementBridge.shutdownCalls, 0);
    assert.equal(replacementStreamCalls, 0);

    releaseReplacementStart();
    const sharedStream = await otherQuery;
    await secondStreamCreated;
    assert.equal(replacementStreamCalls, 1);
    assert.equal(sharedReplacementBridge.shutdownCalls, 0);
    assert.equal(secondRequestBridge, sharedReplacementBridge);

    const events = [];
    for await (const event of sharedStream) events.push(event);
    assert.deepEqual(events.map(event => event.type), ['system', 'result']);
  } finally {
    releaseReplacementStart?.();
    await runtime.shutdown();
  }
}

test('host close during retry acquisition does not shut down a shared replacement bridge', async () => {
  await exerciseSharedAcquisitionCancellation('close');
});

test('host interrupt during retry acquisition does not shut down a shared replacement bridge', async () => {
  await exerciseSharedAcquisitionCancellation('interrupt');
});

test('host does not retire before 2 hours and retires at the boundary', async () => {
  resetFakes();
  let now = 2 * 60 * 60 * 1000 - 1;
  const runtime = createDesktopRuntime({
    bridgeFactory: options => new FakeBridge(options),
    now: () => now,
  });
  runtime.ensureSessionDaemon({ sessionId: 'idle-session', title: 'Idle' });

  await runtime.scanRuntimeLifecycle(now);
  assert.deepEqual(FakeBridge.instances[0].retireCalls, []);

  now += 1;
  await runtime.scanRuntimeLifecycle(now);
  assert.deepEqual(FakeBridge.instances[0].retireCalls, ['idle']);
  await runtime.shutdown();
});

test('host lifecycle scan forwards status timestamps without touching runtime activity', async () => {
  resetFakes();
  const now = 2 * 60 * 60 * 1000;
  const runtime = createDesktopRuntime({
    bridgeFactory: options => new FakeBridge({
      ...options,
      statusValue: {
        daemonStartedAt: 0,
        daemonLastUsedAt: 0,
        activeRequestId: null,
        pendingControlCount: 0,
        runtime: {
          runtimeGeneration: 1,
          runtimeSessionEpoch: 'epoch-1',
          createdAt: 0,
          lastUsedAt: 0,
          activeTurnCount: 0,
          closed: false,
        },
      },
    }),
    now: () => now,
  });
  runtime.ensureSessionDaemon({ sessionId: 'observation-session', title: 'Observation' });
  const bridge = FakeBridge.instances[0];

  await runtime.scanRuntimeLifecycle(now);

  assert.equal(bridge.statusCalls, 1);
  assert.equal(bridge.statusValue.runtime.lastUsedAt, 0);
  assert.equal(bridge.statusValue.daemonLastUsedAt, 0);
  assert.equal(bridge.retireObservations.length, 1);
  assert.equal(bridge.retireObservations[0].observation.runtimeLastUsedAt, 0);
  assert.equal(bridge.retireObservations[0].observation.daemonLastUsedAt, 0);
  await runtime.shutdown();
});

test('host empty-idle scan builds a daemon-only observation without runtime activity', async () => {
  resetFakes();
  const now = 2 * 60 * 60 * 1000;
  const runtime = createDesktopRuntime({
    bridgeFactory: options => new FakeBridge({
      ...options,
      statusValue: {
        daemonStartedAt: 0,
        daemonLastUsedAt: 0,
        activeRequestId: null,
        pendingControlCount: 0,
        runtime: null,
      },
    }),
    now: () => now,
  });
  runtime.ensureSessionDaemon({ sessionId: 'empty-observation-session', title: 'Empty observation' });
  const bridge = FakeBridge.instances[0];

  await runtime.scanRuntimeLifecycle(now);

  assert.equal(bridge.statusCalls, 1);
  assert.deepEqual(bridge.retireObservations, [{
    reason: 'empty-idle',
    observation: {
      runtimeGeneration: null,
      runtimeSessionEpoch: null,
      runtimeCreatedAt: null,
      runtimeLastUsedAt: null,
      daemonLastUsedAt: 0,
    },
  }]);
  await runtime.shutdown();
});

test('host waits for active eight-hour daemon retirement before creating a new generation', async () => {
  resetFakes();
  const eightHours = 8 * 60 * 60 * 1000;
  let now = eightHours;
  const runtime = createDesktopRuntime({
    bridgeFactory: options => new FakeBridge({
      ...options,
      statusValue: {
        daemonStartedAt: 0,
        daemonLastUsedAt: now,
        activeRequestId: 'turn-1',
        pendingControlCount: 0,
        runtime: { createdAt: 0, lastUsedAt: now, activeTurnCount: 1, closed: false },
      },
    }),
    now: () => now,
  });
  runtime.ensureSessionDaemon({ sessionId: 'active-session', title: 'Active' });
  const oldBridge = FakeBridge.instances[0];

  await runtime.scanRuntimeLifecycle(now);
  assert.deepEqual(oldBridge.retireCalls, ['absolute-lifetime']);

  let acquired = false;
  const acquisition = runtime.queryClaude({
    sessionId: 'active-session',
    title: 'Active',
    prompt: 'after retirement',
    options: { cwd: 'D:/ccNexus', model: 'sonnet' },
  }).then((stream) => {
    acquired = true;
    return stream;
  });
  await Promise.resolve();
  assert.equal(acquired, false);

  oldBridge.finishExit();
  const stream = await acquisition;
  assert.equal(FakeBridge.instances.length, 2);
  assert.notEqual(FakeBridge.instances[1], oldBridge);
  assert.equal(stream.runtimeClassification, 'cold');
  assert.equal(stream.runtimeRetirementReason, 'absolute-lifetime');
  assert.equal(oldBridge.streamCalls, 0);
  assert.equal(FakeBridge.instances[1].streamCalls, 1);

  oldBridge.emit('exit', { code: 0, signal: null });
  const snapshot = runtime.buildProcessSnapshot();
  assert.equal(snapshot.processes.filter(item => item.kind === 'DAEMON').length, 1);
  assert.equal(snapshot.processes[0].pid, FakeBridge.instances[1].process.pid);
  await runtime.shutdown();
});

test('host keeps accepted retirement waits independent across sessions', async () => {
  resetFakes();
  const eightHours = 8 * 60 * 60 * 1000;
  let runtime;
  let oldBridge;
  let aAcquisition;
  let aStream;
  let bStream;

  FakeBridge.streamBehavior = (bridge) => {
    const events = [
      { type: 'system', subtype: 'init', session_id: bridge.sessionId },
      { type: 'result', subtype: 'success', session_id: bridge.sessionId },
    ];
    return {
      [Symbol.asyncIterator]() {
        return {
          async next() {
            if (events.length === 0) return { done: true, value: undefined };
            return { done: false, value: events.shift() };
          },
        };
      },
      close() { bridge.closeCalls += 1; },
      interrupt() { bridge.interruptCalls += 1; },
    };
  };

  runtime = createDesktopRuntime({
    bridgeFactory: options => new FakeBridge(options),
  });

  try {
    runtime.ensureSessionDaemon({ sessionId: 'session-a', title: 'Session A' });
    oldBridge = FakeBridge.instances[0];
    await runtime.scanRuntimeLifecycle(eightHours);

    assert.deepEqual(oldBridge.retireCalls, ['absolute-lifetime']);
    assert.equal(oldBridge.lifecycleState, 'retiring');

    let aSettled = false;
    aAcquisition = runtime.queryClaude({
      sessionId: 'session-a',
      title: 'Session A',
      prompt: 'wait for replacement',
      options: { cwd: 'D:/ccNexus', model: 'sonnet' },
    }).then((stream) => {
      aSettled = true;
      return stream;
    }, (error) => {
      aSettled = true;
      throw error;
    });
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.equal(aSettled, false);

    bStream = await withTimeout(runtime.queryClaude({
      sessionId: 'session-b',
      title: 'Session B',
      prompt: 'run independently',
      options: { cwd: 'D:/ccNexus', model: 'sonnet' },
    }), 'session B acquisition');
    const bBridge = FakeBridge.instances[1];
    assert.equal(FakeBridge.instances.length, 2);
    assert.equal(bBridge.sessionId, 'session-b');
    assert.notEqual(bBridge.bridgeIdentity, oldBridge.bridgeIdentity);
    assert.equal(bBridge.streamCalls, 1);
    assert.equal(aSettled, false);
    const bEvents = await withTimeout((async () => {
      const events = [];
      for await (const event of bStream) events.push(event);
      return events;
    })(), 'session B stream');
    assert.deepEqual(bEvents.map(event => event.type), ['system', 'result']);

    oldBridge.finishExit();
    aStream = await withTimeout(aAcquisition, 'session A replacement acquisition');
    const replacementBridge = FakeBridge.instances[2];
    assert.equal(FakeBridge.instances.length, 3);
    assert.equal(replacementBridge.sessionId, 'session-a');
    assert.notEqual(replacementBridge.bridgeIdentity, oldBridge.bridgeIdentity);
    assert.notEqual(replacementBridge.bridgeIdentity, bBridge.bridgeIdentity);
    assert.equal(oldBridge.streamCalls, 0);
    assert.equal(replacementBridge.streamCalls, 1);
    assert.equal(aStream.process, replacementBridge.process);
    assert.equal(aStream.runtimeClassification, 'cold');
    const aEvents = await withTimeout((async () => {
      const events = [];
      for await (const event of aStream) events.push(event);
      return events;
    })(), 'session A replacement stream');
    assert.deepEqual(aEvents.map(event => event.type), ['system', 'result']);
  } finally {
    oldBridge?.finishExit();
    if (aAcquisition) {
      await withTimeout(aAcquisition.catch(() => null), 'session A cleanup').catch(() => {});
    }
    await bStream?.close?.();
    await aStream?.close?.();
    await runtime.shutdown();
  }
});

test('host keeps a bridge running when daemon refuses a stale idle retirement after work resumes', async () => {
  resetFakes();
  const now = 2 * 60 * 60 * 1000;
  let workStarted = false;
  FakeBridge.retireBehavior = (bridge) => {
    workStarted = true;
    bridge.statusValue = {
      ...bridge.statusValue,
      activeRequestId: 'turn-1',
      runtime: {
        ...bridge.statusValue.runtime,
        activeTurnCount: 1,
        lastUsedAt: now + 1,
      },
    };
    return Promise.resolve({
      accepted: false,
      retiring: false,
      deferred: false,
      reason: 'idle',
      refusalReason: 'active',
    });
  };

  const runtime = createDesktopRuntime({
    bridgeFactory: options => new FakeBridge({
      ...options,
      statusValue: {
        daemonStartedAt: 0,
        daemonLastUsedAt: 0,
        activeRequestId: null,
        pendingControlCount: 0,
        runtime: { createdAt: 0, lastUsedAt: 0, activeTurnCount: 0, closed: false },
      },
    }),
    now: () => now,
  });
  runtime.ensureSessionDaemon({ sessionId: 'race-session', title: 'Race' });
  const bridge = FakeBridge.instances[0];

  const scan = await runtime.scanRuntimeLifecycle(now);
  assert.equal(workStarted, true);
  assert.equal(scan[0].value.action, 'keep');
  assert.equal(bridge.lifecycleState, 'running');
  assert.equal(runtime.buildProcessSnapshot().processes[0].lifecycleState, 'running');

  let timer;
  try {
    const query = runtime.queryClaude({
      sessionId: 'race-session',
      title: 'Race',
      prompt: 'continue after refusal',
      options: { cwd: 'D:/ccNexus', model: 'sonnet' },
    });
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error('query waited for refused retirement')), 100);
    });
    const stream = await Promise.race([query, timeout]);
    assert.equal(FakeBridge.instances.length, 1);
    assert.equal(stream.process, bridge.process);
    assert.equal(stream.runtimeRetirementReason, null);
    assert.equal(runtime.buildProcessSnapshot().processes[0].lifecycleState, 'running');
  } finally {
    clearTimeout(timer);
    await runtime.shutdown();
  }
});

test('host returns a stream before the first SDK event and lazily retries retirement once', async () => {
  resetFakes();
  let firstBridge;
  let firstReadResolve;
  let firstReadReject;
  let firstReadSettled = false;
  const firstRead = new Promise((resolve, reject) => {
    firstReadResolve = (value) => {
      firstReadSettled = true;
      resolve(value);
    };
    firstReadReject = (error) => {
      firstReadSettled = true;
      reject(error);
    };
  });
  FakeBridge.streamBehavior = (bridge) => {
    if (!firstBridge) {
      firstBridge = bridge;
      return {
        [Symbol.asyncIterator]() { return { next: () => firstRead }; },
        close() {},
        interrupt() {},
      };
    }
    const events = [{ type: 'system', subtype: 'init', session_id: 'session-1' }];
    return {
      [Symbol.asyncIterator]() {
        return {
          async next() {
            if (events.length === 0) return { done: true, value: undefined };
            return { done: false, value: events.shift() };
          },
        };
      },
      close() {},
      interrupt() {},
    };
  };

  const runtime = createDesktopRuntime({
    bridgeFactory: options => new FakeBridge(options),
  });
  const acquisition = runtime.queryClaude({
    sessionId: 'lazy-session',
    title: 'Lazy retry',
    prompt: 'wait for the first event',
    options: { cwd: 'D:/ccNexus', model: 'sonnet' },
  });
  const timeout = Symbol('acquisition-timeout');

  try {
    const stream = await Promise.race([
      acquisition,
      new Promise(resolve => setTimeout(() => resolve(timeout), 100)),
    ]);
    assert.notEqual(stream, timeout, 'queryClaude must not wait for the first SDK event');

    const iterator = stream[Symbol.asyncIterator]();
    const retirementError = Object.assign(new Error('Daemon is retiring'), {
      code: 'DAEMON_RETIRING',
    });
    firstBridge.finishExit();
    firstReadReject(retirementError);
    const firstEvent = await iterator.next();

    assert.equal(firstEvent.value.type, 'system');
    assert.equal(stream.daemonSessionId, 'lazy-session');
    assert.equal(stream.process, FakeBridge.instances[1].process);
    assert.equal(typeof stream.interrupt, 'function');
    assert.equal(typeof stream.close, 'function');
    assert.equal(FakeBridge.instances.length, 2);
  } finally {
    if (!firstReadSettled) firstReadResolve({ done: true, value: undefined });
    await acquisition.catch(() => {});
    await runtime.shutdown();
  }
});

test('host iterator return closes a pending underlying stream immediately', async () => {
  resetFakes();
  let bridge;
  let readStartedResolve;
  let releaseRead;
  const readStarted = new Promise(resolve => { readStartedResolve = resolve; });
  FakeBridge.streamBehavior = (candidateBridge) => {
    bridge = candidateBridge;
    return {
      [Symbol.asyncIterator]() {
        return {
          next() {
            readStartedResolve();
            return new Promise(resolve => { releaseRead = resolve; });
          },
        };
      },
      close() {
        bridge.closeCalls += 1;
        releaseRead?.({ done: true, value: undefined });
      },
      interrupt() {
        bridge.interruptCalls += 1;
      },
    };
  };

  const runtime = createDesktopRuntime({
    bridgeFactory: options => new FakeBridge(options),
  });
  const stream = await runtime.queryClaude({
    sessionId: 'iterator-return-session',
    title: 'Iterator return',
    prompt: 'stop while reading',
    options: { cwd: 'D:/ccNexus', model: 'sonnet' },
  });
  const iterator = stream[Symbol.asyncIterator]();
  const pendingRead = iterator.next();
  await readStarted;

  const returnTimeout = Symbol('return-timeout');
  const returned = await Promise.race([
    iterator.return('stopped'),
    new Promise(resolve => setTimeout(() => resolve(returnTimeout), 100)),
  ]);
  assert.notEqual(returned, returnTimeout);
  assert.deepEqual(returned, { done: true, value: 'stopped' });
  assert.deepEqual(await pendingRead, { done: true, value: undefined });
  assert.equal(bridge.closeCalls, 1);
  assert.equal(bridge.interruptCalls, 0);
  assert.equal(stream.cancelled, true);
  assert.equal(stream.closed, true);

  await stream.close();
  assert.equal(bridge.closeCalls, 1);
  await runtime.shutdown();
});

test('host close cancels a retiring retry and closes a replacement created during the overlap', async () => {
  resetFakes();
  let firstBridge;
  let firstReadReject;
  let readStartedResolve;
  let replacementCommandStartedResolve;
  let replacementStreamResolve;
  const readStarted = new Promise(resolve => { readStartedResolve = resolve; });
  const replacementCommandStarted = new Promise(resolve => { replacementCommandStartedResolve = resolve; });
  const replacementStream = new Promise(resolve => { replacementStreamResolve = resolve; });

  FakeBridge.streamBehavior = (bridge) => {
    if (!firstBridge) {
      firstBridge = bridge;
      return {
        [Symbol.asyncIterator]() {
          return {
            next() {
              readStartedResolve();
              return new Promise((resolve, reject) => {
                firstReadReject = reject;
              });
            },
          };
        },
        close() { bridge.closeCalls += 1; },
        interrupt() { bridge.interruptCalls += 1; },
      };
    }
    replacementCommandStartedResolve();
    return replacementStream;
  };

  const runtime = createDesktopRuntime({
    bridgeFactory: options => new FakeBridge(options),
  });
  const stream = await runtime.queryClaude({
    sessionId: 'close-retry-overlap',
    title: 'Close retry overlap',
    prompt: 'close while replacing',
    options: { cwd: 'D:/ccNexus', model: 'sonnet' },
  });
  const iterator = stream[Symbol.asyncIterator]();
  const pendingRead = iterator.next();
  await readStarted;
  const error = Object.assign(new Error('Daemon is retiring'), { code: 'DAEMON_RETIRING' });
  firstReadReject(error);
  firstBridge.finishExit();
  await replacementCommandStarted;

  await stream.close();
  await stream.close();
  const replacementBridge = FakeBridge.instances[1];
  replacementStreamResolve({
    [Symbol.asyncIterator]() {
      return {
        async next() {
          return { done: false, value: { type: 'must-not-deliver' } };
        },
      };
    },
    close() { replacementBridge.closeCalls += 1; },
    interrupt() { replacementBridge.interruptCalls += 1; },
  });

  const result = await pendingRead;
  assert.deepEqual(result, { done: true, value: undefined });
  assert.equal(firstBridge.closeCalls, 1);
  assert.equal(firstBridge.interruptCalls, 0);
  assert.equal(replacementBridge.closeCalls, 1);
  assert.equal(replacementBridge.interruptCalls, 0);
  await runtime.shutdown();
});

test('host interrupt cancels a retiring retry and interrupts a replacement created during the overlap', async () => {
  resetFakes();
  let firstBridge;
  let firstReadReject;
  let readStartedResolve;
  let replacementCommandStartedResolve;
  let replacementStreamResolve;
  const readStarted = new Promise(resolve => { readStartedResolve = resolve; });
  const replacementCommandStarted = new Promise(resolve => { replacementCommandStartedResolve = resolve; });
  const replacementStream = new Promise(resolve => { replacementStreamResolve = resolve; });

  FakeBridge.streamBehavior = (bridge) => {
    if (!firstBridge) {
      firstBridge = bridge;
      return {
        [Symbol.asyncIterator]() {
          return {
            next() {
              readStartedResolve();
              return new Promise((resolve, reject) => {
                firstReadReject = reject;
              });
            },
          };
        },
        close() { bridge.closeCalls += 1; },
        interrupt() { bridge.interruptCalls += 1; },
      };
    }
    replacementCommandStartedResolve();
    return replacementStream;
  };

  const runtime = createDesktopRuntime({
    bridgeFactory: options => new FakeBridge(options),
  });
  const stream = await runtime.queryClaude({
    sessionId: 'interrupt-retry-overlap',
    title: 'Interrupt retry overlap',
    prompt: 'interrupt while replacing',
    options: { cwd: 'D:/ccNexus', model: 'sonnet' },
  });
  const iterator = stream[Symbol.asyncIterator]();
  const pendingRead = iterator.next();
  await readStarted;
  const error = Object.assign(new Error('Daemon is retiring'), { code: 'DAEMON_RETIRING' });
  firstReadReject(error);
  firstBridge.finishExit();
  await replacementCommandStarted;

  await stream.interrupt();
  await stream.interrupt();
  const replacementBridge = FakeBridge.instances[1];
  replacementStreamResolve({
    [Symbol.asyncIterator]() {
      return {
        async next() {
          return { done: false, value: { type: 'must-not-deliver' } };
        },
      };
    },
    close() { replacementBridge.closeCalls += 1; },
    interrupt() { replacementBridge.interruptCalls += 1; },
  });

  const result = await pendingRead;
  assert.deepEqual(result, { done: true, value: undefined });
  assert.equal(firstBridge.closeCalls, 0);
  assert.equal(firstBridge.interruptCalls, 1);
  assert.equal(replacementBridge.closeCalls, 0);
  assert.equal(replacementBridge.interruptCalls, 1);
  await runtime.shutdown();
});

test('host records retirement under the bridge owner after adoption overlaps the response', async () => {
  resetFakes();
  let releaseRetire;
  const retirementResponse = new Promise(resolve => { releaseRetire = resolve; });
  FakeBridge.retireBehavior = () => retirementResponse;
  const runtime = createDesktopRuntime({
    bridgeFactory: options => new FakeBridge(options),
  });
  runtime.ensureSessionDaemon({ sessionId: 'pending-session', title: 'Pending' });
  const bridge = FakeBridge.instances[0];

  const scanPromise = runtime.scanRuntimeLifecycle(2 * 60 * 60 * 1000);
  await waitForCondition(() => bridge.retireCalls.length === 1);
  runtime.adoptSessionDaemon({
    fromSessionId: 'pending-session',
    toSessionId: 'adopted-session',
    title: 'Adopted',
  });
  releaseRetire({
    accepted: true,
    retiring: true,
    deferred: false,
    reason: 'idle',
  });
  await scanPromise;

  const daemons = runtime.buildProcessSnapshot().processes.filter(item => item.kind === 'DAEMON');
  assert.equal(daemons.length, 1);
  assert.equal(daemons[0].sessionId, 'adopted-session');
  assert.equal(daemons[0].lifecycleState, 'retiring');
  assert.equal(bridge.sessionId, 'adopted-session');
  await runtime.shutdown();
});

test('host does not reinsert a retiring wait after the bridge exits before the response', async () => {
  resetFakes();
  let releaseRetire;
  const retirementResponse = new Promise(resolve => { releaseRetire = resolve; });
  FakeBridge.retireBehavior = () => retirementResponse;
  const runtime = createDesktopRuntime({
    bridgeFactory: options => new FakeBridge(options),
  });
  runtime.ensureSessionDaemon({ sessionId: 'early-exit-session', title: 'Early exit' });
  const oldBridge = FakeBridge.instances[0];

  const scanPromise = runtime.scanRuntimeLifecycle(2 * 60 * 60 * 1000);
  await waitForCondition(() => oldBridge.retireCalls.length === 1);
  oldBridge.emitExit();
  releaseRetire({
    accepted: true,
    retiring: true,
    deferred: false,
    reason: 'idle',
  });
  await scanPromise;

  const acquisition = runtime.queryClaude({
    sessionId: 'early-exit-session',
    title: 'Early exit',
    prompt: 'reacquire immediately',
    options: { cwd: 'D:/ccNexus', model: 'sonnet' },
  });
  const timeout = Symbol('retiring-wait-timeout');
  try {
    const stream = await Promise.race([
      acquisition,
      new Promise(resolve => setTimeout(() => resolve(timeout), 100)),
    ]);
    assert.notEqual(stream, timeout, 'acquisition must not wait on an exited bridge');
    assert.equal(FakeBridge.instances.length, 2);
    assert.equal(stream.runtimeRetirementReason, 'idle');
    assert.notEqual(stream.process, oldBridge.process);
  } finally {
    oldBridge.finishExit();
    await acquisition.catch(() => {});
    await runtime.shutdown();
  }
});

test('host refusal from an old bridge preserves a newer bridge retirement reason', async () => {
  resetFakes();
  let oldBridge;
  let releaseOldRetire;
  const oldRetirement = new Promise(resolve => { releaseOldRetire = resolve; });
  FakeBridge.retireBehavior = (bridge) => {
    if (!oldBridge) {
      oldBridge = bridge;
      return oldRetirement;
    }
    return Promise.resolve({
      accepted: true,
      retiring: true,
      deferred: false,
      reason: 'absolute-lifetime',
    });
  };
  const runtime = createDesktopRuntime({
    bridgeFactory: options => new FakeBridge(options),
  });
  runtime.ensureSessionDaemon({ sessionId: 'old-session', title: 'Old' });

  const oldScan = runtime.scanRuntimeLifecycle(8 * 60 * 60 * 1000);
  await waitForCondition(() => oldBridge?.retireCalls.length === 1);
  runtime.removeSessionDaemon('old-session');

  runtime.ensureSessionDaemon({ sessionId: 'new-session', title: 'New' });
  const newBridge = FakeBridge.instances[1];
  await runtime.scanRuntimeLifecycle(8 * 60 * 60 * 1000);
  runtime.adoptSessionDaemon({
    fromSessionId: 'new-session',
    toSessionId: 'old-session',
    title: 'Reused old key',
  });
  newBridge.finishExit();
  releaseOldRetire({
    accepted: false,
    retiring: false,
    deferred: false,
    reason: 'absolute-lifetime',
    refusalReason: 'stale-status',
  });
  await oldScan;

  const stream = await runtime.queryClaude({
    sessionId: 'old-session',
    title: 'Reused old key',
    prompt: 'preserve the newer reason',
    options: { cwd: 'D:/ccNexus', model: 'sonnet' },
  });
  assert.equal(stream.runtimeRetirementReason, 'absolute-lifetime');
  await runtime.shutdown();
});

test('host clears lifecycle timer during shutdown', async () => {
  resetFakes();
  const cleared = [];
  const timer = { unref() {} };
  const runtime = createDesktopRuntime({
    bridgeFactory: options => new FakeBridge(options),
    setIntervalFn: () => timer,
    clearIntervalFn: value => cleared.push(value),
  });
  runtime.ensureSessionDaemon({ sessionId: 'timer-session', title: 'Timer' });
  await runtime.shutdown();
  assert.deepEqual(cleared, [timer]);
});

test('host retries a retiring query reported by the first async stream read', async () => {
  resetFakes();
  let firstBridge;
  FakeBridge.streamBehavior = (bridge) => {
    if (!firstBridge) {
      firstBridge = bridge;
      let failed = false;
      const iterator = {
        async next() {
          if (failed) return { done: true, value: undefined };
          failed = true;
          bridge.emit('daemon_event', { event: 'retiring', reason: 'idle' });
          bridge.finishExit();
          const error = new Error('Daemon is retiring');
          error.code = 'DAEMON_RETIRING';
          throw error;
        },
      };
      return {
        [Symbol.asyncIterator]() { return iterator; },
        close() {},
        interrupt() {},
      };
    }

    const events = [
      { type: 'system', subtype: 'init', session_id: 'session-1' },
      { type: 'result', subtype: 'success', session_id: 'session-1' },
    ];
    const iterator = {
      async next() {
        if (events.length === 0) return { done: true, value: undefined };
        return { done: false, value: events.shift() };
      },
    };
    return {
      [Symbol.asyncIterator]() { return iterator; },
      close() {},
      interrupt() {},
    };
  };

  const runtime = createDesktopRuntime({
    bridgeFactory: options => new FakeBridge(options),
  });
  const stream = await runtime.queryClaude({
    sessionId: 'session-1',
    title: 'Retry',
    prompt: 'retry once',
    options: { cwd: 'D:/ccNexus', model: 'sonnet' },
  });

  const events = [];
  for await (const event of stream) events.push(event);
  assert.equal(FakeBridge.instances.length, 2);
  assert.equal(stream.runtimeClassification, 'cold');
  assert.equal(stream.runtimeRetirementReason, 'idle');
  assert.deepEqual(events.map(event => event.type), ['system', 'result']);
  await runtime.shutdown();
});

test('host does not retry a retiring error after the first SDK event was delivered', async () => {
  resetFakes();
  FakeBridge.streamBehavior = (bridge) => {
    const events = [{ type: 'system', subtype: 'init', session_id: 'session-1' }];
    let failed = false;
    const iterator = {
      async next() {
        if (events.length > 0) return { done: false, value: events.shift() };
        if (!failed) {
          failed = true;
          const error = new Error('Daemon is retiring');
          error.code = 'DAEMON_RETIRING';
          throw error;
        }
        return { done: true, value: undefined };
      },
    };
    return {
      [Symbol.asyncIterator]() { return iterator; },
      close() {},
      interrupt() {},
    };
  };

  const runtime = createDesktopRuntime({
    bridgeFactory: options => new FakeBridge(options),
  });
  const stream = await runtime.queryClaude({
    sessionId: 'session-1',
    title: 'No duplicate',
    prompt: 'do not retry after event',
    options: { cwd: 'D:/ccNexus', model: 'sonnet' },
  });

  await assert.rejects(async () => {
    for await (const _event of stream) { /* consume */ }
  }, error => error.code === 'DAEMON_RETIRING');
  assert.equal(FakeBridge.instances.length, 1);
  await runtime.shutdown();
});

test('host waits for workspace runtime shutdown before allowing a new query', async () => {
  resetFakes();
  const runtime = createDesktopRuntime({
    bridgeFactory: options => new FakeBridge(options),
  });
  runtime.ensureSessionDaemon({ sessionId: 'old-session', title: 'Old workspace' });
  const oldBridge = FakeBridge.instances[0];
  let releaseShutdown;
  oldBridge.shutdown = () => new Promise((resolve) => {
    releaseShutdown = () => {
      oldBridge.finishExit();
      resolve();
    };
  });

  const transition = runtime.setCwd('D:/other-workspace');
  const query = Promise.resolve(transition).then(() => runtime.queryClaude({
    sessionId: 'new-session',
    title: 'New workspace',
    prompt: 'after switch',
    options: { cwd: 'D:/other-workspace', model: 'sonnet' },
  })).catch(error => ({ error }));

  await Promise.resolve();
  assert.equal(typeof transition?.then, 'function');
  releaseShutdown();
  const result = await query;
  assert.equal(result?.error, undefined);
  const stream = result;
  assert.equal(stream.runtimeClassification, 'cold');
  await runtime.shutdown();
});

test('host retries context usage once when the daemon is retiring', async () => {
  resetFakes();
  let firstBridge;
  FakeBridge.contextBehavior = (bridge) => {
    if (!firstBridge) {
      firstBridge = bridge;
      bridge.emit('daemon_event', { event: 'retiring', reason: 'absolute_lifetime' });
      bridge.finishExit();
      const error = new Error('Daemon is retiring');
      error.code = 'DAEMON_RETIRING';
      throw error;
    }
    return { used: 42, size: 100 };
  };

  const runtime = createDesktopRuntime({
    bridgeFactory: options => new FakeBridge(options),
  });
  const result = await runtime.getContextUsage({
    sessionId: 'context-session',
    title: 'Context',
    options: { cwd: 'D:/ccNexus', model: 'sonnet' },
  });

  assert.deepEqual(result, {
    used: 42,
    size: 100,
    runtimeClassification: 'cold',
    runtimeGenerationId: 2,
    runtimeCreationReason: 'initial',
    runtimeRetirementReason: 'absolute_lifetime',
  });
  assert.equal(FakeBridge.instances.length, 2);
  await runtime.shutdown();
});

test('host does not fabricate lifecycle metadata when the candidate fails before acquisition metadata', async () => {
  resetFakes();
  FakeBridge.streamBehavior = () => ({
    __skipRuntimeMetadata: true,
    [Symbol.asyncIterator]() {
      return {
        async next() {
          throw new Error('SDK query unavailable');
        },
      };
    },
    close() {},
    interrupt() {},
  });

  const runtime = createDesktopRuntime({
    bridgeFactory: options => new FakeBridge(options),
  });
  const stream = await runtime.queryClaude({
    sessionId: 'acquisition-failure',
    title: 'Acquisition failure',
    prompt: 'fail before acquisition metadata',
    options: { cwd: 'D:/ccNexus', model: 'sonnet' },
  });

  assert.equal(stream.runtimeClassification, undefined);
  assert.equal(stream.runtimeGenerationId, undefined);
  await assert.rejects(
    stream[Symbol.asyncIterator]().next(),
    /SDK query unavailable/,
  );
  await runtime.shutdown();
});

test('host lifecycle metadata follows the replacement candidate stream after lazy retirement retry', async () => {
  resetFakes();
  let firstBridge;
  let failed = false;
  FakeBridge.streamBehavior = (bridge) => {
    if (!firstBridge) {
      firstBridge = bridge;
      return {
        runtimeMetadata: {
          classification: 'cold',
          generationId: 11,
          creationReason: 'initial',
        },
        [Symbol.asyncIterator]() {
          return {
            async next() {
              if (failed) return { done: true, value: undefined };
              failed = true;
              firstBridge.finishExit();
              throw Object.assign(new Error('Daemon is retiring'), { code: 'DAEMON_RETIRING' });
            },
          };
        },
        close() {},
        interrupt() {},
      };
    }
    const events = [
      { type: 'system', subtype: 'init', session_id: 'replacement-session' },
      { type: 'result', subtype: 'success', session_id: 'replacement-session' },
    ];
    return {
      runtimeMetadata: {
        classification: 'cold',
        generationId: 12,
        creationReason: 'initial',
      },
      [Symbol.asyncIterator]() {
        return {
          async next() {
            if (events.length === 0) return { done: true, value: undefined };
            return { done: false, value: events.shift() };
          },
        };
      },
      close() {},
      interrupt() {},
    };
  };

  const runtime = createDesktopRuntime({
    bridgeFactory: options => new FakeBridge(options),
  });
  const stream = await runtime.queryClaude({
    sessionId: 'replacement-session',
    title: 'Replacement metadata',
    prompt: 'retry with replacement metadata',
    options: { cwd: 'D:/ccNexus', model: 'sonnet' },
  });

  assert.equal(stream.runtimeGenerationId, 11);
  const events = [];
  for await (const event of stream) events.push(event);
  assert.deepEqual(events.map(event => event.type), ['system', 'result']);
  assert.equal(stream.runtimeClassification, 'cold');
  assert.equal(stream.runtimeGenerationId, 12);
  assert.equal(stream.runtimeCreationReason, 'initial');
  await runtime.shutdown();
});

test('host attaches a retired-session reason only to a confirmed cold request', async () => {
  resetFakes();
  FakeBridge.streamBehavior = (bridge) => {
    const metadata = {
      classification: bridge.streamCalls === 1 ? 'cold' : 'warm',
      generationId: FakeBridge.instances.indexOf(bridge) + 1,
      ...(bridge.streamCalls === 1 ? { creationReason: 'initial' } : {}),
    };
    const events = [
      { type: 'system', subtype: 'init', session_id: 'retired-metadata-session' },
      { type: 'result', subtype: 'success', session_id: 'retired-metadata-session' },
    ];
    return {
      runtimeMetadata: metadata,
      [Symbol.asyncIterator]() {
        return {
          async next() {
            if (events.length === 0) return { done: true, value: undefined };
            return { done: false, value: events.shift() };
          },
        };
      },
      close() {},
      interrupt() {},
    };
  };

  const runtime = createDesktopRuntime({
    bridgeFactory: options => new FakeBridge(options),
  });
  runtime.ensureSessionDaemon({ sessionId: 'retired-metadata-session', title: 'Retired' });
  const oldBridge = FakeBridge.instances[0];
  oldBridge.emit('daemon_event', { event: 'retiring', reason: 'idle' });
  oldBridge.finishExit();

  const cold = await runtime.queryClaude({
    sessionId: 'retired-metadata-session',
    title: 'Retired',
    prompt: 'first after retirement',
    options: { cwd: 'D:/ccNexus', model: 'sonnet' },
  });
  assert.equal(cold.runtimeRetirementReason, 'idle');
  for await (const _event of cold) { /* consume */ }

  const warm = await runtime.queryClaude({
    sessionId: 'retired-metadata-session',
    title: 'Retired',
    prompt: 'second after retirement',
    options: { cwd: 'D:/ccNexus', model: 'sonnet', resume: 'retired-metadata-session' },
  });
  assert.equal(warm.runtimeClassification, 'warm');
  assert.equal(warm.runtimeRetirementReason, null);
  await runtime.shutdown();
});

test('host preserves a retired-session reason across pre-metadata acquisition failure', async () => {
  resetFakes();
  let failNextAcquisition = true;
  let successfulStreamCount = 0;
  let successfulNextCalls = 0;
  FakeBridge.streamBehavior = async (bridge) => {
    if (failNextAcquisition) {
      failNextAcquisition = false;
      throw new Error('candidate acquisition failed before metadata');
    }

    successfulStreamCount += 1;
    const events = [
      { type: 'system', subtype: 'init', session_id: 'pre-metadata-failure-session' },
      { type: 'result', subtype: 'success', session_id: 'pre-metadata-failure-session' },
    ];
    const metadata = successfulStreamCount === 1
      ? {
        classification: 'cold',
        generationId: FakeBridge.instances.indexOf(bridge) + 1,
        creationReason: 'initial',
      }
      : {
        classification: 'warm',
        generationId: FakeBridge.instances.indexOf(bridge) + 1,
      };
    return {
      runtimeMetadata: metadata,
      [Symbol.asyncIterator]() {
        return {
          async next() {
            successfulNextCalls += 1;
            if (events.length === 0) return { done: true, value: undefined };
            return { done: false, value: events.shift() };
          },
        };
      },
      close() {},
      interrupt() {},
    };
  };

  const runtime = createDesktopRuntime({
    bridgeFactory: options => new FakeBridge(options),
  });
  runtime.ensureSessionDaemon({
    sessionId: 'pre-metadata-failure-session',
    title: 'Pre-metadata failure',
  });
  const oldBridge = FakeBridge.instances[0];
  oldBridge.emit('daemon_event', {
    event: 'retiring',
    reason: 'idle',
  });
  oldBridge.finishExit();

  await assert.rejects(
    () => runtime.queryClaude({
      sessionId: 'pre-metadata-failure-session',
      title: 'Pre-metadata failure',
      prompt: 'fail before lifecycle metadata',
      options: { cwd: 'D:/ccNexus', model: 'sonnet' },
    }),
    /candidate acquisition failed before metadata/,
  );

  const cold = await runtime.queryClaude({
    sessionId: 'pre-metadata-failure-session',
    title: 'Pre-metadata failure',
    prompt: 'acquire after the failed attempt',
    options: { cwd: 'D:/ccNexus', model: 'sonnet' },
  });
  assert.equal(cold.runtimeClassification, 'cold');
  assert.equal(cold.runtimeRetirementReason, 'idle');
  assert.equal(cold.runtimeRetirementReason, 'idle');
  assert.equal(successfulNextCalls, 0, 'metadata inspection must not pre-read the SDK stream');

  for await (const _event of cold) { /* consume */ }

  const warm = await runtime.queryClaude({
    sessionId: 'pre-metadata-failure-session',
    title: 'Pre-metadata failure',
    prompt: 'confirm retirement reason was consumed once',
    options: { cwd: 'D:/ccNexus', model: 'sonnet', resume: 'pre-metadata-failure-session' },
  });
  assert.equal(warm.runtimeClassification, 'warm');
  assert.equal(warm.runtimeRetirementReason, null);
  await runtime.shutdown();
});

test('daemon bridge preserves structured daemon error codes and unwraps lifecycle responses', async () => {
  const { DaemonBridge } = await import('../desktop/runtime/daemonBridge.js');
  const bridge = new DaemonBridge({ daemonScript: 'unused' });
  let rejected;
  const pending = new Promise((resolve, reject) => { rejected = { resolve, reject }; });
  bridge.pendingRequests.set('req-1', {
    ...rejected,
    messages: [],
    countsAsActive: true,
  });

  bridge.handleLine(JSON.stringify({
    id: 'req-1',
    done: true,
    success: false,
    code: 'DAEMON_RETIRING',
    error: 'Daemon is retiring',
  }));
  await assert.rejects(pending, error => error.code === 'DAEMON_RETIRING');

  bridge.lifecycleState = 'running';
  const observation = {
    runtimeGeneration: 7,
    runtimeSessionEpoch: 'epoch-1',
    runtimeCreatedAt: 100,
    runtimeLastUsedAt: 200,
    daemonLastUsedAt: 300,
  };
  let command;
  bridge.sendCommand = async (method, params) => {
    command = { method, params };
    return [{ result: { accepted: true, retiring: true, deferred: false, reason: params.reason } }];
  };
  assert.deepEqual(await bridge.retire('idle', observation), {
    accepted: true,
    retiring: true,
    deferred: false,
    reason: 'idle',
  });
  assert.deepEqual(command, { method: 'retire', params: { reason: 'idle', observation } });
  assert.equal(bridge.lifecycleState, 'retiring');
});

test('daemon bridge consumes runtime metadata without yielding it as an SDK event', async () => {
  const { DaemonBridge } = await import('../desktop/runtime/daemonBridge.js');
  const bridge = new DaemonBridge({ daemonScript: 'unused' });
  bridge.start = async () => {};
  bridge.writeCommand = ({ id }) => {
    queueMicrotask(() => {
      bridge.handleLine(JSON.stringify({
        id,
        type: 'runtime_metadata',
        classification: 'cold',
        generationId: 7,
        creationReason: 'initial',
      }));
      bridge.handleLine(JSON.stringify({
        id,
        type: 'sdk_event',
        event: { type: 'system', subtype: 'init' },
      }));
      bridge.handleLine(JSON.stringify({ id, done: true, success: true }));
    });
    return true;
  };

  const stream = await bridge.streamCommand('query', {});
  const iterator = stream[Symbol.asyncIterator]();
  assert.deepEqual(await iterator.next(), {
    value: { type: 'system', subtype: 'init' },
    done: false,
  });
  assert.deepEqual(stream.runtimeMetadata, {
    classification: 'cold',
    generationId: 7,
    creationReason: 'initial',
  });
  assert.deepEqual(await iterator.next(), { value: undefined, done: true });
});

test('daemon bridge unwraps runtime metadata beside context usage results', async () => {
  const { DaemonBridge } = await import('../desktop/runtime/daemonBridge.js');
  const bridge = new DaemonBridge({ daemonScript: 'unused' });
  bridge.start = async () => {};
  bridge.writeCommand = ({ id }) => {
    queueMicrotask(() => {
      bridge.handleLine(JSON.stringify({
        id,
        type: 'runtime_metadata',
        classification: 'cold',
        generationId: 8,
        creationReason: 'initial',
      }));
      bridge.handleLine(JSON.stringify({
        id,
        done: true,
        success: true,
        result: { used: 42, size: 100 },
        runtimeMetadata: {
          classification: 'cold',
          generationId: 8,
          creationReason: 'initial',
        },
      }));
    });
    return true;
  };

  assert.deepEqual(await bridge.getContextUsage({ options: {} }), {
    used: 42,
    size: 100,
    runtimeMetadata: {
      classification: 'cold',
      generationId: 8,
      creationReason: 'initial',
    },
  });
});

test('daemon bridge only normalizes known retirement aliases at the protocol boundary', async () => {
  const { DaemonBridge } = await import('../desktop/runtime/daemonBridge.js');
  const bridge = new DaemonBridge({ daemonScript: 'unused' });
  const reasons = [];
  bridge.sendCommand = async (_method, params) => {
    reasons.push(params.reason);
    return [{
      result: {
        accepted: false,
        retiring: false,
        deferred: false,
        reason: params.reason,
        refusalReason: 'not-eligible',
      },
    }];
  };

  assert.equal((await bridge.retire('idle_timeout')).reason, 'idle');
  assert.equal((await bridge.retire('absolute_lifetime')).reason, 'absolute-lifetime');
  assert.equal((await bridge.retire('lifecycle')).reason, 'requested');
  assert.equal((await bridge.retire('runtime-closed')).reason, 'runtime-closed');
  assert.equal((await bridge.retire('unknown-reason')).reason, 'unknown-reason');
  assert.deepEqual(reasons, [
    'idle',
    'absolute-lifetime',
    'requested',
    'runtime-closed',
    'unknown-reason',
  ]);
});
