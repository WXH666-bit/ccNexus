import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function read(path) {
  return readFileSync(resolve(root, path), 'utf8');
}

test('ChatView clears streaming state when the server reports idle', () => {
  const source = read('src/views/ChatView.tsx');

  assert.match(source, /case 'status': \{/);
  assert.match(source, /msg\.status === 'idle'/);
  assert.match(source, /finishStreamingMessage\(\)/);
});

test('ChatView has a ccgui-style stream stall watchdog for missing result events', () => {
  const source = read('src/views/ChatView.tsx');

  assert.match(source, /shouldRecoverStalledStream/);
  assert.match(source, /STREAM_STALL_CHECK_INTERVAL_MS/);
  assert.match(source, /streamActivityAtRef/);
  assert.match(source, /window\.setInterval/);
  assert.match(source, /finishStreamingMessage\(\)/);
});

test('ChatView consumes queued websocket messages instead of only the latest packet', () => {
  const source = read('src/views/ChatView.tsx');

  assert.match(source, /incomingMessages/);
  assert.match(source, /processedIncomingMessageCountRef/);
  assert.match(source, /incomingMessages\.slice\(processedIncomingMessageCountRef\.current\)/);
  assert.doesNotMatch(source, /const \{ send, lastMessage, connected \} = useWebSocket/);
});
