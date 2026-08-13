import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';
import { createDesktopRuntime } from '../desktop/runtime/index.js';

class FakeBridge extends EventEmitter {
  static instances = [];

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
    this.process = { pid: 1000 + FakeBridge.instances.length, killed: false, spawnargs: [] };
    this.exitPromise = new Promise((resolve) => { this.resolveExit = resolve; });
    FakeBridge.instances.push(this);
  }

  start() {
    return Promise.resolve();
  }

  status() {
    return Promise.resolve(this.statusValue);
  }

  retire(reason) {
    this.retireCalls.push(reason);
    return Promise.resolve({ scheduled: true, reason });
  }

  waitForExit() {
    return this.exitPromise;
  }

  finishExit() {
    this.emit('exit', { code: 0, signal: null });
    this.resolveExit();
  }

  getProcessForInspection() {
    return this.process;
  }

  async streamCommand() {
    const stream = {
      daemonSessionId: 'session-1',
      async *[Symbol.asyncIterator]() {},
      close() {},
    };
    return stream;
  }

  shutdown() {
    this.finishExit();
    return Promise.resolve();
  }
}

function resetFakes() {
  FakeBridge.instances = [];
}

test('host does not retire before 30 minutes and retires at the boundary', async () => {
  resetFakes();
  let now = 30 * 60 * 1000 - 1;
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

test('host waits for active six-hour daemon retirement before creating a new generation', async () => {
  resetFakes();
  const sixHours = 6 * 60 * 60 * 1000;
  let now = sixHours;
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

  oldBridge.emit('exit', { code: 0, signal: null });
  const snapshot = runtime.buildProcessSnapshot();
  assert.equal(snapshot.processes.filter(item => item.kind === 'DAEMON').length, 1);
  assert.equal(snapshot.processes[0].pid, FakeBridge.instances[1].process.pid);
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

  let command;
  bridge.sendCommand = async (method, params) => {
    command = { method, params };
    return [{ result: { scheduled: true, reason: params.reason } }];
  };
  assert.deepEqual(await bridge.retire('idle'), { scheduled: true, reason: 'idle' });
  assert.deepEqual(command, { method: 'retire', params: { reason: 'idle' } });
});
