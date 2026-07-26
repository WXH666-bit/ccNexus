# Chat Protocol Closure Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make one ccNexus chat turn reliably deliver streaming SDK events, a final assistant message, permissions, cancellation, and a session ID to the React client.

**Architecture:** Add a small server-side protocol factory that emits browser-facing events with one stable schema. Keep the SDK integration in `server/index.js`, but route each SDK event through the factory. The React types and WebSocket hook consume the same field names, and the hook queues messages until its socket is open.

**Tech Stack:** Node.js ESM, `node:test`, Express, ws, Claude Agent SDK, React 19, TypeScript.

## Global Constraints

- Scope is limited to the first chat-loop milestone defined in `docs/superpowers/specs/2026-07-26-chat-protocol-design.md`.
- Do not implement session history persistence, workspace selection, attachments, MCP, Skills, or settings behavior in this plan.
- Preserve the existing public `/api/*` routes.
- Use `sessionId` in all new client/server WebSocket payloads.
- Keep `.agents/`, `.claude/`, and `_ccgui/` out of commits.

---

### Task 1: Define and test browser-facing protocol events

**Files:**
- Create: `server/protocol.js`
- Create: `tests/chat-protocol.test.mjs`
- Modify: `package.json`

**Interfaces:**
- Produces `sessionEvent(sessionId)`, `streamEvent(event, sessionId, uuid)`, `assistantEvent(message)`, and `permissionRequestEvent(request)`.
- Consumes raw SDK event fields: `event.session_id`, `event.uuid`, `event.message.content`, and tool permission input.
- Later tasks import these factories from `server/protocol.js`.

- [ ] **Step 1: Write failing protocol tests**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  assistantEvent,
  permissionRequestEvent,
  sessionEvent,
  streamEvent,
} from '../server/protocol.js';

test('assistantEvent wraps the complete message under message', () => {
  assert.deepEqual(assistantEvent({ id: 'a1', content: [{ type: 'text', text: 'Hi' }], sessionId: 's1' }), {
    type: 'assistant',
    message: { id: 'a1', content: [{ type: 'text', text: 'Hi' }], sessionId: 's1' },
  });
});

test('permissionRequestEvent preserves the request id expected by the client', () => {
  assert.deepEqual(permissionRequestEvent({ requestId: 'p1', toolName: 'Edit', input: { file_path: 'a.ts' } }), {
    type: 'permission_request', requestId: 'p1', toolName: 'Edit', input: { file_path: 'a.ts' },
  });
});

test('sessionEvent and streamEvent preserve camel-case session ids', () => {
  assert.equal(sessionEvent('s1').sessionId, 's1');
  assert.deepEqual(streamEvent({ type: 'content_block_delta' }, 's1', 'u1'), {
    type: 'stream_event', event: { type: 'content_block_delta' }, sessionId: 's1', uuid: 'u1',
  });
});
```

- [ ] **Step 2: Run the test to verify failure**

Run: `node --test tests/chat-protocol.test.mjs`

Expected: FAIL because `server/protocol.js` does not exist.

- [ ] **Step 3: Implement the minimal event factory**

```js
export const sessionEvent = (sessionId) => ({ type: 'session', sessionId });

export const streamEvent = (event, sessionId, uuid) => ({
  type: 'stream_event', event, sessionId, uuid,
});

export const assistantEvent = ({ id, content, sessionId, model, cost, duration, turns }) => {
  const message = { id, content, sessionId };
  if (model !== undefined) message.model = model;
  if (cost !== undefined) message.cost = cost;
  if (duration !== undefined) message.duration = duration;
  if (turns !== undefined) message.turns = turns;
  return { type: 'assistant', message };
};

