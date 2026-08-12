import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';

const root = new URL('../', import.meta.url);
const read = file => readFileSync(new URL(file, root), 'utf8');

const refreshConsumers = [
  'src/views/HistoryView.tsx',
  'src/components/ConfigSelect.tsx',
  'src/components/FileExplorer.tsx',
  'src/components/settings/AgentSection.tsx',
  'src/components/settings/AppUpdateSection.tsx',
  'src/components/settings/EnvVarEditor.tsx',
  'src/components/settings/MCPSection.tsx',
  'src/components/settings/ProviderManageSection.tsx',
  'src/components/settings/SkillsSection.tsx',
  'src/components/settings/UsageStatistics.tsx',
];

test('refresh controls share one animated icon and bind animation to request state', () => {
  assert.equal(existsSync(new URL('src/components/RefreshIcon.tsx', root)), true);
  const icon = read('src/components/RefreshIcon.tsx');
  const css = read('src/index.css');

  assert.match(icon, /RefreshCw/);
  assert.match(icon, /refresh-icon--spinning/);
  assert.match(css, /\.refresh-icon--spinning/);
  assert.match(css, /prefers-reduced-motion/);

  for (const file of refreshConsumers) {
    const source = read(file);
    assert.match(source, /RefreshIcon/, `${file} should use the shared refresh icon`);
  }
});

test('refresh icon replays a click animation when a request resolves immediately', () => {
  const icon = read('src/components/RefreshIcon.tsx');
  const css = read('src/index.css');

  assert.match(icon, /onPointerDown/);
  assert.match(icon, /refresh-icon--clicked/);
  assert.match(css, /\.refresh-icon--clicked/);
  assert.match(css, /@keyframes refresh-icon-click/);
  assert.match(css, /refresh-icon-spin\s+1100ms/);
  assert.match(css, /refresh-icon-click\s+1000ms/);
  assert.match(icon, /},\s*1000\);/);
});

test('refresh controls do not keep separate legacy spinner classes', () => {
  for (const file of refreshConsumers) {
    const source = read(file);
    assert.doesNotMatch(source, /<RefreshCw[^>]*className=\{[^}]*\bspin(?:ning)?\b/);
  }
});
