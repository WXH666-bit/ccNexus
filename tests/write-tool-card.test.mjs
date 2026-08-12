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
  assert.match(source, /const writeLineCount = countLines\(writeContent\);/);
  assert.match(source, /<span className="stat-add">\+\{writeLineCount\}<\/span>/);
  assert.match(source, /<span className="stat-del">-0<\/span>/);
  assert.match(source, /<div className="task-field-label">\{key\}<\/div>/);
  assert.match(source, /formatParamValueCapped\(value\)/);
});

test('write card field styles keep content readable instead of raw JSON blob', () => {
  const styles = read('src/index.css');

  assert.match(styles, /\.task-field-label\s*\{[^}]*text-transform:\s*uppercase;/s);
  assert.match(styles, /\.task-field-content\s*\{[^}]*font-family:\s*var\(--font-mono\);/s);
  assert.match(styles, /\.task-field-content\s*\{[^}]*white-space:\s*pre-wrap;/s);
});

test('streaming tools render a live card before input JSON is complete', () => {
  const source = read('src/components/MessageItem.tsx');
  const bash = read('src/components/toolBlocks/BashToolBlock.tsx');
  const generic = read('src/components/toolBlocks/GenericToolBlock.tsx');

  assert.doesNotMatch(source, /isStreaming && \(!block\.input \|\| Object\.keys\(block\.input\)\.length === 0\)/);
  assert.match(source, /tool-card-live/);
  assert.match(bash, /_partialCommand/);
  assert.match(generic, /_partialContent/);
});

test('edit status counts Write only after a successful tool result', () => {
  const source = read('src/utils/statusPanelData.ts');

  assert.match(source, /findToolResultForBlock\(messages, messageIndex, block\.id\)/);
  assert.match(source, /if \(!result \|\| result\.is_error\) return;/);
  assert.match(source, /isFileModifyToolName\(block\.name\)/);
});
