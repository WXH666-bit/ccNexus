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

test('complete keeps thinking streamed before the terminal assistant event', () => {
  const turn = createAssistantTurn();
  turn.addStreamEvent({ type: 'content_block_start', index: 0, content_block: { type: 'thinking' } });
  turn.addStreamEvent({ type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: 'Check assumptions. ' } });
  turn.addStreamEvent({ type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: 'Then answer.' } });
  turn.add({ content: [{ type: 'text', text: 'Final answer' }] });

  assert.deepEqual(turn.complete({ id: 'final-id', sessionId: 'session-1' }).content, [
    { type: 'thinking', thinking: 'Check assumptions. Then answer.' },
    { type: 'text', text: 'Final answer' },
  ]);
});

test('complete preserves the native stream order across thinking, tools, and text', () => {
  const turn = createAssistantTurn();
  turn.addStreamEvent({ type: 'content_block_start', index: 0, content_block: { type: 'thinking' } });
  turn.addStreamEvent({ type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: 'Inspect the task.' } });
  turn.addStreamEvent({ type: 'content_block_start', index: 1, content_block: { type: 'tool_use', id: 'read-1', name: 'Read' } });
  turn.addStreamEvent({ type: 'content_block_delta', index: 1, delta: { type: 'input_json_delta', partial_json: '{"file_path":"package.json"}' } });
  turn.addStreamEvent({ type: 'content_block_start', index: 0, content_block: { type: 'thinking' } });
  turn.addStreamEvent({ type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: 'Use the package name.' } });
  turn.addStreamEvent({ type: 'content_block_start', index: 1, content_block: { type: 'text' } });
  turn.addStreamEvent({ type: 'content_block_delta', index: 1, delta: { type: 'text_delta', text: 'ccnexus' } });
  turn.add({ content: [{ type: 'text', text: 'ccnexus' }] });

  assert.deepEqual(turn.complete({ id: 'final-id', sessionId: 'session-1' }).content, [
    { type: 'thinking', thinking: 'Inspect the task.' },
    { type: 'tool_use', id: 'read-1', name: 'Read', input: { file_path: 'package.json' } },
    { type: 'thinking', thinking: 'Use the package name.' },
    { type: 'text', text: 'ccnexus' },
  ]);
});

test('complete keeps tool_result blocks with their matching tool_use for live and history replay', () => {
  const turn = createAssistantTurn();
  turn.addStreamEvent({ type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: 'read-1', name: 'Read' } });
  turn.addStreamEvent({ type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: '{"file_path":"package.json"}' } });
  turn.addToolResult({ type: 'tool_result', tool_use_id: 'read-1', content: 'package contents', is_error: false });
  turn.add({ content: [{ type: 'text', text: 'Done' }] });

  assert.deepEqual(turn.complete({ id: 'final-id', sessionId: 'session-1' }).content, [
    { type: 'tool_use', id: 'read-1', name: 'Read', input: { file_path: 'package.json' } },
    { type: 'tool_result', tool_use_id: 'read-1', content: 'package contents', is_error: false },
    { type: 'text', text: 'Done' },
  ]);
});
