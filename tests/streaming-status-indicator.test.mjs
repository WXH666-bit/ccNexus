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
const styles = read('../src/index.css');

test('ChatView shows a ccgui-style generating response indicator above the status panel while streaming', () => {
  assert.match(chatView, /<GeneratingResponseIndicator isStreaming=\{isStreaming\} \/>/);
  assert.match(chatView, /<GeneratingResponseIndicator isStreaming=\{isStreaming\} \/>[\s\S]*\{showStatusPanel && <StatusPanel/);
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
  assert.match(statusPanel, /<span className="status-item-label">\{t\('status\.tasks'\)\}<\/span>/);
  assert.match(statusPanel, /<span className="status-item-count">/);
  assert.match(statusPanel, /<span className="status-item-label">\{t\('status\.subagents'\)\}<\/span>/);
  assert.match(statusPanel, /<span className="status-item-label">\{t\('status\.edits'\)\}<\/span>/);
  assert.match(styles, /\.status-panel\s*\{[^}]*display:\s*grid;/s);
  assert.match(styles, /grid-template-columns:\s*repeat\(3,\s*minmax\(0,\s*1fr\)\);/s);
  assert.match(styles, /\.status-item\s*\{[^}]*min-height:\s*32px;/s);
  assert.match(styles, /\.status-item-count\s*\{[^}]*font-variant-numeric:\s*tabular-nums;/s);
});
