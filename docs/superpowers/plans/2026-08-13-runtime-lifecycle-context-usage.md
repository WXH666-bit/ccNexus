# Runtime Lifecycle and Context Usage Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `/context`, `[1m]`, model routing, epoch ownership, history loading, and runtime retirement correct without disabling existing features or causing unapproved persistent-query rebuilds.

**Architecture:** Keep ccNexus's per-session daemon isolation and cross-session parallelism. Pass an explicit ccNexus-only runtime descriptor beside SDK options, queue `/context` behind only its own session's active turn, and add a host-coordinated 30-minute idle/6-hour absolute-lifetime retirement state machine whose daemon-side gate never interrupts active work.

**Tech Stack:** Electron main process, Node.js ESM, Claude Agent SDK persistent query, React/TypeScript renderer, `node:test`, PowerShell verification commands.

## Global Constraints

- A session runtime may retire after 30 minutes of true inactivity; the cleanup scan runs every 5 minutes, so observed retirement is approximately 30–35 minutes.
- A runtime may retire after 6 hours, but an active turn, permission prompt, plan approval, AskUserQuestion, tool execution, or already queued `/context` must finish first.
- A post-retirement first request is classified and reported as cold; it must never be hidden or relabeled as warm.
- Outside approved retirement, explicit runtime-identity changes, provider/workspace changes, abort, runtime failure, and app exit, unchanged sessions must reuse the same SDK query.
- `/context` must remain available: during a turn it waits, then resolves; it must not alter permission, thinking, model, Agent prompt, streaming, or MCP state.
- `[1m]` is derived case-insensitively from the trimmed raw model ID before it is mapped to an SDK short name.
- Existing Agent, MCP, Skills, model, permission, plan, AskUserQuestion, thinking, streaming, file, history, process-management, and multi-session parallel features must remain available.
- Do not modify Claude Code settings, credentials, provider files, cc-switch data, or project `.claude` content.
- Keep request-scoped env handling; do not copy ccgui's temporary global `process.env` mutation.
- Keep MCP in runtime identity and serialize the MCP snapshot canonically.
- Tests and diagnostics must not expose API keys, tokens, or secret MCP values.
- Follow `.agents/AGENTS.md`; update its persistent-query section in the final task to record the two newly approved retirement boundaries.

---

## File Map

### New files

- `server/runtimeIdentity.js` — pure construction and comparison of ccNexus runtime descriptors and canonical runtime signatures.
- `desktop/runtime/runtimeLifecyclePolicy.js` — pure 30-minute/6-hour retirement decision logic.
- `tests/runtime-identity.test.mjs` — `[1m]`, model route, epoch, and canonical MCP identity tests.
- `tests/runtime-lifecycle-policy.test.mjs` — fake-clock tests for idle, absolute lifetime, and active-work protection.
- `tests/desktop-runtime-lifecycle.test.mjs` — host/bridge retirement, exit cleanup, and transparent reacquisition tests.

### Existing files to modify

- `server/queryOptions.js` — preserve existing SDK option semantics and provide the mapped options consumed by the descriptor builder.
- `desktop/runtime/index.js` — create bridge epochs, build request envelopes, coordinate per-session retirement/reacquisition, and run the cleanup timer.
- `desktop/runtime/daemonBridge.js` — expose epoch/identity, structured status, retirement, and process-exit waiting.
- `desktop/runtime/processRegistry.js` — record daemon lifecycle state and remove only the matching bridge generation.
- `desktop/daemon/ccnexus-daemon.js` — consume descriptors, queue `/context`, use a read-only context fast path, remove dead live-model control, report status, and retire safely.
- `desktop/runtime/chatController.js` — send complete `/context` controls and retain a small non-secret per-session selector profile.
- `desktop/runtime/promptEnhancementService.js` — pass the already selected raw model ID into the isolated request envelope.
- `desktop/runtime/sessionController.js` — make history loading read-only.
- `src/components/ChatInputBox/index.tsx` — submit complete `/context` controls instead of only a model string.
- `src/views/ChatView.tsx` — pass the complete context request through desktop IPC.
- `src/utils/desktopBridgeApi.ts`, `src/vite-env.d.ts` — define the backward-compatible context request type.
- `tests/desktop-daemon-persistent-runtime-behavior.test.mjs` — daemon behavior regressions for queueing, controls, descriptor ownership, and retirement.
- `tests/desktop-daemon-persistent-runtime.test.mjs` — replace source-presence assertions with the new explicit identity boundaries where appropriate.
- `tests/query-options.test.mjs` — validate raw `[1m]` plus provider mapping inputs.
- `tests/desktop-chat-ipc.test.mjs` — complete `/context` request construction.
- `tests/desktop-session-controller.test.mjs`, `tests/process-management.test.mjs` — history no-spawn and retained process-management behavior.
- `.agents/AGENTS.md` — document approved idle and absolute-lifetime exceptions.

---

### Task 1: Add a Pure Runtime Identity Module

**Files:**
- Create: `server/runtimeIdentity.js`
- Create: `tests/runtime-identity.test.mjs`
- Test: `tests/query-options.test.mjs`

**Interfaces:**
- Produces: `createRuntimeDescriptor({ rawModelId, options, runtimeSessionEpoch, workspaceIdentity, providerGeneration }) -> RuntimeDescriptor`.
- Produces: `buildRuntimeSignature(options, descriptor) -> string`.
- Produces: `hasSameContextModel(currentDescriptor, requestedDescriptor) -> boolean`.
- Consumes: existing SDK query options; does not mutate them or add custom fields.

- [ ] **Step 1: Write failing identity tests**

