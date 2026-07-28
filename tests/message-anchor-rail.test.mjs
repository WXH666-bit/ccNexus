import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function read(path) {
  return readFileSync(resolve(root, path), 'utf8');
}

test('message anchor tooltip is rendered outside the scrollable dot list', () => {
  const source = read('src/components/MessageAnchorRail.tsx');

  assert.match(source, /tooltipState/);
  assert.match(source, /getBoundingClientRect/);
  assert.match(source, /window\.innerHeight/);
  assert.match(source, /Math\.min\(Math\.max/);

  const dotMap = source.match(/anchors\.map\(\(anchor, idx\) => \([\s\S]*?\)\)\}/)?.[0] || '';
  assert.doesNotMatch(dotMap, /className="anchor-tooltip"/);
});

test('message anchor tooltip uses a fixed non-interactive layer to avoid bottom hover jitter', () => {
  const styles = read('src/index.css');

  assert.match(styles, /\.anchor-tooltip\s*\{[^}]*position:\s*fixed;/s);
  assert.match(styles, /\.anchor-tooltip\s*\{[^}]*pointer-events:\s*none;/s);
  assert.doesNotMatch(styles, /\.anchor-tooltip\s*\{[^}]*position:\s*absolute;/s);
});
