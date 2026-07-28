import test from 'node:test';
import assert from 'node:assert/strict';
import { buildThinkingOptions, normalizeReasoningEffort } from '../server/thinkingOptions.js';

test('passes ccgui SDK effort without adding a separate thinking option', () => {
  assert.deepEqual(buildThinkingOptions('high'), {
    effort: 'high',
  });
});

test('uses fixed thinking tokens only when always thinking is enabled without a valid effort', () => {
  assert.deepEqual(buildThinkingOptions('not-a-level', { alwaysThinkingEnabled: true }), {
    maxThinkingTokens: 10000,
  });
});

test('does not request fixed thinking tokens when always thinking is disabled', () => {
  assert.deepEqual(buildThinkingOptions('', { alwaysThinkingEnabled: false }), {});
});

test('normalizes ccgui supported effort levels', () => {
  assert.equal(normalizeReasoningEffort(' xhigh '), 'xhigh');
  assert.equal(normalizeReasoningEffort('not-a-level'), undefined);
});