```js
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildRuntimeSignature,
  createRuntimeDescriptor,
  hasSameContextModel,
} from '../server/runtimeIdentity.js';

test('retains raw 1M intent after SDK model mapping', () => {
  const descriptor = createRuntimeDescriptor({
    rawModelId: '  claude-sonnet-4-6[1M]  ',
    options: {
      model: 'sonnet',
      env: { ANTHROPIC_MODEL: 'deepseek-v4-pro[1m]' },
    },
    runtimeSessionEpoch: 'epoch-1',
    workspaceIdentity: 'D:/repo',
  });

  assert.deepEqual(descriptor, {
    rawModelId: 'claude-sonnet-4-6[1M]',
    sdkModelName: 'sonnet',
    resolvedModelId: 'deepseek-v4-pro[1m]',
    contextWindow1M: true,
    runtimeSessionEpoch: 'epoch-1',
    workspaceIdentity: 'D:/repo',
    providerGeneration: '',
  });
});

test('canonical MCP key order does not change runtime identity', () => {
  const descriptor = createRuntimeDescriptor({
    rawModelId: 'claude-sonnet-4-6',
    options: { model: 'sonnet' },
    runtimeSessionEpoch: 'epoch-1',
  });
  const left = buildRuntimeSignature({
    cwd: 'D:/repo',
    mcpServers: { docs: { command: 'node', env: { B: '2', A: '1' } } },
  }, descriptor);
  const right = buildRuntimeSignature({
    cwd: 'D:/repo',
    mcpServers: { docs: { env: { A: '1', B: '2' }, command: 'node' } },
  }, descriptor);
  assert.equal(left, right);
});

test('context model comparison includes route, 1M, and epoch', () => {
  const base = createRuntimeDescriptor({
    rawModelId: 'claude-sonnet-4-6',
    options: { model: 'sonnet', env: { ANTHROPIC_MODEL: 'backend-a' } },
    runtimeSessionEpoch: 'epoch-1',
  });
  assert.equal(hasSameContextModel(base, { ...base }), true);
  assert.equal(hasSameContextModel(base, { ...base, contextWindow1M: true }), false);
  assert.equal(hasSameContextModel(base, { ...base, resolvedModelId: 'backend-b' }), false);
  assert.equal(hasSameContextModel(base, { ...base, runtimeSessionEpoch: 'epoch-2' }), false);
});
```

- [ ] **Step 2: Run the tests and verify the missing module failure**

Run:

```powershell
node --test tests/runtime-identity.test.mjs tests/query-options.test.mjs
```

Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `server/runtimeIdentity.js`.

- [ ] **Step 3: Implement canonical identity functions**

```js
import { createHash } from 'node:crypto';

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.keys(value).sort().map(key => [key, canonicalize(value[key])]),
  );
}

function fingerprint(value) {
  return createHash('sha256')
    .update(JSON.stringify(canonicalize(value)))
    .digest('hex');
}

export function createRuntimeDescriptor({
  rawModelId = '',
  options = {},
  runtimeSessionEpoch = '',
  workspaceIdentity = '',
  providerGeneration = '',
} = {}) {
  const normalizedRawModelId = typeof rawModelId === 'string' ? rawModelId.trim() : '';
  return {
    rawModelId: normalizedRawModelId,
    sdkModelName: typeof options.model === 'string' ? options.model : '',
    resolvedModelId: typeof options.env?.ANTHROPIC_MODEL === 'string'
      ? options.env.ANTHROPIC_MODEL
      : '',
    contextWindow1M: /\[1m\]$/i.test(normalizedRawModelId),
    runtimeSessionEpoch: runtimeSessionEpoch || '',
    workspaceIdentity: workspaceIdentity || '',
    providerGeneration: providerGeneration || '',
  };
}

export function buildRuntimeSignature(options = {}, descriptor = {}) {
  return JSON.stringify(canonicalize({
    cwd: options.cwd || '',
    additionalDirectories: options.additionalDirectories || [],
    systemPromptAppend: options.systemPrompt?.append || '',
    streamingEnabled: options.includePartialMessages !== false,
    runtimeSessionEpoch: descriptor.runtimeSessionEpoch || '',
    model: descriptor.sdkModelName || options.model || '',
    modelRouting: descriptor.resolvedModelId || options.env?.ANTHROPIC_MODEL || '',
    effort: options.effort || '',
    contextWindow1M: descriptor.contextWindow1M === true,
    bypassPermissions: options.permissionMode === 'bypassPermissions',
    persistSession: options.persistSession !== false,
    strictMcpConfig: options.strictMcpConfig === true,
    mcpFingerprint: options.mcpServers == null ? null : fingerprint(options.mcpServers),
    isolatedDenyAllTools: options.isolatedDenyAllTools === true,
  }));
}

export function hasSameContextModel(current = {}, requested = {}) {
  return current.runtimeSessionEpoch === requested.runtimeSessionEpoch
    && current.sdkModelName === requested.sdkModelName
    && current.resolvedModelId === requested.resolvedModelId
    && current.contextWindow1M === requested.contextWindow1M;
}
```

Extend the canonical-MCP test with `assert.doesNotMatch(left, /docs-server-secret/)` after putting `TOKEN: 'docs-server-secret'` in both equivalent MCP env objects. This proves the signature compares a digest rather than retaining a secret value.

- [ ] **Step 4: Run identity and existing query-option tests**

Run:

```powershell
node --test tests/runtime-identity.test.mjs tests/query-options.test.mjs
```

Expected: PASS, including lowercase/uppercase `[1m]`, mapped backend suffix, stale suffix removal, and canonical MCP tests.

- [ ] **Step 5: Commit the pure identity layer**

```powershell
git add server/runtimeIdentity.js tests/runtime-identity.test.mjs
git commit -m "feat: define canonical runtime identity"
```

---

### Task 2: Wire Non-Empty Epochs and Descriptors Through the Daemon Protocol

**Files:**
- Modify: `desktop/runtime/index.js:1-170`
- Modify: `desktop/runtime/daemonBridge.js:65-120`
- Modify: `desktop/runtime/promptEnhancementService.js:140-160`
- Modify: `desktop/daemon/ccnexus-daemon.js:1-380`
- Modify: `tests/desktop-runtime.test.mjs`
- Modify: `tests/desktop-daemon-persistent-runtime-behavior.test.mjs`
- Modify: `tests/desktop-daemon-persistent-runtime.test.mjs`
- Test: `tests/desktop-prompt-enhancement-ipc.test.mjs`

**Interfaces:**
- Consumes: `createRuntimeDescriptor` and `buildRuntimeSignature` from Task 1.
- Produces: query/context daemon params `{ options, runtimeDescriptor }`.
- Produces: `DaemonBridge.runtimeSessionEpoch: string` and `DaemonBridge.bridgeIdentity: string`.
- Produces: daemon runtime field `descriptor` and strict epoch ownership checks.

- [ ] **Step 1: Add failing behavior tests for descriptor transport and stale epoch rejection**

Add daemon-harness commands that always pass descriptors:

```js
const descriptor = {
  rawModelId: 'claude-sonnet-4-6[1m]',
  sdkModelName: 'sonnet',
  resolvedModelId: 'provider-sonnet[1m]',
  contextWindow1M: true,
  runtimeSessionEpoch: 'epoch-live',
  workspaceIdentity: 'D:/repo',
  providerGeneration: '',
};

harness.send({
  id: 'turn-live',
  method: 'query',
  params: {
    prompt: 'hello',
    options: { cwd: 'D:/repo', model: 'sonnet' },
    runtimeDescriptor: descriptor,
  },
});
await waitForDone(harness.state.messages, 'turn-live');

harness.send({
  id: 'context-stale',
  method: 'context_usage',
  params: {
    options: { cwd: 'D:/repo', model: 'sonnet' },
    runtimeDescriptor: { ...descriptor, runtimeSessionEpoch: 'epoch-stale' },
  },
});
const stale = await waitForDone(harness.state.messages, 'context-stale');
assert.equal(stale.success, false);
assert.match(stale.error, /epoch|ownership/i);
```

