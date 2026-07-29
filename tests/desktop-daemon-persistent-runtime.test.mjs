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
  assert.match(daemon, /contextWindow1M:\s*\(options\.model \|\| ''\)\.includes\('\[1m\]'\)/);
  assert.match(daemon, /setPermissionMode/);
  assert.match(daemon, /setMaxThinkingTokens/);
});
