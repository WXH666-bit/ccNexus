import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function read(path) {
  return readFileSync(resolve(root, path), 'utf8');
}

test('generic tool card renders Write with ccgui-style title and fields', () => {
  const source = read('src/components/toolBlocks/GenericToolBlock.tsx');

  assert.match(source, /normalizeToolInput\(name, block\.input\)/);
  assert.match(source, /return '写入文件';/);
  assert.match(source, /const isWriteTool =/);
  assert.match(source, /<div className="task-field-label">\{key\}<\/div>/);
  assert.match(source, /formatParamValueCapped\(value\)/);
});

test('write card field styles keep content readable instead of raw JSON blob', () => {
  const styles = read('src/index.css');

  assert.match(styles, /\.task-field-label\s*\{[^}]*text-transform:\s*uppercase;/s);
  assert.match(styles, /\.task-field-content\s*\{[^}]*font-family:\s*var\(--font-mono\);/s);
  assert.match(styles, /\.task-field-content\s*\{[^}]*white-space:\s*pre-wrap;/s);
});

test('edit status counts Write only after a successful tool result', () => {
  const source = read('src/views/ChatView.tsx');

  assert.match(source, /findToolResultForBlock\(messages, messageIndex, block\.id\)/);
  assert.match(source, /if \(!result \|\| result\.is_error\) return;/);
  assert.match(source, /isFileModifyToolName\(block\.name\)/);
});
