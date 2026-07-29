import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

test('package has desktop packaging scripts and electron-builder config', () => {
  assert.equal(pkg.main, 'desktop/main.js');
  assert.equal(pkg.scripts['desktop:pack'], 'npm run build && electron-builder --dir');
  assert.equal(pkg.scripts['desktop:dist'], 'npm run build && electron-builder');
  assert.ok(pkg.devDependencies['electron-builder']);
  assert.equal(pkg.build.appId, 'com.ccnexus.app');
  assert.equal(pkg.build.productName, 'ccNexus');
  assert.ok(pkg.build.files.includes('dist/**'));
  assert.ok(pkg.build.files.includes('desktop/**'));
  assert.ok(pkg.build.files.includes('server/claudeHistory.js'));
  assert.ok(pkg.build.files.includes('server/protocol.js'));
  assert.ok(pkg.build.files.includes('server/sessionSync.js'));
  assert.ok(pkg.build.files.includes('src/utils/contextUsage.js'));
  assert.ok(pkg.build.files.includes('package.json'));
});