Add a runtime-construction test using injected `randomUUID` that asserts two created bridges have non-empty, distinct epochs.

- [ ] **Step 2: Run the focused tests and verify failure**

Run:

```powershell
node --test tests/desktop-runtime.test.mjs tests/desktop-daemon-persistent-runtime.test.mjs tests/desktop-daemon-persistent-runtime-behavior.test.mjs tests/desktop-prompt-enhancement-ipc.test.mjs
```

Expected: FAIL because bridge epochs/descriptors do not exist and stale epochs are currently accepted.

- [ ] **Step 3: Add bridge identities and request-envelope construction**

In `createDesktopRuntime`, inject UUID generation for deterministic tests and build the descriptor outside SDK options:

```js
import { randomUUID } from 'node:crypto';
import { createRuntimeDescriptor } from '../../server/runtimeIdentity.js';

const makeUuid = options.randomUUID || randomUUID;

function createDaemonBridge(extraOptions = {}) {
  const runtimeSessionEpoch = extraOptions.runtimeSessionEpoch || makeUuid();
  const bridgeIdentity = extraOptions.bridgeIdentity || makeUuid();
  return new DaemonBridge({
    // existing fields remain unchanged
    ...extraOptions,
    runtimeSessionEpoch,
    bridgeIdentity,
  });
}

function buildRequestEnvelope(bridge, queryOptions, rawModelId, providerGeneration = '') {
  return {
    options: queryOptions,
    runtimeDescriptor: createRuntimeDescriptor({
      rawModelId,
      options: queryOptions,
      runtimeSessionEpoch: bridge.runtimeSessionEpoch,
      workspaceIdentity: runtimeCwd,
      providerGeneration,
    }),
  };
}
```

Change `queryClaude` and `getContextUsage` to accept `rawModelId` and pass both `options` and `runtimeDescriptor` to the bridge. Keep `options` itself free of ccNexus-only fields.

Change the prompt-enhancement call to include `rawModelId: model`, and forward that field through `queryClaudeDisposable`; the isolated runtime still gets its own epoch and remains `persistSession: false`, `strictMcpConfig: true`, and deny-all-tools.

In `DaemonBridge` constructor:

```js
this.runtimeSessionEpoch = options.runtimeSessionEpoch || '';
this.bridgeIdentity = options.bridgeIdentity || '';
```

- [ ] **Step 4: Make daemon runtime identity descriptor-driven**

Import Task 1 helpers, replace the local signature builder, and update signatures:

```js
import {
  buildRuntimeSignature,
  hasSameContextModel,
} from '../../server/runtimeIdentity.js';

async function ensureRuntime(options = {}, runtimeDescriptor = {}) {
  const signature = buildRuntimeSignature(options, runtimeDescriptor);
  // retain existing session-conflict handling
}
```

Store a copy on creation:

```js
runtime = {
  // existing fields
  descriptor: { ...runtimeDescriptor },
};
```

Before reuse or control, require a non-empty matching epoch:

```js
function assertRuntimeOwnership(currentRuntime, requestedDescriptor) {
  const requestedEpoch = requestedDescriptor?.runtimeSessionEpoch || '';
  if (!requestedEpoch) throw new Error('Runtime session epoch is required');
  if (currentRuntime && currentRuntime.descriptor?.runtimeSessionEpoch !== requestedEpoch) {
    throw new Error('Runtime ownership mismatch for session epoch');
  }
}
```

Call a separate `assertRequestedDescriptor(runtimeDescriptor)` at the beginning of `ensureRuntime` and reject an empty epoch even when no runtime exists; ownership must not become optional on the creation path.

Update the VM harness import replacement so `buildRuntimeSignature` and `hasSameContextModel` are injected from the real pure module.

- [ ] **Step 5: Run persistent-runtime and query-option regressions**

Run:

```powershell
node --test tests/runtime-identity.test.mjs tests/query-options.test.mjs tests/desktop-runtime.test.mjs tests/desktop-daemon-persistent-runtime.test.mjs tests/desktop-daemon-persistent-runtime-behavior.test.mjs tests/desktop-prompt-enhancement-ipc.test.mjs
```

Expected: PASS; consecutive matching turns still create one SDK query, while missing/stale epochs fail before touching an existing runtime.

- [ ] **Step 6: Commit descriptor and epoch wiring**

```powershell
git add desktop/runtime/index.js desktop/runtime/daemonBridge.js desktop/runtime/promptEnhancementService.js desktop/daemon/ccnexus-daemon.js tests/desktop-runtime.test.mjs tests/desktop-daemon-persistent-runtime.test.mjs tests/desktop-daemon-persistent-runtime-behavior.test.mjs
git commit -m "feat: wire runtime descriptors and epochs"
```

---

### Task 3: Queue `/context` and Make Its Existing-Runtime Path Read-Only

**Files:**
- Modify: `src/components/ChatInputBox/index.tsx:23-40,370-391`
- Modify: `src/views/ChatView.tsx:203-221`
- Modify: `src/utils/desktopBridgeApi.ts:240`
- Modify: `src/vite-env.d.ts:185`
- Modify: `desktop/runtime/chatController.js:330-550`
- Modify: `desktop/runtime/index.js:90-170`
- Modify: `desktop/runtime/daemonBridge.js:348-357`
- Modify: `desktop/daemon/ccnexus-daemon.js:390-550,630-680`
- Modify: `tests/desktop-chat-ipc.test.mjs`
- Modify: `tests/desktop-daemon-persistent-runtime-behavior.test.mjs`
- Test: `tests/context-usage.test.mjs`

**Interfaces:**
- Produces renderer/IPC shape `ContextUsageRequest` with optional `sessionId`, `model`, `mode`, `reasoning`, `agent`, `streaming`, and `alwaysThinking`.
- Produces daemon-local FIFO `pendingContextUsage` and `drainContextUsageQueue()`.
- Consumes descriptor envelope from Task 2.
- Existing API callers passing only `{ sessionId, model }` remain valid.

- [ ] **Step 1: Write a failing active-turn `/context` behavior test**

Extend the daemon fake query with `getContextUsage()` and control-call counters, then add:

