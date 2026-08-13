import test from 'node:test';
import assert from 'node:assert/strict';
import {
  beginAbortWindow,
  completeAbortWindow,
  createQueuedChatMessage,
  queuedChatMessageToSendArgs,
  shouldQueueChatMessage,
} from '../src/utils/abortWindowState.js';

test('messages remain queued after Stop until the matching idle acknowledgement', () => {
  const stopping = beginAbortWindow('session-a');

  assert.equal(shouldQueueChatMessage({ isStreaming: false, stopping }), true);
  assert.deepEqual(
    completeAbortWindow(stopping, { type: 'status', status: 'idle', sessionId: 'session-a' }),
    stopping,
  );
  assert.deepEqual(
    completeAbortWindow(stopping, {
      type: 'status',
      status: 'idle',
      reason: 'abort-complete',
      sessionId: 'session-b',
    }),
    stopping,
  );
  assert.equal(
    completeAbortWindow(stopping, {
      type: 'status',
      status: 'idle',
      reason: 'abort-complete',
      sessionId: 'session-a',
    }),
    null,
  );
});

test('streaming still queues messages when no abort cleanup is active', () => {
  assert.equal(shouldQueueChatMessage({ isStreaming: true, stopping: null }), true);
  assert.equal(shouldQueueChatMessage({ isStreaming: false, stopping: null }), false);
});

test('queued messages preserve every option needed to replay the original send', () => {
  const queued = createQueuedChatMessage({
    id: 'queued-1',
    text: 'inspect image',
    timestamp: 123,
    attachments: [{ type: 'image/png', data: 'base64-data' }],
    reasoningEffort: 'max',
    agent: 'reviewer',
    streaming: false,
    alwaysThinking: true,
    modelOverride: 'claude-opus-4-6[1m]',
  });

  assert.deepEqual(queuedChatMessageToSendArgs(queued), [
    'inspect image',
    [{ type: 'image/png', data: 'base64-data' }],
    false,
    'max',
    'reviewer',
    false,
    true,
    'claude-opus-4-6[1m]',
  ]);
});
