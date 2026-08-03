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
    sessionId: 's1',
    message: { id: 'a1', content: [{ type: 'text', text: 'Hi' }], sessionId: 's1' },
  });
});

test('assistantEvent carries model and terminal metadata inside message', () => {
  const usage = { input_tokens: 10, output_tokens: 2 };
  const event = assistantEvent({
    id: 'a1',
    content: [],
    sessionId: 's1',
    model: 'claude',
    usage,
    cost: 0.01,
    duration: 12,
    turns: 1,
  });

  assert.equal(event.message.model, 'claude');
  assert.equal(event.message.usage, usage);
  assert.equal(event.message.cost, 0.01);
  assert.equal(event.message.duration, 12);
  assert.equal(event.message.turns, 1);
});

test('permissionRequestEvent preserves the request id expected by the client', () => {
  assert.deepEqual(permissionRequestEvent({ requestId: 'p1', toolName: 'Edit', input: { file_path: 'a.ts' } }), {
    type: 'permission_request', requestId: 'p1', toolName: 'Edit', input: { file_path: 'a.ts' },
  });
});

test('permissionRequestEvent preserves optional UI labels', () => {
  assert.deepEqual(permissionRequestEvent({
    requestId: 'p1',
    toolName: 'Edit',
    input: { file_path: 'a.ts' },
    title: 'Edit a.ts',
    displayName: 'Edit',
  }), {
    type: 'permission_request',
    requestId: 'p1',
    toolName: 'Edit',
    input: { file_path: 'a.ts' },
    title: 'Edit a.ts',
    displayName: 'Edit',
  });
});

test('sessionEvent and streamEvent preserve camel-case session ids', () => {
  assert.equal(sessionEvent('s1').sessionId, 's1');
  assert.deepEqual(streamEvent({ type: 'content_block_delta' }, 's1', 'u1'), {
    type: 'stream_event', event: { type: 'content_block_delta' }, sessionId: 's1', uuid: 'u1',
  });
});