```js
function makeOptions(overrides = {}) {
  return { cwd: 'D:/repo', model: 'sonnet', ...overrides };
}

function makeDescriptor(overrides = {}) {
  return {
    rawModelId: 'claude-sonnet-4-6',
    sdkModelName: 'sonnet',
    resolvedModelId: 'backend-sonnet',
    contextWindow1M: false,
    runtimeSessionEpoch: overrides.epoch || 'epoch-context',
    workspaceIdentity: 'D:/repo',
    providerGeneration: '',
    ...overrides,
  };
}

function makeQueryCommand(id, descriptor, optionOverrides = {}) {
  return {
    id,
    method: 'query',
    params: {
      prompt: id,
      options: makeOptions(optionOverrides),
      runtimeDescriptor: descriptor,
    },
  };
}

let releaseTurn;
const turnGate = new Promise(resolve => { releaseTurn = resolve; });
const harness = createDaemonHarness({ turnGates: [turnGate], contextUsage: { used: 12, size: 200 } });
const descriptor = makeDescriptor({ epoch: 'epoch-context' });

harness.send({
  id: 'turn-context',
  method: 'query',
  params: { prompt: 'work', options: makeOptions(), runtimeDescriptor: descriptor },
});
await waitForCondition(() => harness.state.turnCount === 1);

harness.send({
  id: 'context-queued',
  method: 'context_usage',
  params: {
    options: { ...makeOptions(), permissionMode: 'default', maxThinkingTokens: null },
    runtimeDescriptor: descriptor,
  },
});
await new Promise(resolve => setTimeout(resolve, 10));
assert.equal(harness.state.contextCalls, 0);
assert.equal(harness.state.closeCalls, 0);
assert.deepEqual(harness.state.permissionModes, []);
assert.deepEqual(harness.state.maxThinkingTokens, []);

releaseTurn();
await waitForDone(harness.state.messages, 'turn-context');
const contextDone = await waitForDone(harness.state.messages, 'context-queued');
assert.equal(contextDone.success, true);
assert.equal(harness.state.queryCalls, 1);
assert.equal(harness.state.contextCalls, 1);
```

- [ ] **Step 2: Write a failing full-control IPC test**

In `tests/desktop-chat-ipc.test.mjs`, call:

```js
await controller.getContextUsage({
  sessionId: 'session-1',
  model: 'claude-sonnet-4-6[1m]',
  mode: 'plan',
  reasoning: 'high',
  agent: 'reviewer',
  streaming: false,
  alwaysThinking: true,
});

assert.equal(captured.rawModelId, 'claude-sonnet-4-6[1m]');
assert.equal(captured.options.permissionMode, 'plan');
assert.equal(captured.options.includePartialMessages, false);
assert.match(captured.options.systemPrompt.append, /Review release risks/);
assert.equal(captured.options.effort, 'high');
```

- [ ] **Step 3: Run focused tests and verify both failures**

Run:

```powershell
node --test tests/desktop-chat-ipc.test.mjs tests/desktop-daemon-persistent-runtime-behavior.test.mjs tests/context-usage.test.mjs
```

Expected: FAIL because `/context` currently enters `ensureRuntime` while a turn is active and the IPC carries only a model.

- [ ] **Step 4: Pass complete controls through renderer and IPC**

Export the backward-compatible type from `src/utils/desktopBridgeApi.ts`, import it as a type in `ChatInputBox` and `ChatView`, and mirror the shape in `src/vite-env.d.ts`:

```ts
export interface ContextUsageRequest {
  sessionId?: string | null;
  model?: string;
  mode?: PermissionMode;
  reasoning?: string;
  agent?: string;
  streaming?: boolean;
  alwaysThinking?: boolean;
}
```

Change `ChatInputBox` to call:

```ts
onContextUsage?.({
  model: effectiveModel,
  mode,
  reasoning,
  agent: selectedAgent,
  streaming,
  alwaysThinking,
});
```

Change `ChatView.handleContextUsage` to add the current `sessionId` and forward the object. In `chatController`, keep a `runtimeProfiles` map containing only these selectors, merge a prior profile with supplied fields, and rebuild SDK options through `buildClaudeClientOptions` plus `buildClaudeQueryOptions`. Never store provider credentials in this map.

Move a pending profile to the SDK-returned session ID in the existing `system/init` adoption block. Delete one profile in `forgetSessionState`; clear the map in provider/workspace reset and controller disposal. This prevents stale Agent/model selectors crossing lifecycle boundaries.

- [ ] **Step 5: Implement daemon-local context FIFO and read-only fast path**

Add:

```js
const pendingContextUsage = [];
let contextUsageRunning = false;

function enqueueContextUsage(id, params) {
  pendingContextUsage.push({ id, params });
  void drainContextUsageQueue();
}

async function drainContextUsageQueue() {
  if (contextUsageRunning || activeRequestId) return;
  contextUsageRunning = true;
  try {
    while (!activeRequestId && pendingContextUsage.length > 0) {
      const item = pendingContextUsage.shift();
      await runContextUsageNow(item.id, item.params);
    }
  } finally {
    contextUsageRunning = false;
  }
}
```

At the end of `runQuery` cleanup, after clearing `activeRequestId`, call `void drainContextUsageQueue()`.

The fast path must be explicit:

```js
async function resolveRuntimeForContext(options, descriptor) {
  if (runtime && !runtime.closed && hasSameContextModel(runtime.descriptor, descriptor)) {
    assertRuntimeOwnership(runtime, descriptor);
    return runtime;
  }
  if (runtime && !runtime.closed) await closeRuntime();
  return ensureRuntime(options, descriptor);
}
```

Do not call `applyDynamicControls` when the existing runtime matches. Route `context_usage` to `enqueueContextUsage`; continue routing permission/plan responses, abort, heartbeat, and status immediately.

Add `failPendingContextUsage(message)` that writes one completed error response for every queued item. Call it from shutdown and terminal input/signal cleanup before closing the runtime; bridge exit remains the final fallback that rejects any request already in flight.

- [ ] **Step 6: Run context, daemon, IPC, and type tests**

Run:

```powershell
node --test tests/context-usage.test.mjs tests/desktop-chat-ipc.test.mjs tests/desktop-daemon-persistent-runtime-behavior.test.mjs
npx.cmd tsc --noEmit
```

Expected: PASS; `/context` waits behind the active turn, returns afterward, and leaves query/control counters unchanged.

- [ ] **Step 7: Commit queued read-only context usage**

```powershell
git add src/components/ChatInputBox/index.tsx src/views/ChatView.tsx src/utils/desktopBridgeApi.ts src/vite-env.d.ts desktop/runtime/chatController.js desktop/runtime/index.js desktop/runtime/daemonBridge.js desktop/daemon/ccnexus-daemon.js tests/desktop-chat-ipc.test.mjs tests/desktop-daemon-persistent-runtime-behavior.test.mjs tests/context-usage.test.mjs
git commit -m "fix: isolate context usage from active turns"
```