export const permissionRequestEvent = ({ requestId, toolName, input, title, displayName }) => {
  const event = { type: 'permission_request', requestId, toolName, input };
  if (title !== undefined) event.title = title;
  if (displayName !== undefined) event.displayName = displayName;
  return event;
};
```

- [ ] **Step 4: Add a deterministic test command and verify it passes**

Add this script to `package.json`:

```json
"test:protocol": "node --test"
```

Run: `pnpm run test:protocol`

Expected: all three tests PASS.

- [ ] **Step 5: Commit the protocol foundation**

```bash
git add package.json server/protocol.js tests/chat-protocol.test.mjs
git commit -m "test: define chat protocol events"
```

### Task 2: Adapt the Express bridge to the protocol

**Files:**
- Modify: `server/index.js:1-20, 134-160, 855-1159`
- Test: `tests/chat-protocol.test.mjs`

**Interfaces:**
- Consumes factories exported by `server/protocol.js`.
- Consumes client messages with `sessionId`, `requestId`, and `allow`.
- Produces `session`, `stream_event`, `assistant`, `permission_request`, `status`, `result`, and `error` events.

- [ ] **Step 1: Extend tests with the event shapes used by the bridge**

```js
test('assistantEvent carries model and terminal metadata inside message', () => {
  const event = assistantEvent({ id: 'a1', content: [], sessionId: 's1', model: 'claude', cost: 0.01, duration: 12, turns: 1 });
  assert.equal(event.message.model, 'claude');
  assert.equal(event.message.cost, 0.01);
  assert.equal(event.message.duration, 12);
  assert.equal(event.message.turns, 1);
});
```

- [ ] **Step 2: Run the protocol suite to verify the new assertion fails**

Run: `pnpm run test:protocol`

Expected: FAIL until `assistantEvent` returns each metadata field inside `message`.

- [ ] **Step 3: Route server WebSocket output through the factories**

At the top of `server/index.js`, import the factories:

```js
import { assistantEvent, permissionRequestEvent, sessionEvent, streamEvent } from './protocol.js';
```

Replace raw output construction with these calls:

```js
ws.send(JSON.stringify(sessionEvent(currentSessionId)));
ws.send(JSON.stringify(streamEvent(event.event, event.session_id, event.uuid)));
ws.send(JSON.stringify(assistantEvent({
  id: event.uuid || `msg-${Date.now()}`,
  content,
  sessionId: event.session_id,
  model: event.message?.model,
})));
```

Read chat input and permission input using the canonical names:

```js
const { text, images, sessionId, options: clientOptions } = msg;
const { requestId, allow, message } = msg;
```

Use `permissionRequestEvent(...)` inside `createPermissionHandler`. Keep `images` outside this milestone.

- [ ] **Step 4: Isolate query ownership per WebSocket client**

Inside the connection callback, add `const ownedQueries = new Map();`. When a session ID is established, add its query to both `activeQueries` and `ownedQueries`. In `abort`, resolve the query from `ownedQueries`. In `close`, close and delete only entries in `ownedQueries`.

```js
for (const [sessionId, query] of ownedQueries) {
  try { query.close(); } catch { /* ignore */ }
  activeQueries.delete(sessionId);
}
ownedQueries.clear();
```

- [ ] **Step 5: Verify the bridge and commit**

Run:

```bash
node --check server/index.js
pnpm run test:protocol
```

Expected: syntax check exits 0 and all protocol tests PASS.

```bash
git add server/index.js server/protocol.js tests/chat-protocol.test.mjs
git commit -m "fix: align websocket bridge protocol"
```

### Task 3: Align React message types and ChatView handlers

**Files:**
- Modify: `src/types.ts:54-72`
- Modify: `src/views/ChatView.tsx:199-405, 420-531`
- Test: `tests/chat-protocol.test.mjs`

**Interfaces:**
- Consumes server events defined in Task 1.
- Produces client `chat`, `permission_response`, and `abort` messages using canonical camel-case fields.
- Produces visible assistant and permission UI state from `assistant` and `permission_request` events.

- [ ] **Step 1: Add compile-time discriminated event types before changing handlers**

Replace the mismatched members with these shapes:

```ts
| { type: 'session'; sessionId: string }
| { type: 'stream_event'; event: unknown; sessionId?: string; uuid?: string }
| { type: 'assistant'; message: { id: string; content: ContentBlock[]; model?: string; sessionId?: string; cost?: number; duration?: number; turns?: number } }
| { type: 'permission_request'; requestId: string; toolName: string; input: Record<string, unknown>; title?: string; displayName?: string }
| { type: 'status'; status: 'thinking' | 'idle' }
| { type: 'result'; subtype: string; duration?: number; cost?: number; turns?: number; is_error?: boolean; sessionId?: string }
```

- [ ] **Step 2: Run TypeScript before updating ChatView**

Run: `pnpm exec tsc --noEmit`

Expected: FAIL at the stale `permission`, `permission_id`, `session_id`, and `status.subtype` usages.

- [ ] **Step 3: Update ChatView to use the canonical events**

Change outgoing payloads and cases to these forms:

```ts
send({ type: 'chat', text: text.trim(), sessionId: currentSession?.id, images: attachments, options: { reasoning: reasoningEffort || reasoning, streaming, alwaysThinking } });
send({ type: 'permission_response', requestId, allow: behavior !== 'deny' });

