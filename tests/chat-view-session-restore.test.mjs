import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function read(path) {
  return readFileSync(resolve(root, path), 'utf8');
}

test('ChatView accepts restored history for the latest session when /chat has no session id', () => {
  const source = read('src/views/ChatView.tsx');

  assert.match(source, /if\s*\(urlSessionId\s*&&\s*urlSessionId\s*!==\s*history\.sessionId\)\s*return;/);
});

test('ChatView requests the latest session history after restoring the session list', () => {
  const source = read('src/views/ChatView.tsx');

  assert.match(source, /const latest = \[\.\.\.sessionList\]\.sort/);
  assert.match(source, /requestSessionHistory\(latest\.id\)/);
  assert.match(source, /loadSession\(sessionId\)/);
  assert.doesNotMatch(source, /send\(\{\s*type:\s*'load_session',\s*sessionId\s*\}\)/s);
});

test('ChatView seeds context usage from restored history before the next live usage update', () => {
  const source = read('src/views/ChatView.tsx');

  assert.match(source, /estimateMessagesUsedTokens/);
  assert.match(source, /extractMessagesUsedTokens/);
  assert.match(source, /setMessages\(history\.messages\);\s*setUsageUsedTokens\(extractMessagesUsedTokens\(history\.messages\) \?\? readStoredContextUsage\(history\.sessionId\) \?\? estimateMessagesUsedTokens\(history\.messages\)\);/s);
  assert.match(source, /case 'rewind_complete': \{[\s\S]*setUsageUsedTokens\(extractMessagesUsedTokens\(msg\.messages\) \?\? estimateMessagesUsedTokens\(msg\.messages\)\);/);
  assert.match(source, /setMessages\(\[\]\);\s*setUsageUsedTokens\(undefined\);/s);
  assert.doesNotMatch(source, /setMessages\(\[\]\);\s*setUsageUsedTokens\(readStoredContextUsage\(urlSessionId\)\);/s);
});

test('ChatView mirrors ccgui session-transition isolation for stale history responses', () => {
  const source = read('src/views/ChatView.tsx');

  assert.match(source, /const historyRequestTokenRef = useRef\(0\);/);
  assert.match(source, /const requestToken = \+\+historyRequestTokenRef\.current;/);
  assert.match(source, /historyRequestTokenRef\.current !== requestToken/);
  assert.match(source, /activeSessionIdRef\.current !== history\.sessionId/);
});

test('ChatView ignores usage updates that belong to a different active session', () => {
  const source = read('src/views/ChatView.tsx');

  assert.match(source, /const activeSessionId = activeSessionIdRef\.current \?\? currentSession\?\.id \?\? urlSessionId;/);
  assert.match(source, /if \(usageSessionId && activeSessionId && usageSessionId !== activeSessionId\) break;/);
});

test('ChatView persists live usage updates per session so refresh does not fall back to a low estimate', () => {
  const source = read('src/views/ChatView.tsx');
  const types = read('src/types.ts');
  const contextUsage = read('src/utils/contextUsage.js');
  const controller = read('desktop/runtime/chatController.js');

  assert.match(source, /function readStoredContextUsage\(sessionId\?: string\)/);
  assert.match(source, /function writeStoredContextUsage\(sessionId: string \| undefined, usedTokens: number\)/);
  assert.match(source, /const usageSessionId = msg\.sessionId \?\? currentSession\?\.id \?\? urlSessionId;/);
  assert.match(source, /writeStoredContextUsage\(usageSessionId, msg\.usedTokens\);/);
  assert.match(types, /type: 'usage_update';[^}]*sessionId\?: string/s);
  assert.match(contextUsage, /sessionId/);
  assert.match(controller, /sessionId: querySessionId/);
});

test('ChatView navigates back to the sessionless route before creating a new session', () => {
  const source = read('src/views/ChatView.tsx');

  assert.match(source, /const handleNewSession = useCallback\(\(\) => \{/);
  assert.match(source, /beginSessionTransition\(null\);\s*navigate\('\/chat', \{ replace: true \}\);\s*send\(\{ type: 'new_session' \}\);/s);
});
