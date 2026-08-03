import test from 'node:test';
import assert from 'node:assert/strict';
import { createInboundMessageQueue, createOutboundMessageQueue } from '../src/hooks/desktopMessageQueue.js';

test('queues commands sent before the desktop event channel is ready and flushes them in order', () => {
  const delivered = [];
  const queue = createOutboundMessageQueue((message) => delivered.push(message));

  queue.send({ type: 'get_sessions' }, false);
  queue.send({ type: 'chat', text: 'hello' }, false);

  assert.equal(queue.size(), 2);
  assert.deepEqual(delivered, []);

  queue.flush();

  assert.deepEqual(delivered, [
    { type: 'get_sessions' },
    { type: 'chat', text: 'hello' },
  ]);
  assert.equal(queue.size(), 0);
});

test('sends immediately after the desktop event channel is ready', () => {
  const delivered = [];
  const queue = createOutboundMessageQueue((message) => delivered.push(message));

  queue.send({ type: 'get_sessions' }, true);

  assert.deepEqual(delivered, [{ type: 'get_sessions' }]);
  assert.equal(queue.size(), 0);
});

test('keeps rapid incoming desktop events in order until the view consumes them', () => {
  const queue = createInboundMessageQueue();

  queue.push({ type: 'assistant', message: { id: 'a1', content: [{ type: 'text', text: 'done' }] } });
  queue.push({ type: 'result', is_error: false });
  queue.push({ type: 'status', status: 'idle' });

  assert.deepEqual(queue.consumeFrom(0), {
    messages: [
      { type: 'assistant', message: { id: 'a1', content: [{ type: 'text', text: 'done' }] } },
      { type: 'result', is_error: false },
      { type: 'status', status: 'idle' },
    ],
    nextCursor: 3,
  });
  assert.deepEqual(queue.consumeFrom(3), { messages: [], nextCursor: 3 });
});