---

### Task 4: Make Model and Thinking Controls Honest and Compatible

**Files:**
- Modify: `desktop/daemon/ccnexus-daemon.js:264-380`
- Modify: `tests/desktop-daemon-persistent-runtime-behavior.test.mjs`
- Modify: `tests/desktop-daemon-persistent-runtime.test.mjs`
- Test: `tests/query-options.test.mjs`

**Interfaces:**
- Consumes: immutable model route in Task 1 signature.
- Produces: `applyDynamicControls(runtime, options) -> { requiresRebuild: boolean, reason?: string }`.
- Guarantees: generic reuse never calls `query.setModel`; missing/failing thinking live control falls back to one safe rebuild before the next turn begins.

- [ ] **Step 1: Add failing tests for unreachable model control and thinking fallback**

```js
test('same-identity reuse never live-switches the model', async () => {
  const harness = createDaemonHarness({ turnGates: [Promise.resolve(), Promise.resolve()] });
  const descriptor = makeDescriptor({ resolvedModelId: 'backend-a' });
  harness.send(makeQueryCommand('turn-1', descriptor, { model: 'sonnet' }));
  await waitForDone(harness.state.messages, 'turn-1');
  harness.send(makeQueryCommand('turn-2', descriptor, { model: 'sonnet', resume: 'session-1' }));
  await waitForDone(harness.state.messages, 'turn-2');
  assert.deepEqual(harness.state.models, []);
  assert.equal(harness.state.queryCalls, 1);
});

test('missing thinking setter rebuilds instead of silently ignoring the selection', async () => {
  const harness = createDaemonHarness({
    turnGates: [Promise.resolve(), Promise.resolve()],
    omitThinkingSetter: true,
  });
  const descriptor = makeDescriptor();
  harness.send(makeQueryCommand('think-1', descriptor, { maxThinkingTokens: 10000 }));
  await waitForDone(harness.state.messages, 'think-1');
  harness.send(makeQueryCommand('think-2', descriptor, { maxThinkingTokens: 20000, resume: 'session-1' }));
  await waitForDone(harness.state.messages, 'think-2');
  assert.equal(harness.state.queryCalls, 2);
  assert.equal(harness.state.closeCalls, 1);
});
```

- [ ] **Step 2: Run tests and verify the model/fallback failures**

Run:

```powershell
node --test tests/desktop-daemon-persistent-runtime.test.mjs tests/desktop-daemon-persistent-runtime-behavior.test.mjs tests/query-options.test.mjs
```

Expected: FAIL because generic reuse still contains `setModel`, and absent `setMaxThinkingTokens` is silently skipped.

- [ ] **Step 3: Remove generic live model switching and return a thinking rebuild signal**

```js
async function applyDynamicControls(currentRuntime, options = {}) {
  if (!currentRuntime || currentRuntime.closed) return { requiresRebuild: false };

  const targetPermissionMode = normalizePermissionMode(options.permissionMode || 'default');
  await setRuntimePermissionMode(currentRuntime, targetPermissionMode);

  const targetMaxThinkingTokens = options.maxThinkingTokens ?? null;
  if (currentRuntime.currentMaxThinkingTokens === targetMaxThinkingTokens) {
    return { requiresRebuild: false };
  }
  if (typeof currentRuntime.query?.setMaxThinkingTokens !== 'function') {
    return { requiresRebuild: true, reason: 'thinking-control-unavailable' };
  }
  try {
    await currentRuntime.query.setMaxThinkingTokens(targetMaxThinkingTokens);
    currentRuntime.currentMaxThinkingTokens = targetMaxThinkingTokens;
    return { requiresRebuild: false };
  } catch {
    return { requiresRebuild: true, reason: 'thinking-control-failed' };
  }
}
```

In `ensureRuntime`, if matching identity returns `requiresRebuild`, close once and continue through the normal creation block with the same complete options and descriptor. Do not recursively call `ensureRuntime`.

- [ ] **Step 4: Run focused behavior tests**

Run:

```powershell
node --test tests/desktop-daemon-persistent-runtime.test.mjs tests/desktop-daemon-persistent-runtime-behavior.test.mjs tests/query-options.test.mjs
```

Expected: PASS; same model does not call `setModel`, a route change rebuilds through the signature, and unsupported thinking still takes effect through a single pre-turn rebuild.

- [ ] **Step 5: Commit dynamic-control corrections**

```powershell
git add desktop/daemon/ccnexus-daemon.js tests/desktop-daemon-persistent-runtime.test.mjs tests/desktop-daemon-persistent-runtime-behavior.test.mjs tests/query-options.test.mjs
git commit -m "fix: align model and thinking runtime controls"
```

---

### Task 5: Make History Loading Strictly Read-Only

**Files:**
- Modify: `desktop/runtime/sessionController.js:1-24`
- Modify: `tests/desktop-session-controller.test.mjs`
- Modify: `tests/process-management.test.mjs`
- Test: `tests/desktop-session-ipc.test.mjs`

**Interfaces:**
- Produces: `createDesktopSessionController({ sessions }).loadSession(sessionId)` with no runtime dependency.
- Preserves: returned `session_history` shape and all history/search behavior.
- Daemon creation remains in chat send, `/context`, and explicit process operations only.

- [ ] **Step 1: Change the session-controller test to require zero daemon starts**

```js
test('loading one or many histories never starts a daemon', async () => {
  let daemonStarts = 0;
  const controller = createDesktopSessionController({
    runtime: { ensureSessionDaemon() { daemonStarts += 1; } },
    sessions: {
      async loadSession(sessionId) {
        return { type: 'session_history', sessionId, messages: [] };
      },
    },
  });

  await Promise.all(['session-1', 'session-2', 'session-3'].map(id => controller.loadSession(id)));
  assert.equal(daemonStarts, 0);
});
```

Update `process-management.test.mjs` so it still requires idle daemons to remain after a real query, but no longer expects `loadSession` to create them.

- [ ] **Step 2: Run history/process tests and verify failure**

Run:

```powershell
node --test tests/desktop-session-controller.test.mjs tests/desktop-session-ipc.test.mjs tests/process-management.test.mjs
```

Expected: FAIL with `daemonStarts === 3` under the current eager-load behavior.

- [ ] **Step 3: Remove daemon activation from history loading**

Reduce `sessionController` to:

```js
export function createDesktopSessionController({ sessions }) {
  async function loadSession(sessionId) {
    return sessions.loadSession(sessionId);
  }
  return { loadSession };
}
```

Keep the accepted `runtime` property at call sites if removing it would cause unrelated churn, but do not invoke it. Remove the now-unused `titleFromMessages` helper.

