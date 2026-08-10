import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';
import { formatUpdateError } from '../src/utils/updateError.js';

const root = new URL('../', import.meta.url);
const read = path => readFileSync(new URL(path, root), 'utf8');
const readJson = path => JSON.parse(read(path));

function getKey(value, path) {
  return path.split('.').reduce((current, key) => current?.[key], value);
}

test('basic settings renders an application update section with all bridge actions', () => {
  assert.equal(existsSync(new URL('src/components/settings/AppUpdateSection.tsx', root)), true);
  const component = read('src/components/settings/AppUpdateSection.tsx');
  const basic = read('src/components/settings/BasicConfigSection.tsx');

  for (const helper of ['getUpdateState', 'checkForUpdates', 'downloadUpdate', 'installUpdate', 'onUpdateStatus']) {
    assert.match(component, new RegExp(`\\b${helper}\\b`));
  }
  for (const status of ['idle', 'checking', 'not-available', 'available', 'downloading', 'downloaded', 'error']) {
    assert.match(component, new RegExp(`['"]${status}['"]`));
  }
  assert.match(component, /return\s*\(\)\s*=>/);
  assert.match(basic, /AppUpdateSection/);
  assert.match(basic, /<AppUpdateSection\s*\/>/);
});

test('web settings skip update bridge work when Electron preload is unavailable', () => {
  const component = read('src/components/settings/AppUpdateSection.tsx');
  assert.match(component, /if\s*\(!desktopBridgeAvailable\)\s*return;/);
  assert.match(component, /if\s*\(!desktopBridgeAvailable\)\s*return null;/);
});

test('both locales contain the complete update card vocabulary', () => {
  const en = readJson('src/i18n/locales/en.json');
  const zh = readJson('src/i18n/locales/zh.json');
  const keys = [
    'settings.update.title',
    'settings.update.currentVersion',
    'settings.update.latestVersion',
    'settings.update.check',
    'settings.update.checking',
    'settings.update.notAvailable',
    'settings.update.available',
    'settings.update.download',
    'settings.update.downloading',
    'settings.update.downloaded',
    'settings.update.install',
    'settings.update.developmentStatus',
    'settings.update.error',
    'settings.update.networkError',
    'settings.update.retry',
  ];

  for (const key of keys) {
    assert.equal(typeof getKey(en, key), 'string', `missing English key: ${key}`);
    assert.equal(typeof getKey(zh, key), 'string', `missing Chinese key: ${key}`);
  }
});

test('basic settings removes the obsolete autosave placeholder', () => {
  const basic = read('src/components/settings/BasicConfigSection.tsx');
  const css = read('src/index.css');
  const en = readJson('src/i18n/locales/en.json');
  const zh = readJson('src/i18n/locales/zh.json');

  assert.doesNotMatch(basic, /autoSave|setting-save-status/);
  assert.doesNotMatch(css, /\.setting-save-status/);
  assert.equal(en.settings.basic.autoSave, undefined);
  assert.equal(en.settings.basic.autoSaveDescription, undefined);
  assert.equal(en.settings.basic.autoSaveEnabled, undefined);
  assert.equal(zh.settings.basic.autoSave, undefined);
  assert.equal(zh.settings.basic.autoSaveDescription, undefined);
  assert.equal(zh.settings.basic.autoSaveEnabled, undefined);
});

test('update card separates its summary from actions and labels development mode', () => {
  const component = read('src/components/settings/AppUpdateSection.tsx');
  const css = read('src/index.css');

  assert.match(component, /app-update-summary/);
  assert.match(component, /settings\.update\.developmentStatus/);
  assert.match(css, /\.app-update-summary/);
});

test('update card does not show the obsolete packaging-only note', () => {
  const component = read('src/components/settings/AppUpdateSection.tsx');
  const en = readJson('src/i18n/locales/en.json');
  const zh = readJson('src/i18n/locales/zh.json');

  assert.doesNotMatch(component, /t\(['"]settings\.update\.development['"]\)/);
  assert.equal(en.settings.update.development, undefined);
  assert.equal(zh.settings.update.development, undefined);
});

test('update errors turn connection failures into an actionable message', () => {
  assert.equal(
    formatUpdateError(new Error('net::ERR_CONNECTION_CLOSED'), () => 'check network'),
    'check network',
  );
  assert.equal(
    formatUpdateError(new Error('unexpected updater failure'), () => 'check network'),
    'unexpected updater failure',
  );
});
