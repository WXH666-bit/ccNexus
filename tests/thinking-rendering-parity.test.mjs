import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function read(path) {
  return readFileSync(resolve(root, path), 'utf8');
}

test('thinking blocks use a dedicated ccgui-style renderer instead of the generic collapsible block', () => {
  const messageItem = read('src/components/MessageItem.tsx');
  const thinkingBlock = read('src/components/ThinkingBlock.tsx');

  assert.match(messageItem, /<ThinkingBlock/);
  assert.doesNotMatch(messageItem, /title=\{isMessageStreaming && isLastBlock \? 'Thinking process' : 'Thinking'\}/);
  assert.match(thinkingBlock, /className="thinking-block"/);
  assert.match(thinkingBlock, /className="thinking-header"/);
  assert.match(thinkingBlock, /className="thinking-title"/);
  assert.match(thinkingBlock, /思考过程/);
  assert.match(thinkingBlock, /思考/);
});

test('thinking content renders markdown inside the ccgui left-rail content area', () => {
  const thinkingBlock = read('src/components/ThinkingBlock.tsx');
  const styles = read('src/index.css');

  assert.match(thinkingBlock, /const normalizedThinking = typeof thinking === 'string' \? thinking\.trim\(\) : ''/);
  assert.match(thinkingBlock, /if \(!normalizedThinking\) return null/);
  assert.match(thinkingBlock, /renderMarkdown\(normalizedThinking\)/);
  assert.doesNotMatch(thinkingBlock, /暂无思考内容/);
  assert.match(thinkingBlock, /className="thinking-content"/);
  assert.match(thinkingBlock, /dangerouslySetInnerHTML/);
  assert.match(styles, /\.thinking-content\s*\{[^}]*border-left:\s*2px solid var\(--color-thinking-border\)/s);
  assert.match(styles, /\.thinking-content\s*\{[^}]*color:\s*var\(--text-tertiary\)/s);
});

test('empty thinking blocks are ignored instead of showing a placeholder', () => {
  const thinkingBlock = read('src/components/ThinkingBlock.tsx');

  assert.match(thinkingBlock, /if \(!normalizedThinking\) return null/);
  assert.doesNotMatch(thinkingBlock, /暂无思考内容/);
});

test('latest thinking block auto-expands while streaming and preserves manual toggles', () => {
  const messageItem = read('src/components/MessageItem.tsx');

  assert.match(messageItem, /useMemo/);
  assert.match(messageItem, /useMemo\(\(\) => groupBlocks\(message\.content\), \[message\.content\]\)/);
  assert.match(messageItem, /expandedThinking/);
  assert.match(messageItem, /manuallyExpandedThinking/);
  assert.match(messageItem, /lastAutoExpandedIndexRef/);
  assert.match(messageItem, /thinkingIndices/);
  assert.match(messageItem, /setExpandedThinking/);
  assert.match(messageItem, /toggleThinking/);
});
