import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';

const root = new URL('../', import.meta.url);
const read = (path) => readFileSync(new URL(path, root), 'utf8');

test('package exposes desktop-first development entry points while keeping web UI build', () => {
  const pkg = JSON.parse(read('package.json'));

  assert.equal(pkg.scripts.build, 'vite build');
  assert.equal(pkg.scripts['desktop:host'], 'electron desktop/main.js');
  assert.equal(pkg.scripts['desktop:daemon'], 'node desktop/daemon/ccnexus-daemon.js');
  assert.match(pkg.scripts['desktop:dev'], /vite --port 5000/);
  assert.doesNotMatch(pkg.scripts['desktop:dev'], /node server\/index\.js/);
  assert.match(pkg.scripts['desktop:dev'], /electron desktop\/main\.js/);
});

test('desktop host owns the app shell and loads the retained local web UI', () => {
  assert.equal(existsSync(new URL('desktop/main.js', root)), true);
  const host = read('desktop/main.js');

  assert.match(host, /BrowserWindow/);
  assert.match(host, /CCNEXUS_WEB_URL/);
  assert.match(host, /http:\/\/localhost:5000\/chat/);
  assert.match(host, /createDesktopRuntime/);
});

test('desktop host separates development localhost from packaged dist loading', () => {
  const host = read('desktop/main.js');

  assert.match(host, /app\.isPackaged/);
  assert.match(host, /loadURL\(devUrl\)/);
  assert.match(host, /loadFile\(indexHtml,\s*\{\s*hash:\s*'\/chat'/s);
  assert.match(host, /dist/);
});

test('desktop host wires a preload IPC boundary instead of exposing node to the UI', () => {
  assert.equal(existsSync(new URL('desktop/preload.cjs', root)), true);
  const host = read('desktop/main.js');
  const preload = read('desktop/preload.cjs');

  assert.match(host, /preload:/);
  assert.match(host, /preload\.cjs/);
  assert.match(host, /ipcMain\.handle\('desktop:get-runtime-info'/);
  assert.match(host, /ipcMain\.handle\('desktop:get-processes'/);
  assert.match(preload, /contextBridge\.exposeInMainWorld\('ccNexusDesktop'/);
  assert.match(preload, /ipcRenderer\.invoke\('desktop:get-runtime-info'/);
  assert.match(preload, /ipcRenderer\.invoke\('desktop:get-processes'/);
});

test('desktop packaged UI uses hash routing while browser dev keeps browser routing', () => {
  const main = read('src/main.tsx');

  assert.match(main, /HashRouter/);
  assert.match(main, /BrowserRouter/);
  assert.match(main, /window\.ccNexusDesktop/);
});

test('daemon bridge mirrors ccgui NDJSON lifecycle over a child process', () => {
  assert.equal(existsSync(new URL('desktop/runtime/daemonBridge.js', root)), true);
  const bridge = read('desktop/runtime/daemonBridge.js');

  assert.match(bridge, /spawn\(/);
  assert.match(bridge, /method:\s*'heartbeat'/);
  assert.match(bridge, /method:\s*'shutdown'/);
  assert.match(bridge, /pendingRequests/);
  assert.match(bridge, /activeRequestCount/);
  assert.match(bridge, /getProcessForInspection/);
});

test('daemon process implements ready, heartbeat, status, abort and shutdown protocol', () => {
  assert.equal(existsSync(new URL('desktop/daemon/ccnexus-daemon.js', root)), true);
  const daemon = read('desktop/daemon/ccnexus-daemon.js');

  assert.match(daemon, /sendDaemonEvent\('ready'/);
  assert.match(daemon, /method === 'heartbeat'/);
  assert.match(daemon, /method === 'status'/);
  assert.match(daemon, /method === 'abort'/);
  assert.match(daemon, /method === 'shutdown'/);
});

test('desktop chat controller delegates process management to desktop runtime registry', () => {
  const controller = read('desktop/runtime/chatController.js');

  assert.match(controller, /runtime\.ensureSessionDaemon/);
  assert.match(controller, /runtime\.registerChannel/);
  assert.match(controller, /runtime\.unregisterChannel/);
  assert.match(controller, /runtime\.removeSessionDaemon/);
});
