import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { marked } from 'marked';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function read(path) {
  return readFileSync(resolve(root, path), 'utf8');
}

test('Markdown keeps GFM table markup for assistant responses', () => {
  const markdown = '| Name | Value |\n| --- | --- |\n| mode | high |';
  const html = marked.parse(markdown, { gfm: true, breaks: false });

  assert.match(html, /<table>/);
  assert.match(html, /<th>Name<\/th>/);
  assert.match(html, /<td>high<\/td>/);
});

test('ccNexus markdown tables use ccgui-style borders and overflow handling', () => {
  const css = read('src/index.css');

  assert.match(css, /\.markdown-body table\s*\{[\s\S]*border-collapse:\s*collapse/);
  assert.match(css, /\.markdown-body table\s*\{[\s\S]*overflow-x:\s*auto/);
  assert.match(css, /\.markdown-body th,\s*\.markdown-body td\s*\{[\s\S]*border:\s*1px solid var\(--border-color\)/);
  assert.match(css, /\.markdown-body th\s*\{[\s\S]*background-color:\s*var\(--bg-tertiary\)/);
});
