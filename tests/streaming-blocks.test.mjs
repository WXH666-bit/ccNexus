import test from 'node:test';
import assert from 'node:assert/strict';
import { createStreamingBlockState, applyStreamEventToBlocks, appendToolResultBlock } from '../src/utils/streamingBlocks.js';

test('streaming blocks preserve earlier tool loop blocks when SDK indexes reset', () => {
  const state = createStreamingBlockState();

  applyStreamEventToBlocks(state, { type: 'message_start' });
  applyStreamEventToBlocks(state, { type: 'content_block_start', index: 0, content_block: { type: 'thinking' } });
  applyStreamEventToBlocks(state, { type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: 'Inspect. ' } });
  applyStreamEventToBlocks(state, { type: 'content_block_start', index: 1, content_block: { type: 'tool_use', id: 'read-1', name: 'Read' } });
  applyStreamEventToBlocks(state, { type: 'content_block_delta', index: 1, delta: { type: 'input_json_delta', partial_json: '{"file_path":"package.json"}' } });

  applyStreamEventToBlocks(state, { type: 'message_start' });
  applyStreamEventToBlocks(state, { type: 'content_block_start', index: 0, content_block: { type: 'text' } });
  applyStreamEventToBlocks(state, { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Done' } });

  assert.deepEqual(state.blocks, [
    { type: 'thinking', thinking: 'Inspect. ' },
    { type: 'tool_use', id: 'read-1', name: 'Read', input: { file_path: 'package.json' } },
    { type: 'text', text: 'Done' },
  ]);
});

test('streaming tool input keeps partial json until it becomes valid', () => {
  const state = createStreamingBlockState();
  applyStreamEventToBlocks(state, { type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: 'bash-1', name: 'Bash' } });
  applyStreamEventToBlocks(state, { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: '{"command"' } });
  assert.deepEqual(state.blocks[0].input, {});
  applyStreamEventToBlocks(state, { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: ':"npm test"}' } });
  assert.deepEqual(state.blocks[0].input, { command: 'npm test' });
});

test('streaming accumulator keeps tool_result blocks across later deltas', () => {
  const state = createStreamingBlockState();
  applyStreamEventToBlocks(state, { type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: 'bash-1', name: 'Bash' } });
  applyStreamEventToBlocks(state, { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: '{"command":"echo ok"}' } });
  appendToolResultBlock(state, { type: 'tool_result', tool_use_id: 'bash-1', content: 'ok', is_error: false });
  applyStreamEventToBlocks(state, { type: 'message_start' });
  applyStreamEventToBlocks(state, { type: 'content_block_start', index: 0, content_block: { type: 'text' } });
  applyStreamEventToBlocks(state, { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Finished' } });

  assert.deepEqual(state.blocks, [
    { type: 'tool_use', id: 'bash-1', name: 'Bash', input: { command: 'echo ok' } },
    { type: 'tool_result', tool_use_id: 'bash-1', content: 'ok', is_error: false },
    { type: 'text', text: 'Finished' },
  ]);
});

test('streaming text deltas follow ccgui cumulative-snapshot normalization', () => {
  const state = createStreamingBlockState();

  applyStreamEventToBlocks(state, { type: 'message_start' });
  applyStreamEventToBlocks(state, { type: 'content_block_start', index: 0, content_block: { type: 'text' } });
  applyStreamEventToBlocks(state, { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Hello' } });
  applyStreamEventToBlocks(state, { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Hello world' } });

  assert.equal(state.blocks[0].text, 'Hello world');
});

test('streaming thinking deltas follow ccgui cumulative-snapshot normalization', () => {
  const state = createStreamingBlockState();

  applyStreamEventToBlocks(state, { type: 'message_start' });
  applyStreamEventToBlocks(state, { type: 'content_block_start', index: 0, content_block: { type: 'thinking' } });
  applyStreamEventToBlocks(state, { type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: 'Plan' } });
  applyStreamEventToBlocks(state, { type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: 'Plan carefully' } });

  assert.equal(state.blocks[0].thinking, 'Plan carefully');
});

test('streaming normalizer resets block indexes at message_start like ccgui', () => {
  const state = createStreamingBlockState();

  applyStreamEventToBlocks(state, { type: 'message_start' });
  applyStreamEventToBlocks(state, { type: 'content_block_start', index: 0, content_block: { type: 'thinking' } });
  applyStreamEventToBlocks(state, { type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: 'Old turn' } });

  applyStreamEventToBlocks(state, { type: 'message_start' });
  applyStreamEventToBlocks(state, { type: 'content_block_start', index: 0, content_block: { type: 'thinking' } });
  applyStreamEventToBlocks(state, { type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: 'New turn' } });

  assert.deepEqual(state.blocks, [
    { type: 'thinking', thinking: 'Old turn' },
    { type: 'thinking', thinking: 'New turn' },
  ]);
});
