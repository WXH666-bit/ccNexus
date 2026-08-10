import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const root = path.resolve(process.cwd());
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');

test('desktop title bar uses the ccNexus background with native window controls', () => {
  const host = read('desktop/main.js');
  assert.match(host, /titleBarStyle:\s*'hidden'/);
  assert.match(host, /backgroundColor:\s*palette\.color/);
  assert.match(host, /titleBarOverlay:\s*\{[\s\S]*color:\s*palette\.color/);
  assert.match(host, /symbolColor:\s*'#9aa0a6'/);
  assert.match(host, /TITLE_BAR_HEIGHT\s*=\s*42/);
  assert.match(host, /height:\s*TITLE_BAR_HEIGHT/);
});

test('renderer reserves and exposes a draggable title bar overlay region', () => {
  const app = read('src/App.tsx');
  const css = read('src/index.css');
  assert.match(app, /className="window-drag-region"/);
  assert.match(css, /\.window-drag-region\s*\{/);
  assert.match(css, /-webkit-app-region:\s*drag/);
  assert.match(css, /env\(titlebar-area-height/);
});

test('desktop title bar follows the renderer theme', () => {
  const host = read('desktop/main.js');
  const preload = read('desktop/preload.cjs');
  const appearance = read('src/components/settings/AppearanceSection.tsx');
  const rendererEntry = read('src/main.tsx');

  assert.match(host, /setTitleBarOverlay/);
  assert.match(host, /light:\s*\{\s*color:\s*'#ffffff',\s*symbolColor:\s*'#5f6368'/);
  assert.match(host, /desktop:set-theme/);
  assert.match(preload, /setTheme:\s*\(theme\)\s*=>\s*ipcRenderer\.invoke\('desktop:set-theme'/);
  assert.match(appearance, /setTheme\(theme\)/);
  assert.match(rendererEntry, /getAppearancePreferences\(\)/);
});
