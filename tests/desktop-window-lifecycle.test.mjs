import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const root = new URL('../', import.meta.url);
const read = (file) => readFileSync(new URL(file, root), 'utf8');

test('desktop host owns a tray and persists the close behavior through IPC', () => {
  const host = read('desktop/main.js');
  const preload = read('desktop/preload.cjs');
  const bridge = read('src/utils/desktopBridgeApi.ts');

  assert.match(host, /Tray/);
  assert.match(host, /desktop:get-window-preferences/);
  assert.match(host, /desktop:set-window-preferences/);
  assert.match(preload, /ipcRenderer\.invoke\('desktop:get-window-preferences'/);
  assert.match(preload, /ipcRenderer\.invoke\('desktop:set-window-preferences'/);
  assert.match(bridge, /getWindowPreferences/);
  assert.match(bridge, /setWindowPreferences/);
});

test('desktop host distinguishes hiding the window from an explicit quit', () => {
  const host = read('desktop/main.js');

  assert.match(host, /window\.on\('close'/);
  assert.match(host, /event\.preventDefault\(\)/);
  assert.match(host, /window\.hide\(\)/);
  assert.match(host, /isQuitting/);
  assert.match(host, /app\.on\('before-quit'/);
  assert.match(host, /await runtime\.shutdown\(\)/);
  assert.match(host, /Menu\.buildFromTemplate/);
});