- [ ] **Step 4: Run history, process, and chat regressions**

Run:

```powershell
node --test tests/desktop-session-controller.test.mjs tests/desktop-session-ipc.test.mjs tests/process-management.test.mjs tests/desktop-chat-ipc.test.mjs
```

Expected: PASS; N history loads create zero daemons, while the first real chat still registers a daemon and process snapshot.

- [ ] **Step 5: Commit read-only history loading**

```powershell
git add desktop/runtime/sessionController.js tests/desktop-session-controller.test.mjs tests/process-management.test.mjs
git commit -m "fix: keep history loading daemon-free"
```

---

### Task 6: Add Pure Retirement Policy and Daemon-Side Safe Retirement

**Files:**
- Create: `desktop/runtime/runtimeLifecyclePolicy.js`
- Create: `tests/runtime-lifecycle-policy.test.mjs`
- Modify: `desktop/daemon/ccnexus-daemon.js:1-700`
- Modify: `tests/desktop-daemon-persistent-runtime-behavior.test.mjs`

**Interfaces:**
- Produces constants `SESSION_RUNTIME_MAX_IDLE_MS`, `RUNTIME_MAX_ABSOLUTE_LIFETIME_MS`, `RUNTIME_CLEANUP_INTERVAL_MS`.
- Produces `decideRuntimeRetirement(status, now, overrides?) -> { action, reason }` where action is `keep`, `retire-now`, or `retire-after-turn`.
- Produces daemon methods `status` with structured lifecycle data and `retire` with safe deferred exit.

- [ ] **Step 1: Write fake-clock policy tests**

```js
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  decideRuntimeRetirement,
  RUNTIME_MAX_ABSOLUTE_LIFETIME_MS,
  SESSION_RUNTIME_MAX_IDLE_MS,
} from '../desktop/runtime/runtimeLifecyclePolicy.js';

function idleStatus(overrides = {}) {
  return {
    daemonStartedAt: 0,
    daemonLastUsedAt: 0,
    activeRequestId: null,
    pendingControlCount: 0,
    runtime: {
      createdAt: 0,
      lastUsedAt: 0,
      activeTurnCount: 0,
      closed: false,
    },
    ...overrides,
  };
}

test('does not retire before 30 minutes and retires at the boundary', () => {
  assert.equal(decideRuntimeRetirement(idleStatus(), SESSION_RUNTIME_MAX_IDLE_MS - 1).action, 'keep');
  assert.deepEqual(decideRuntimeRetirement(idleStatus(), SESSION_RUNTIME_MAX_IDLE_MS), {
    action: 'retire-now',
    reason: 'idle',
  });
});

test('six-hour active runtime retires only after the turn', () => {
  const status = idleStatus({
    activeRequestId: 'turn-1',
    runtime: { createdAt: 0, lastUsedAt: RUNTIME_MAX_ABSOLUTE_LIFETIME_MS, activeTurnCount: 1, closed: false },
  });
  assert.deepEqual(decideRuntimeRetirement(status, RUNTIME_MAX_ABSOLUTE_LIFETIME_MS), {
    action: 'retire-after-turn',
    reason: 'absolute-lifetime',
  });
});

test('permission and queued context block idle retirement', () => {
  const status = idleStatus({ pendingControlCount: 2 });
  assert.equal(decideRuntimeRetirement(status, SESSION_RUNTIME_MAX_IDLE_MS).action, 'keep');
});
```

- [ ] **Step 2: Run policy tests and verify missing-module failure**

Run:

```powershell
node --test tests/runtime-lifecycle-policy.test.mjs
```

Expected: FAIL with `ERR_MODULE_NOT_FOUND`.

- [ ] **Step 3: Implement policy with blockers before absolute retirement**

```js
export const SESSION_RUNTIME_MAX_IDLE_MS = 30 * 60 * 1000;
export const RUNTIME_MAX_ABSOLUTE_LIFETIME_MS = 6 * 60 * 60 * 1000;
export const RUNTIME_CLEANUP_INTERVAL_MS = 5 * 60 * 1000;

export function decideRuntimeRetirement(status, now = Date.now(), overrides = {}) {
  const idleMs = overrides.idleMs ?? SESSION_RUNTIME_MAX_IDLE_MS;
  const absoluteMs = overrides.absoluteMs ?? RUNTIME_MAX_ABSOLUTE_LIFETIME_MS;
  const current = status?.runtime || null;
  const blocked = Boolean(status?.activeRequestId)
    || Number(status?.pendingControlCount || 0) > 0
    || Number(current?.activeTurnCount || 0) > 0;

  if (!current) {
    if (blocked) return { action: 'keep', reason: 'active' };
    return now - Number(status?.daemonLastUsedAt ?? status?.daemonStartedAt ?? now) >= idleMs
      ? { action: 'retire-now', reason: 'empty-idle' }
      : { action: 'keep', reason: 'within-idle-window' };
  }

  if (current.closed) return { action: 'retire-now', reason: 'runtime-closed' };

  if (now - current.createdAt >= absoluteMs) {
    return blocked
      ? { action: 'retire-after-turn', reason: 'absolute-lifetime' }
      : { action: 'retire-now', reason: 'absolute-lifetime' };
  }
  if (blocked) return { action: 'keep', reason: 'active' };
  return now - current.lastUsedAt >= idleMs
    ? { action: 'retire-now', reason: 'idle' }
    : { action: 'keep', reason: 'within-idle-window' };
}
```

- [ ] **Step 4: Add failing daemon retirement tests**

Create one test with a gated turn, send `retire`, assert no close/exit before releasing the turn, then assert close/exit afterward. Add another status test asserting:

```js
assert.equal(status.result.runtime.closed, false);
assert.equal(typeof status.result.runtime.createdAt, 'number');
assert.equal(typeof status.result.runtime.lastUsedAt, 'number');
assert.equal(status.result.runtime.activeTurnCount, 1);
assert.equal(status.result.runtime.runtimeSessionEpoch, 'epoch-retire');
assert.equal(status.result.pendingControlCount, 0);
```

- [ ] **Step 5: Implement daemon lifecycle status and deferred retirement**

Add process-level state:

```js
const daemonStartedAt = Date.now();
let daemonLastUsedAt = daemonStartedAt;
let retireAfterTurn = false;
let retirementStarted = false;
```

Add `touchDaemon()` and extend the existing `touchRuntime()` so real activity updates both timestamps. Invoke it on query start, each SDK event, turn completion/error/abort, permission and plan responses, successful dynamic controls, and completed `/context`. Do not invoke it for heartbeat, status, cleanup scans, history reads, or renderer-only session selection.

