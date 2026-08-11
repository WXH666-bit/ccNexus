import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ccnexusSource = fs.readFileSync(
  path.join(root, 'src', 'components', 'ChatInputBox', 'ButtonArea.tsx'),
  'utf8',
);
const ccguiSource = fs.readFileSync(
  path.join(root, '_ccgui', 'ccgui-src', 'webview', 'src', 'components', 'ChatInputBox', 'types.ts'),
  'utf8',
);

function readSet(source, name) {
  const start = source.indexOf('const ' + name);
  assert.notEqual(start, -1, name + ' should be declared');
  const open = source.indexOf('[', start);
  const close = source.indexOf('])', open);
  assert.ok(open > start && close > open, name + ' should contain a Set literal');
  return [...source.slice(open, close).matchAll(/'([^']+)'/g)].map(item => item[1]);
}

test('Claude reasoning capability lists stay aligned with ccgui', () => {
  for (const name of [
    'EFFORT_SUPPORTED_CLAUDE_MODELS',
    'XHIGH_EFFORT_CLAUDE_MODELS',
    'MAX_EFFORT_CLAUDE_MODELS',
  ]) {
    assert.deepEqual(
      readSet(ccnexusSource, name),
      readSet(ccguiSource, name),
      name + ' should match ccgui',
    );
  }
});
