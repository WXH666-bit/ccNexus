import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const root = path.resolve(process.cwd());
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');

test('desktop title bar uses the ccNexus background with native window controls', () => {
  const host = read('desktop/main.js');
  assert.match(host, /titleBarStyle:\s*'hidden'/);
  assert.match(host, /titleBarOverlay:\s*\{[\s\S]*color:\s*'#1e1f22'/);
  assert.match(host, /symbolColor:\s*'#9aa0a6'/);
  assert.match(host, /height:\s*42/);
});

test('renderer reserves and exposes a draggable title bar overlay region', () => {
  const app = read('src/App.tsx');
  const css = read('src/index.css');
  assert.match(app, /className="window-drag-region"/);
  assert.match(css, /\.window-drag-region\s*\{/);
  assert.match(css, /-webkit-app-region:\s*drag/);
  assert.match(css, /env\(titlebar-area-height/);
});
