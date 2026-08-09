import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const root = new URL('../', import.meta.url);
const read = path => readFileSync(new URL(path, root), 'utf8');

test('main process owns the updater service and exposes the four update commands', () => {
  const main = read('desktop/main.js');

  assert.match(main, /createAppUpdater/);
  assert.match(main, /electron-updater/);
  assert.match(main, /autoUpdater/);
  assert.match(main, /desktop:get-update-state/);
  assert.match(main, /desktop:check-for-updates/);
  assert.match(main, /desktop:download-update/);
  assert.match(main, /desktop:install-update/);
  assert.match(main, /desktop:update-status/);
  assert.match(main, /appUpdater\.initialize\(\)/);
  assert.match(main, /appUpdater\.checkForUpdates\(\)/);
  assert.match(main, /appUpdater\.dispose\(\)/);
});

test('startup update check happens after the main window is created and does not block it', () => {
  const main = read('desktop/main.js');
  const windowIndex = main.indexOf('createMainWindow();');
  const checkIndex = main.indexOf('appUpdater.checkForUpdates()', windowIndex);

  assert.notEqual(windowIndex, -1);
  assert.notEqual(checkIndex, -1);
  assert.ok(checkIndex > windowIndex);
  assert.match(main.slice(checkIndex - 80, checkIndex + 80), /void\s+appUpdater\.checkForUpdates\(\)/);
});

test('update state is pushed only through the existing BrowserWindow renderer boundary', () => {
  const main = read('desktop/main.js');
  assert.match(main, /mainWindow\.webContents\.send\('desktop:update-status'/);
  assert.match(main, /mainWindow\.isDestroyed\(\)/);
  assert.doesNotMatch(read('desktop/update/appUpdater.js'), /@anthropic-ai\/claude-agent-sdk|chatController|daemonBridge/);
});
