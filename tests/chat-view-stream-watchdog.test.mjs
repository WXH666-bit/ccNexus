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

test('ChatView treats permission waits and web review lifecycles as active turn state', () => {
  const source = read('src/views/ChatView.tsx');

  assert.match(source, /const hasActiveWebResearch = webResearchAgentItems\.some/);
  assert.match(source, /item\.status === 'pending' \|\| item\.status === 'searching'/);
  assert.match(source, /const isStreamRecoverySuspended = Boolean\(permission \|\| planApproval \|\| askQuestion\) \|\| hasActiveWebResearch/);
  assert.match(source, /isRecoverySuspended: streamRecoverySuspendedRef\.current/);
  assert.match(source, /if \(!isTurnBusy && !stopping && messageQueue\.length > 0/);
  assert.match(source, /shouldQueueChatMessage\(\{ isStreaming: isTurnBusy, stopping \}\)/);
});

test('session and workspace transitions abort a turn waiting on web review', () => {
  const source = read('src/views/ChatView.tsx');

  assert.match(source, /const handleNewSession = useCallback\(\(\) => \{\s*if \(isTurnBusy\) \{\s*send\(\{ type: 'abort'/s);
  assert.match(source, /const handleSelectSession = useCallback[\s\S]*?if \(isTurnBusy\) \{\s*send\(\{ type: 'abort'/);
  assert.match(source, /const handleWorkspaceChanged = useCallback\(\(\) => \{\s*if \(isTurnBusy\) \{\s*send\(\{ type: 'abort'/s);
});

test('ChatView consumes queued desktop chat events instead of only the latest packet', () => {
  const source = read('src/views/ChatView.tsx');

  assert.match(source, /incomingMessages/);
  assert.match(source, /processedIncomingMessageCountRef/);
  assert.match(source, /incomingMessages\.slice\(processedIncomingMessageCountRef\.current\)/);
  assert.doesNotMatch(source, /const \{ send, lastMessage, connected \} = useDesktopChat/);
});
