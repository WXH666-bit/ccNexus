import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const root = new URL('../', import.meta.url);
const read = (path) => readFileSync(new URL(path, root), 'utf8');

test('chat route uses desktop daemon query channel instead of calling SDK directly', () => {
  const controller = read('desktop/runtime/chatController.js');

  assert.match(controller, /runtime\.queryClaude\(/);
  assert.match(controller, /sessionId:\s*querySessionId/);
  assert.doesNotMatch(controller, /sdkQuery\(\{ prompt, options: queryOpts \}\)/);
});

test('desktop runtime exposes a Claude query stream backed by a session daemon', () => {
  const runtime = read('desktop/runtime/index.js');
  const bridge = read('desktop/runtime/daemonBridge.js');

  assert.match(runtime, /queryClaude\(/);
  assert.match(runtime, /bridge\.streamCommand\('query'/);
  assert.match(bridge, /streamCommand\(method, params/);
  assert.match(bridge, /onPermissionRequest/);
  assert.match(bridge, /method:\s*'permission_response'/);
});

test('desktop daemon bridge keeps the Node daemon alive when launched from Electron', () => {
  const runtime = read('desktop/runtime/index.js');
  const bridge = read('desktop/runtime/daemonBridge.js');

  assert.match(runtime, /ELECTRON_RUN_AS_NODE:\s*'1'/);
  assert.match(bridge, /ELECTRON_RUN_AS_NODE/);
  assert.match(bridge, /spawn\(this\.nodePath,\s*\[this\.daemonScript\]/);
});

test('desktop daemon bridge handles stdin EPIPE during app shutdown', () => {
  const bridge = read('desktop/runtime/daemonBridge.js');

  assert.match(bridge, /stdin\.on\('error'/);
  assert.match(bridge, /isBrokenPipeError/);
  assert.match(bridge, /this\.handlePipeError/);
});

test('desktop daemon runs Claude SDK query and asks the bridge for tool permission', () => {
  const daemon = read('desktop/daemon/ccnexus-daemon.js');
  const bridge = read('desktop/runtime/daemonBridge.js');

  assert.match(daemon, /@anthropic-ai\/claude-agent-sdk/);
  assert.match(daemon, /method === 'query'/);
  assert.match(daemon, /class AsyncStream/);
  assert.match(daemon, /const query = sdkQuery\(\{[\s\S]*prompt:\s*inputStream/);
  assert.match(daemon, /currentRuntime\.inputStream\.enqueue\(buildUserMessage/);
  assert.match(daemon, /async function canUseTool/);
  assert.match(daemon, /type:\s*'permission_request'/);
  assert.match(daemon, /pendingPermissions\.set\(requestId, resolve\)/);
  assert.match(daemon, /method === 'permission_response'/);
  assert.match(bridge, /options\.onPermissionRequest/);
  assert.match(bridge, /method:\s*'permission_response'/);
});
