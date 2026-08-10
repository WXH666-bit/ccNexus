import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const root = path.resolve(process.cwd());
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');

test('appearance preferences normalize defaults and persist only ccNexus-owned state', async () => {
  const { AppearancePreferences } = await import('../desktop/runtime/appearancePreferences.js');
  const tempRoot = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'ccnexus-appearance-'));
  const service = new AppearancePreferences({
    stateFile: path.join(tempRoot, 'appearance.json'),
    backgroundFile: path.join(tempRoot, 'chat-background.png'),
  });

  assert.deepEqual(await service.load(), {
    theme: 'dark',
    background: {
      opacity: 0.32,
      blur: 0,
      overlay: 0.22,
      hasImage: false,
      imageMime: null,
      imageDataUrl: null,
    },
  });

  const saved = await service.update({
    theme: 'light',
    background: { opacity: 9, blur: -4, overlay: 2 },
  });

  assert.equal(saved.theme, 'light');
  assert.equal(saved.background.opacity, 1);
  assert.equal(saved.background.blur, 0);
  assert.equal(saved.background.overlay, 0.6);
  assert.deepEqual(JSON.parse(await fs.promises.readFile(path.join(tempRoot, 'appearance.json'), 'utf8')), {
    theme: 'light',
    background: {
      opacity: 1,
      blur: 0,
      overlay: 0.6,
      hasImage: false,
      imageMime: null,
    },
  });
});

test('appearance preferences import and clear a validated image at a fixed app-owned path', async () => {
  const { AppearancePreferences } = await import('../desktop/runtime/appearancePreferences.js');
  const tempRoot = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'ccnexus-appearance-image-'));
  const source = path.join(tempRoot, 'source.png');
  const destination = path.join(tempRoot, 'chat-background.png');
  await fs.promises.writeFile(source, Buffer.from('fake-png-data'));
  const service = new AppearancePreferences({
    stateFile: path.join(tempRoot, 'appearance.json'),
    backgroundFile: destination,
  });

  await service.load();
  const imported = await service.importBackground(source);
  assert.equal(imported.background.hasImage, true);
  assert.equal(imported.background.imageMime, 'image/png');
  assert.match(imported.background.imageDataUrl, /^data:image\/png;base64,/);
  assert.deepEqual(await fs.promises.readFile(destination), Buffer.from('fake-png-data'));

  const cleared = await service.clearBackground();
  assert.equal(cleared.background.hasImage, false);
  assert.equal(cleared.background.imageDataUrl, null);
  await assert.rejects(fs.promises.access(destination));
});

test('main process loads appearance before creating the window and owns the appearance IPC', () => {
  const host = read('desktop/main.js');
  assert.match(host, /AppearancePreferences/);
  assert.match(host, /appearancePreferences\.load\(\)/);
  assert.match(host, /desktop:get-appearance-preferences/);
  assert.match(host, /desktop:save-appearance-preferences/);
  assert.match(host, /desktop:choose-appearance-background/);
  assert.match(host, /desktop:clear-appearance-background/);
  assert.match(host, /createMainWindow\(appearance\.theme\)/);
});

test('preload exposes appearance preferences without exposing filesystem access', () => {
  const preload = read('desktop/preload.cjs');
  assert.match(preload, /getAppearancePreferences:\s*\(\)\s*=>\s*ipcRenderer\.invoke\('desktop:get-appearance-preferences'\)/);
  assert.match(preload, /saveAppearancePreferences:\s*\(preferences\)\s*=>\s*ipcRenderer\.invoke\('desktop:save-appearance-preferences'/);
  assert.match(preload, /chooseAppearanceBackground:\s*\(\)\s*=>\s*ipcRenderer\.invoke\('desktop:choose-appearance-background'\)/);
  assert.match(preload, /clearAppearanceBackground:\s*\(\)\s*=>\s*ipcRenderer\.invoke\('desktop:clear-appearance-background'\)/);
  assert.doesNotMatch(preload, /readFileSync|fs\.promises|require\(['"]fs['"]\)/);
});

test('renderer bootstraps the main-process appearance before rendering', () => {
  const rendererEntry = read('src/main.tsx');
  const utility = read('src/utils/appearancePreferences.ts');
  assert.match(rendererEntry, /getAppearancePreferences\(\)/);
  assert.match(rendererEntry, /applyAppearancePreferences/);
  assert.match(rendererEntry, /createRoot\(document\.getElementById\('root'\)!\)\.render/);
  assert.match(utility, /--bg-chat-image/);
  assert.match(utility, /--chat-bg-image-opacity/);
  assert.match(utility, /--chat-bg-image-blur/);
  assert.match(utility, /--chat-bg-overlay-opacity/);
});

test('appearance settings provide custom image background controls', () => {
  const appearance = read('src/components/settings/AppearanceSection.tsx');
  const zh = read('src/i18n/locales/zh.json');
  const en = read('src/i18n/locales/en.json');
  assert.match(appearance, /chooseAppearanceBackground/);
  assert.match(appearance, /clearAppearanceBackground/);
  assert.match(appearance, /opacity/);
  assert.match(appearance, /blur/);
  assert.match(appearance, /overlay/);
  assert.match(appearance, /appearance-background-card/);
  assert.match(zh, /"background"\s*:/);
  assert.match(en, /"background"\s*:/);
});

test('appearance background is rendered by the whole app shell', () => {
  const css = read('src/index.css');
  assert.match(css, /\.app-root\s*\{[^}]*position:\s*relative;/s);
  assert.match(css, /\.app-root::before[\s\S]*--bg-chat-image/);
  assert.match(css, /\.app-root::after[\s\S]*--chat-bg-overlay-opacity/);
  assert.match(css, /\.app-root\s*>\s*\*[^}]*z-index:\s*1;/s);
  assert.match(css, /\.chat-main\s*\{[^}]*background:\s*transparent;/s);
  assert.doesNotMatch(css, /\.chat-main::before/);
});