Return status containing daemon timestamps, runtime timestamps, `activeTurnCount`, epoch, and a `pendingControlCount` computed from queued/running context requests, permissions, and plan approvals.

Implement:

```js
async function maybeFinishRetirement() {
  if (!retireAfterTurn || retirementStarted) return;
  const pendingControlCount = pendingContextUsage.length
    + (contextUsageRunning ? 1 : 0)
    + pendingPermissions.size
    + pendingPlanApprovals.size;
  if (activeRequestId || pendingControlCount > 0 || (runtime?.activeTurnCount || 0) > 0) return;
  retirementStarted = true;
  await closeRuntime();
  sendDaemonEvent('retired');
  process.exit(0);
}

async function runRetire(id, params = {}) {
  retireAfterTurn = true;
  reply(id, { result: { scheduled: true, reason: params.reason || 'lifecycle' } });
  setTimeout(() => { void maybeFinishRetirement(); }, 0);
}
```

Call `maybeFinishRetirement()` after turn cleanup and context-queue drain. New query/context commands received after retirement is scheduled return a structured `DAEMON_RETIRING` error rather than starting work on the closing generation.

- [ ] **Step 6: Run policy and daemon behavior tests**

Run:

```powershell
node --test tests/runtime-lifecycle-policy.test.mjs tests/desktop-daemon-persistent-runtime-behavior.test.mjs
```

Expected: PASS; six-hour active work is not interrupted, idle retirement closes once, and status/heartbeat do not update last-used timestamps.

- [ ] **Step 7: Commit retirement policy and daemon gate**

```powershell
git add desktop/runtime/runtimeLifecyclePolicy.js desktop/daemon/ccnexus-daemon.js tests/runtime-lifecycle-policy.test.mjs tests/desktop-daemon-persistent-runtime-behavior.test.mjs
git commit -m "feat: add safe runtime retirement policy"
```

---

### Task 7: Coordinate Host Cleanup, Exit Removal, and Transparent Reacquisition

**Files:**
- Create: `tests/desktop-runtime-lifecycle.test.mjs`
- Modify: `desktop/runtime/index.js:1-250`
- Modify: `desktop/runtime/daemonBridge.js:65-410`
- Modify: `desktop/runtime/processRegistry.js:1-220`
- Modify: `tests/desktop-runtime.test.mjs`
- Modify: `tests/process-management.test.mjs`

**Interfaces:**
- Consumes: `decideRuntimeRetirement` and constants from Task 6.
- Produces: `DaemonBridge.retire(reason)`, `DaemonBridge.waitForExit()`, and structured daemon errors with `error.code`.
- Produces: runtime method `scanRuntimeLifecycle(now?) -> Promise<void>` for deterministic tests and timer reuse.
- Produces: registry lifecycle states `starting`, `running`, `retiring`, `stopping`, `stopped`.
- Guarantees: requests arriving during retirement wait for a new generation instead of using a closing bridge.

- [ ] **Step 1: Write fake-bridge host lifecycle tests**

Use an injected bridge factory and fake clock:

```js
class FakeBridge extends EventEmitter {
  constructor({ status }) {
    super();
    this.runtimeSessionEpoch = `epoch-${FakeBridge.instances.length + 1}`;
    this.bridgeIdentity = `bridge-${FakeBridge.instances.length + 1}`;
    this.statusValue = status;
    this.retireCalls = [];
    this.exitPromise = new Promise(resolve => { this.resolveExit = resolve; });
    FakeBridge.instances.push(this);
  }
  start() { return Promise.resolve(); }
  status() { return Promise.resolve(this.statusValue); }
  retire(reason) {
    this.retireCalls.push(reason);
    return Promise.resolve({ scheduled: true, reason });
  }
  waitForExit() { return this.exitPromise; }
  finishExit() { this.emit('exit', { code: 0, signal: null }); this.resolveExit(); }
  getProcessForInspection() { return { pid: 1000 + FakeBridge.instances.length, killed: false, spawnargs: [] }; }
}
FakeBridge.instances = [];
```

Cover these scenarios:

1. 29:59 scan does not call `retire`.
2. 30:00 scan calls `retire('idle')` once.
3. Six-hour active status calls `retire('absolute-lifetime')`, then a new acquisition waits until `finishExit()` and receives a different bridge/epoch.
4. A stale old-bridge exit cannot remove the new bridge.
5. `shutdown()` clears the cleanup timer and all pending retirement records.

- [ ] **Step 2: Run lifecycle tests and verify missing hooks**

Run:

```powershell
node --test tests/desktop-runtime-lifecycle.test.mjs tests/desktop-runtime.test.mjs tests/process-management.test.mjs
```

Expected: FAIL because bridge-factory injection, lifecycle scans, retirement methods, and lifecycle states do not exist.

- [ ] **Step 3: Add bridge exit waiting, structured errors, and retirement**

In `DaemonBridge.start`, create an exit promise before spawning and settle it in the existing `exit` handler. Add:

```js
waitForExit() {
  return this.exitPromise || Promise.resolve();
}

async retire(reason) {
  const messages = await this.sendCommand('retire', { reason }, { countsAsActive: false });
  return messages.at(-1)?.result || { scheduled: true, reason };
}
```

Change `DaemonBridge.status()` to unwrap and return the final message's `result`, just like `getContextUsage()`. When a daemon reply contains `success: false`, copy `message.code` to the rejected Error. Keep existing shutdown escalation and Windows process-tree behavior unchanged.

- [ ] **Step 4: Add registry lifecycle state helpers**

Add exact bridge-aware methods:

```js
getSessionDaemon(sessionId) {
  return this.sessionDaemons.get(sessionId) || null;
}

markSessionDaemonState(sessionId, bridge, state) {
  const daemon = this.sessionDaemons.get(sessionId);
  if (!daemon || daemon.bridge !== bridge) return false;
  daemon.lifecycleState = state;
  return true;
}

removeSessionDaemonIfBridge(sessionId, bridge) {
  const daemon = this.sessionDaemons.get(sessionId);
  if (!daemon || daemon.bridge !== bridge) return false;
  this.sessionDaemons.delete(sessionId);
  return true;
}
```

Initialize new records with `lifecycleState: 'starting'`, then mark `running` after bridge readiness. Include lifecycle state and epoch in process snapshots without exposing secrets.

- [ ] **Step 5: Implement per-session transition locking and cleanup scans**

In `createDesktopRuntime`, inject `bridgeFactory`, `now`, `setIntervalFn`, and `clearIntervalFn` for tests while defaulting to `new DaemonBridge`, `Date.now`, global `setInterval`, and global `clearInterval`. Maintain:

