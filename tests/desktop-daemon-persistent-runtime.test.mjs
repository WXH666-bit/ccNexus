import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const daemon = readFileSync(new URL('../desktop/daemon/ccnexus-daemon.js', import.meta.url), 'utf8');

test('desktop daemon keeps one SDK query runtime open and feeds turns through an async input stream', () => {
  assert.match(daemon, /class AsyncStream/);
  assert.match(daemon, /let runtime = null/);
  assert.match(daemon, /const query = sdkQuery\(\{[\s\S]*prompt:\s*inputStream/);
  assert.match(daemon, /function createTurnSink\(\)/);
  assert.match(daemon, /function startPerpetualReader\(\w+Runtime\)/);
  assert.match(daemon, /\.inputStream\.enqueue\(buildUserMessage/);
  assert.match(daemon, /await \w+Runtime\.query\.next\(\)/);
  assert.match(daemon, /await currentRuntime\.turnSink\.take\(\)/);
  assert.doesNotMatch(daemon, /activeQuery = sdkQuery\(\{\s*prompt,\s*options:/);
});

test('desktop daemon promotes the SDK runtime to the returned session id without rebuilding it', () => {
  assert.doesNotMatch(daemon, /resume:\s*options\.resume/);
  assert.match(daemon, /sessionId:\s*options\.resume \|\| ''/);
  assert.match(daemon, /requestedSessionId = options\.resume \|\| ''/);
  assert.match(daemon, /runtime\.sessionId !== requestedSessionId/);
  assert.match(daemon, /currentRuntime\.sessionId = event\.session_id/);
});

test('desktop daemon follows ccgui runtime signature rules for cache-preserving controls', () => {
  assert.doesNotMatch(daemon, /permissionMode:\s*options\.permissionMode/);
  assert.doesNotMatch(daemon, /maxThinkingTokens:\s*options\.maxThinkingTokens/);
  assert.match(daemon, /bypassPermissions:\s*options\.permissionMode === 'bypassPermissions'/);
  assert.match(daemon, /contextWindow1M:[\s\S]*CLAUDE_CODE_DISABLE_1M_CONTEXT/);
  assert.match(daemon, /setPermissionMode/);
  assert.match(daemon, /setMaxThinkingTokens/);
});

test('desktop daemon includes ccgui cache prefix inputs in runtime identity', () => {
  assert.match(daemon, /additionalDirectories/);
  assert.match(daemon, /systemPromptAppend/);
  assert.match(daemon, /streamingEnabled/);
  assert.match(daemon, /runtimeSessionEpoch/);
});

test('desktop daemon keeps prompt-enhancement persistence and MCP isolation in runtime identity', () => {
  assert.match(daemon, /persistSession/);
  assert.match(daemon, /strictMcpConfig/);
  assert.match(daemon, /mcpServers:\s+options\.mcpServers/);
  assert.match(daemon, /await closeRuntime\(\)/);
});
