import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const root = new URL('../', import.meta.url);
const read = (file) => readFileSync(new URL(file, root), 'utf8');

test('diff calculation follows ccgui safeguards for large file changes', () => {
  const source = read('src/utils/diff.ts');
  const statusData = read('src/utils/statusPanelData.ts');

  assert.match(source, /LCS_MAX_LINES/);
  assert.match(source, /DIFF_CACHE_MAX_SIZE/);
  assert.match(source, /MAX_DIFF_RENDER_LINES/);
  assert.match(source, /MAX_DIFF_RENDER_CHARS/);
  assert.doesNotMatch(source, /oldLines\.filter\(l => !newLines\.includes\(l\)\)/);
  assert.doesNotMatch(source, /newLines\.filter\(l => !oldLines\.includes\(l\)\)/);
  assert.match(statusData, /computeDiffStats/);
  assert.doesNotMatch(statusData, /computeDiff\(oldString, newString\)/);
});

test('status panel creates diff HTML only for the expanded file row', () => {
  const source = read('src/components/StatusPanel.tsx');

  assert.match(source, /const expanded = expandedPath === file\.path/);
  assert.match(source, /const diffPreviews = expanded && hasDiff/);
  assert.doesNotMatch(source, /const diffHtml = hasDiff/);
  assert.match(source, /diff\.truncated/);
});