```js
const retiringBySession = new Map();
const transitionTails = new Map();
let cleanupTimer = null;

function withSessionTransition(sessionId, operation) {
  const previous = transitionTails.get(sessionId) || Promise.resolve();
  const current = previous.catch(() => {}).then(operation);
  const tail = current.finally(() => {
    if (transitionTails.get(sessionId) === tail) transitionTails.delete(sessionId);
  });
  transitionTails.set(sessionId, tail);
  return current;
}
```

Use the transition lock for query/context bridge acquisition and retirement scheduling. Before creating a bridge, await `retiringBySession.get(sessionId)`. Register one `exit` listener that looks up the bridge's current adopted session ID and only removes matching map/registry entries.

Implement `scanRuntimeLifecycle(now = clock())` by querying all bridge statuses with `Promise.allSettled`, calling `decideRuntimeRetirement`, and scheduling `bridge.retire(reason)` only for `retire-now` or `retire-after-turn`. A rejected or malformed status means keep the runtime for this scan.

Start the 5-minute timer lazily when the first session bridge is created; call `unref()`. Clear it during `shutdown()`.

- [ ] **Step 6: Preserve adoption and transparent reacquisition**

When a pending session ID is promoted to the SDK session ID, move bridge ownership, transition metadata, retirement tracking, and non-secret profile together. `queryClaude` and `getContextUsage` must acquire a non-retiring bridge before sending. If the daemon still returns `DAEMON_RETIRING` in the narrow race window, await exit and retry acquisition once; never retry arbitrary SDK/API errors.

- [ ] **Step 7: Run lifecycle, process, persistent-query, and IPC tests**

Run:

```powershell
node --test tests/runtime-lifecycle-policy.test.mjs tests/desktop-runtime-lifecycle.test.mjs tests/desktop-runtime.test.mjs tests/process-management.test.mjs tests/desktop-daemon-persistent-runtime-behavior.test.mjs tests/desktop-chat-ipc.test.mjs
```

Expected: PASS; retirement happens once, active work completes, new requests obtain a fresh epoch, and process snapshots contain no stale daemon after exit.

- [ ] **Step 8: Commit host lifecycle coordination**

```powershell
git add desktop/runtime/index.js desktop/runtime/daemonBridge.js desktop/runtime/processRegistry.js tests/desktop-runtime-lifecycle.test.mjs tests/desktop-runtime.test.mjs tests/process-management.test.mjs
git commit -m "feat: coordinate daemon retirement and recovery"
```

---

### Task 8: Codify Cache Boundaries and Run Full Compatibility Verification

**Files:**
- Modify: `.agents/AGENTS.md:113-120`
- Modify only if a discovered regression requires it: the focused tests/files from Tasks 1–7; do not add unrelated refactors.

**Interfaces:**
- Produces: repository rules that explicitly permit only 30-minute idle and safe post-turn 6-hour retirement as timer-based exceptions.
- Produces: final evidence for persistent-query reuse, cold/warm classification, full feature compatibility, types, and build.

- [ ] **Step 1: Update persistent-query rules with exact approved exceptions**

Add these exact rules:

```markdown
- Timer-based runtime retirement is allowed only after 30 minutes of true session inactivity or after 6 hours of runtime lifetime. Six-hour retirement must wait for the active turn and queued control work to finish.
- A request after approved retirement is a cold request and must be reported separately. Outside approved retirement and existing hard identity/error boundaries, an unchanged session must keep the same SDK query.
- History loading and search must not start a daemon or SDK query. `/context` must queue behind its session's active turn and must use a read-only fast path when model route, `[1m]`, and epoch still match.
```

- [ ] **Step 2: Run the cache-focused suite**

Run:

```powershell
node --test tests/context-usage.test.mjs tests/claude-history.test.mjs tests/assistant-turn.test.mjs tests/desktop-daemon-persistent-runtime.test.mjs tests/desktop-daemon-persistent-runtime-behavior.test.mjs tests/query-options.test.mjs tests/desktop-usage-statistics.test.mjs tests/runtime-identity.test.mjs tests/runtime-lifecycle-policy.test.mjs tests/desktop-runtime-lifecycle.test.mjs
```

Expected: PASS. Inspect assertions to confirm same-identity turns and `/context` use one query factory call, while post-retirement reconstruction uses exactly one new query and a new epoch.

- [ ] **Step 3: Run process, session, permission, and desktop regressions**

Run:

```powershell
node --test tests/process-management.test.mjs tests/desktop-runtime.test.mjs tests/desktop-session-controller.test.mjs tests/desktop-session-ipc.test.mjs tests/desktop-chat-ipc.test.mjs tests/chat-view-session-restore.test.mjs tests/chat-input-box-parity.test.mjs
```

Expected: PASS; history/search spawn zero daemons, process stop/restart still works, and all context UI/IPC calls remain available.

- [ ] **Step 4: Run the repository-required full verification**

Run:

```powershell
npm.cmd run test:protocol
npx.cmd tsc --noEmit
npm.cmd run build
git diff --check
```

Expected: all commands exit 0. Do not claim completion if any command is skipped or fails.

- [ ] **Step 5: Perform a real desktop smoke test**

Using ccNexus in the current workspace:

1. Start one normal session and send two short turns; confirm the second is warm using raw assistant usage.
2. During a long/gated turn, submit `/context`; confirm the Agent completes first, then context usage appears without a restart/error.
3. Switch normal → `[1m]` and `[1m]` → normal; confirm the switch waits for an active turn and the displayed context limit follows the selected mode.
4. Exercise Agent selection, MCP tool use, plan approval, AskUserQuestion, permission mode, thinking, streaming, abort, and session resume once.
5. Use an injected/fake-clock automated lifecycle test for 30 minutes and 6 hours; do not wait in real time.
6. Confirm post-retirement first request is reported as cold and the following unchanged request can become warm.
7. Confirm two sessions can run independently; no global queue blocks the second session.

Read cache values from raw Claude assistant usage and calculate:

```text
cache_read_input_tokens /
(input_tokens + cache_creation_input_tokens + cache_read_input_tokens)
```

Do not use `result.usage` as the authoritative source.

- [ ] **Step 6: Commit rules and any verification-only test corrections**

```powershell
git add .agents/AGENTS.md
git commit -m "docs: codify runtime retirement boundaries"
```

- [ ] **Step 7: Record final evidence in the implementation handoff**

Report:

- each command and exit result;
- query creation counts for same-runtime turns, `/context`, and post-retirement resume;
- cold/warm raw assistant usage separately;
- 30-minute and 6-hour fake-clock outcomes;
- confirmation that history deep search created zero daemons;
- any remaining external limitation, such as provider cache TTL, without presenting it as a ccNexus guarantee.

Do not create an extra report file unless the user asks; keep this evidence in the final implementation handoff.
