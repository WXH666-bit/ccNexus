import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const daemon = readFileSync(new URL('../desktop/daemon/ccnexus-daemon.js', import.meta.url), 'utf8');
const runtimeIdentity = readFileSync(new URL('../server/runtimeIdentity.js', import.meta.url), 'utf8');

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
  assert.match(runtimeIdentity, /bypassPermissions:\s*options\.permissionMode === 'bypassPermissions'/);
  assert.match(runtimeIdentity, /contextWindow1M:\s*descriptor\.contextWindow1M === true/);
  assert.match(daemon, /setPermissionMode/);
  assert.match(daemon, /setMaxThinkingTokens/);
});

test('desktop daemon includes ccgui cache prefix inputs in runtime identity', () => {
  assert.match(runtimeIdentity, /additionalDirectories/);
  assert.match(runtimeIdentity, /systemPromptAppend/);
  assert.match(runtimeIdentity, /streamingEnabled/);
  assert.match(runtimeIdentity, /runtimeSessionEpoch/);
});

test('desktop daemon keeps prompt-enhancement persistence and MCP isolation in runtime identity', () => {
  assert.match(runtimeIdentity, /persistSession/);
  assert.match(runtimeIdentity, /strictMcpConfig/);
  assert.match(runtimeIdentity, /mcpFingerprint/);
  assert.match(daemon, /await closeRuntime\(\)/);
});
