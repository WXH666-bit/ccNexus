import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';

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
    'settings.update.development',
    'settings.update.error',
    'settings.update.retry',
  ];

  for (const key of keys) {
    assert.equal(typeof getKey(en, key), 'string', `missing English key: ${key}`);
    assert.equal(typeof getKey(zh, key), 'string', `missing Chinese key: ${key}`);
  }
});
