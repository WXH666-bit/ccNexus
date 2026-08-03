import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const root = new URL('../', import.meta.url);
const read = (file) => readFileSync(new URL(file, root), 'utf8');

test('status panel uses one ccgui-style tabbed popover for all three status groups', () => {
  const source = read('src/components/StatusPanel.tsx');
  const styles = read('src/index.css');

  assert.match(source, /className="status-panel-tabs"/);
  assert.match(source, /className="status-panel-tab/);
  assert.match(source, /className="status-panel-popover"/);
  assert.match(source, /StatusTaskList/);
  assert.match(source, /StatusSubagentList/);
  assert.match(source, /StatusFileChangesList/);
  assert.match(source, /document\.addEventListener\('mousedown'/);
  assert.match(styles, /\.status-panel-popover\s*\{[^}]*bottom:\s*100%;[^}]*left:\s*0;[^}]*right:\s*0;/s);
  assert.match(styles, /\.status-panel-empty\s*\{[^}]*border:\s*1px dashed/);
});

test('status panel exposes ccgui-style structured actions', () => {
  const source = read('src/components/StatusPanel.tsx');

  assert.match(source, /status-panel-todo-item/);
  assert.match(source, /subagent-description/);
  assert.match(source, /status-file-diff/);
  assert.match(source, /onDiscardAllFiles/);
  assert.match(source, /onKeepAllFiles/);
  assert.match(source, /onUndoFile/);
});
