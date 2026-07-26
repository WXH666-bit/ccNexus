import test from 'node:test';
import assert from 'node:assert/strict';
import { buildThinkingOptions } from '../server/thinkingOptions.js';

test('requests summarized adaptive thinking blocks alongside the selected effort', () => {
  assert.deepEqual(buildThinkingOptions('high'), {
    thinking: { type: 'adaptive', display: 'summarized' },
    effort: 'high',
  });
});

test('uses the default effort when the client sends an unsupported value', () => {
  assert.deepEqual(buildThinkingOptions('not-a-level'), {
    thinking: { type: 'adaptive', display: 'summarized' },
    effort: 'high',
  });
});
