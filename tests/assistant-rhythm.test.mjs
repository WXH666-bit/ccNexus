import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const styles = fs.readFileSync(path.join(root, 'src', 'index.css'), 'utf8')
  .replaceAll('\r\n', '\n');

test('assistant blocks use a compact vertical rhythm', () => {
  assert.ok(styles.includes('/* Compact assistant response rhythm */'));
  assert.ok(styles.includes(
    '.assistant-row .message-content > .thinking-block {\n  margin: 0 0 6px;',
  ));
  assert.ok(styles.includes(
    '.assistant-row .message-content > .tool-block,\n.assistant-row .message-content > .tool-group-block,\n.assistant-row .message-content > .agent-group-block {\n  margin: 6px 0;',
  ));
  assert.ok(styles.includes(
    '.assistant-row .message-content > .markdown-body {\n  margin: 0;',
  ));
  assert.ok(styles.includes(
    '.assistant-row + .assistant-row {',
  ));
  assert.ok(styles.includes('margin-top: -20px;'));
});
