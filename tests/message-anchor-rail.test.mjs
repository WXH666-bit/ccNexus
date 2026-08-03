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

test('message anchor hover does not resize the scrollable rail overflow area', () => {
  const styles = read('src/index.css');
  const dotRule = styles.match(/\.anchor-dot\s*\{[^}]*\}/s)?.[0] || '';
  const hoverRule = styles.match(/\.anchor-dot:hover,\s*\.anchor-dot\.hovered\s*\{[^}]*\}/s)?.[0] || '';

  assert.match(dotRule, /border:\s*2px solid var\(--border-color\);/);
  assert.match(hoverRule, /box-shadow:/);
  assert.match(hoverRule, /border-color:/);
  assert.doesNotMatch(hoverRule, /outline:/);
  assert.doesNotMatch(hoverRule, /transform:/);
  assert.doesNotMatch(hoverRule, /scale\(/);
});

test('chat message list hides page-level horizontal overflow above the status panel', () => {
  const styles = read('src/index.css');

  assert.match(styles, /\.message-list\s*\{[^}]*overflow-x:\s*hidden;/s);
  assert.match(styles, /\.chat-content-with-rail \.message-list\s*\{[^}]*min-width:\s*0;/s);
});

test('message anchor rail follows ccgui left-side layout and reserves its own gutter', () => {
  const styles = read('src/index.css');

  assert.match(styles, /--anchor-rail-gutter:\s*36px;/);
  assert.match(styles, /\.chat-content-with-rail \.message-list\s*\{[^}]*padding-left:\s*var\(--anchor-rail-gutter\);/s);
  assert.match(styles, /\.anchor-rail\s*\{[^}]*left:\s*4px;/s);
  assert.match(styles, /\.anchor-rail\s*\{[^}]*pointer-events:\s*none;/s);
});

test('message anchor rail defaults to user conversation nodes and keeps tool detail opt-in', () => {
  const source = read('src/components/MessageAnchorRail.tsx');

  assert.match(source, /showToolAnchors\?: boolean/);
  assert.match(source, /showToolAnchors = false/);
  assert.match(source, /getAnchors\(messages, showToolAnchors\)/);
  assert.match(source, /message\.role === 'user'/);
  assert.match(source, /if \(!showToolAnchors \|\| message\.role !== 'assistant'\) return;/);
  assert.match(source, /block\.type === 'tool_use'/);
  assert.match(source, /block\.type === 'thinking'/);
});

test('chat view stores the tool-node visibility preference and passes it to the rail and config menu', () => {
  const chatView = read('src/views/ChatView.tsx');
  const inputBox = read('src/components/ChatInputBox/index.tsx');
  const buttonArea = read('src/components/ChatInputBox/ButtonArea.tsx');
  const configSelect = read('src/components/ConfigSelect.tsx');

  assert.match(chatView, /localStorage\.getItem\('showToolAnchors'\)/);
  assert.match(chatView, /showToolAnchors=\{showToolAnchors\}/);
  assert.match(chatView, /setShowToolAnchors=\{setShowToolAnchors\}/);
  assert.match(inputBox, /showToolAnchors: boolean/);
  assert.match(buttonArea, /showToolAnchors: boolean/);
  assert.match(configSelect, /showToolAnchors: boolean/);
  assert.match(configSelect, /config\.showToolAnchors/);
});
