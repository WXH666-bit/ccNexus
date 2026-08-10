import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';

function read(path) {
  const url = new URL(path, import.meta.url);
  return existsSync(url) ? readFileSync(url, 'utf8') : '';
}

const chatView = read('../src/views/ChatView.tsx');
const indicator = read('../src/components/GeneratingResponseIndicator.tsx');
const statusPanel = read('../src/components/StatusPanel.tsx');
const contextBar = read('../src/components/ChatInputBox/ContextBar.tsx');
const styles = read('../src/index.css');

test('ChatView shows a ccgui-style generating response indicator above the status panel while streaming', () => {
  assert.match(chatView, /<GeneratingResponseIndicator isStreaming=\{isStreaming\} \/>/);
  assert.match(chatView, /<GeneratingResponseIndicator isStreaming=\{isStreaming\} \/>[\s\S]*\{showStatusPanel && \([\s\S]*<StatusPanel/);
  assert.match(indicator, /useElapsedStreamingSeconds/);
  assert.match(indicator, /className="generating-response-indicator"/);
  assert.match(indicator, /正在生成响应/);
  assert.match(indicator, /已用 \{formatElapsedTime\(elapsedSeconds\)\}/);
});

test('generating response indicator is a quiet row above the status panel', () => {
  assert.match(styles, /\.generating-response-indicator\s*\{[^}]*display:\s*flex;/s);
  assert.match(styles, /\.generating-response-indicator\s*\{[^}]*margin:\s*0 20px 8px 20px;/s);
  assert.match(styles, /\.generating-response-spinner\s*\{[^}]*animation:\s*spin 1s linear infinite;/s);
});

test('status panel separates labels from counts and aligns three equal columns', () => {
  assert.match(statusPanel, /className="status-panel-tab/);
  assert.match(statusPanel, /className="tab-progress"/);
  assert.match(statusPanel, /className="tab-stats"/);
  assert.match(styles, /\.status-panel-tabs\s*\{[^}]*display:\s*grid;/s);
  assert.match(styles, /grid-template-columns:\s*repeat\(3,\s*minmax\(0,\s*1fr\)\);/s);
  assert.match(styles, /\.status-panel-tab\s*\{[^}]*min-height:\s*32px;/s);
  assert.match(styles, /\.status-panel-tab \.tab-progress[\s\S]*font-variant-numeric:\s*tabular-nums;/s);
});

test('status panel toggle renders a direction icon in both states', () => {
  assert.match(contextBar, /ChevronDown[\s\S]*ChevronUp/);
  assert.match(contextBar, /status-panel-toggle-button/);
  assert.match(contextBar, /showStatusPanel \? <ChevronDown size=\{16\} \/> : <ChevronUp size=\{16\} \/>/);
  assert.match(contextBar, /aria-expanded=\{showStatusPanel\}/);
  assert.match(styles, /\.status-panel-toggle-button\s*\{/);
});
