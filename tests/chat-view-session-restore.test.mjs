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

  assert.match(source, /const latest = \[\.\.\.visibleSessionList\]\.sort/);
  assert.match(source, /const nextSession = preferredSession \|\| latest/);
  assert.match(source, /requestSessionHistory\(nextSession\.id, fallbackSessionId\)/);
  assert.match(source, /loadSession\(sessionId\)/);
  assert.doesNotMatch(source, /send\(\{\s*type:\s*'load_session',\s*sessionId\s*\}\)/s);
});

test('ChatView limits recent tasks to the five newest sessions and reports the visible count', () => {
  const source = read('src/views/ChatView.tsx');

  assert.match(source, /const RECENT_SESSION_LIMIT = 5;/);
  assert.match(source, /const recentSessions = useMemo\(\(\) => \([\s\S]*?\.sort\(\(a, b\) => b\.updatedAt - a\.updatedAt\)\.slice\(0, RECENT_SESSION_LIMIT\)/);
  assert.match(source, /<span>\{recentSessions\.length\}<\/span>/);
  assert.match(source, /recentSessions\.map\(session =>/);
});

test('recent task selection follows route-driven restore and directly retries a failed same-route load', () => {
  const source = read('src/views/ChatView.tsx');
  const handler = source.match(/const handleSelectSession = useCallback\(\(session: Session\) => \{[\s\S]*?\n  \}, \[[^\n]*\]\);/);

  assert.ok(handler, 'expected recent task selection handler');
  assert.match(handler[0], /if \(session\.id === activeSessionId\) \{[\s\S]*?requestSessionHistory\(session\.id\);[\s\S]*?return;/);
  assert.match(handler[0], /beginSessionTransition\(session\.id, session\)/);
  assert.match(handler[0], /navigate\(`\/chat\/\$\{encodeURIComponent\(session\.id\)\}`\)/);
  assert.match(source, /if \(requestedHistorySessionRef\.current !== urlSessionId\) \{\s*requestSessionHistory\(urlSessionId\);/s);
});

test('ChatView prefers the persisted active session before falling back to the latest session', () => {
  const source = read('src/views/ChatView.tsx');

  assert.match(source, /getActiveSession/);
  assert.match(source, /activeSession.*sessionId/);
  assert.match(source, /preferredSession/);
  assert.match(source, /setActiveSession/);
});

test('ChatView falls back to the latest session when the preferred history cannot be loaded', () => {
  const source = read('src/views/ChatView.tsx');

  assert.match(source, /fallbackSessionId/);
  assert.match(source, /if \(fallbackSessionId\)/);
  assert.match(source, /requestSessionHistory\(fallbackSession\.id\)/);
});

test('ChatView does not clear a restored session just because the route has no session id', () => {
  const source = read('src/views/ChatView.tsx');

  assert.doesNotMatch(source, /else if \(activeSessionIdRef\.current !== null\) \{\s*beginSessionTransition\(null\);\s*setCurrentSession\(null\);/s);
  assert.match(source, /newSessionNavigationRef/);
});

test('ChatView consumes the canonical title from the session event instead of a placeholder', () => {
  const source = read('src/views/ChatView.tsx');

  assert.match(source, /title: msg\.title/);
  assert.match(source, /Number\.isFinite\(msg\.updatedAt\)/);
  assert.match(source, /sessionUpdatedAt/);
  assert.doesNotMatch(source, /title: currentSession\?\.id === msg\.sessionId \? currentSession\.title : 'New Chat'/);
});

test('ChatView seeds context usage from restored history before the next live usage update', () => {
  const source = read('src/views/ChatView.tsx');

  assert.match(source, /estimateMessagesUsedTokens/);
  assert.match(source, /extractMessagesUsedTokens/);
  assert.match(source, /setMessages\(visibleChatMessages\(history\.messages\)\);\s*setUsageUsedTokens\(extractMessagesUsedTokens\(history\.messages\) \?\? readStoredContextUsage\(history\.sessionId\) \?\? estimateMessagesUsedTokens\(history\.messages\)\);/s);
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

test('App keeps ChatView mounted while settings and history routes are active', () => {
  const source = read('src/App.tsx');

  assert.match(source, /persistent-chat-shell/);
  assert.match(source, /secondary-route-shell/);
  assert.match(read('src/index.css'), /\.persistent-chat-shell,[\s\S]*display:\s*flex/);
  assert.match(source, /<ChatView routeSessionId=\{routeSessionId\} \/>/);
  assert.match(source, /useLocation/);
  assert.match(source, /route-hidden/);
});

test('ChatView keeps a route session id when it is mounted outside the route element', () => {
  const source = read('src/views/ChatView.tsx');

  assert.match(source, /interface ChatViewProps/);
  assert.match(source, /routeSessionId\?: string/);
  assert.match(source, /const urlSessionId = routeSessionId \?\? routeParamSessionId/);
});

test('ExitPlanMode permission requests are shown as a readable plan approval', () => {
  const source = read('src/views/ChatView.tsx');
  const types = read('src/types.ts');

  assert.match(source, /msg\.toolName === ['"]ExitPlanMode['"]/);
  assert.doesNotMatch(source, /msg\.toolName === ['"]ExitPlanMode['"]\s*&&\s*mode === ['"]plan['"]/);
  assert.match(source, /responseType:\s*['"]permission['"]/);
  assert.match(source, /planApproval\.responseType === ['"]permission['"]/);
  assert.match(source, /type:\s*['"]permission_response['"]/);
  assert.match(types, /responseType\?: ['"]plan['"] \| ['"]permission['"]/);
});
