import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeStreamDelta,
  resetTurnBlockState,
  resolveSnapshotDelta,
} from '../src/utils/streamDeltaNormalizer.js';

function state() {
  return {
    textBlockContentByIndex: new Map(),
    thinkingBlockContentByIndex: new Map(),
    blockStreamModeByKey: new Map(),
  };
}

test('normalizes cumulative snapshot-style text deltas like ccgui', () => {
  const turn = state();

  assert.equal(normalizeStreamDelta(turn, 'text', 0, 'Hello'), 'Hello');
  assert.equal(normalizeStreamDelta(turn, 'text', 0, 'Hello world'), ' world');
});

test('keeps repeated incremental thinking tokens instead of swallowing them', () => {
  const turn = state();

  assert.equal(normalizeStreamDelta(turn, 'thinking', 0, '谢谢'), '谢谢');
  assert.equal(normalizeStreamDelta(turn, 'thinking', 0, '谢谢'), '谢谢');
  assert.equal(turn.thinkingBlockContentByIndex.get(0), '谢谢谢谢');
});

test('resets per-turn block state when SDK block indexes restart', () => {
  const turn = state();

  normalizeStreamDelta(turn, 'text', 0, 'Old');
  resetTurnBlockState(turn);

  assert.equal(normalizeStreamDelta(turn, 'text', 0, 'New'), 'New');
});

test('tail-fills assistant snapshots only when the block had previous streamed content', () => {
  const turn = state();

  normalizeStreamDelta(turn, 'text', 0, 'Ans');
  assert.deepEqual(resolveSnapshotDelta(turn, 'text', 0, 'Answer'), {
    delta: 'wer',
    hadPrevious: true,
  });
  assert.deepEqual(resolveSnapshotDelta(turn, 'thinking', 0, 'Plan'), {
    delta: 'Plan',
    hadPrevious: false,
  });
});
