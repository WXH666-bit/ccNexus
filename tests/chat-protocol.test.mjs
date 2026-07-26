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
