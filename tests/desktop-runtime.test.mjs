import assert from 'node:assert/strict';
import { once } from 'node:events';
import test from 'node:test';
import { createDesktopRuntime } from '../desktop/runtime/index.js';
import { DaemonBridge } from '../desktop/runtime/daemonBridge.js';

test('desktop runtime starts one inspectable daemon process for a session', async () => {
  const runtime = createDesktopRuntime({ cwd: process.cwd(), provider: 'claude' });
  const daemon = runtime.ensureSessionDaemon({
    sessionId: 'desktop-runtime-test',
    title: 'Runtime test',
  });

  assert.equal(daemon.kind, 'DAEMON');
  assert.equal(daemon.sessionId, 'desktop-runtime-test');
  assert.equal(typeof daemon.pid, 'number');
  assert.notEqual(daemon.pid, process.pid);

  const snapshot = runtime.buildProcessSnapshot();
  assert.equal(snapshot.totals.daemon, 1);
  assert.equal(snapshot.processes[0].pid, daemon.pid);
  assert.equal(snapshot.processes[0].tabName, 'AI1');

  const bridge = daemon.bridge;
  await runtime.shutdown();
  if (bridge.getProcessForInspection()) {
    await once(bridge, 'exit');
  }
});

test('daemon bridge handles a closed stdin pipe during shutdown without surfacing EPIPE', async () => {
  const bridge = new DaemonBridge({ daemonScript: 'unused' });
  bridge.daemonProcess = {
    killed: false,
    stdin: {
      destroyed: true,
      writableEnded: false,
      write() {
        throw Object.assign(new Error('write EPIPE'), { code: 'EPIPE' });
      },
    },
    kill() {
      this.killed = true;
    },
  };

  await assert.doesNotReject(() => bridge.shutdown());
  assert.equal(bridge.daemonProcess.killed, true);
});