case 'permission_request':
  setPermission({ permission_id: msg.requestId, tool_name: msg.toolName, input: msg.input });
  break;
```

Handle `session` by creating/updating a `Session` entry and navigating to `/chat/${sessionId}` only when there is no active current session. Keep the existing stream block logic, which now receives the matching `stream_event` type.

- [ ] **Step 4: Run compile and protocol tests**

Run:

```bash
pnpm exec tsc --noEmit
pnpm run test:protocol
```

Expected: both commands exit 0.

- [ ] **Step 5: Commit the React protocol alignment**

```bash
git add src/types.ts src/views/ChatView.tsx
git commit -m "fix: consume canonical chat websocket events"
```

### Task 4: Queue pre-connection messages and verify the chat loop

**Files:**
- Modify: `src/hooks/useWebSocket.ts:1-54`
- Modify: `src/views/ChatView.tsx:420-531`
- Test: `tests/chat-protocol.test.mjs`

**Interfaces:**
- `useWebSocket.send(msg)` queues when the socket is connecting and flushes on open.
- `useWebSocket` returns the same public `{ send, lastMessage, connected }` interface.

- [ ] **Step 1: Add a focused queue helper test**

Extract a pure helper to `src/hooks/websocketQueue.mjs` and test it with Node:

```js
import { createMessageQueue } from '../src/hooks/websocketQueue.mjs';

test('queued messages flush in insertion order', () => {
  const queue = createMessageQueue();
  queue.enqueue({ type: 'chat', text: 'first' });
  queue.enqueue({ type: 'chat', text: 'second' });
  assert.deepEqual(queue.drain(), [
    { type: 'chat', text: 'first' },
    { type: 'chat', text: 'second' },
  ]);
});
```

- [ ] **Step 2: Run the test to verify failure**

Run: `pnpm run test:protocol`

Expected: FAIL because `src/hooks/websocketQueue.mjs` does not exist.

- [ ] **Step 3: Implement the queue and integrate it into the hook**

```js
export function createMessageQueue() {
  const items = [];
  return {
    enqueue: (message) => items.push(message),
    drain: () => items.splice(0, items.length),
  };
}
```

In `useWebSocket`, hold this queue in a ref. In `send`, enqueue when `readyState` is not `OPEN`; in `onopen`, serialize and send every item returned by `drain()`. Add a `disposedRef` so the cleanup close callback does not schedule a reconnect after unmount.

- [ ] **Step 4: Verify source and manually exercise the acceptance path**

Run:

```bash
pnpm run test:protocol
pnpm exec tsc --noEmit
node --check server/index.js
```

Then start `pnpm dev`, refresh the browser, immediately send a short prompt, and confirm: session ID arrives, text streams, final response replaces the temporary streaming message, permission allow/deny unblocks the query, and Stop only cancels this browser connection.

- [ ] **Step 5: Commit the connection queue**

```bash
git add src/hooks/useWebSocket.ts src/hooks/websocketQueue.mjs tests/chat-protocol.test.mjs
git commit -m "fix: queue websocket messages before connection"
```

## Self-Review

- Scope coverage: Tasks 1-4 cover the protocol contract, server adapter, React consumer, connection queue, cancellation isolation, and every acceptance criterion in the approved design.
- Placeholder scan: no implementation step relies on an unspecified API or undefined file path.
- Type consistency: all browser-to-server identifiers use `sessionId`; all permission replies use `requestId` and `allow`; final assistant payloads use `message`.
