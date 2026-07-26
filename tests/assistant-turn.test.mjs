import test from 'node:test';
import assert from 'node:assert/strict';
import { createAssistantTurn } from '../server/assistantTurn.js';

test('complete returns one message containing thinking and text blocks in arrival order', () => {
  const turn = createAssistantTurn();
  turn.add({ content: [{ type: 'thinking', thinking: 'Check the request.' }] });
  turn.add({ content: [{ type: 'text', text: 'Hello' }], model: 'claude-sonnet' });

  assert.deepEqual(turn.complete({ id: 'final-id', sessionId: 'session-1' }), {
    id: 'final-id',
    content: [
      { type: 'thinking', thinking: 'Check the request.' },
      { type: 'text', text: 'Hello' },
    ],
    sessionId: 'session-1',
    model: 'claude-sonnet',
  });
});

test('complete returns null for an empty turn', () => {
  assert.equal(createAssistantTurn().complete({ id: 'final-id', sessionId: 'session-1' }), null);
});
