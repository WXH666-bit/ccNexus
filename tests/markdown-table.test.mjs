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

test('light theme keeps highlighted markdown code readable', () => {
  const css = read('src/index.css');
  const lightTheme = css.match(/\[data-theme="light"\]\s*\{([\s\S]*?)\n\}/)?.[1] ?? '';

  assert.match(lightTheme, /--code-text:/);
  assert.match(lightTheme, /--code-comment:/);
  assert.match(css, /\.markdown-body pre code\.hljs\s*\{[\s\S]*color:\s*var\(--code-text\);/);
  assert.match(css, /\.markdown-body pre code\.hljs \.hljs-comment[\s\S]*color:\s*var\(--code-comment\);/);
});

test('rendered markdown is sanitized before it reaches dangerouslySetInnerHTML', () => {
  const markdown = read('src/utils/markdown.ts');
  const messageItem = read('src/components/MessageItem.tsx');

  assert.match(markdown, /DOMPurify\.sanitize/);
  assert.match(markdown, /sanitizeHtml/);
  assert.match(messageItem, /escapeHtml\(displayText\)/);
  assert.match(messageItem, /sanitizeHtml\(highlightText\(/);
});
