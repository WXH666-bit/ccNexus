import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const root = path.resolve(process.cwd());
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');

test('the ccNexus brand assets exist for renderer and Windows packaging', () => {
  assert.ok(fs.existsSync(path.join(root, 'public', 'ccnexus-logo.png')));
  assert.ok(fs.existsSync(path.join(root, 'assets', 'ccnexus.ico')));
});

test('the renderer uses the shared ccNexus logo beside the window title', () => {
  const app = read('src/App.tsx');
  const welcome = read('src/components/WelcomeScreen.tsx');
  assert.match(app, /window-title-brand/);
  assert.match(app, /src="\.\/ccnexus-logo\.png"/);
  assert.match(app, /alt="ccNexus"/);
  assert.match(welcome, /src="\.\/ccnexus-logo\.png"/);
});

test('the renderer logo path remains relative for file-based packaged loading', () => {
  const html = read('dist/index.html');
  assert.doesNotMatch(html, /src="\/ccnexus-logo\.png"/);
  assert.ok(fs.existsSync(path.join(root, 'dist', 'ccnexus-logo.png')));
});

test('Electron window and tray use the shared logo while the builder uses the ico asset', () => {
  const host = read('desktop/main.js');
  const packageJson = read('package.json');

  assert.match(host, /appIconPath/);
  assert.match(host, /icon:.*appIconPath/);
  assert.match(host, /nativeImage\.createFromPath\(appIconPath\)/);
  assert.match(packageJson, /"icon":\s*"assets\/ccnexus\.ico"/);
});
