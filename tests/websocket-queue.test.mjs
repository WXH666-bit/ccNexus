import test from 'node:test';
import assert from 'node:assert/strict';
import { createOutboundMessageQueue } from '../src/hooks/websocketQueue.js';

test('queues messages sent before WebSocket open and flushes them in order', () => {
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

test('sends immediately after the socket is open', () => {
  const delivered = [];
  const queue = createOutboundMessageQueue((message) => delivered.push(message));

  queue.send({ type: 'get_sessions' }, true);

  assert.deepEqual(delivered, [{ type: 'get_sessions' }]);
  assert.equal(queue.size(), 0);
});
