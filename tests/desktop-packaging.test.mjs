import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const viteConfig = readFileSync(new URL('../vite.config.ts', import.meta.url), 'utf8');

test('package has desktop packaging scripts and electron-builder config', () => {
  assert.equal(pkg.main, 'desktop/main.js');
  assert.equal(pkg.scripts['desktop:pack'], 'npm run build && electron-builder --dir');
  assert.equal(pkg.scripts['desktop:dist'], 'npm run build && electron-builder');
  assert.ok(pkg.devDependencies['electron-builder']);
  assert.equal(pkg.devDependencies['electron-builder'], '26.15.3');
  assert.equal(pkg.build.appId, 'com.ccnexus.app');
  assert.equal(pkg.build.productName, 'ccNexus');
  assert.ok(pkg.build.files.includes('dist/**'));
  assert.ok(pkg.build.files.includes('desktop/**'));
  assert.ok(pkg.build.files.includes('server/claudeHistory.js'));
  assert.ok(pkg.build.files.includes('server/protocol.js'));
  assert.ok(pkg.build.files.includes('server/claudeProjectPaths.js'));
  assert.ok(!pkg.build.files.includes('server/index.js'));
  assert.equal(pkg.dependencies?.express, undefined);
  assert.equal(pkg.dependencies?.ws, undefined);
  assert.ok(pkg.build.files.includes('src/utils/contextUsage.js'));
  assert.ok(pkg.build.files.includes('package.json'));
});

test('package pins the Claude SDK and publishes stable updates through public GitHub Releases', () => {
  assert.equal(pkg.dependencies['@anthropic-ai/claude-agent-sdk'], '0.3.218');
  assert.ok(pkg.dependencies['electron-updater']);
  assert.deepEqual(pkg.build.publish, {
    provider: 'github',
    owner: 'WXH666-bit',
    repo: 'ccNexus',
    releaseType: 'release',
  });
  assert.equal(pkg.build.win.target, 'nsis');
});

test('NSIS uses an assisted installer with a selectable directory and launch choice', () => {
  assert.deepEqual(pkg.build.nsis, {
    oneClick: false,
    allowToChangeInstallationDirectory: true,
    runAfterFinish: true,
  });
});

test('vite emits relative renderer assets for packaged file loading', () => {
  assert.match(viteConfig, /base:\s*['"]\.\/['"]/);
});
