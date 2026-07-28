import test from 'node:test';
import assert from 'node:assert/strict';
import { buildThinkingOptions, normalizeReasoningEffort } from '../server/thinkingOptions.js';

test('passes SDK effort only when thinking is enabled', () => {
  assert.deepEqual(buildThinkingOptions('high', { thinkingEnabled: true }), {
    effort: 'high',
  });
});

test('does not pass SDK effort when thinking is disabled', () => {
  assert.deepEqual(buildThinkingOptions('high', { thinkingEnabled: false }), {});
});

test('uses fixed thinking tokens only when always thinking is enabled without a valid effort', () => {
  assert.deepEqual(buildThinkingOptions('not-a-level', { thinkingEnabled: true, alwaysThinkingEnabled: true }), {
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
