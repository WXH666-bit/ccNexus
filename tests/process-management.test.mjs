import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const mainSource = readFileSync(new URL('../desktop/main.js', import.meta.url), 'utf8');
const controllerSource = readFileSync(new URL('../desktop/runtime/chatController.js', import.meta.url), 'utf8');
const registrySource = readFileSync(new URL('../desktop/runtime/processRegistry.js', import.meta.url), 'utf8');

test('Electron host delegates process management to the desktop runtime', () => {
  assert.match(mainSource, /createDesktopRuntime/);
  assert.match(mainSource, /runtime\.buildProcessSnapshot/);
  assert.match(mainSource, /runtime\.stopProcess/);
  assert.match(mainSource, /runtime\.restartDaemon/);
  assert.match(controllerSource, /runtime\.registerChannel\(\{ sessionId, query \}\)/);
  assert.match(controllerSource, /runtime\.unregisterChannel\(\{ sessionId, query \}\)/);
});

test('idle session daemon remains visible after the active query is unregistered', () => {
  assert.match(controllerSource, /runtime\.ensureSessionDaemon\(\{ sessionId: querySessionId/);

  const finallyBlock = controllerSource.slice(controllerSource.indexOf('finally {'));
  assert.match(finallyBlock, /unregisterActiveQuery\(querySessionId, query\)/);
  assert.doesNotMatch(finallyBlock, /runtime\.removeSessionDaemon\(querySessionId\)/);
});

test('desktop registry produces ccgui-style daemon and channel process snapshots', () => {
  assert.match(registrySource, /this\.sessionDaemons = new Map\(\)/);
  assert.match(registrySource, /this\.channels = new Map\(\)/);
  assert.match(registrySource, /kind:\s*'DAEMON'/);
  assert.match(registrySource, /kind:\s*'CHANNEL'/);
  assert.match(registrySource, /tabName:\s*`AI\$\{this\.nextDaemonTabIndex\+\+\}`/);
  assert.match(registrySource, /activeRequestCount:/);
  assert.match(registrySource, /snapshotAt/);
  assert.match(registrySource, /totals/);
});

test('desktop registry owns stop and restart semantics', () => {
  assert.match(registrySource, /stopProcess\(\{ pid, id \}\)/);
  assert.match(registrySource, /channel\.query\?\.interrupt\?\.\(\)/);
  assert.match(registrySource, /processRef\.kill\('SIGTERM'\)/);
  assert.match(registrySource, /daemon\?\.bridge\?\.shutdown\?\.\(\)/);
  assert.match(registrySource, /restartDaemon\(\{ pid, id \}\)/);
  assert.match(registrySource, /this\.ensureSessionDaemon\(\{ sessionId, title \}\)/);
});
