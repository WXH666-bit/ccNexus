import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const serverSource = readFileSync(new URL('../server/index.js', import.meta.url), 'utf8');
const registrySource = readFileSync(new URL('../desktop/runtime/processRegistry.js', import.meta.url), 'utf8');

test('server delegates process management to the desktop runtime', () => {
  assert.match(serverSource, /createDesktopRuntime/);
  assert.match(serverSource, /const desktopRuntime = createDesktopRuntime/);
  assert.doesNotMatch(serverSource, /const sessionDaemons = new Map\(\)/);
  assert.doesNotMatch(serverSource, /function queryProcess/);
  assert.match(serverSource, /desktopRuntime\.registerChannel\(\{ sessionId, query \}\)/);
  assert.match(serverSource, /desktopRuntime\.unregisterChannel\(\{ sessionId, query \}\)/);
  assert.match(serverSource, /desktopRuntime\.buildProcessSnapshot\(\)/);
  assert.match(serverSource, /desktopRuntime\.stopProcess\(\{ pid, id: requestedId \}\)/);
  assert.match(serverSource, /desktopRuntime\.restartDaemon\(\{ pid, id: requestedId \}\)/);
});

test('idle session daemon remains visible after the active query is unregistered', () => {
  const chatRoute = serverSource.slice(
    serverSource.indexOf("case 'chat':"),
    serverSource.indexOf("case 'permission_response':"),
  );

  assert.match(chatRoute, /desktopRuntime\.ensureSessionDaemon\(\{ sessionId: querySessionId/);

  const finallyBlock = chatRoute.slice(chatRoute.indexOf('finally {'));
  assert.match(finallyBlock, /unregisterActiveQuery\(querySessionId, q\)/);
  assert.doesNotMatch(finallyBlock, /desktopRuntime\.removeSessionDaemon\(querySessionId\)/);
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
